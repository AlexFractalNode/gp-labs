<script setup lang="ts">
/**
 * Kernel-Baukasten (Spec §5). K(X, X) and the prior samples L·u (fixed u, so the curves morph) are recomputed at
 * most once per animation frame; the eigenvalue check runs 150 ms after the last change on 100 points. A kernel
 * whose check fails is never sampled (state error, error.notPsd). The 2D sample (40 × 40) is drawn in a worker.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n, type MessageKey } from '../../i18n'
import { useRoute, type RouteState } from '../../router'
import { buildHash, encodeKernel, parseHash } from '../../urlState'
import { GpError } from '../../core/errors'
import { standardNormals } from '../../core/gp'
import { checkValidity, kernelDiag, kernelMatrix, kernelTex, type KernelSpec } from '../../core/kernels'
import type { Mat } from '../../core/linalg'
import { createRng } from '../../core/rng'
import PlotFrame from '../../ui/PlotFrame.vue'
import LineLayer from '../../ui/LineLayer.vue'
import Heatmap from '../../ui/Heatmap.vue'
import Formula from '../../ui/Formula.vue'
import RefBadge from '../../ui/RefBadge.vue'
import LinearSlider from '../../ui/LinearSlider.vue'
import ScenarioArea from '../../ui/ScenarioArea.vue'
import { routeMatchesScenario } from '../scenarios'
import { useScenario } from '../useScenario'
import { expectedKernelsSettings, kernelsKey } from './scenarioKey'
import KernelBuilder from './KernelBuilder.vue'
import EigenBars from './EigenBars.vue'
import MarkerLayer from './MarkerLayer.vue'
import { KERNEL_PRESETS, loadKernelPreset, type LoadedKernelPreset, type PresetGroup } from './presets'
import {
  classifyEigenvalues,
  EIGEN_BARS,
  errorKey,
  GRID_2D,
  inputDimOf,
  kernelSlice,
  lineInputs,
  priorSamples,
  SAMPLE_COUNT,
  SAMPLE_N,
  sampleInputs,
  validityInputs,
  VALIDITY_N,
  type EigenBar,
} from './compute'
import { createSample2dClient } from './sample2d'

const { lang, t } = useI18n()
const route = useRoute()

const VALIDITY_DEBOUNCE_MS = 150
const PLOT_W = 760
const PLOT_H = 340
const SLICE_W = 440
const SLICE_H = 300

type PanelState = 'loading' | 'empty' | 'ready' | 'error'

// ------------------------------------------------------------------ state

const preset = shallowRef<LoadedKernelPreset>(loadKernelPreset(null).preset)
const spec = shallowRef<KernelSpec>(preset.value.spec)
const seed = ref(1)
const yDomain = ref<[number, number]>([-3, 3])
const x0 = ref(1)
const x0b = ref(2)

const inputDim = computed(() => inputDimOf(spec.value))
const is2D = computed(() => inputDim.value === 2)
const domain = computed(() => preset.value.domain)
const domain2 = computed<[number, number]>(() => preset.value.domain2 ?? preset.value.domain)
const modified = computed(() => JSON.stringify(spec.value) !== JSON.stringify(KERNEL_PRESETS[preset.value.name].spec))

const X1 = computed(() => lineInputs(domain.value, SAMPLE_N))
const X2 = computed(() => sampleInputs(domain.value, domain2.value, GRID_2D))
const u1 = computed(() => standardNormals(createRng(seed.value), SAMPLE_COUNT, SAMPLE_N))
const u2 = computed(() => standardNormals(createRng(seed.value), 1, GRID_2D * GRID_2D).data)

// ------------------------------------------------------------------ frame: K and samples (≤ 1 per frame)

interface Frame {
  spec: KernelSpec
  /** Heatmap matrix: K on the 1D sample grid, or on the 10 × 10 validity grid in 2D. */
  K: Mat | null
  samples: Float64Array[]
  sampleFailed: boolean
  error: MessageKey | null
}
const frame = shallowRef<Frame | null>(null)

