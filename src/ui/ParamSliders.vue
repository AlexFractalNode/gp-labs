<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n, type MessageKey } from '../i18n'
import {
  DEGREE_RANGE,
  PARAM_BOUNDS,
  POWEXP_P_RANGE,
  freeParams,
  isKernelSpec,
  locationParams,
  withLogParams,
  type KernelSpec,
  type ParamInfo,
} from '../core/kernels'
import { GpError } from '../core/errors'
import LogSlider from './LogSlider.vue'
import LinearSlider from './LinearSlider.vue'

const props = defineProps<{ spec: KernelSpec; inputDim: number }>()
const emit = defineEmits<{ 'update:spec': [spec: KernelSpec] }>()
const { t } = useI18n()

/** Log sliders span at most ±4 log-units around an anchor value. */
const WINDOW = 4
/** Anchors keep the slider range stable while dragging (the spec, and so the value, changes on every move). */
const anchors = new Map<string, number>()

interface LogEntry {
  kind: 'log'
  index: number
  label: string
  value: number
  min: number
  max: number
}
interface LinEntry {
  kind: 'linear'
  term: number
  factor: number
  param: string
  label: string
  value: number
  min: number
  max: number
  step: number
}
interface Group {
  key: string
  title: string
  entries: (LogEntry | LinEntry)[]
}

// [min, max, step] of location/shape parameters; parameters with a validity domain (degree, p) are never widened.
const BOUNDED = new Set(['degree', 'p'])
const LINEAR_RANGES: Record<string, [number, number, number]> = {
  'linear.c': [-5, 5, 0.1],
  'polynomial.c': [0.1, 10, 0.1],
  offset: [0, 10, 0.1],
  degree: [DEGREE_RANGE[0], DEGREE_RANGE[1], 1],
  p: [POWEXP_P_RANGE[0], POWEXP_P_RANGE[1], 0.05],
  x0: [-5, 5, 0.1],
}

const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉'
const subscript = (n: number) => String(n).replace(/\d/g, (d) => SUBSCRIPT[Number(d)])

const LABELS: Record<string, MessageKey> = {
  sigma: 'param.sigma',
  ell: 'param.ell',
  alpha: 'param.alpha',
  period: 'param.period',
  sigma0: 'param.sigma0',
  c: 'param.c',
  offset: 'param.offset',
  degree: 'param.degree',
  p: 'param.p',
  l1: 'param.l1',
  l2: 'param.l2',
  w: 'param.w',
  x0: 'param.x0',
}

function paramLabel(key: string): string {
  const ard = /^ell_(\d+)$/.exec(key)
  if (ard) return t('param.ell', { index: subscript(Number(ard[1]) + 1) })
  const k = LABELS[key]
  return k ? t(k, { index: '' }) : key
}

const EMPTY_INFO: ParamInfo = {
  names: [],
  logValues: new Float64Array(0),
  logLower: new Float64Array(0),
  logUpper: new Float64Array(0),
}
let lastInfo: ParamInfo = EMPTY_INFO
/**
 * Free parameters of the spec. Vue patches the props one at a time and the sync watchers below see the
 * intermediate state (e.g. an ARD spec with the old inputDim). Such a mismatch raises a GpError: keep the previous
 * result until spec and inputDim agree again (both are read before freeParams can throw, so they stay tracked).
 */
const info = computed<ParamInfo>(() => {
  const spec = props.spec
  const inputDim = props.inputDim
  try {
    lastInfo = freeParams(spec, inputDim)
  } catch (e) {
    if (!(e instanceof GpError)) throw e
  }
  return lastInfo
})

// Structure signature: anchors are dropped when the kernel layout changes, and refreshed (sync, before
// the groups are recomputed) when a value leaves its window.
const structure = computed(
  () =>
    JSON.stringify([props.inputDim, props.spec.terms.map((t) => t.map((f) => [f.kind, f.ard, f.activeDims]))]) +
    info.value.names.join(','),
)
watch(
  structure,
  () => anchors.clear(),
  { flush: 'sync' },
)
watch(
  info,
  (i) =>
    i.names.forEach((name, k) => {
      const a = anchors.get(name)
      if (a === undefined || Math.abs(i.logValues[k] - a) > WINDOW) anchors.set(name, i.logValues[k])
    }),
  { flush: 'sync', immediate: true },
)

