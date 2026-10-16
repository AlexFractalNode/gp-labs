<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from '../../i18n'
import Formula from '../../ui/Formula.vue'
import RefBadge from '../../ui/RefBadge.vue'
import type { InspectResult } from './inspect'
import type { Point } from './compute'
import type { GpModel } from '../../core/gp'

const props = defineProps<{
  /** Inspected location (hover or pinned). */
  x: number
  pinned: boolean
  result: InspectResult | null
  error: string | null
  model: GpModel
  points: Point[]
}>()
const emit = defineEmits<{ pin: [x: number]; unpin: [] }>()
const { lang, t } = useI18n()

/**
 * `signDisplay: 'negative'` drops the sign of values that round to zero (no "-0,000" for a mean of −3·10⁻⁶). The
 * option is ES2023; the cast only bridges the ES2022 lib typings of this project.
 */
const fmt = computed(
  () =>
    new Intl.NumberFormat(lang.value, {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
      useGrouping: false,
      signDisplay: 'negative' as Intl.NumberFormatOptions['signDisplay'],
    }),
)
const f3 = (v: number) => fmt.value.format(v)
/** The same number for KaTeX: the decimal comma needs braces to avoid extra spacing. */
const tex = (v: number) => f3(v).replace(',', '{,}').replace('−', '-')
const sep = computed(() => (lang.value === 'de' ? '; ' : ', '))

const state = computed(() => (props.error ? 'error' : props.result ? 'ready' : 'loading'))

const rows = computed(() => {
  const r = props.result
  if (!r) return []
  return [
    { key: 'mean', label: t('playground.meanValue'), value: f3(r.mean), interval: null },
    { key: 'sdF', label: t('playground.sdF'), value: f3(r.sdF), interval: [r.mean - 2 * r.sdF, r.mean + 2 * r.sdF] },
    { key: 'sdY', label: t('playground.sdY'), value: f3(r.sdY), interval: [r.mean - 2 * r.sdY, r.mean + 2 * r.sdY] },
  ]
})

/** Kap. 9: with one data point the posterior is a weighted pull towards y₁ (only for a prescribed mean). */
const onePointTex = computed(() => {
  const r = props.result
  // Terms come from inspectAt (same fit as the plot); only with one point and a prescribed mean.
  if (!r || r.weight === undefined || !r.onePoint || props.points.length !== 1) return null
  const p = props.points[0]
  const { kStar1: ks1, k11, kStarStar: kss, m1, mStar: ms } = r.onePoint
  const s2 = props.model.sigmaN ** 2
  return [
    String.raw`\begin{aligned}`,
    // Symbolic line, then the numbers on their own line: keeps the block narrow enough for the side panel.
    String.raw`w &= \frac{k(x_*,x_1)}{k(x_1,x_1)+\sigma_n^2}\\ &= \frac{${tex(ks1)}}{${tex(k11)} + ${tex(s2)}} = ${tex(r.weight)}\\[6pt]`,
    String.raw`\bar f_* &= m(x_*) + w\,\bigl(y_1 - m(x_1)\bigr)\\`,
    String.raw`&= ${tex(ms)} + ${tex(r.weight)}\cdot(${tex(p.y)} - ${tex(m1)}) = ${tex(r.mean)}\\[6pt]`,
    String.raw`s_f^2 &= k(x_*,x_*) - w\,k(x_*,x_1)\\`,
    String.raw`&= ${tex(kss)} - ${tex(r.weight)}\cdot ${tex(ks1)} = ${tex(r.sdF ** 2)}`,
    String.raw`\end{aligned}`,
  ].join('')
})