function computeFrame() {
  const s = spec.value
  try {
    if (is2D.value) {
      const X = validityInputs(s, domain.value, domain2.value)
      frame.value = { spec: s, K: kernelMatrix(s, X, X, { sameSet: true }), samples: [], sampleFailed: false, error: null }
      return
    }
    const K = kernelMatrix(s, X1.value, X1.value, { sameSet: true })
    let samples: Float64Array[] = []
    let sampleFailed = false
    try {
      samples = priorSamples(K, u1.value)
    } catch (e) {
      if (!(e instanceof GpError) || e.code !== 'NotPositiveDefinite') throw e
      sampleFailed = true
    }
    frame.value = { spec: s, K, samples, sampleFailed, error: null }
  } catch (e) {
    if (!(e instanceof GpError)) console.error(e)
    frame.value = { spec: s, K: null, samples: [], sampleFailed: false, error: errorKey(e) }
  }
}

let rafId: number | null = null
function requestFrame() {
  if (rafId !== null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    computeFrame()
  })
}

// ------------------------------------------------------------------ validity (debounced)

interface Verdict {
  spec: KernelSpec
  valid: boolean
  bars: EigenBar[]
  minRel: number
  negatives: number
  n: number
  error: MessageKey | null
}
const verdict = shallowRef<Verdict | null>(null)

function computeVerdict() {
  const s = spec.value
  try {
    const X = validityInputs(s, domain.value, domain2.value)
    const r = checkValidity(kernelMatrix(s, X, X, { sameSet: true }))
    const all = classifyEigenvalues(r.eigenvalues, r.eigenvalues.length)
    verdict.value = {
      spec: s,
      valid: r.valid,
      bars: all.slice(0, EIGEN_BARS),
      minRel: r.minRel,
      negatives: all.filter((b) => b.cls === 'negative').length,
      n: X.rows,
      error: null,
    }
  } catch (e) {
    if (!(e instanceof GpError)) console.error(e)
    verdict.value = { spec: s, valid: false, bars: [], minRel: NaN, negatives: 0, n: 0, error: errorKey(e) }
  }
  request2d()
}

let validityTimer: ReturnType<typeof setTimeout> | null = null
function requestVerdict() {
  if (validityTimer !== null) clearTimeout(validityTimer)
  validityTimer = setTimeout(() => {
    validityTimer = null
    computeVerdict()
  }, VALIDITY_DEBOUNCE_MS)
}

// ------------------------------------------------------------------ 2D sample (worker, after a valid verdict)

const sample2d = shallowRef<{ spec: KernelSpec; seed: number; mat: Mat | null; error: MessageKey | null } | null>(null)
let client: ReturnType<typeof createSample2dClient> | null = null

function request2d() {
  const v = verdict.value
  const s = spec.value
  if (!is2D.value || !v || v.spec !== s || !v.valid) return
  const sd = seed.value
  if (sample2d.value?.spec === s && sample2d.value.seed === sd) return
  client ??= createSample2dClient()
  const X = X2.value
  client.request({ spec: s, X: X.data, cols: X.cols, u: u2.value }, (r) => {
    sample2d.value = r.ok
      ? { spec: s, seed: sd, mat: { rows: GRID_2D, cols: GRID_2D, data: r.sample }, error: null }
      : { spec: s, seed: sd, mat: null, error: errorKey(r.error) }
  })
}

// ------------------------------------------------------------------ derived panel states

const samplesView = computed<{ state: PanelState; error: MessageKey | null }>(() => {
  const s = spec.value
  const f = frame.value
  const v = verdict.value
  if (f?.spec === s && f.error) return { state: 'error', error: f.error }
  if (v?.spec === s && v.error) return { state: 'error', error: v.error }
  // Until the check of the current kernel is done, the last verdict counts (no flicker while dragging).
  if (v && !v.valid && !v.error) return { state: 'error', error: 'error.notPsd' }
  const current = v !== null && v.spec === s
  if (is2D.value) {
    const r = sample2d.value
    if (r && r.spec === s && r.seed === seed.value) return r.error ? { state: 'error', error: r.error } : { state: 'ready', error: null }
    return { state: 'loading', error: null }
  }
  if (!f) return { state: 'loading', error: null }
  if (f.sampleFailed) return current && v.valid ? { state: 'error', error: 'error.numerical' } : { state: 'loading', error: null }
  return { state: 'ready', error: null }
})

