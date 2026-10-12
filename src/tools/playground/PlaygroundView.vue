<script setup lang="ts">
/**
 * GP-Playground (Spec §4): interactive 1D GP regression. Heavy work runs through latest-wins schedulers
 * (≤ 1 recompute per 100 ms on GRID_N points); when a full recompute took > 80 ms, pointer drags update only the
 * mean and the bands follow on release.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useI18n, type MessageKey } from '../../i18n'
import { notify } from '../../notify'
import { useRoute } from '../../router'
import { buildHash, KERNEL_PARAM, parseHash } from '../../urlState'
import { GpError } from '../../core/errors'
import { modelParams, withModelLogParams, type GpModel } from '../../core/gp'
import { kernelTex, type KernelSpec } from '../../core/kernels'
import type { MeanSpec } from '../../core/mean'
import { startOptimize, type OptimizeHandle } from '../../worker/client'
import PlotFrame from '../../ui/PlotFrame.vue'
import BandLayer from '../../ui/BandLayer.vue'
import LineLayer from '../../ui/LineLayer.vue'
import PointLayer from '../../ui/PointLayer.vue'
import Heatmap from '../../ui/Heatmap.vue'
import LogSlider from '../../ui/LogSlider.vue'
import ParamSliders from '../../ui/ParamSliders.vue'
import Formula from '../../ui/Formula.vue'
import RefBadge from '../../ui/RefBadge.vue'
import CursorLayer from './CursorLayer.vue'
import Inspector from './Inspector.vue'
import { inspectAt, type InspectResult } from './inspect'
import { startTween, type TweenHandle } from './tween'
import { loadPreset, type PlaygroundState } from './presets'
import {
  computeGrid,
  computeMeanOnly,
  fitTraining,
  logMarginalLikelihoodValue,
  fitYDomain,
  MAX_POINTS,
  NO_NOTICE_FLAGS,
  noticeTransitions,
  resolveKernel,
  SAMPLE_COUNT,
  SIGMA_N_BOUNDS,
  type GridResult,
  type NoticeFlags,
  type Point,
  type TrainingFit,
} from './compute'

const { lang, t } = useI18n()
const route = useRoute()

const MIN_GAP_MS = 100
const INSPECT_GAP_MS = 50
const SLOW_MS = 80
const LOGML_IDLE_MS = 250
const TWEEN_MS = 400
const RESTARTS = 3
const PLOT_W = 760
const PLOT_H = 440

// ------------------------------------------------------------------ model state

type MeanKind = 'zero' | 'constant' | 'linear' | 'glsConstant' | 'glsLinear'
const MEAN_KINDS: MeanKind[] = ['zero', 'constant', 'linear', 'glsConstant', 'glsLinear']

const points = shallowRef<Point[]>([])
const view = ref<[number, number]>([0, 1])
const yDomain = ref<[number, number]>([-3, 3])
const truth = shallowRef<((x: number) => number) | undefined>(undefined)
const seed = ref(1)
const kernel = shallowRef<KernelSpec>({ terms: [[{ kind: 'rbf', params: { sigma: 1, ell: 1 } }]] })
const kernelFromUrl = ref(false)
const sigmaN = ref(0.4)
const sigmaAnchor = ref(0.4)
const meanKind = ref<MeanKind>('zero')
const meanC = ref(0)
const meanA = ref(0)
const meanB = ref(0)

const finite = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const mean = computed<MeanSpec>(() => {
  switch (meanKind.value) {
    case 'constant':
      return { kind: 'constant', c: finite(meanC.value) }
    case 'linear':
      return { kind: 'linear', a: finite(meanA.value), b: [finite(meanB.value)] }
    case 'glsConstant':
      return { kind: 'gls', basis: 'constant' }
    case 'glsLinear':
      return { kind: 'gls', basis: 'linear' }
    default:
      return { kind: 'zero' }
  }
})
const model = computed<GpModel>(() => ({ kernel: kernel.value, sigmaN: sigmaN.value, mean: mean.value }))
const isGls = computed(() => mean.value.kind === 'gls')

const layers = reactive({
  points: true,
  mean: true,
  fBand: true,
  yBand: true,
  samples: false,
  priorMean: false,
  truth: true,
})
const sampleChoice = ref<'posterior' | 'prior'>('posterior')
const sampleSource = computed(() => (points.value.length === 0 ? 'prior' : sampleChoice.value))
const covOpen = ref(false)

const presetName = computed(() => route.value.params.get('preset'))
const showHyper = computed(() => /^hyper(-4[357])?$/.test(presetName.value ?? ''))
const activeHyper = computed(() => (presetName.value === 'hyper' ? 'hyper-43' : presetName.value))

// ------------------------------------------------------------------ results

const grid = shallowRef<GridResult | null>(null)
/** Mean shown on the plot; ahead of `grid` during a mean-only drag. */
const shownMean = shallowRef<Float64Array | null>(null)
const stale = ref(false)
const plotError = ref<string | null>(null)
const logML = ref<number | null>(null)

