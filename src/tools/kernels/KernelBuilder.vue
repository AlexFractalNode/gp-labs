<script setup lang="ts">
/**
 * Builder of a sum-of-products kernel (Spec §5): terms are added, the factor chips of a term are multiplied.
 * Each chip has a kind select, an input select (2D: active dimensions / ARD), a warp select with its sliders and
 * the parameter sliders of its factor. Factors are treated as immutable; every edit emits a new spec.
 */
import { computed, ref, watch } from 'vue'
import { useI18n, type MessageKey } from '../../i18n'
import {
  BASE_KINDS,
  MAX_FACTORS,
  MAX_TERMS,
  defaultKernel,
  isKernelSpec,
  kindParams,
  type BaseKernel,
  type BaseKind,
  type KernelSpec,
  type Warp,
} from '../../core/kernels'
import ParamSliders from '../../ui/ParamSliders.vue'
import LogSlider from '../../ui/LogSlider.vue'
import LinearSlider from '../../ui/LinearSlider.vue'

const props = defineProps<{ spec: KernelSpec; inputDim: number }>()
const emit = defineEmits<{ 'update:spec': [spec: KernelSpec] }>()
const { t } = useI18n()

type Dims = 'all' | 'x12' | 'x1' | 'x2' | 'ard'
type WarpKind = Warp['kind']
const DIMS: Dims[] = ['all', 'x12', 'x1', 'x2', 'ard']
const WARPS: WarpKind[] = ['identity', 'square', 'log', 'circle', 'tanh']

// ------------------------------------------------------------------ stable chip keys

let nextKey = 1
const keys = ref<number[][]>([])
const fresh = () => nextKey++
const shape = computed(() => props.spec.terms.map((term) => term.length).join(','))
// A spec of a different shape that the builder did not produce (preset load) gets fresh keys.
watch(
  shape,
  (s) => {
    if (keys.value.map((k) => k.length).join(',') !== s) keys.value = props.spec.terms.map((term) => term.map(fresh))
  },
  { immediate: true, flush: 'sync' },
)
const keyOf = (ti: number, fi: number) => keys.value[ti]?.[fi] ?? `${ti}.${fi}`
const termKey = (ti: number) => keys.value[ti]?.[0] ?? `t${ti}`

const chipCount = computed(() => props.spec.terms.reduce((s, term) => s + term.length, 0))

// ------------------------------------------------------------------ edits

function commit(terms: BaseKernel[][], nextKeys?: number[][]) {
  const next: KernelSpec = { terms }
  if (!isKernelSpec(next)) return
  if (nextKeys) keys.value = nextKeys
  emit('update:spec', next)
}

function setFactor(ti: number, fi: number, f: BaseKernel) {
  commit(props.spec.terms.map((term, i) => (i === ti ? term.map((g, j) => (j === fi ? f : g)) : term)))
}

function addTerm() {
  if (props.spec.terms.length >= MAX_TERMS) return
  commit([...props.spec.terms, [defaultKernel('rbf')]], [...keys.value, [fresh()]])
}

function removeTerm(ti: number) {
  if (props.spec.terms.length <= 1) return
  commit(
    props.spec.terms.filter((_, i) => i !== ti),
    keys.value.filter((_, i) => i !== ti),
  )
}

function addFactor(ti: number) {
  if (props.spec.terms[ti].length >= MAX_FACTORS) return
  commit(
    props.spec.terms.map((term, i) => (i === ti ? [...term, defaultKernel('rbf')] : term)),
    keys.value.map((k, i) => (i === ti ? [...k, fresh()] : k)),
  )
}

function removeFactor(ti: number, fi: number) {
  if (props.spec.terms[ti].length === 1) return removeTerm(ti)
  commit(
    props.spec.terms.map((term, i) => (i === ti ? term.filter((_, j) => j !== fi) : term)),
    keys.value.map((k, i) => (i === ti ? k.filter((_, j) => j !== fi) : k)),
  )
}

const hasEll = (kind: BaseKind) => kindParams(kind).includes('ell')