const validityView = computed<{ state: PanelState; error: MessageKey | null }>(() => {
  const v = verdict.value
  if (!v) return { state: 'loading', error: null }
  if (v.error) return { state: 'error', error: v.error }
  if (!v.valid) return { state: 'error', error: 'error.notPsd' }
  return { state: v.spec === spec.value ? 'ready' : 'loading', error: null }
})

const heatmapView = computed<{ state: PanelState; error: MessageKey | null }>(() => {
  const f = frame.value
  if (!f) return { state: 'loading', error: null }
  if (f.error) return { state: 'error', error: f.error }
  return { state: 'ready', error: null }
})

const showSamples = computed(() => samplesView.value.state === 'ready' && !is2D.value)
const samples = computed(() => (showSamples.value ? (frame.value?.samples ?? []) : []))

// ------------------------------------------------------------------ slice k(x, x₀)

const slice = computed<{ values: Float64Array; variance: number; mat?: Mat } | { error: MessageKey }>(() => {
  try {
    if (is2D.value) {
      const r = kernelSlice(spec.value, X2.value, [x0.value, x0b.value])
      return { ...r, mat: { rows: GRID_2D, cols: GRID_2D, data: r.values } }
    }
    return kernelSlice(spec.value, X1.value, [x0.value])
  } catch (e) {
    if (!(e instanceof GpError)) console.error(e)
    return { error: errorKey(e) }
  }
})
const sliceY = computed<[number, number]>(() => {
  const s = slice.value
  if ('error' in s) return [-1, 1]
  let lo = Math.min(0, s.variance)
  let hi = Math.max(0, s.variance)
  for (const v of s.values) {
    if (!Number.isFinite(v)) continue
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  if (!(hi > lo)) return [lo - 1, hi + 1]
  const pad = (hi - lo) * 0.08
  return [lo - pad, hi + pad]
})

const dragging = ref(false)
const clampX = (x: number, d: [number, number]) => Math.min(Math.max(x, d[0]), d[1])
function setX0(x: number) {
  x0.value = Number(clampX(x, domain.value).toPrecision(6))
}
function onSliceHover(p: { x: number } | null) {
  if (dragging.value && p) setX0(p.x)
}
function stopDrag() {
  dragging.value = false
}

// ------------------------------------------------------------------ loading / URL

/** Symmetric y range of the 1D sample plot: ±3·max sd on the grid. Not used in 2D mode (no 1D plot there). */
function fitAxes() {
  if (is2D.value) return
  try {
    const d = kernelDiag(spec.value, X1.value)
    let m = 0
    for (const v of d) if (Number.isFinite(v)) m = Math.max(m, v)
    const a = m > 0 ? 3 * Math.sqrt(m) : 1
    yDomain.value = [-a, a]
  } catch (e) {
    // A kernel that cannot be evaluated on the grid (e.g. log warp at x ≤ 0) keeps the old axes; the samples panel
    // reports the same GpError as its error state.
    if (!(e instanceof GpError)) throw e
  }
}

const presetParam = computed(() => route.value.params.get('preset'))

/**
 * Loads the preset from the address. `withScenario` (default) adopts the spec of a matching scenario; "Preset neu
 * laden" passes false and gets the plain gallery spec, so "modified" disappears and a standing scenario shows
 * "changed" (Spec §3.3).
 */
function load(withScenario = true) {
  const { preset: p } = loadKernelPreset(presetParam.value)
  preset.value = p
  spec.value = (withScenario ? scenarioSpec() : null) ?? p.spec
  seed.value = p.seed ?? 1
  x0.value = (p.domain[0] + p.domain[1]) / 2
  const d2 = p.domain2 ?? p.domain
  x0b.value = (d2[0] + d2[1]) / 2
  frame.value = null
  verdict.value = null
  sample2d.value = null
  fitAxes()
  computeFrame()
  requestVerdict()
}

/**
 * Spec of the active scenario when the address matches it (Spec §3.3), as a deep copy (the registry stays
 * untouched); null otherwise, e.g. after a gallery switch with a standing `scenario` or after closing the box.
 */
function scenarioSpec(): KernelSpec | null {
  const s = scenario.active.value
  if (s === null || s.kernels === undefined || !routeMatchesScenario(route.value.params, s)) return null
  return JSON.parse(JSON.stringify(s.kernels.spec)) as KernelSpec
}

/**
 * Loads once per route object (Spec §3.3): the preset watcher, the scenario adoption and the mount all land here,
 * so watcher order and double triggers do not matter, and `refreshRoute` (a new route object) always reloads.
 * "Reset" (`resetPreset`) and `selectPreset` on the same address still call `load()` directly.
 */
let loadedFor: RouteState | null = null
function loadOnce() {
  if (loadedFor === route.value) return
  loadedFor = route.value
  load()
}

/** "Preset neu laden": restores the chosen gallery example (spec, seed, x₀), ignoring a standing scenario. */
function resetPreset() {
  load(false)
}

function selectPreset(name: string) {
  const params = parseHash(window.location.hash).params
  params.set('preset', name)
  const hash = buildHash('kernels', Object.fromEntries(params))
  if (window.location.hash === hash) load()
  else window.location.hash = hash
}

/** Structure (kinds, warps, input modes): a change refits the sample axes. */
const structure = computed(() =>
  JSON.stringify(spec.value.terms.map((term) => term.map((f) => [f.kind, f.warp?.kind, f.ard, f.activeDims]))),
)
watch(structure, fitAxes)
watch(spec, () => {
  requestFrame()
  requestVerdict()
})
watch(seed, () => {
  requestFrame()
  request2d()
})
watch(presetParam, () => {
  if (route.value.route === 'kernels') loadOnce()
})

const scenario = useScenario('kernels', {
  adopt: loadOnce,
  liveKey: () => kernelsKey({ preset: preset.value.name, spec: spec.value }),
  expectedKey: (s) => kernelsKey(expectedKernelsSettings(s)),
})

onMounted(() => {
  loadOnce()
  window.addEventListener('pointerup', stopDrag)
  window.addEventListener('pointercancel', stopDrag)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerup', stopDrag)
  window.removeEventListener('pointercancel', stopDrag)
  if (rafId !== null) cancelAnimationFrame(rafId)
  if (validityTimer !== null) clearTimeout(validityTimer)
  client?.dispose()
  client = null
})

// ------------------------------------------------------------------ hand-over (Playground, Daten-Lab)

/** Reason why the current kernel cannot be transferred yet: check still pending (debounce) or kernel invalid. */
const validityBlocked = computed<MessageKey | null>(() => {
  const v = verdict.value
  if (!v || v.spec !== spec.value) return 'kernels.transfer.pending'
  if (!v.valid || v.error) return 'kernels.playground.disabledInvalid'
  return null
})
/** The Playground is 1D; the Daten-Lab also takes 2D kernels (it makes ARD / activeDims isotropic, Spec §6). */
const playgroundBlocked = computed<MessageKey | null>(() =>
  is2D.value ? 'kernels.playground.disabled2d' : validityBlocked.value,
)
const datalabBlocked = computed<MessageKey | null>(() => validityBlocked.value)
/** Distinct reasons, each shown once; a button points at its reason via aria-describedby. */
const blockedReasons = computed(() => [
  ...new Set([playgroundBlocked.value, datalabBlocked.value].filter((r): r is MessageKey => r !== null)),
])
const reasonId = (r: MessageKey | null) => (r ? `transfer-blocked-${blockedReasons.value.indexOf(r)}` : undefined)

function usePlayground() {
  if (playgroundBlocked.value) return
  window.location.hash = buildHash('playground', { kernel: encodeKernel(spec.value) })
}
function useDatalab() {
  if (datalabBlocked.value) return
  window.location.hash = buildHash('datalab', { kernel: encodeKernel(spec.value) })
}

// ------------------------------------------------------------------ display

const formula = computed(() => {
  try {
    return kernelTex(spec.value, { inputDim: inputDim.value })
  } catch (e) {
    if (!(e instanceof GpError)) throw e
    return null
  }
})

const GROUPS: PresetGroup[] = ['gallery', 'combination', 'validity']
const presetsByGroup = GROUPS.map((g) => ({
  group: g,
  names: Object.keys(KERNEL_PRESETS).filter((n) => KERNEL_PRESETS[n].group === g),
}))
const presetLabel = (name: string) => {
  const code = KERNEL_PRESETS[name].ref.code
  const label = t(`kernels.preset.${name}` as MessageKey)
  return code ? t('kernels.presetWithCode', { label, code }) : label
}

const num = (digits: number) => new Intl.NumberFormat(lang.value, { maximumFractionDigits: digits })
const sci = computed(() => new Intl.NumberFormat(lang.value, { notation: 'scientific', maximumFractionDigits: 2 }))
const varianceText = computed(() => {
  const s = slice.value
  return 'error' in s ? '' : t('kernels.slice.variance', { v: num(3).format(s.variance) })
})
const axesText = computed(() =>
  t('kernels.sample2d.axes', {
    a: num(2).format(domain.value[0]),
    b: num(2).format(domain.value[1]),
    c: num(2).format(domain2.value[0]),
    d: num(2).format(domain2.value[1]),
  }),
)
const sampleMat = computed(() => sample2d.value?.mat ?? null)
const sample2dStale = computed(() => samplesView.value.state === 'loading' && sampleMat.value !== null)
const x0Step = computed(() => (domain.value[1] - domain.value[0]) / 200)
const x0bStep = computed(() => (domain2.value[1] - domain2.value[0]) / 200)
</script>

<template>
  <div class="kb" data-verify-unit="kernel-view" data-verify-state="ready" :data-verify-preset="preset.name">
    <header class="kb-head">
      <div class="titles">
        <h2 class="title">{{ t('kernels.title') }}</h2>
        <p class="lead">{{ t('kernels.lead') }}</p>
      </div>
      <div class="gallery">
        <label class="gallery-label" for="kernel-preset">{{ t('kernels.gallery') }}</label>
        <select id="kernel-preset" :value="preset.name" @change="selectPreset(($event.target as HTMLSelectElement).value)">
          <optgroup v-for="g in presetsByGroup" :key="g.group" :label="t(`kernels.group.${g.group}`)">
            <option v-for="n in g.names" :key="n" :value="n">{{ presetLabel(n) }}</option>
          </optgroup>
        </select>
        <RefBadge :chapter="preset.ref.chapter" :code="preset.ref.code || undefined" />
      </div>
    </header>

    <ScenarioArea tool="kernels" :scenario="scenario" />

    <p class="note">
      <span>{{ t(`kernels.note.${preset.name}` as MessageKey) }}</span>
      <span v-if="modified" class="tag">{{ t('kernels.modified') }}</span>
      <button v-if="modified" type="button" class="btn small-btn" @click="resetPreset">{{ t('kernels.reset') }}</button>
    </p>

    <div class="kb-grid">
      <div class="main-col">
        <section class="panel formula-panel" :aria-label="t('kernels.formula')">
          <Formula v-if="formula" :tex="formula" display />
          <p v-else class="muted formula-error" role="status">{{ t('kernels.formulaError') }}</p>
        </section>

        <section
          class="panel samples"
          data-verify-unit="kernel-samples"
          :data-verify-state="samplesView.state"
          :data-verify-error="samplesView.state === 'error' ? samplesView.error : undefined"
          :data-verify-mode="is2D ? '2d' : '1d'"
          :data-verify-count="is2D ? (samplesView.state === 'ready' ? 1 : 0) : samples.length"
          :aria-label="is2D ? t('kernels.sample2d.title') : t('kernels.samples.label')"
        >
          <header class="panel-head">
            <h3>{{ is2D ? t('kernels.sample2d.title') : t('kernels.samples.title') }}</h3>
            <div class="tools">
              <button type="button" class="btn" @click="seed++">{{ t('kernels.samples.redraw') }}</button>
              <span class="muted tabular">{{ t('kernels.samples.seed', { seed }) }}</span>
              <button v-if="!is2D" type="button" class="btn" @click="fitAxes">{{ t('kernels.samples.fitAxes') }}</button>
            </div>
          </header>
          <div v-if="!is2D" class="plot-box">
            <PlotFrame
              :x-domain="domain"
              :y-domain="yDomain"
              :width="PLOT_W"
              :height="PLOT_H"
              :x-label="t('kernels.samples.xLabel')"
              :y-label="t('kernels.samples.yLabel')"
            >
              <g v-for="(s, k) in samples" :key="k" :data-sample="k">
                <LineLayer :x="X1.data" :y="s" variant="sample" />
              </g>
            </PlotFrame>
            <p v-if="samplesView.state === 'error'" class="overlay error" role="alert">{{ t(samplesView.error!) }}</p>
          </div>
          <div v-else class="map-box">
            <div class="map" :class="{ stale: sample2dStale }">
              <Heatmap v-if="sampleMat" :matrix="sampleMat" diverging :label="t('kernels.sample2d.label')" />
              <div v-else class="map-placeholder" />
              <p v-if="samplesView.state === 'error'" class="overlay error" role="alert">{{ t(samplesView.error!) }}</p>
              <p v-else-if="samplesView.state === 'loading'" class="overlay" role="status">{{ t('kernels.sample2d.computing') }}</p>
            </div>
            <p class="muted small">{{ axesText }}</p>
          </div>
          <p class="muted small">{{ t('kernels.samples.hint') }}</p>
        </section>

        <div class="two-up">
          <section
            class="panel"
            data-verify-unit="kernel-heatmap"
            :data-verify-state="heatmapView.state"
            :data-verify-error="heatmapView.state === 'error' ? heatmapView.error : undefined"
            :data-verify-count="frame?.K ? frame.K.rows : 0"
          >
            <header class="panel-head"><h3 class="no-caps">{{ t('kernels.cov.title') }}</h3></header>
            <div class="map">
              <Heatmap v-if="frame?.K" :matrix="frame.K" diverging :label="t('kernels.cov.label')" />
              <div v-else class="map-placeholder" />
              <p v-if="heatmapView.state === 'error'" class="overlay error" role="alert">{{ t(heatmapView.error!) }}</p>
            </div>
            <p class="muted small">{{ is2D ? t('kernels.cov.note2d') : t('kernels.cov.note1d') }}</p>
          </section>

          <section
            class="panel"
            data-verify-unit="kernel-slice"
            :data-verify-state="'error' in slice ? 'error' : 'ready'"
            :data-verify-error="'error' in slice ? slice.error : undefined"
          >
            <header class="panel-head"><h3 class="no-caps">{{ t('kernels.slice.title') }}</h3></header>
            <template v-if="!is2D">
              <div class="plot-box" @pointerdown="dragging = true">
                <PlotFrame
                  :x-domain="domain"
                  :y-domain="sliceY"
                  :width="SLICE_W"
                  :height="SLICE_H"
                  :x-label="t('kernels.samples.xLabel')"
                  :y-label="t('kernels.slice.yLabel')"
                  @plot-click="setX0($event.x)"
                  @plot-hover="onSliceHover"
                >
                  <LineLayer v-if="!('error' in slice)" :x="X1.data" :y="slice.values" variant="f" />
                  <MarkerLayer :x="x0" :y="'error' in slice ? null : slice.variance" />
                </PlotFrame>
                <p v-if="'error' in slice" class="overlay error" role="alert">{{ t(slice.error) }}</p>
              </div>
              <LinearSlider
                :model-value="x0"
                :min="domain[0]"
                :max="domain[1]"
                :step="x0Step"
                :label="t('kernels.slice.x0')"
                @update:model-value="setX0"
              />
              <p class="muted small">{{ varianceText }} · {{ t('kernels.slice.hint') }}</p>
            </template>
            <template v-else>
              <div class="map">
                <Heatmap
                  v-if="!('error' in slice) && slice.mat"
                  :matrix="slice.mat"
                  diverging
                  :label="t('kernels.slice.label2d')"
                />
                <div v-else class="map-placeholder" />
                <p v-if="'error' in slice" class="overlay error" role="alert">{{ t(slice.error) }}</p>
              </div>
              <LinearSlider
                :model-value="x0"
                :min="domain[0]"
                :max="domain[1]"
                :step="x0Step"
                :label="t('kernels.slice.x01')"
                @update:model-value="x0 = $event"
              />
              <LinearSlider
                :model-value="x0b"
                :min="domain2[0]"
                :max="domain2[1]"
                :step="x0bStep"
                :label="t('kernels.slice.x02')"
                @update:model-value="x0b = $event"
              />
              <p class="muted small">{{ varianceText }} · {{ axesText }}</p>
            </template>
          </section>
        </div>

        <section
          class="panel"
          data-verify-unit="kernel-validity"
          :data-verify-state="validityView.state"
          :data-verify-error="validityView.state === 'error' ? validityView.error : undefined"
          :data-verify-count="verdict?.bars.length ?? 0"
          :data-verify-negatives="verdict?.negatives ?? 0"
        >
          <header class="panel-head">
            <h3>{{ t('kernels.validity.title') }}</h3>
            <RefBadge chapter="8.5" />
          </header>
          <p class="muted small">{{ t('kernels.validity.lead', { bars: EIGEN_BARS, n: verdict?.n || VALIDITY_N }) }}</p>
          <div class="eigen-box" :class="{ stale: validityView.state === 'loading' && verdict }">
            <EigenBars v-if="verdict && verdict.bars.length" :bars="verdict.bars" :label="t('kernels.validity.chartLabel')" />
          </div>
          <ul class="eigen-legend" aria-hidden="true">
            <li><span class="sw positive" />{{ t('kernels.validity.legendPositive') }}</li>
            <li><span class="sw zero" />{{ t('kernels.validity.legendZero') }}</li>
            <li><span class="sw negative" />{{ t('kernels.validity.legendNegative') }}</li>
          </ul>
          <p v-if="!verdict" class="muted" role="status">{{ t('kernels.validity.checking') }}</p>
          <p v-else-if="verdict.error" class="verdict bad" role="alert">{{ t(verdict.error) }}</p>
          <p v-else class="verdict" :class="verdict.valid ? 'good' : 'bad'" :role="verdict.valid ? undefined : 'alert'">
            <strong>{{
              verdict.valid ? t('kernels.validity.valid') : t('kernels.validity.invalid', { count: verdict.negatives })
            }}</strong>
            <span class="min-rel tabular">{{ t('kernels.validity.minRel', { v: sci.format(verdict.minRel) }) }}</span>
          </p>
        </section>
      </div>

      <aside class="side">
        <section class="panel" aria-labelledby="builder-title">
          <header class="panel-head">
            <h3 id="builder-title">{{ t('kernels.builder.title') }}</h3>
            <RefBadge chapter="13.4" />
          </header>
          <KernelBuilder :spec="spec" :input-dim="inputDim" @update:spec="spec = $event" />
        </section>
        <section class="panel handover">
          <div class="handover-buttons">
            <button
              type="button"
              class="btn primary"
              :disabled="playgroundBlocked !== null"
              :aria-describedby="reasonId(playgroundBlocked)"
              data-action="use-in-playground"
              @click="usePlayground"
            >
              {{ t('kernels.playground.use') }}
            </button>
            <button
              type="button"
              class="btn"
              :disabled="datalabBlocked !== null"
              :aria-describedby="reasonId(datalabBlocked)"
              data-action="use-in-datalab"
              @click="useDatalab"
            >
              {{ t('kernels.transfer.useDatalab') }}
            </button>
          </div>
          <p
            v-for="(r, i) in blockedReasons"
            :id="`transfer-blocked-${i}`"
            :key="r"
            class="muted small"
            :data-blocked-reason="r"
          >
            {{ t(r) }}
          </p>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.kb {
  --serif: 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif;
  max-width: 1320px;
  margin: 0 auto;
  display: grid;
  gap: 1rem;
}
.kb-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--border);
}
.title {
  margin: 0;
  font-family: var(--serif);
  font-size: 1.75rem;
  font-weight: 600;
  letter-spacing: 0.005em;
}
.lead {
  margin: 0.25rem 0 0;
  max-width: 62ch;
  color: var(--text-muted);
  font-size: 0.95rem;
}
.gallery {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.gallery-label,
h3 {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.gallery select {
  font: inherit;
  font-size: 0.9rem;
  padding: 0.3rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  color: var(--text);
  max-width: 100%;
}
.gallery select:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.note {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  font-family: var(--serif);
  font-style: italic;
  font-size: 1rem;
}
.tag {
  font-family: system-ui, sans-serif;
  font-style: normal;
  font-size: 0.75rem;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--focus);
  color: var(--focus);
}
.min-rel {
  display: block;
  margin-top: 0.15rem;
}
h3.no-caps {
  text-transform: none;
  letter-spacing: 0.02em;
  font-size: 0.85rem;
}
.btn.small-btn {
  font-style: normal;
  font-family: system-ui, sans-serif;
}
.kb-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 1.5rem;
  align-items: start;
}
@media (max-width: 960px) {
  .kb-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.main-col,
.side {
  display: grid;
  gap: 1rem;
  min-width: 0;
}
.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.85rem 1rem;
  min-width: 0;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}