const hoverX = ref<number | null>(null)
const pinnedX = ref<number | null>(null)
const inspectX = computed(() => pinnedX.value ?? hoverX.value ?? (view.value[0] + view.value[1]) / 2)
const inspection = shallowRef<InspectResult | null>(null)
const inspectError = ref<string | null>(null)

// ------------------------------------------------------------------ scheduling

/** Latest-wins throttle: at most one run per `gap` ms (measured from the end of the previous run). */
function throttle(fn: () => void, gap: number) {
  let last = -Infinity
  let timer: ReturnType<typeof setTimeout> | null = null
  const run = () => {
    timer = null
    fn()
    last = performance.now()
  }
  return {
    request() {
      if (timer !== null) return
      timer = setTimeout(run, Math.max(0, gap - (performance.now() - last)))
    },
    now() {
      if (timer !== null) clearTimeout(timer)
      run()
    },
    cancel() {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}

let lastFullMs = 0
const pointerActive = ref(false)
const tweening = ref(false)
const interacting = computed(() => pointerActive.value || tweening.value)

const errorCode = (e: unknown) => (e instanceof GpError ? e.code : 'Error')

/**
 * One core fit (Cholesky of C_X) per (model, points), shared by grid, mean-only path, log-ML and inspector.
 * `model` and `points` are replaced on every change, so identity is the cache key.
 */
let fitCache: { model: GpModel; points: Point[]; training: TrainingFit } | null = null
function currentFit(): TrainingFit {
  const m = model.value
  const pts = points.value
  if (fitCache && fitCache.model === m && fitCache.points === pts) return fitCache.training
  const training = fitTraining(m, pts) // may throw GpError (e.g. NotPositiveDefinite)
  fitCache = { model: m, points: pts, training }
  return training
}

/** A mean-only update happened since the last full recompute (bands, samples and log-ML are behind). */
let fullPending = false
let noticeFlags: NoticeFlags = NO_NOTICE_FLAGS

function recompute() {
  const m = model.value
  const pts = points.value
  const meanOnly = interacting.value && lastFullMs > SLOW_MS && grid.value !== null && plotError.value === null
  try {
    if (meanOnly) {
      fullPending = true
      const mm = computeMeanOnly(m, grid.value!.xs, currentFit())
      if (mm) {
        shownMean.value = mm
        stale.value = true
      }
      return
    }
    const t0 = performance.now()
    const r = computeGrid(m, pts, view.value, {
      samples: layers.samples ? sampleSource.value : null,
      seed: seed.value,
      cov: covOpen.value,
      training: currentFit(),
    })
    lastFullMs = performance.now() - t0
    fullPending = false
    grid.value = r
    shownMean.value = r.mean
    stale.value = false
    plotError.value = null
    const { next, raised } = noticeTransitions(noticeFlags, r)
    noticeFlags = next
    if (raised.includes('jitter')) notify('notice.jitter', { jitter: formatJitter(r.jitter) })
    if (raised.includes('gls')) notify('notice.glsUnderdetermined')
    if (raised.includes('samples')) notify('notice.samplesFailed')
    logMLTimer.request()
  } catch (e) {
    if (!(e instanceof GpError)) console.error(e)
    plotError.value = errorCode(e)
  }
}
const recomputer = throttle(recompute, MIN_GAP_MS)

function updateLogML() {
  try {
    logML.value = logMarginalLikelihoodValue(currentFit())
  } catch (e) {
    if (!(e instanceof GpError)) console.error(e)
    logML.value = null
  }
}
// Debounced: cheap with the shared fit, but not needed while sliders move.
const logMLTimer = (() => {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    request() {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        updateLogML()
      }, LOGML_IDLE_MS)
    },
    cancel() {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
})()

const playgroundState = (): PlaygroundState => ({
  points: points.value,
  model: model.value,
  view: view.value,
  showPriorSamples: layers.samples,
  seed: seed.value,
})
function inspect() {
  try {
    const fit = currentFit().fit
    inspection.value = inspectAt(playgroundState(), inspectX.value, fit ? { fit } : undefined)
    inspectError.value = null
  } catch (e) {
    if (!(e instanceof GpError)) console.error(e)
    inspectError.value = t('playground.errorMsg', { code: errorCode(e) })
  }
}
const inspector = throttle(inspect, INSPECT_GAP_MS)

watch([model, points, () => layers.samples, sampleSource, seed, covOpen], () => recomputer.request())
watch([inspectX, model, points], () => inspector.request())
watch(points, () => {
  if (points.value.length === 0) logML.value = null
})
watch(sigmaN, (v) => {
  if (Math.abs(Math.log(v / sigmaAnchor.value)) > 4) sigmaAnchor.value = v
})

function onPointerUp() {
  if (!pointerActive.value) return
  pointerActive.value = false
  if (fullPending) recomputer.request()
}

// ------------------------------------------------------------------ loading

function meanKindOf(m: MeanSpec): MeanKind {
  if (m.kind === 'gls') return m.basis === 'linear' ? 'glsLinear' : 'glsConstant'
  return m.kind
}

function load() {
  cancelOptimize()
  const params = route.value.params
  const { state, unknown } = loadPreset(params.get('preset'))
  if (unknown) notify('notice.unknownPreset')
  const resolved = resolveKernel(params.get(KERNEL_PARAM), state.model)
  for (const key of resolved.notices) notify(key)

  points.value = state.points
  view.value = state.view
  truth.value = state.truth
  seed.value = state.seed
  kernel.value = resolved.model.kernel
  kernelFromUrl.value = resolved.fromUrl
  sigmaN.value = resolved.model.sigmaN
  sigmaAnchor.value = resolved.model.sigmaN
  const m = state.model.mean
  meanKind.value = meanKindOf(m)
  meanC.value = m.kind === 'constant' ? m.c : 0
  meanA.value = m.kind === 'linear' ? m.a : m.kind === 'constant' ? m.c : 0
  meanB.value = m.kind === 'linear' ? (m.b[0] ?? 0) : 0

  layers.points = true
  layers.mean = true
  layers.fBand = true
  layers.yBand = true
  layers.samples = state.showPriorSamples
  layers.priorMean = m.kind !== 'zero'
  layers.truth = state.truth !== undefined
  sampleChoice.value = 'posterior'

  const xParam = params.get('x')
  const x = xParam === null || xParam.trim() === '' ? NaN : Number(xParam)
  pinnedX.value = Number.isFinite(x) ? x : null
  if (xParam !== null && !Number.isFinite(x)) notify('notice.invalidX')
  hoverX.value = null
  logML.value = null
  lastFullMs = 0
  fullPending = false
  noticeFlags = NO_NOTICE_FLAGS

  fitAxes()
  recomputer.now()
  inspector.now()
}

function fitAxes() {
  yDomain.value = fitYDomain(model.value, points.value, view.value, truth.value)
}

const presetKey = computed(() => `${route.value.route}|${presetName.value}|${route.value.params.get(KERNEL_PARAM)}`)
watch(presetKey, () => {
  if (route.value.route === 'playground') load()
})
// A changed mean moves the curves vertically: refit the axes once per change.
watch(meanKind, fitAxes)

onMounted(() => {
  load()
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  recomputer.cancel()
  inspector.cancel()
  logMLTimer.cancel()
  cancelOptimize()
})

// ------------------------------------------------------------------ points

const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, Math.min(a, b)), Math.max(a, b))
const clampPoint = (p: Point): Point => ({
  x: clamp(p.x, view.value[0], view.value[1]),
  y: clamp(p.y, yDomain.value[0], yDomain.value[1]),
})