// Text field for x*: mirrors the inspected location until the user types into it.
const draft = ref('')
const editing = ref(false)
const invalid = ref(false)
watch(
  () => [props.x, lang.value] as const,
  () => {
    if (!editing.value) draft.value = f3(props.x)
  },
  { immediate: true },
)
function parse(s: string): number | null {
  const v = Number(s.trim().replace(/\s/g, '').replace('−', '-').replace(',', '.'))
  return s.trim() !== '' && Number.isFinite(v) ? v : null
}
function commit() {
  const v = parse(draft.value)
  invalid.value = v === null
  if (v !== null) {
    editing.value = false
    emit('pin', v)
  }
}
function onBlur() {
  editing.value = false
  if (!invalid.value) draft.value = f3(props.x)
}
</script>

<template>
  <section
    class="inspector"
    data-verify-unit="playground-inspector"
    :data-verify-state="state"
    :data-verify-error="state === 'error' ? error : undefined"
    :data-verify-pinned="pinned"
    aria-labelledby="inspector-title"
  >
    <header class="head">
      <h3 id="inspector-title">{{ t('playground.inspector') }}</h3>
      <RefBadge chapter="9" code="39" />
    </header>
    <p class="hint">{{ t('playground.inspectorHint') }}</p>

    <div class="xrow">
      <label for="inspector-x">{{ t('playground.xStar') }}</label>
      <input
        id="inspector-x"
        v-model="draft"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        spellcheck="false"
        :aria-invalid="invalid || undefined"
        @focus="editing = true"
        @input="invalid = false"
        @keydown.enter.prevent="commit"
        @change="commit"
        @blur="onBlur"
      />
      <button v-if="pinned" type="button" class="btn" @click="emit('unpin')">{{ t('playground.unpin') }}</button>
      <button v-else type="button" class="btn" @click="emit('pin', x)">{{ t('playground.pin') }}</button>
    </div>
    <p class="mode" aria-live="polite">
      <span class="dot" :class="{ on: pinned }" aria-hidden="true" />
      {{ pinned ? t('playground.pinned') : t('playground.following') }}
    </p>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <dl v-else-if="result" class="values">
      <div v-for="r in rows" :key="r.key" class="row" :data-verify-field="r.key">
        <dt>{{ r.label }}</dt>
        <dd>
          <span class="num">{{ r.value }}</span>
          <span v-if="r.interval" class="interval">
            {{ t('playground.interval') }}: [{{ f3(r.interval[0]) }}{{ sep }}{{ f3(r.interval[1]) }}]
          </span>
        </dd>
      </div>
    </dl>
    <p v-if="result && points.length === 0" class="note">{{ t('playground.priorShown') }}</p>
    <div v-if="onePointTex" class="kap9">
      <p class="note">{{ t('playground.onePoint') }}</p>
      <Formula :tex="onePointTex" display />
    </div>
  </section>
</template>

<style scoped>
.inspector {
  display: grid;
  gap: 0.5rem;
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
}
h3 {
  margin: 0;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.hint,
.note {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-muted);
}
.xrow {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
}
input {
  min-width: 0;
  font: inherit;
  font-variant-numeric: tabular-nums;
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  color: var(--text);
}
input[aria-invalid='true'] {
  border-color: var(--error);
}
input:focus-visible,
.btn:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.btn {
  font: inherit;
  font-size: 0.85rem;
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
.btn:hover {
  border-color: var(--accent);
}
.mode {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1.5px solid var(--text-muted);
}
.dot.on {
  background: var(--focus);
  border-color: var(--focus);
}
.values {
  margin: 0.25rem 0 0;
  display: grid;
  gap: 0.15rem;
}
.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 0.75rem;
  padding: 0.35rem 0;
  border-bottom: 1px solid var(--grid);
}
dt {
  font-size: 0.9rem;
}
dd {
  margin: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.num {
  font-size: 1.05rem;
  font-weight: 600;
}
.interval {
  display: block;
  font-size: 0.78rem;
  color: var(--text-muted);
}
.error {
  margin: 0;
  color: var(--error);
}
.kap9 {
  display: grid;
  gap: 0.35rem;
  padding-top: 0.25rem;
  font-size: 0.85rem;
}
</style>