function dimsOf(f: BaseKernel): Dims {
  if (f.ard) return 'ard'
  const ad = f.activeDims
  if (!ad) return 'all'
  if (ad.length === 1) return ad[0] === 0 ? 'x1' : 'x2'
  return 'x12'
}

/** Copy of f with the given input mode; ARD expands ℓ to ℓ₁ = ℓ₂ and drops the warp (ARD acts on raw inputs). */
function withDims(f: BaseKernel, dims: Dims): BaseKernel {
  const params = { ...f.params }
  const wasArd = f.ard === true
  if (wasArd && dims !== 'ard') {
    params.ell = params.ell_0
    for (const k of Object.keys(params)) if (/^ell_\d+$/.test(k)) delete params[k]
  }
  const out: BaseKernel = { kind: f.kind, params }
  if (f.fixed) out.fixed = f.fixed.filter((k) => !/^ell(_\d+)?$/.test(k))
  if (out.fixed && out.fixed.length === 0) delete out.fixed
  if (dims === 'ard') {
    if (!wasArd) {
      params.ell_0 = params.ell
      params.ell_1 = params.ell
      delete params.ell
    }
    out.ard = true
    return out
  }
  // Warps need one input: keep them only where the factor sees one dimension.
  if (f.warp && dims !== 'x12') out.warp = { ...f.warp }
  if (dims === 'x12') out.activeDims = [0, 1]
  else if (dims === 'x1') out.activeDims = [0]
  else if (dims === 'x2') out.activeDims = [1]
  return out
}

function changeKind(ti: number, fi: number, kind: BaseKind) {
  const old = props.spec.terms[ti][fi]
  let f = defaultKernel(kind)
  const dims = dimsOf(old)
  if (dims === 'ard' && !hasEll(kind)) f = withDims(f, 'all')
  else if (dims !== 'all') f = withDims(f, dims)
  if (old.warp && dims !== 'ard' && dims !== 'x12') f = { ...f, warp: { ...old.warp } }
  setFactor(ti, fi, f)
}

function changeDims(ti: number, fi: number, dims: Dims) {
  setFactor(ti, fi, withDims(props.spec.terms[ti][fi], dims))
}

function defaultWarp(kind: WarpKind): Warp | undefined {
  switch (kind) {
    case 'identity':
      return undefined
    case 'circle':
      return { kind, period: 0.5 }
    case 'tanh':
      return { kind, a: 1, b: 5, c: 1 }
    default:
      return { kind }
  }
}

function changeWarp(ti: number, fi: number, kind: WarpKind) {
  const f: BaseKernel = { ...props.spec.terms[ti][fi] }
  const w = defaultWarp(kind)
  if (w) f.warp = w
  else delete f.warp
  setFactor(ti, fi, f)
}

function setWarpParam(ti: number, fi: number, key: 'period' | 'a' | 'b' | 'c', value: number) {
  const f = props.spec.terms[ti][fi]
  if (!f.warp || !Number.isFinite(value)) return
  setFactor(ti, fi, { ...f, warp: { ...f.warp, [key]: value } as Warp })
}

/** Single-factor specs for the per-chip ParamSliders (cached, so slider anchors stay stable). */
const factorSpecs = computed(() => props.spec.terms.map((term) => term.map((f): KernelSpec => ({ terms: [[f]] }))))

function onFactorSliders(ti: number, fi: number, s: KernelSpec) {
  setFactor(ti, fi, s.terms[0][0])
}

const warpKind = (f: BaseKernel): WarpKind => f.warp?.kind ?? 'identity'
const warpRange = (f: BaseKernel, key: 'a' | 'b' | 'c'): [number, number, number] => {
  const v = f.warp?.kind === 'tanh' ? f.warp[key] : 0
  const [lo, hi, step]: [number, number, number] = key === 'a' ? [-3, 3, 0.1] : key === 'b' ? [0, 20, 0.5] : [-5, 5, 0.1]
  return [Math.min(lo, v), Math.max(hi, v), step]
}