function addPoint(p: Point) {
  if (points.value.length >= MAX_POINTS) {
    notify('notice.maxPoints')
    return
  }
  cancelOptimize()
  points.value = [...points.value, clampPoint(p)]
}
function dragPoint(i: number, p: Point) {
  cancelOptimize()
  const next = points.value.slice()
  next[i] = clampPoint(p)
  points.value = next
}
function removePoint(i: number) {
  cancelOptimize()
  points.value = points.value.filter((_, k) => k !== i)
}
function clearPoints() {
  cancelOptimize()
  points.value = []
}
/** Many points: smaller dots and hit targets, drawn below the curves. */
const dense = computed(() => points.value.length > 60)
const px = computed(() => points.value.map((p) => p.x))
const py = computed(() => points.value.map((p) => p.y))

// ------------------------------------------------------------------ inspector / URL

function onHover(p: { x: number } | null) {
  if (p) hoverX.value = p.x
}
/** Rewrites the hash query from the live location (replaceState does not update the router state). */
function setHash(mutate: (p: URLSearchParams) => void, replace: boolean) {
  const p = parseHash(window.location.hash).params
  mutate(p)
  const hash = buildHash('playground', Object.fromEntries(p))
  if (replace) history.replaceState(history.state, '', hash)
  else window.location.hash = hash
}
function pin(x: number) {
  pinnedX.value = x
  setHash((p) => p.set('x', String(Number(x.toPrecision(6)))), true)
}
function unpin() {
  pinnedX.value = null
  setHash((p) => p.delete('x'), true)
}
function switchHyper(name: string) {
  setHash((p) => {
    p.set('preset', name)
    p.delete(KERNEL_PARAM)
  }, false)
}

