<script setup lang="ts">
/**
 * Step 5: metrics (original units), parity plot with ±2·s_y error bars (Code 94), coverage and calibration,
 * ARD relevance, a 1D slice with s_f and s_y bands, warnings and the run comparison table (memory only).
 * With log(y) the point prediction exp(μ) is the median and the bands are asymmetric (labelled as such).
 */
import { computed, ref, useId, watch } from 'vue'
import { useI18n, type MessageKey } from '../../i18n'
import { GpError } from '../../core/errors'
import { modelParams, type GpModel } from '../../core/gp'
import PlotFrame from '../../ui/PlotFrame.vue'
import ErrorBarLayer from '../../ui/ErrorBarLayer.vue'
import LineLayer from '../../ui/LineLayer.vue'
import BandLayer from '../../ui/BandLayer.vue'
import PointLayer from '../../ui/PointLayer.vue'
import { sliceAt, type RunResult, type RunWarning } from './pipeline'
import { runMeta, type RunMeta } from './runs'
import type { StepId } from './labState'

const props = defineProps<{ run: RunResult | null; meta: RunMeta | null; runs: RunResult[] }>()
const emit = defineEmits<{ show: [r: RunResult]; clear: []; goto: [step: StepId] }>()
const { lang, t } = useI18n()
const id = useId()

/** Nominal coverage of ±2 sd under a normal distribution. */
const NOMINAL_2SD = 0.9545