const kindLabel = (k: BaseKind) => t(`kernels.builder.kindName.${k}` as MessageKey)
const dimsLabel = (d: Dims) => t(`kernels.builder.dimsKind.${d}` as MessageKey)
const warpLabel = (w: WarpKind) => t(`kernels.builder.warpKind.${w}` as MessageKey)
const id = (ti: number, fi: number) => `${ti + 1}.${fi + 1}`
</script>

<template>
  <section
    class="builder"
    data-verify-unit="kernel-builder"
    data-verify-state="ready"
    :data-verify-count="chipCount"
    :data-verify-terms="spec.terms.length"
  >
    <p class="hint">{{ t('kernels.builder.hint') }}</p>
    <ol class="terms">
      <template v-for="(term, ti) in spec.terms" :key="termKey(ti)">
        <li v-if="ti > 0" class="op op-sum" aria-hidden="true">+</li>
        <li class="term">
          <header class="term-head">
            <span class="term-title">{{ t('kernels.builder.term', { n: ti + 1 }) }}</span>
            <button
              type="button"
              class="icon-btn"
              :disabled="spec.terms.length === 1"
              :aria-label="t('kernels.builder.removeTerm', { n: ti + 1 })"
              :title="t('kernels.builder.removeTerm', { n: ti + 1 })"
              @click="removeTerm(ti)"
            >
              ×
            </button>
          </header>
          <template v-for="(f, fi) in term" :key="keyOf(ti, fi)">
            <div v-if="fi > 0" class="op op-prod" aria-hidden="true">×</div>
            <article class="chip" :aria-label="`${id(ti, fi)} · ${kindLabel(f.kind)}`">
              <header class="chip-head">
                <span class="chip-id tabular">{{ id(ti, fi) }}</span>
                <select
                  class="kind"
                  :value="f.kind"
                  :aria-label="`${t('kernels.builder.kind')} ${id(ti, fi)}`"
                  @change="changeKind(ti, fi, ($event.target as HTMLSelectElement).value as BaseKind)"
                >
                  <option v-for="k in BASE_KINDS" :key="k" :value="k">{{ kindLabel(k) }}</option>
                </select>
                <button
                  type="button"
                  class="icon-btn"
                  :disabled="spec.terms.length === 1 && term.length === 1"
                  :aria-label="t('kernels.builder.removeFactor', { id: id(ti, fi) })"
                  :title="t('kernels.builder.removeFactor', { id: id(ti, fi) })"
                  @click="removeFactor(ti, fi)"
                >
                  ×
                </button>
              </header>
              <div class="chip-opts">
                <label>
                  <span>{{ t('kernels.builder.dims') }}</span>
                  <select
                    :value="dimsOf(f)"
                    @change="changeDims(ti, fi, ($event.target as HTMLSelectElement).value as Dims)"
                  >
                    <option v-for="d in DIMS" :key="d" :value="d" :disabled="d === 'ard' && !hasEll(f.kind)">
                      {{ dimsLabel(d) }}
                    </option>
                  </select>
                </label>
                <label>
                  <span>{{ t('kernels.builder.warp') }}</span>
                  <select
                    :value="warpKind(f)"
                    :disabled="f.ard === true || dimsOf(f) === 'x12'"
                    @change="changeWarp(ti, fi, ($event.target as HTMLSelectElement).value as WarpKind)"
                  >
                    <option v-for="w in WARPS" :key="w" :value="w">{{ warpLabel(w) }}</option>
                  </select>
                </label>
              </div>
              <div v-if="f.warp?.kind === 'circle'" class="warp-params">
                <LogSlider
                  :model-value="f.warp.period"
                  :min="Math.min(0.05, f.warp.period)"
                  :max="Math.max(5, f.warp.period)"
                  :label="t('kernels.builder.warpParam.period')"
                  @update:model-value="setWarpParam(ti, fi, 'period', $event)"
                />
              </div>
              <div v-else-if="f.warp?.kind === 'tanh'" class="warp-params">
                <LinearSlider
                  v-for="key in ['a', 'b', 'c'] as const"
                  :key="key"
                  :model-value="f.warp[key]"
                  :min="warpRange(f, key)[0]"
                  :max="warpRange(f, key)[1]"
                  :step="warpRange(f, key)[2]"
                  :label="t(`kernels.builder.warpParam.${key}`)"
                  @update:model-value="setWarpParam(ti, fi, key, $event)"
                />
              </div>
              <ParamSliders
                class="chip-sliders"
                :spec="factorSpecs[ti][fi]"
                :input-dim="inputDim"
                @update:spec="onFactorSliders(ti, fi, $event)"
              />
            </article>
          </template>
          <button
            type="button"
            class="btn add add-factor"
            :disabled="term.length >= MAX_FACTORS"
            :aria-label="t('kernels.builder.factorAddTo', { n: ti + 1 })"
            :title="term.length >= MAX_FACTORS ? t('kernels.builder.limitFactors', { n: MAX_FACTORS }) : undefined"
            @click="addFactor(ti)"
          >
            <span aria-hidden="true">+</span> {{ t('kernels.builder.addFactor') }}
            <span class="op-hint" aria-hidden="true">(×)</span>
          </button>
        </li>
      </template>
    </ol>
    <button
      type="button"
      class="btn add"
      :disabled="spec.terms.length >= MAX_TERMS"
      :title="spec.terms.length >= MAX_TERMS ? t('kernels.builder.limitTerms', { n: MAX_TERMS }) : undefined"
      @click="addTerm"
    >
      <span aria-hidden="true">+</span> {{ t('kernels.builder.addTerm') }}
    </button>
    <p v-if="spec.terms.length >= MAX_TERMS" class="limit">{{ t('kernels.builder.limitTerms', { n: MAX_TERMS }) }}</p>
  </section>