.formula-panel {
  font-size: 0.95rem;
  min-height: 2.6rem;
  padding: 0.4rem 1rem;
}
.formula-error {
  margin: 0.5rem 0;
}
.tools {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.plot-box {
  position: relative;
}
.two-up {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}
@media (max-width: 760px) {
  .two-up {
    grid-template-columns: minmax(0, 1fr);
  }
}
.map-box {
  display: grid;
  justify-items: center;
}
.map {
  position: relative;
  width: 100%;
  max-width: 420px;
  margin: 0 auto;
}
.map-placeholder {
  width: 100%;
  aspect-ratio: 1;
  border: 1px dashed var(--border);
}
.stale {
  opacity: 0.45;
}
.overlay {
  position: absolute;
  left: 50%;
  top: 1.25rem;
  transform: translateX(-50%);
  margin: 0;
  width: max-content;
  max-width: min(86%, 46ch);
  padding: 0.45rem 0.8rem;
  border-radius: 4px;
  font-size: 0.85rem;
  text-align: center;
  pointer-events: none;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.overlay.error {
  border-color: var(--error);
  border-left-width: 4px;
  color: var(--text);
  background: var(--error-bg);
}
/* Five distinguishable sample colours (each ≥ 3:1 on the surface). */
.samples :deep([data-sample='1'] path) {
  stroke: var(--c-f);
}
.samples :deep([data-sample='2'] path) {
  stroke: var(--c-y);
}
.samples :deep([data-sample='3'] path) {
  stroke: var(--c-prior);
}
.samples :deep([data-sample='4'] path) {
  stroke: var(--c-truth);
}
.samples :deep([data-variant='sample'] path) {
  stroke-width: 1.6;
}
.eigen-box {
  min-height: 3rem;
}
.eigen-legend {
  list-style: none;
  margin: 0.25rem 0 0.4rem;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 1rem;
  font-size: 0.8rem;
  color: var(--text-muted);
}
.eigen-legend li {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.sw {
  width: 0.8rem;
  height: 0.8rem;
  border-radius: 2px;
  display: inline-block;
}
.sw.positive {
  background: var(--accent);
}
.sw.zero {
  background: var(--text-muted);
  opacity: 0.7;
}
.sw.negative {
  background: var(--error);
}
.verdict {
  margin: 0.25rem 0 0;
  padding: 0.45rem 0.7rem;
  border-radius: 4px;
  border-left: 4px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  font-size: 0.9rem;
}
.verdict.bad {
  border-left-color: var(--error);
  background: var(--error-bg);
}
.handover {
  display: grid;
  gap: 0.4rem;
}
.handover-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.btn {
  font: inherit;
  font-size: 0.85rem;
  padding: 0.3rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
.btn:hover:not(:disabled) {
  border-color: var(--accent);
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--surface);
  font-weight: 600;
  padding: 0.5rem 0.75rem;
}
.muted {
  color: var(--text-muted);
  font-size: 0.85rem;
}
.small {
  font-size: 0.8rem;
  margin: 0.4rem 0 0;
}
.tabular {
  font-variant-numeric: tabular-nums;
}
</style>