// ------------------------------------------------------------------ optimiser

const opt = reactive({ running: false, run: 0, atBound: [] as string[], notConverged: false })
let handle: OptimizeHandle | null = null
let tween: TweenHandle | null = null

/** Stops a running optimisation and its slider tween; neither is applied afterwards. */
function cancelOptimize() {
  if (handle) {
    const h = handle
    handle = null
    h.cancel()
  }
  opt.running = false
  if (tween) {
    tween.cancel()
    tween = null
    tweening.value = false
    recomputer.request()
  }
}
watch(meanKind, cancelOptimize)

/** User edits of the kernel or the noise cancel a running optimisation and its tween. */
function onKernelInput(spec: KernelSpec) {
  cancelOptimize()
  kernel.value = spec
}
function onSigmaInput(v: number) {
  cancelOptimize()
  sigmaN.value = v
}

function optimize() {
  if (points.value.length === 0 || opt.running || optimizeBlocked.value) return
  cancelOptimize()
  const job = {
    // Plain copies: reactive proxies are not structured-cloneable.
    model: JSON.parse(JSON.stringify(model.value)) as GpModel,
    X: points.value.map((p) => [p.x]),
    y: points.value.map((p) => p.y),
    restarts: RESTARTS,
    seed: seed.value,
  }
  const h = startOptimize(job, (p) => {
    if (handle === h) opt.run = p.restart + 1
  })
  handle = h
  opt.running = true
  opt.run = 0
  opt.atBound = []
  opt.notConverged = false
  h.result.then(
    (res) => {
      if (handle !== h) return
      handle = null
      opt.running = false
      opt.atBound = res.atBound
      opt.notConverged = !res.converged
      tweenTo(res.model)
    },
    (e: unknown) => {
      if (handle !== h) return
      handle = null
      opt.running = false
      if (e instanceof GpError && e.details?.cancelled) return
      if (!(e instanceof GpError)) console.error(e)
      notify('notice.optimizerFailed')
    },
  )
}

/** Animates kernel parameters and sigma_n in log space to the optimum (400 ms; instant with reduced motion). */
function tweenTo(target: GpModel) {
  const from = modelParams(model.value, 1)
  const to = modelParams(target, 1)
  const finish = () => {
    tween = null
    kernel.value = target.kernel
    sigmaN.value = target.sigmaN
    tweening.value = false
    recomputer.request()
  }
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced || from.names.join() !== to.names.join()) return finish()
  tweening.value = true
  tween = startTween({
    from: from.logValues,
    to: to.logValues,
    durationMs: TWEEN_MS,
    apply: (lv) => {
      const m = withModelLogParams(model.value, 1, lv)
      kernel.value = m.kernel
      sigmaN.value = m.sigmaN
    },
    finish,
  })
}

// ------------------------------------------------------------------ display

const fmt = (digits: number) =>
  new Intl.NumberFormat(lang.value, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false })
const logMLText = computed(() => (logML.value === null ? '–' : fmt(2).format(logML.value)))
const etaText = computed(() => {
  const eta = grid.value?.eta
  return eta ? Array.from(eta, (v) => fmt(3).format(v)).join(lang.value === 'de' ? '; ' : ', ') : null
})

const kernelFormula = computed(() => {
  try {
    return kernelTex(kernel.value, { inputDim: 1 })
  } catch (e) {
    if (!(e instanceof GpError)) throw e
    return ''
  }
})

/** Jitter in the current language, e.g. DE "1E-9" / "1,5E-9". */
const formatJitter = (j: number) =>
  new Intl.NumberFormat(lang.value, { notation: 'scientific', maximumFractionDigits: 1 }).format(j)

/** With an underdetermined GLS mean there is no likelihood to optimise. */
const optimizeBlocked = computed(() => grid.value?.glsFallback === true)

const sigmaRange = computed(() => ({
  min: Math.max(SIGMA_N_BOUNDS[0], sigmaAnchor.value * Math.exp(-4)),
  max: Math.min(SIGMA_N_BOUNDS[1], sigmaAnchor.value * Math.exp(4)),
}))

const band = (k: 'sdF' | 'sdY', sign: 1 | -1) =>
  computed(() => {
    const g = grid.value
    const m = shownMean.value
    if (!g || !m) return new Float64Array(0)
    return m.map((v, i) => v + sign * 2 * g[k][i])
  })