</template>

<style scoped>
.hint {
  margin: 0 0 0.6rem;
  font-size: 0.85rem;
  color: var(--text-muted);
}
.terms {
  list-style: none;
  margin: 0 0 0.6rem;
  padding: 0;
  display: grid;
  gap: 0.35rem;
}
.term {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.5rem 0.6rem 0.6rem;
  background: color-mix(in srgb, var(--bg) 60%, var(--surface));
}
.term-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.35rem;
}
.term-title {
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.op {
  text-align: center;
  font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;
  color: var(--text-muted);
  line-height: 1;
}
.op-sum {
  font-size: 1.3rem;
}
.op-prod {
  font-size: 1.1rem;
  margin: 0.15rem 0;
}
.chip {
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: 6px;
  background: var(--surface);
  padding: 0.45rem 0.6rem 0.2rem;
}
.chip-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.chip-id {
  font-size: 0.8rem;
  font-weight: 650;
  color: var(--text-muted);
  min-width: 2.2ch;
}
.kind {
  flex: 1;
  font-weight: 600;
}
select {
  font: inherit;
  font-size: 0.85rem;
  padding: 0.2rem 0.3rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  color: var(--text);
  min-width: 0;
}
select:disabled {
  opacity: 0.5;
}
select:focus-visible,
.icon-btn:focus-visible,
.btn:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.chip-opts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
  margin: 0.45rem 0 0.1rem;
}
.chip-opts label {
  display: grid;
  gap: 0.1rem;
  font-size: 0.75rem;
  color: var(--text-muted);
}
.warp-params {
  padding: 0 0.1rem;
}
/* The chip header already names the factor: hide the "1.1 · rbf" legend of the per-chip sliders. */
.chip-sliders :deep(.factor) {
  border: 0;
  padding: 0;
  margin: 0;
}
.chip-sliders :deep(legend) {
  display: none;
}
.icon-btn {
  font: inherit;
  font-size: 1.05rem;
  line-height: 1;
  width: 1.7rem;
  height: 1.7rem;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.icon-btn:hover:not(:disabled) {
  border-color: var(--error);
  color: var(--error);
}
.icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
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
.add {
  width: 100%;
  border-style: dashed;
}
.add-factor {
  margin-top: 0.45rem;
}
.op-hint {
  color: var(--text-muted);
  margin-left: 0.2rem;
}
.limit {
  margin: 0.35rem 0 0;
  font-size: 0.8rem;
  color: var(--text-muted);
}
.tabular {
  font-variant-numeric: tabular-nums;
}
</style>
