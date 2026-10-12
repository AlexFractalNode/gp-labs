<script setup lang="ts">
import { computed } from 'vue'
import { useI18n, type MessageKey } from '../i18n'
import { freeParams, isKernelSpec, locationParams, withLogParams, type KernelSpec } from '../core/kernels'
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

// [min, max, step] of location/shape parameters; widened to include the current value.
const LINEAR_RANGES: Record<string, [number, number, number]> = {
  'linear.c': [-5, 5, 0.1],
  'polynomial.c': [0.1, 10, 0.1],
  offset: [0, 10, 0.1],
  degree: [1, 10, 1],
  p: [0.1, 2, 0.05],
  x0: [-5, 5, 0.1],
}

const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉'
const subscript = (n: number) => String(n).replace(/\d/g, (d) => SUBSCRIPT[Number(d)])

function paramLabel(key: string): string {
  const ard = /^ell_(\d+)$/.exec(key)
  if (ard) return t('param.ell', { index: subscript(Number(ard[1]) + 1) })
  return t(`param.${key}` as MessageKey, { index: '' })
}

const info = computed(() => freeParams(props.spec, props.inputDim))

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
        let a = anchors.get(name)
        if (a === undefined || Math.abs(v - a) > WINDOW) {
          a = v
          anchors.set(name, a)
        }
        entries.push({
          kind: 'log',
          index,
          label: paramLabel(m[3]),
          value: Math.exp(v),
          min: Math.exp(Math.max(logLower[index], a - WINDOW)),
          max: Math.exp(Math.min(logUpper[index], a + WINDOW)),
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
          min: Math.min(lo, value),
          max: Math.max(hi, value),
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
  if (!(value > 0) || !Number.isFinite(value)) return
  const lv = Float64Array.from(info.value.logValues)
  lv[index] = Math.log(value)
  emit('update:spec', withLogParams(props.spec, props.inputDim, lv))
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