const fLower = band('sdF', -1)
const fUpper = band('sdF', 1)
const yLower = band('sdY', -1)
const yUpper = band('sdY', 1)
const truthY = computed(() => {
  const g = grid.value
  const f = truth.value
  return g && f ? g.xs.map((x) => f(x)) : null
})

const plugIn = computed(() => (isGls.value && grid.value && !grid.value.glsFallback ? ` (${t('playground.plugIn')})` : ''))

type LayerKey = keyof typeof layers
interface LegendItem {
  key: LayerKey
  label: string
  swatch: 'band-f' | 'band-y' | 'line' | 'thin' | 'dash' | 'dot' | 'dot-line'
  variant: string
}
const legend = computed<LegendItem[]>(() => {
  const items: LegendItem[] = [
    { key: 'points', label: t('playground.layer.points'), swatch: 'dot', variant: 'points' },
    { key: 'mean', label: t('playground.layer.mean'), swatch: 'line', variant: 'mean' },
    { key: 'fBand', label: t('playground.layer.fBand') + plugIn.value, swatch: 'band-f', variant: 'f' },
    { key: 'yBand', label: t('playground.layer.yBand') + plugIn.value, swatch: 'band-y', variant: 'y' },
    {
      key: 'samples',
      label: `${SAMPLE_COUNT} ${t('playground.layer.samples')} (${t(
        sampleSource.value === 'prior' ? 'playground.sourcePrior' : 'playground.sourcePosterior',
      )})`,
      swatch: 'thin',
      variant: 'sample',
    },
    { key: 'priorMean', label: t('playground.layer.priorMean'), swatch: 'dash', variant: 'prior' },
  ]
  if (truth.value) items.push({ key: 'truth', label: t('playground.layer.truth'), swatch: 'dot-line', variant: 'truth' })
  return items
})

const plotState = computed(() => {
  if (plotError.value) return 'error'
  if (points.value.length === 0 && !layers.samples) return 'empty'
  return 'ready'
})
const plotMode = computed(() => (grid.value?.prior ? 'prior' : isGls.value ? 'plug-in' : 'posterior'))

const hyperOptions = [
  { name: 'hyper-43', code: '43', ell: 1, sigma: 2 },
  { name: 'hyper-45', code: '45', ell: 0.001, sigma: 2 },
  { name: 'hyper-47', code: '47', ell: 0.01, sigma: 5 },
]
const num = (v: number) => new Intl.NumberFormat(lang.value, { maximumFractionDigits: 3 }).format(v)

const meanLabel = (k: MeanKind): MessageKey => `playground.meanKind.${k}` as MessageKey
</script>