const groups = computed<Group[]>(() => {
  const { names, logValues, logLower, logUpper } = info.value
  const out: Group[] = []
  props.spec.terms.forEach((term, ti) =>
    term.forEach((f, fi) => {
      const entries: (LogEntry | LinEntry)[] = []
      names.forEach((name, index) => {
        const m = /^t(\d+)\.f(\d+)\.(.+)$/.exec(name)
        if (!m || Number(m[1]) !== ti || Number(m[2]) !== fi) return
        const v = logValues[index]
        const a = anchors.get(name) ?? v
        entries.push({
          kind: 'log',
          index,
          label: paramLabel(m[3]),
          value: Math.exp(v),
          min: Math.max(PARAM_BOUNDS[0], Math.exp(Math.max(logLower[index], a - WINDOW))),
          max: Math.min(PARAM_BOUNDS[1], Math.exp(Math.min(logUpper[index], a + WINDOW))),
        })
      })
      for (const param of locationParams(f.kind)) {
        const value = f.params[param]
        if (typeof value !== 'number') continue
        const [lo, hi, step] = LINEAR_RANGES[`${f.kind}.${param}`] ?? LINEAR_RANGES[param] ?? [-5, 5, 0.1]
        entries.push({
          kind: 'linear',
          term: ti,
          factor: fi,
          param,
          label: paramLabel(param),
          value,
          min: BOUNDED.has(param) ? lo : Math.min(lo, value),
          max: BOUNDED.has(param) ? hi : Math.max(hi, value),
          step,
        })
      }
      if (entries.length) out.push({ key: `${ti}.${fi}`, title: `${ti + 1}.${fi + 1} · ${f.kind}`, entries })
    }),
  )
  return out
})

const count = computed(() => groups.value.reduce((s, g) => s + g.entries.length, 0))

function setLog(index: number, value: number) {
  if (!Number.isFinite(value) || value <= 0) return
  const lv = Float64Array.from(info.value.logValues)
  lv[index] = Math.log(Math.min(Math.max(value, PARAM_BOUNDS[0]), PARAM_BOUNDS[1]))
  let next: KernelSpec
  try {
    next = withLogParams(props.spec, props.inputDim, lv)
  } catch (e) {
    if (!(e instanceof GpError)) throw e
    return
  }
  // exp(log(x)) can overshoot a bound by one ulp: clamp every free parameter back into range.
  info.value.names.forEach((name) => {
    const m = /^t(\d+)\.f(\d+)\.(.+)$/.exec(name)!
    const params = next.terms[Number(m[1])][Number(m[2])].params
    params[m[3]] = Math.min(Math.max(params[m[3]], PARAM_BOUNDS[0]), PARAM_BOUNDS[1])
  })
  if (isKernelSpec(next)) emit('update:spec', next)
}

function setLinear(e: LinEntry, value: number) {
  const next = JSON.parse(JSON.stringify(props.spec)) as KernelSpec
  next.terms[e.term][e.factor].params[e.param] = value
  if (isKernelSpec(next)) emit('update:spec', next)
}
</script>

<template>
  <div
    class="param-sliders"
    data-verify-unit="param-sliders"
    :data-verify-state="count ? 'ready' : 'empty'"
    :data-verify-count="count"
  >
    <p v-if="!count" class="none">{{ t('param.none') }}</p>
    <fieldset v-for="g in groups" :key="g.key" class="factor">
      <legend>{{ g.title }}</legend>
      <template v-for="e in g.entries" :key="e.kind === 'log' ? e.index : e.param">
        <LogSlider
          v-if="e.kind === 'log'"
          :model-value="e.value"
          :min="e.min"
          :max="e.max"
          :label="e.label"
          @update:model-value="setLog(e.index, $event)"
        />
        <LinearSlider
          v-else
          :model-value="e.value"
          :min="e.min"
          :max="e.max"
          :step="e.step"
          :label="e.label"
          @update:model-value="setLinear(e, $event)"
        />
      </template>
    </fieldset>
  </div>
</template>

<style scoped>
.factor {
  border: 1px solid var(--border);
  border-radius: 6px;
  margin: 0 0 0.7rem;
  padding: 0.2rem 0.8rem 0.5rem;
}
legend {
  font-size: 0.8rem;
  color: var(--text-muted);
  padding: 0 0.3rem;
}
.none {
  color: var(--text-muted);
}
</style>