const fmt = (opts: Intl.NumberFormatOptions) => new Intl.NumberFormat(lang.value, opts)
const f = computed(() => ({
  r2: fmt({ minimumFractionDigits: 4, maximumFractionDigits: 4 }),
  rmse: fmt({ maximumSignificantDigits: 4 }),
  lml: fmt({ minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  pct: fmt({ style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  pp: fmt({ maximumFractionDigits: 1 }),
  hyper: fmt({ maximumSignificantDigits: 3 }),
}))

const logY = computed(() => props.meta?.cfg.logTarget === true)
const templateLabel = (r: RunResult) => t(`datalab.template.${r.label}` as MessageKey)

// ------------------------------------------------------------------ metrics

const tiles = computed(() => {
  const r = props.run
  if (!r) return []
  const m = r.metrics
  return [
    { key: 'r2Train', label: t('datalab.result.r2Train'), value: m.r2Train, text: f.value.r2.format(m.r2Train) },
    { key: 'r2Test', label: t('datalab.result.r2Test'), value: m.r2Test, text: f.value.r2.format(m.r2Test) },
    { key: 'rmseTrain', label: t('datalab.result.rmseTrain'), value: m.rmseTrain, text: f.value.rmse.format(m.rmseTrain) },
    { key: 'rmseTest', label: t('datalab.result.rmseTest'), value: m.rmseTest, text: f.value.rmse.format(m.rmseTest) },
    { key: 'logML', label: t('datalab.result.logML'), value: r.logML, text: f.value.lml.format(r.logML), note: t('datalab.result.logMLNote') },
  ]
})

const nTest = computed(() => props.run?.test.yTrue.length ?? 0)
const coveredCount = computed(() => props.run?.metrics.coveredCount ?? 0)
/** One binomial standard error of a 95.45 % coverage with nTest points, in percentage points. */
const coverageSe = computed(() =>
  nTest.value > 0 ? f.value.pp.format(100 * Math.sqrt((NOMINAL_2SD * (1 - NOMINAL_2SD)) / nTest.value)) : '',
)

// ------------------------------------------------------------------ parity plot

function extent(values: number[][], pad = 0.05): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const arr of values)
    for (const v of arr) {
      if (!Number.isFinite(v)) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  if (!(hi > lo)) return Number.isFinite(lo) ? [lo - 1, lo + 1] : [0, 1]
  const p = (hi - lo) * pad
  return [lo - p, hi + p]
}

/** Same domain on both axes, so that the diagonal is at 45°; includes 0 like Code 94. */
const parityDomain = computed<[number, number]>(() => {
  const r = props.run
  if (!r) return [0, 1]
  const [lo, hi] = extent([r.test.yTrue, r.test.yPred, r.test.lowerY, r.test.upperY, [0]], 0.04)
  return [lo, hi]
})

// ------------------------------------------------------------------ calibration

const calib = computed(() => {
  const c = props.run?.metrics.calibration ?? []
  return { x: c.map((p) => p.level), y: c.map((p) => p.observed) }
})

// ------------------------------------------------------------------ relevance (ARD)

const relevance = computed(() => {
  const rel = props.run?.relevance
  if (!rel || rel.length === 0) return []
  const inv = rel.map((r) => 1 / r.ell)
  const max = Math.max(...inv)
  return rel
    .map((r, i) => ({ ...r, share: max > 0 ? inv[i] / max : 0 }))
    .sort((a, b) => a.ell - b.ell)
})

// ------------------------------------------------------------------ slice

const sliceFeature = ref(0)
watch(
  () => props.run,
  () => {
    sliceFeature.value = 0
  },
)
const featureNames = computed(() => props.meta?.cfg.dataset.featureNames ?? [])

const slice = computed(() => {
  const r = props.run
  const m = props.meta
  if (!r || !m) return null
  try {
    return { ok: true as const, ...sliceAt(r, m.cfg, Math.min(sliceFeature.value, featureNames.value.length - 1)) }
  } catch (e) {
    if (!(e instanceof GpError)) console.error(e)
    return { ok: false as const }
  }
})
const sliceY = computed<[number, number]>(() => {
  const s = slice.value
  if (!s || !s.ok) return [0, 1]
  return extent([s.lowerY, s.upperY, s.mean], 0.06)
})
/** Share of the band half-width below which the s_f and s_y bands count as indistinguishable. */
const SAME_BAND_REL = 0.01
/**
 * Largest gap (original units) between the s_f and s_y band limits, when it is below SAME_BAND_REL of the largest
 * s_y half-width (small σₙ: the bands coincide in the plot and the legend says so); null otherwise.
 */
const bandGap = computed<number | null>(() => {
  const s = slice.value
  if (!s || !s.ok) return null
  let gap = 0
  let half = 0
  for (let i = 0; i < s.x.length; i++) {
    gap = Math.max(gap, Math.abs(s.upperY[i] - s.upperF[i]), Math.abs(s.lowerF[i] - s.lowerY[i]))
    half = Math.max(half, (s.upperY[i] - s.lowerY[i]) / 2)
  }
  return Number.isFinite(gap) && half > 0 && gap < SAME_BAND_REL * half ? gap : null
})
const sliceX = computed<[number, number]>(() => {
  const s = slice.value
  if (!s || !s.ok || s.x.length < 2) return [0, 1]
  return [s.x[0], s.x[s.x.length - 1]]
})

// ------------------------------------------------------------------ warnings

const warningStep: Partial<Record<RunWarning, StepId>> = { negativePredictions: 'target', largeN: 'split' }

// ------------------------------------------------------------------ hyperparameters

const SYMBOLS: Record<string, string> = {
  ell: 'ℓ',
  sigma: 'σ',
  sigma0: 'σ₀',
  sigmaN: 'σₙ',
  alpha: 'α',
  period: 'T',
  l1: 'ℓ₁',
  l2: 'ℓ₂',
}

/** Fitted free parameters in natural units, e.g. "ℓ = 3,21 · σ₀ = 0,41 · σₙ = 0,05" (ARD: ℓ(a1), …). */
function hyperText(model: GpModel, names: string[]): string {
  try {
    const info = modelParams(model, Math.max(names.length, 1))
    const items = info.names.map((name, i) => {
      const parts = name.split('.')
      const key = parts[parts.length - 1]
      const ard = /^ell_(\d+)$/.exec(key)
      const sym = ard ? `ℓ(${names[Number(ard[1])] ?? ard[1]})` : (SYMBOLS[key] ?? key)
      return { sym, where: parts.length > 1 ? `${parts[0]}${parts[1]}` : '', value: Math.exp(info.logValues[i]) }
    })
    const seen = new Map<string, number>()
    for (const it of items) seen.set(it.sym, (seen.get(it.sym) ?? 0) + 1)
    return items
      .map((it) => `${(seen.get(it.sym) ?? 0) > 1 ? `${it.sym}[${it.where}]` : it.sym} = ${f.value.hyper.format(it.value)}`)
      .join(' · ')
  } catch (e) {
    if (!(e instanceof GpError)) throw e
    return '–'
  }
}

function dataText(r: RunResult): string {
  const m = metaOf(r)
  if (!m) return '–'
  return t('datalab.runs.dataValue', { source: m.source, target: m.target, d: m.cfg.dataset.featureNames.length })
}

const metaOf = (r: RunResult) => runMeta(r)
</script>

<template>
  <div class="step-result">
    <section
      class="result"
      data-verify-unit="datalab-result"
      :data-verify-state="run ? 'ready' : 'empty'"
      :data-run-id="run?.id"
    >
      <template v-if="run">
        <p class="shown">
          <strong>{{ t('datalab.result.shownRun', { id: run.id, template: templateLabel(run) }) }}</strong>
          <span class="muted"> · {{ meta ? dataText(run) : '' }} · {{ t('datalab.result.original') }}</span>
        </p>

        <div class="tiles">
          <div
            v-for="tile in tiles"
            :key="tile.key"
            class="tile"
            :data-metric="tile.key"
            :data-value="String(tile.value)"
          >
            <span class="tile-label">{{ tile.label }}</span>
            <span class="tile-value tabular">{{ tile.text }}</span>
            <span v-if="tile.note" class="tile-note">{{ tile.note }}</span>
          </div>
          <div class="tile coverage" data-metric="coverage2sd" :data-value="String(run.metrics.coverage2sd)">
            <span class="tile-label">{{ t('datalab.result.coverage') }}</span>
            <span class="tile-value tabular">{{ f.pct.format(run.metrics.coverage2sd) }}</span>
            <span class="tile-note">{{ t('datalab.result.coverageValue', { k: coveredCount, n: nTest }) }}</span>
          </div>
        </div>
        <p v-if="logY" class="note">{{ t('datalab.result.medianNote') }}</p>

        <ul v-if="run.warnings.length" class="warnings" :aria-label="t('datalab.result.warnings')">
          <li v-for="w in run.warnings" :key="w" class="note warn" :data-warning="w">
            {{ t(`warning.${w}`) }}
            <button v-if="warningStep[w]" type="button" class="btn link-btn" @click="emit('goto', warningStep[w]!)">
              {{ w === 'negativePredictions' ? t('datalab.result.toTarget') : t('datalab.step.split') }}
            </button>
          </li>
        </ul>

        <div class="grid two">
          <figure class="panel">
            <figcaption class="panel-head"><h4>{{ t('datalab.result.parity') }}</h4></figcaption>
            <PlotFrame
              :x-domain="parityDomain"
              :y-domain="parityDomain"
              :width="480"
              :height="440"
              :x-label="t('datalab.result.parityX')"
              :y-label="logY ? t('datalab.result.parityYMedian') : t('datalab.result.parityY')"
              :aria-label="t('datalab.result.parityLabel')"
            >
              <LineLayer :x="parityDomain" :y="parityDomain" variant="truth" />
              <ErrorBarLayer :x="run.test.yTrue" :lower="run.test.lowerY" :upper="run.test.upperY" variant="y" />
              <PointLayer :x="run.test.yTrue" :y="run.test.yPred" :editable="false" />
            </PlotFrame>
            <ul class="legend">
              <li><span class="sw bar" data-variant="y" />{{ logY ? t('datalab.result.legendBarsLog') : t('datalab.result.legendBars') }}</li>
              <li><span class="sw dash" data-variant="truth" />{{ t('datalab.result.legendDiag') }}</li>
            </ul>
          </figure>

          <figure class="panel">
            <figcaption class="panel-head"><h4>{{ t('datalab.result.calibration') }}</h4></figcaption>
            <PlotFrame
              :x-domain="[0.4, 1]"
              :y-domain="[0, 1]"
              :width="420"
              :height="340"
              :x-label="t('datalab.result.calibrationX')"
              :y-label="t('datalab.result.calibrationY')"
              :aria-label="t('datalab.result.calibrationLabel')"
            >
              <LineLayer :x="[0, 1]" :y="[0, 1]" variant="truth" />
              <LineLayer :x="calib.x" :y="calib.y" variant="f" />
              <PointLayer :x="calib.x" :y="calib.y" :editable="false" />
            </PlotFrame>
            <p class="muted small">{{ t('datalab.result.calibrationHint') }}</p>
            <p class="muted small">{{ t('datalab.result.coverageSe', { n: nTest, se: coverageSe }) }}</p>
          </figure>
        </div>

        <div class="grid two slice-row">
          <figure class="panel">
            <figcaption class="panel-head">
              <h4>{{ t('datalab.result.slice') }}</h4>
              <span class="slice-pick">
                <label :for="`${id}-feat`" class="muted">{{ t('datalab.result.sliceFeature') }}</label>
                <select :id="`${id}-feat`" v-model.number="sliceFeature" data-field="slice-feature">
                  <option v-for="(name, j) in featureNames" :key="name" :value="j">{{ name }}</option>
                </select>
              </span>
            </figcaption>
            <template v-if="slice && slice.ok">
              <PlotFrame
                :x-domain="sliceX"
                :y-domain="sliceY"
                :width="640"
                :height="320"
                :x-label="featureNames[sliceFeature] ?? ''"
                :y-label="logY ? t('datalab.result.parityYMedian') : t('datalab.result.sliceY')"
                :aria-label="t('datalab.result.sliceLabel')"
              >
                <BandLayer :x="slice.x" :lower="slice.lowerY" :upper="slice.upperY" variant="y" />
                <BandLayer :x="slice.x" :lower="slice.lowerF" :upper="slice.upperF" variant="f" />
                <LineLayer :x="slice.x" :y="slice.mean" variant="mean" />
              </PlotFrame>
              <ul class="legend">
                <li><span class="sw line" data-variant="mean" />{{ logY ? t('datalab.result.legendMedian') : t('datalab.result.legendMean') }}</li>
                <li><span class="sw solid" data-variant="f" />{{ t('datalab.result.legendF') }}<template v-if="logY">, {{ t('datalab.result.asym') }}</template></li>
                <li><span class="sw hatch" data-variant="y" />{{ t('datalab.result.legendY') }}<template v-if="logY">, {{ t('datalab.result.asym') }}</template></li>
              </ul>
              <p v-if="bandGap !== null" class="muted small" data-note="sf-equals-sy">
                {{ t('datalab.result.sfApproxSy', { d: f.hyper.format(bandGap) }) }}
              </p>
              <p class="muted small">{{ t('datalab.result.sliceHint', { feature: featureNames[sliceFeature] ?? '' }) }}</p>
            </template>
            <p v-else class="error-box" role="alert">{{ t('datalab.result.sliceError') }}</p>
            <p class="note">{{ t('datalab.result.sfsy') }}</p>
          </figure>

          <figure class="panel">
            <figcaption class="panel-head"><h4>{{ t('datalab.result.relevance') }}</h4></figcaption>
            <ul v-if="relevance.length" class="bars" :aria-label="t('datalab.result.relevanceLabel')">
              <li v-for="r in relevance" :key="r.feature" class="bar-row">
                <span class="bar-name">{{ r.feature }}</span>
                <span class="bar-track"><span class="bar-fill" :style="{ width: `${Math.max(r.share * 100, 0.5)}%` }" /></span>
                <span class="bar-value tabular">ℓ = {{ f.hyper.format(r.ell) }}</span>
              </li>
            </ul>
            <p class="muted small">{{ relevance.length ? t('datalab.result.relevanceHint') : t('datalab.result.relevanceNone') }}</p>
          </figure>
        </div>
      </template>
    </section>

    <section
      class="panel runs"
      data-verify-unit="datalab-runs"
      :data-verify-state="runs.length ? 'ready' : 'empty'"
      :data-verify-count="runs.length"
    >
      <header class="panel-head">
        <h4>{{ t('datalab.runs.title') }}</h4>
        <button v-if="runs.length" type="button" class="btn" data-action="clear-runs" @click="emit('clear')">
          {{ t('datalab.runs.clear') }}
        </button>
      </header>
      <p class="muted small">{{ t('datalab.runs.hint') }}</p>
      <p v-if="!runs.length" class="muted">{{ t('datalab.runs.empty') }}</p>
      <div v-else class="table-wrap">
        <table class="runs-table">
          <caption class="sr-only">{{ t('datalab.runs.caption') }}</caption>
          <thead>
            <tr>
              <th scope="col">{{ t('datalab.runs.run') }}</th>
              <th scope="col">{{ t('datalab.runs.data') }}</th>
              <th scope="col">{{ t('datalab.runs.kernel') }}</th>
              <th scope="col" class="num">{{ t('datalab.runs.logML') }}</th>
              <th scope="col">{{ t('datalab.runs.hyper') }}</th>
              <th scope="col" class="num">{{ t('datalab.runs.rmse') }}</th>
              <th scope="col" class="num">{{ t('datalab.runs.r2') }}</th>
              <th scope="col" class="num">{{ t('datalab.runs.coverage') }}</th>
              <th scope="col"><span class="sr-only">{{ t('datalab.runs.show') }}</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in runs" :key="r.id" :class="{ current: r === run }" :data-run-id="r.id">
              <td class="num">{{ r.id }}</td>
              <td>{{ dataText(r) }}</td>
              <td>{{ templateLabel(r) }}</td>
              <td class="num">{{ f.lml.format(r.logML) }}</td>
              <td class="hyper">{{ hyperText(r.model, metaOf(r)?.cfg.dataset.featureNames ?? []) }}</td>
              <td class="num">{{ f.rmse.format(r.metrics.rmseTest) }}</td>
              <td class="num">{{ f.r2.format(r.metrics.r2Test) }}</td>
              <td class="num">{{ f.pct.format(r.metrics.coverage2sd) }}</td>
              <td>
                <span v-if="r === run" class="tag">{{ t('datalab.runs.shown') }}</span>
                <button v-else type="button" class="btn" @click="emit('show', r)">{{ t('datalab.runs.show') }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.step-result {
  display: grid;
  gap: 1rem;
  margin-top: 0.75rem;
}
.step-result > * {
  min-width: 0;
}
.shown {
  margin: 0 0 0.75rem;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
  gap: 0.6rem;
}
.tile {
  display: grid;
  align-content: start;
  gap: 0.15rem;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
}
.tile-label {
  font-size: 0.78rem;
  font-weight: 650;
  letter-spacing: 0.02em;
  color: var(--text-muted);
}
.tile-value {
  font-family: var(--serif);
  font-size: 1.5rem;
  font-weight: 600;
}
.tile-note {
  font-size: 0.75rem;
  color: var(--text-muted);
}
.tile.coverage {
  grid-column: span 2;
  border-color: color-mix(in srgb, var(--c-y) 60%, var(--border));
}
.warnings {
  list-style: none;
  padding: 0;
  margin: 0.25rem 0 0;
  display: grid;
  gap: 0.4rem;
}
.warnings .note {
  max-width: none;
}
.link-btn {
  margin-left: 0.4rem;
  padding: 0.1rem 0.55rem;
  font-size: 0.8rem;
}
.grid.two {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 1rem;
  margin-top: 1rem;
  align-items: start;
}
.grid.two.slice-row {
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
}
figure {
  margin: 0;
}
figure p {
  margin: 0.4rem 0 0;
}
.slice-pick {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.legend {
  list-style: none;
  margin: 0.3rem 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 1.1rem;
  font-size: 0.8rem;
  color: var(--text-muted);
}
.legend li {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.sw {
  display: inline-block;
  width: 1.4rem;
  height: 0.75rem;
}
.sw.bar {
  width: 0.6rem;
  height: 0.9rem;
  border-top: 2px solid var(--v);
  border-bottom: 2px solid var(--v);
  background: linear-gradient(var(--v), var(--v)) center / 2px 100% no-repeat;
}
.sw.dash {
  height: 0;
  border-top: 2px dashed var(--v);
}
.sw.line {
  height: 0;
  border-top: 3px solid var(--v);
}
.sw.solid {
  background: color-mix(in srgb, var(--v) 22%, transparent);
  border: 1px solid color-mix(in srgb, var(--v) 60%, transparent);
}
.sw.hatch {
  border: 1px solid color-mix(in srgb, var(--v) 50%, transparent);
  background: repeating-linear-gradient(45deg, var(--v) 0 1.4px, transparent 1.4px 5px);
}
.bars {
  list-style: none;
  margin: 0.3rem 0 0;
  padding: 0;
  display: grid;
  gap: 0.45rem;
}
.bar-row {
  display: grid;
  grid-template-columns: minmax(3rem, auto) minmax(0, 1fr) auto;
  gap: 0.6rem;
  align-items: center;
  font-size: 0.85rem;
}
.bar-name {
  font-weight: 600;
}
.bar-track {
  height: 0.8rem;
  background: var(--grid);
  border-radius: 2px;
  overflow: hidden;
}
.bar-fill {
  display: block;
  height: 100%;
  background: var(--accent);
}
.bar-value {
  color: var(--text-muted);
  font-size: 0.8rem;
}
.table-wrap {
  /* Containing block for the sr-only header text, so it is clipped by the scroll box. */
  position: relative;
  overflow-x: auto;
}
.runs-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}
.runs-table th,
.runs-table td {
  padding: 0.35rem 0.55rem;
  border-bottom: 1px solid var(--grid);
  text-align: left;
  vertical-align: top;
}
.runs-table th {
  font-size: 0.78rem;
  font-weight: 650;
  color: var(--text-muted);
  white-space: nowrap;
}
.runs-table .num {
  text-align: right;
  white-space: nowrap;
}
.runs-table .hyper {
  font-size: 0.8rem;
  min-width: 14rem;
}
.runs-table tr.current td {
  background: color-mix(in srgb, var(--accent) 7%, transparent);
}
@media (max-width: 900px) {
  .grid.two,
  .grid.two.slice-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 480px) {
  .tile.coverage {
    grid-column: auto;
  }
}
</style>