<template>
  <div class="pg" data-verify-unit="playground" data-verify-state="ready">
    <header class="pg-head">
      <div class="titles">
        <h2 class="title">{{ t('playground.title') }}</h2>
        <p class="lead">{{ t('playground.lead') }}</p>
      </div>
      <RefBadge chapter="1, 6, 11" code="17–42" />
    </header>

    <div class="pg-grid">
      <div class="plot-col">
        <section
          class="plot-wrap"
          :class="{ dense }"
          data-verify-unit="playground-plot"
          :data-verify-state="plotState"
          :data-verify-error="plotState === 'error' ? plotError : undefined"
          :data-verify-count="points.length"
          :data-verify-mode="plotMode"
          :data-verify-stale="stale"
          :aria-label="t('playground.plotLabel')"
          @pointerdown.capture="pointerActive = true"
        >
          <PlotFrame
            :x-domain="view"
            :y-domain="yDomain"
            :width="PLOT_W"
            :height="PLOT_H"
            :x-label="t('playground.xLabel')"
            :y-label="t('playground.yLabel')"
            @plot-click="addPoint"
            @plot-hover="onHover"
          >
            <!-- Dense data (e.g. sine, n = 500) goes below the curves so the mean stays readable. -->
            <PointLayer
              v-if="layers.points && dense"
              :x="px"
              :y="py"
              @point-drag="dragPoint"
              @point-remove="removePoint"
            />
            <template v-if="grid && shownMean && !plotError">
              <g :class="{ stale }">
                <BandLayer v-if="layers.yBand" :x="grid.xs" :lower="yLower" :upper="yUpper" variant="y" />
                <BandLayer v-if="layers.fBand" :x="grid.xs" :lower="fLower" :upper="fUpper" variant="f" />
                <template v-if="layers.samples">
                  <LineLayer v-for="(s, k) in grid.samples" :key="k" :x="grid.xs" :y="s" variant="sample" />
                </template>
              </g>
              <LineLayer v-if="layers.priorMean" :x="grid.xs" :y="grid.meanLine" variant="prior" />
              <LineLayer v-if="layers.truth && truthY" :x="grid.xs" :y="truthY" variant="truth" />
              <LineLayer v-if="layers.mean" :x="grid.xs" :y="shownMean" variant="mean" />
            </template>
            <PointLayer
              v-if="layers.points && !dense"
              :x="px"
              :y="py"
              @point-drag="dragPoint"
              @point-remove="removePoint"
            />
            <CursorLayer
              :x="inspectX"
              :mean="inspection?.mean"
              :sd-f="inspection?.sdF"
              :pinned="pinnedX !== null"
            />
          </PlotFrame>
          <p v-if="plotState === 'empty'" class="overlay hint">{{ t('playground.emptyHint') }}</p>
          <p v-if="plotError" class="overlay error" role="alert">
            {{ t('playground.errorMsg', { code: plotError }) }}
          </p>
        </section>

        <fieldset class="legend">
          <legend>{{ t('playground.layers') }}</legend>
          <label v-for="item in legend" :key="item.key" class="chip" :class="{ off: !layers[item.key] }">
            <input v-model="layers[item.key]" type="checkbox" :data-layer-toggle="item.key" />
            <svg class="swatch" :data-variant="item.variant" viewBox="0 0 28 14" aria-hidden="true">
              <rect v-if="item.swatch === 'band-f'" class="sw-band" x="1" y="2" width="26" height="10" />
              <template v-else-if="item.swatch === 'band-y'">
                <pattern id="sw-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="4" class="sw-hatch" />
                </pattern>
                <rect class="sw-band-y" x="1" y="2" width="26" height="10" fill="url(#sw-hatch)" />
              </template>
              <circle v-else-if="item.swatch === 'dot'" class="sw-dot" cx="14" cy="7" r="4" />
              <line v-else x1="1" y1="7" x2="27" y2="7" :class="`sw-${item.swatch}`" />
            </svg>
            <span>{{ item.label }}</span>
          </label>
        </fieldset>

        <div class="toolbar">
          <div class="group" data-verify-unit="playground-samples" :data-verify-state="layers.samples ? 'ready' : 'empty'">
            <span class="group-label" id="samples-source">{{ t('playground.samplesSource') }}</span>
            <div class="seg" role="radiogroup" aria-labelledby="samples-source">
              <label v-for="s in ['posterior', 'prior'] as const" :key="s" :class="{ on: sampleSource === s }">
                <input
                  v-model="sampleChoice"
                  type="radio"
                  name="sample-source"
                  :value="s"
                  :disabled="points.length === 0"
                />
                {{ t(s === 'prior' ? 'playground.sourcePrior' : 'playground.sourcePosterior') }}
              </label>
            </div>
            <button
              type="button"
              class="btn"
              @click="
                seed++;
                layers.samples = true
              "
            >
              {{ t('playground.redraw') }}
            </button>
            <span class="muted tabular">{{ t('playground.seed', { seed }) }}</span>
          </div>
          <div class="group" data-verify-unit="playground-points" :data-verify-state="points.length ? 'ready' : 'empty'" :data-verify-count="points.length">
            <span class="muted tabular">{{ t('playground.pointsCount', { n: points.length }) }}</span>
            <button type="button" class="btn" data-action="clear" :disabled="points.length === 0" @click="clearPoints">
              {{ t('playground.clear') }}
            </button>
            <button type="button" class="btn" data-action="reset" @click="load">{{ t('playground.reset') }}</button>
            <button type="button" class="btn" data-action="fit" @click="fitAxes">{{ t('playground.fitAxes') }}</button>
          </div>
        </div>

        <section
          class="likelihood"
          data-verify-unit="playground-optimizer"
          :data-verify-state="opt.running ? 'loading' : 'ready'"
        >
          <div v-if="points.length > 0" class="lml" data-verify-unit="playground-logml" data-verify-state="ready">
            <span class="lml-label">{{ t('playground.logML') }}</span>
            <output class="lml-value tabular" aria-live="polite">{{ logMLText }}</output>
          </div>
          <div class="opt-actions">
            <button
              type="button"
              class="btn primary"
              :disabled="points.length === 0 || opt.running || optimizeBlocked"
              :aria-describedby="optimizeBlocked ? 'optimize-blocked' : undefined"
              data-action="optimize"
              @click="optimize"
            >
              {{ t('playground.optimize') }}
            </button>
            <button v-if="opt.running" type="button" class="btn" @click="cancelOptimize">
              {{ t('playground.cancel') }}
            </button>
            <span v-if="opt.running" class="muted" role="status">
              {{ t('playground.optimizing', { run: Math.max(opt.run, 1), total: RESTARTS + 1 }) }}
            </span>
            <span v-else-if="optimizeBlocked" id="optimize-blocked" class="muted">
              {{ t('playground.optimizeGlsBlocked') }}
            </span>
            <span v-else-if="opt.atBound.length" class="muted">
              {{ t('playground.atBound', { names: opt.atBound.join(', ') }) }}
            </span>
            <span v-if="!opt.running && opt.notConverged" class="muted" role="status" data-note="not-converged">
              {{ t('playground.notConverged') }}
            </span>
          </div>
        </section>

        <details class="cov" @toggle="covOpen = ($event.target as HTMLDetailsElement).open">
          <summary>{{ t('playground.covariance') }}</summary>
          <div v-if="covOpen && grid?.cov" class="cov-body">
            <Heatmap :matrix="grid.cov" diverging :label="t('playground.covarianceLabel')" />
          </div>
        </details>
      </div>

      <aside class="side" @pointerdown.capture="pointerActive = true">
        <div class="panel">
          <Inspector
            :x="inspectX"
            :pinned="pinnedX !== null"
            :result="inspection"
            :error="inspectError"
            :model="model"
            :points="points"
            @pin="pin"
            @unpin="unpin"
          />
        </div>

        <section class="panel" data-verify-unit="playground-model" data-verify-state="ready" aria-labelledby="model-title">
          <header class="panel-head">
            <h3 id="model-title">{{ t('playground.model') }}</h3>
            <RefBadge chapter="8, 12" code="22–23, 43–48" />
          </header>
          <p class="kernel-source muted">
            {{ t('playground.kernel') }}: {{ kernelFromUrl ? t('playground.kernelUrl') : t('playground.kernelRbf') }}
          </p>
          <div class="formula-box"><Formula v-if="kernelFormula" :tex="kernelFormula" display /></div>
          <div v-if="showHyper" class="hyper" role="group" :aria-label="t('playground.hyper')">
            <span class="group-label no-caps">{{ t('playground.hyper') }}</span>
            <div class="hyper-row">
              <button
                v-for="h in hyperOptions"
                :key="h.name"
                type="button"
                class="btn hyper-btn"
                :aria-pressed="activeHyper === h.name"
                @click="switchHyper(h.name)"
              >
                <span class="code">Code {{ h.code }}</span>
                <span class="tabular">ℓ = {{ num(h.ell) }}, σ = {{ num(h.sigma) }}</span>
              </button>
            </div>
          </div>
          <ParamSliders :spec="kernel" :input-dim="1" @update:spec="onKernelInput" />
          <LogSlider
            :model-value="sigmaN"
            class="noise"
            :min="sigmaRange.min"
            :max="sigmaRange.max"
            :label="t('param.sigmaN')"
            @update:model-value="onSigmaInput"
          />
        </section>

        <section class="panel" data-verify-unit="playground-mean" data-verify-state="ready" aria-labelledby="mean-title">
          <header class="panel-head">
            <h3 id="mean-title">{{ t('playground.mean') }}</h3>
            <RefBadge chapter="7" code="gp-mean-demo" />
          </header>
          <div class="mean-kinds" role="radiogroup" aria-labelledby="mean-title">
            <label v-for="k in MEAN_KINDS" :key="k" class="radio" :class="{ on: meanKind === k }">
              <input v-model="meanKind" type="radio" name="mean-kind" :value="k" />
              {{ t(meanLabel(k)) }}
            </label>
          </div>
          <div v-if="meanKind === 'constant'" class="mean-params">
            <label>{{ t('playground.meanC') }} <input v-model.number="meanC" type="number" step="0.1" :lang="lang" /></label>
          </div>
          <div v-else-if="meanKind === 'linear'" class="mean-params">
            <label>{{ t('playground.meanA') }} <input v-model.number="meanA" type="number" step="0.1" :lang="lang" /></label>
            <label>{{ t('playground.meanB') }} <input v-model.number="meanB" type="number" step="0.1" :lang="lang" /></label>
          </div>
          <template v-else-if="isGls">
            <p class="muted small" data-note="gls-plug-in">{{ t('playground.glsNote') }}</p>
            <p v-if="etaText" class="tabular small">{{ t('playground.eta', { eta: etaText }) }}</p>
          </template>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.pg {
  --serif: 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif;
  max-width: 1320px;
  margin: 0 auto;
  display: grid;
  gap: 1.25rem;
}
.pg-head {
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
.pg-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 1.5rem;
  align-items: start;
}
@media (max-width: 960px) {
  .pg-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.plot-col {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}
.plot-wrap {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.5rem 0.5rem 0.25rem;
}
.overlay {
  position: absolute;
  left: 50%;
  top: 1.25rem;
  transform: translateX(-50%);
  margin: 0;
  max-width: min(80%, 44ch);
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
  color: var(--text);
  background: var(--error-bg);
}
.stale {
  opacity: 0.45;
}
/* Brief: the specified mean m(x) is dashed; the true function is dotted, so the two stay distinct. */
.plot-wrap :deep([data-variant='prior'] path) {
  stroke-dasharray: 8 5;
}
.plot-wrap :deep([data-variant='truth'] path) {
  stroke-dasharray: 0.5 5;
  stroke-linecap: round;
  stroke-width: 2.6;
}
.dense :deep(.dot) {
  r: 2.6px;
  stroke-width: 0.6;
  fill-opacity: 0.75;
}
.dense :deep(.hit) {
  r: 5px;
}
.no-caps {
  text-transform: none;
  letter-spacing: 0.02em;
}
.side :deep(.ref-badge) {
  border-radius: 6px;
}

/* Legend doubling as layer toggles. */
.legend {
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.5rem;
}
.legend legend,
.group-label {
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.legend legend {
  padding: 0 0 0.35rem;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.2rem 0.6rem 0.2rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 0.85rem;
  cursor: pointer;
  background: var(--surface);
  user-select: none;
}
.chip.off {
  background: transparent;
  color: var(--text-muted);
}
.chip.off .swatch {
  opacity: 0.35;
}
.chip input {
  margin: 0;
  accent-color: var(--accent);
}
.chip:focus-within {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
.swatch {
  width: 28px;
  height: 14px;
  flex: none;
}
.sw-band {
  fill: var(--v);
  fill-opacity: 0.22;
  stroke: var(--v);
  stroke-opacity: 0.6;
}
.sw-band-y {
  stroke: var(--v);
  stroke-opacity: 0.5;
}
.sw-hatch {
  stroke: var(--c-y);
  stroke-width: 1.2;
}
.sw-dot {
  fill: var(--c-points);
}
.sw-line,
.sw-thin,
.sw-dash,
.sw-dot-line {
  stroke: var(--v);
  fill: none;
}
.sw-line {
  stroke-width: 2.6;
}
.sw-thin {
  stroke-width: 1.4;
}
.sw-dash {
  stroke-width: 2;
  stroke-dasharray: 8 5;
}
.sw-dot-line {
  stroke-width: 2.6;
  stroke-dasharray: 0.5 5;
  stroke-linecap: round;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.75rem 1.5rem;
  padding: 0.6rem 0;
  border-top: 1px solid var(--grid);
  border-bottom: 1px solid var(--grid);
}
.group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.seg {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
}
.seg label {
  padding: 0.25rem 0.6rem;
  font-size: 0.85rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.seg label + label {
  border-left: 1px solid var(--border);
}
.seg label.on {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.seg input {
  margin: 0;
  accent-color: var(--accent);
}
.seg label:focus-within {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
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
}
.muted {
  color: var(--text-muted);
  font-size: 0.85rem;
}
.small {
  font-size: 0.85rem;
  margin: 0.25rem 0 0;
}
.tabular {
  font-variant-numeric: tabular-nums;
}

.likelihood {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1.5rem;
}
.lml {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}
.lml-label {
  font-family: var(--serif);
  font-style: italic;
  font-size: 1rem;
}
.lml-value {
  font-size: 1.35rem;
  font-weight: 600;
  min-width: 6ch;
}
.opt-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}

.cov {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
}
.cov summary {
  cursor: pointer;
  padding: 0.55rem 0.8rem;
  font-size: 0.9rem;
}
.cov summary:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}
.cov-body {
  padding: 0 0.8rem 0.8rem;
  max-width: 420px;
}

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
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}
h3 {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.kernel-source {
  margin: 0 0 0.25rem;
}
.formula-box {
  font-size: 0.9rem;
  margin-bottom: 0.5rem;
  min-height: 2.2rem;
}
.hyper {
  margin: 0 0 0.75rem;
}
.hyper-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.35rem;
  margin-top: 0.35rem;
}
.hyper-btn {
  display: grid;
  gap: 0.1rem;
  padding: 0.35rem 0.4rem;
  font-size: 0.75rem;
  text-align: center;
}
.hyper-btn .code {
  font-weight: 650;
}
.hyper-btn[aria-pressed='true'] {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.noise {
  padding: 0 0.8rem;
}
.mean-kinds {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.3rem 0.75rem;
}
.radio {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.88rem;
  cursor: pointer;
}
.radio input {
  margin: 0;
  accent-color: var(--accent);
}
.radio:focus-within {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
  border-radius: 2px;
}
.mean-params {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.6rem;
}
.mean-params label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.9rem;
}
.mean-params input {
  width: 6.5rem;
  font: inherit;
  font-variant-numeric: tabular-nums;
  padding: 0.25rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  color: var(--text);
}
.mean-params input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
</style>
