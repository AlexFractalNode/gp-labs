<script setup lang="ts">
/**
 * Daten-Lab (Spec §6): five step cards (data → target/features → split → model → result). A card header jumps
 * back to its step at any time; later steps open once their inputs are valid. The hyperparameters are optimised
 * in the worker (maxIter 500); the fitted model is evaluated on the main thread (`evaluateRun`). A failed or
 * cancelled run sets `datalab-run` to `error` and keeps the last successful result and the runs table.
 * Scenarios d1–d3 (Spec §3.3) load the Yacht data, apply their settings and start one run.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useI18n, type MessageKey } from '../../i18n'
import { useRoute } from '../../router'
import { decodeKernel, KERNEL_PARAM } from '../../urlState'
import { inferColumns, parseCsv, type ColumnInfo, type Table } from '../../core/csv'
import { GpError } from '../../core/errors'
import { kernelTex, MAX_ARD_DIM, type KernelSpec } from '../../core/kernels'
import { createRng } from '../../core/rng'
import { createOptimizeClient, type OptimizeHandle } from '../../worker/client'
import RefBadge from '../../ui/RefBadge.vue'
import ScenarioArea from '../../ui/ScenarioArea.vue'
import type { Scenario } from '../scenarios'
import { useScenario } from '../useScenario'
import { datalabKey, expectedDatalabSettings } from './scenarioKey'
import {
  buildModelWithNotices,
  canLogTarget,
  evaluateRun,
  LARGE_N,
  NOTEBOOK_SPLIT,
  prepareDataset,
  prepareRun,
  splitIndices,
  type Dataset,
  type RunConfig,
  type RunResult,
  type Split,
} from './pipeline'
import type { TemplateId } from './templates'
import { runMeta, useRuns } from './runs'
import { problemOf, type ModelPreview, type PanelState, type Problem, type RunView, type StepId, type TemplateChoice } from './labState'
import StepData from './StepData.vue'
import StepTarget from './StepTarget.vue'
import StepSplit from './StepSplit.vue'
import StepModel from './StepModel.vue'
import StepResult from './StepResult.vue'

defineOptions({ name: 'DataLabView' })

const { lang, t } = useI18n()
const route = useRoute()
const { runs, add, clear } = useRuns()


const STEPS: { id: StepId; chapter: string; code: string }[] = [
  { id: 'data', chapter: '15', code: '87–90' },
  { id: 'target', chapter: '15', code: '87–90' },
  { id: 'split', chapter: '15', code: '87–90' },
  { id: 'model', chapter: '14–15', code: '91' },
  { id: 'result', chapter: '15, 17', code: '92–94' },
]
/** Files above this size are refused (parsing happens on the main thread). */
const MAX_FILE_MB = 20
const NOTEBOOK_FEATURES = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']
const MAX_ITER = 500
/**
 * Notebook template (Code 91) as sklearn writes it, RBF(ℓ) · DotProduct(σ₀): the core kernel with its fixed values
 * substituted (RBF amplitude σ = 1, linear location c = 0); free are ℓ, σ₀ and σₙ.
 */
const NOTEBOOK_TEX = String.raw`k(x,x') = \exp\left(-\frac{\lVert x - x' \rVert^2}{2\ell^2}\right) \cdot \left(\sigma_0^2 + x^\top x'\right)`

const active = ref<StepId>('data')

// ------------------------------------------------------------------ step 1: data

interface Source {
  name: string
  kind: 'yacht' | 'file'
  table: Table
  info: ColumnInfo[]
}
const source = shallowRef<Source | null>(null)
const loadState = ref<PanelState>('empty')
const loadProblem = shallowRef<Problem | null>(null)
let loadToken = 0

function useTable(name: string, kind: Source['kind'], text: string, token: number) {
  if (token !== loadToken) return
  try {
    const table = parseCsv(text)
    const info = inferColumns(table)
    source.value = { name, kind, table, info }
    loadState.value = 'ready'
    loadProblem.value = null
    resetSelection(table, info)
  } catch (e) {
    if (!(e instanceof GpError)) console.error(e)
    loadState.value = 'error'
    loadProblem.value = problemOf(e)
  }
}

async function loadYacht() {
  const token = ++loadToken
  loadState.value = 'loading'
  loadProblem.value = null
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/yacht.csv`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    useTable(t('datalab.data.yachtName'), 'yacht', text, token)
  } catch (e) {
    if (token !== loadToken) return
    loadState.value = 'error'
    loadProblem.value = { key: 'datalab.data.fetchFailed', vars: { status: e instanceof Error ? e.message : String(e) } }
  }
}

async function loadFile(file: File) {
  const token = ++loadToken
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    loadState.value = 'error'
    loadProblem.value = { key: 'datalab.data.tooLarge', vars: { mb: MAX_FILE_MB } }
    return
  }
  loadState.value = 'loading'
  loadProblem.value = null
  let text: string
  try {
    text = await file.text()
  } catch {
    if (token !== loadToken) return
    loadState.value = 'error'
    loadProblem.value = { key: 'datalab.data.readFailed' }
    return
  }
  useTable(file.name, 'file', text, token)
}

// ------------------------------------------------------------------ step 2: target and features

const target = ref('')
const selected = ref<string[]>([])
const logTarget = ref(false)

/** Defaults for a new table: target `y` (else the last numeric column), every usable numeric column as feature. */
function resetSelection(table: Table, info: ColumnInfo[]) {
  const numeric = info.filter((c) => c.type === 'numeric')
  const tgt = numeric.find((c) => c.name === 'y') ?? numeric[numeric.length - 1]
  target.value = tgt?.name ?? table.columns[0]
  selected.value = info.filter((c) => c.type === 'numeric' && !c.constant && c.name !== target.value).map((c) => c.name)
  logTarget.value = false
  notebookMode.value = false
  subsample.value = false
  testFraction.value = 0.1
  seed.value = 42
}

/** Selected features in table column order (the order of X's columns), without the target. */
const features = computed(() => {
  const s = source.value
  if (!s) return []
  return s.table.columns.filter((c) => c !== target.value && selected.value.includes(c))
})

const prepared = computed<{ dataset: Dataset } | { problem: Problem } | null>(() => {
  const s = source.value
  if (!s) return null
  try {
    return { dataset: prepareDataset(s.table, target.value, features.value) }
  } catch (e) {
    if (!(e instanceof GpError)) console.error(e)
    return { problem: problemOf(e) }
  }
})
const dataset = computed(() => (prepared.value && 'dataset' in prepared.value ? prepared.value.dataset : null))
const datasetProblem = computed(() => (prepared.value && 'problem' in prepared.value ? prepared.value.problem : null))
const canLog = computed(() => dataset.value !== null && canLogTarget(dataset.value.y))
watch(canLog, (ok) => {
  if (!ok) logTarget.value = false
})

// ------------------------------------------------------------------ step 3: split

const testFraction = ref(0.1)
const seed = ref(42)
const notebookMode = ref(false)
const subsample = ref(false)

const notebookAvailable = computed(() => {
  const s = source.value
  const ds = dataset.value
  return (
    s?.kind === 'yacht' &&
    target.value === 'y' &&
    ds !== null &&
    ds.featureNames.join() === NOTEBOOK_FEATURES.join() &&
    ds.X.rows === NOTEBOOK_SPLIT.train.length + NOTEBOOK_SPLIT.test.length
  )
})
watch(notebookAvailable, (ok) => {
  if (!ok) notebookMode.value = false
})

/** `k` of the rows in `idx`, drawn without replacement with a seeded partial Fisher–Yates shuffle. */
function subsetOf(idx: readonly number[], k: number, s: number): number[] {
  const a = [...idx]
  const rng = createRng(s)
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng.uniform() * (a.length - i))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, k)
}

const baseSplit = computed<Split | null>(() => {
  const ds = dataset.value
  if (!ds) return null
  if (notebookMode.value && notebookAvailable.value) return NOTEBOOK_SPLIT
  return splitIndices(ds.X.rows, testFraction.value, seed.value)
})
const split = computed<Split | null>(() => {
  const b = baseSplit.value
  if (!b) return null
  if (subsample.value && b.train.length > LARGE_N) return { train: subsetOf(b.train, LARGE_N, seed.value), test: b.test }
  return b
})

// ------------------------------------------------------------------ step 4: model

const template = ref<TemplateChoice>('notebook')
const restarts = ref(5)

/**
 * Kernel from the Kernel-Baukasten (`?kernel=`), offered when it decodes to a valid spec. 2D kernels (ARD,
 * activeDims) are adapted by `buildModelWithNotices` with visible notices; a kernel that cannot be used (e.g. Gibbs
 * on several features) shows its error in step 4. Read only while the lab's own route is shown: the cached
 * (KeepAlive) lab must not react to the `?kernel=` of other tools.
 */
const urlKernel = shallowRef<KernelSpec | null>(null)
watch(
  route,
  (r) => {
    if (r.route !== 'datalab') return
    const k = r.params.get(KERNEL_PARAM)
    const spec = k === null ? null : decodeKernel(k)
    urlKernel.value = spec
  },
  { immediate: true },
)
/** The template chosen before a URL kernel switched to 'baukasten'; restored when that kernel goes away. */
let templateBeforeUrl: TemplateChoice = 'notebook'
watch(
  urlKernel,
  (spec) => {
    if (spec) {
      if (template.value !== 'baukasten') templateBeforeUrl = template.value
      template.value = 'baukasten'
    } else if (template.value === 'baukasten') template.value = templateBeforeUrl
  },
  { immediate: true },
)
const d = computed(() => dataset.value?.X.cols ?? 0)
const ardBlocked = computed(() => d.value > MAX_ARD_DIM)
watch(ardBlocked, (blocked) => {
  if (blocked && template.value.startsWith('ard-')) template.value = 'rbf'
})

const templateValue = computed<TemplateId | KernelSpec | null>(() =>
  template.value === 'baukasten' ? urlKernel.value : template.value,
)

const modelPreview = computed<ModelPreview | null>(() => {
  const tv = templateValue.value
  if (!dataset.value || tv === null) return null
  try {
    const { model, notices } = buildModelWithNotices(tv, d.value)
    let tex: string | null = tv === 'notebook' ? NOTEBOOK_TEX : null
    try {
      tex ??= kernelTex(model.kernel, { inputDim: d.value })
    } catch (e) {
      if (!(e instanceof GpError)) throw e
    }
    return { tex, notices, problem: null }
  } catch (e) {
    if (!(e instanceof GpError)) console.error(e)
    return { tex: null, notices: [], problem: problemOf(e) }
  }
})

// ------------------------------------------------------------------ run

const runView = reactive<RunView>({ state: 'empty', run: 0, total: 0, best: NaN, problem: null, lastId: 0, lastLogML: NaN })
const current = shallowRef<RunResult | null>(null)
let handle: OptimizeHandle | null = null
/** Own worker: a Playground optimisation (shared default client) never cancels a lab run. */
const optimizer = createOptimizeClient()

const canStart = computed(
  () => dataset.value !== null && split.value !== null && templateValue.value !== null && modelPreview.value?.problem === null,
)

function runFailed(problem: Problem) {
  runView.state = 'error'
  runView.problem = problem
}

function startRun() {
  const ds = dataset.value
  const sp = split.value
  const tv = templateValue.value
  if (!ds || !sp || tv === null || !canStart.value) return
  const cfg: RunConfig = { dataset: ds, split: sp, logTarget: logTarget.value, template: tv, restarts: restarts.value, seed: seed.value }
  const meta = { cfg, source: source.value?.name ?? '', target: logTarget.value ? `log(${target.value})` : target.value }
  let job
  try {
    const prep = prepareRun(cfg)
    const { model } = buildModelWithNotices(tv, ds.X.cols)
    const X: number[][] = []
    for (let i = 0; i < prep.Xtrain.rows; i++) {
      X.push(Array.from(prep.Xtrain.data.subarray(i * prep.Xtrain.cols, (i + 1) * prep.Xtrain.cols)))
    }
    job = { model, X, y: Array.from(prep.ytrain), restarts: restarts.value, seed: seed.value, maxIter: MAX_ITER }
  } catch (e) {
    if (!(e instanceof GpError)) console.error(e)
    handle?.cancel()
    handle = null
    runFailed(problemOf(e))
    return
  }
  // startOptimize cancels a running optimisation; its rejection is ignored below (handle !== h).
  const h = optimizer.startOptimize(job, (p) => {
    if (handle !== h) return
    runView.run = p.restart + 1
    runView.best = p.logML
  })
  handle = h
  Object.assign(runView, { state: 'loading', run: 0, total: restarts.value + 1, best: NaN, problem: null })
  h.result.then(
    (out) => {
      if (handle !== h) return
      handle = null
      try {
        const r = evaluateRun(cfg, out.model, out.logML, out.atBound)
        add(r, meta)
        current.value = r
        Object.assign(runView, { state: 'ready', problem: null, lastId: r.id, lastLogML: r.logML })
        active.value = 'result'
      } catch (e) {
        if (!(e instanceof GpError)) console.error(e)
        runFailed(problemOf(e))
      }
    },
    (e: unknown) => {
      if (handle !== h) return
      handle = null
      if (e instanceof GpError && e.details?.cancelled) runFailed({ key: 'datalab.model.cancelled' })
      else {
        if (!(e instanceof GpError)) console.error(e)
        const reason = e instanceof GpError ? String(e.details?.reason ?? e.code) : String(e)
        runFailed({ key: 'datalab.model.failed', vars: { reason } })
      }
    },
  )
}

function cancelRun() {
  handle?.cancel()
}

onBeforeUnmount(() => {
  handle = null
  optimizer.dispose()
})

function showRun(r: RunResult) {
  current.value = r
  active.value = 'result'
}
function clearRuns() {
  clear()
  current.value = null
  if (active.value === 'result') active.value = 'model'
}

// ------------------------------------------------------------------ cards

const reachable = computed<Record<StepId, boolean>>(() => ({
  data: true,
  target: source.value !== null,
  split: dataset.value !== null,
  model: dataset.value !== null,
  result: current.value !== null,
}))

function open(id: StepId) {
  if (reachable.value[id]) active.value = id
}

const num = (digits: number) => new Intl.NumberFormat(lang.value, { maximumFractionDigits: digits })

function templateLabel(choice: string): string {
  return t(`datalab.template.${choice}` as MessageKey)
}

const summaries = computed<Record<StepId, string>>(() => {
  const s = source.value
  const ds = dataset.value
  const sp = split.value
  const r = current.value
  return {
    data: s ? t('datalab.summary.data', { name: s.name, rows: s.table.rows.length, cols: s.table.columns.length }) : '',
    target: ds
      ? t('datalab.summary.target', { target: logTarget.value ? `log(${target.value})` : target.value, d: ds.X.cols })
      : '',
    split: sp
      ? t(notebookMode.value ? 'datalab.summary.splitNotebook' : 'datalab.summary.split', {
          train: sp.train.length,
          test: sp.test.length,
        })
      : '',
    model:
      runView.state === 'loading'
        ? t('datalab.summary.running')
        : ds
          ? t('datalab.summary.model', { template: templateLabel(template.value), restarts: restarts.value })
          : '',
    result: r ? t('datalab.summary.result', { id: r.id, rmse: num(3).format(r.metrics.rmseTest) }) : '',
  }
})

const currentMeta = computed(() => (current.value ? (runMeta(current.value) ?? null) : null))

// ------------------------------------------------------------------ scenarios

/** True from the adoption of a scenario until its Yacht data are loaded and its settings applied. */
const adopting = ref(false)
/** The current adoption (Yacht load plus settings); the start action waits for it. */
let pendingAdoption: Promise<void> = Promise.resolve()
/**
 * Runs started by a scenario, as `data-verify-runs`: a second start cancels the first, so the runs table alone
 * (one entry then) cannot show how often the start action ran.
 */
const scenarioRuns = ref(0)

/**
 * Adopts a Daten-Lab scenario (Spec §3.3): cancels a running run, goes back to step 1 and loads the Yacht data;
 * `resetSelection` sets target, features, test fraction and seed, then the scenario's settings follow. The runs
 * table stays, so d1–d3 can be compared. State only: the watcher may call this while the cached view is still
 * deactivated; the step switch to "model" belongs to the start action. A later adoption (`generation`) supersedes
 * this one, also after the asynchronous load.
 */
function adoptScenario(s: Scenario) {
  const gen = scenario.generation.value
  cancelRun()
  active.value = 'data'
  adopting.value = true
  pendingAdoption = loadYacht()
    .then(() => {
      // superseded, or closed / left for an address without scenario (e.g. `?kernel=`) while loading
      if (gen !== scenario.generation.value || scenario.active.value !== s) return
      const settings = s.datalab
      if (settings && loadState.value === 'ready' && source.value?.kind === 'yacht') {
        template.value = settings.template
        logTarget.value = settings.logTarget
        notebookMode.value = settings.notebookMode
        restarts.value = settings.restarts
      }
    })
    .catch((e: unknown) => console.error(`scenario ${s.id}: adoption failed`, e))
    .finally(() => {
      if (gen === scenario.generation.value) adopting.value = false
    })
}

/** Start action: one run per adoption, once the data and settings are in place and the adoption is still current. */
async function scenarioStartRun(s: Scenario, gen: number) {
  await pendingAdoption
  if (gen !== scenario.generation.value || scenario.active.value !== s) return
  if (loadState.value !== 'ready' || !canStart.value) return
  active.value = 'model' // progress visible
  scenarioRuns.value++
  startRun()
}

const scenario = useScenario('datalab', {
  adopt: adoptScenario,
  liveKey: () =>
    datalabKey({
      source: source.value?.kind ?? null,
      target: target.value,
      features: features.value,
      logTarget: logTarget.value,
      testFraction: testFraction.value,
      seed: seed.value,
      notebookMode: notebookMode.value,
      subsample: subsample.value,
      template: template.value,
      restarts: restarts.value,
    }),
  expectedKey: (s) => datalabKey(expectedDatalabSettings(s)),
  // Only loaded data can deviate: while loading or applying settings "changed" would flash for a flush after the
  // load; after a failed load (`error`, `source` may still hold older data) there is nothing to compare.
  settled: () => loadState.value === 'ready' && !adopting.value,
  actions: { startRun: scenarioStartRun },
})
// A cold start with a scenario adopts it in onMounted; until then the box must not report a deviation either.
adopting.value = scenario.active.value !== null
// KeepAlive: mounted once; later adoptions of the cached view come from the route watcher.
onMounted(() => {
  if (scenario.active.value) adoptScenario(scenario.active.value)
})
</script>

<template>
  <div
    class="dl"
    data-verify-unit="datalab-view"
    data-verify-state="ready"
    :data-verify-step="active"
    :data-verify-runs="scenarioRuns"
  >
    <header class="dl-head">
      <h2 class="title">{{ t('datalab.title') }}</h2>
      <p class="lead">{{ t('datalab.lead') }}</p>
    </header>

    <ScenarioArea tool="datalab" :scenario="scenario" />

    <ol class="steps">
      <li
        v-for="(s, i) in STEPS"
        :key="s.id"
        class="card"
        :class="{ open: active === s.id, locked: !reachable[s.id] }"
        :data-step="s.id"
      >
        <div class="card-head">
          <h3>
            <button
              type="button"
              class="step-btn"
              data-action="open-step"
              :aria-expanded="active === s.id"
              :aria-controls="`dl-step-${s.id}`"
              :disabled="!reachable[s.id]"
              :title="reachable[s.id] ? undefined : t('datalab.locked')"
              @click="open(s.id)"
            >
              <span class="step-no" aria-hidden="true">{{ i + 1 }}</span>
              <span class="step-text">
                <span class="step-kicker">{{ t('datalab.stepN', { n: i + 1 }) }}</span>
                <span class="step-title">{{ t(`datalab.step.${s.id}`) }}</span>
              </span>
              <span v-if="active !== s.id && summaries[s.id]" class="step-summary">{{ summaries[s.id] }}</span>
            </button>
          </h3>
          <RefBadge :chapter="s.chapter" :code="s.code" />
        </div>

        <div v-show="active === s.id" :id="`dl-step-${s.id}`" class="card-body">
          <StepData
            v-if="s.id === 'data'"
            :state="loadState"
            :problem="loadProblem"
            :name="source?.name ?? ''"
            :table="source?.table ?? null"
            :info="source?.info ?? []"
            @yacht="loadYacht"
            @file="loadFile"
            @next="open('target')"
          />
          <StepTarget
            v-else-if="s.id === 'target' && source"
            v-model:target="target"
            v-model:selected="selected"
            v-model:log-target="logTarget"
            :info="source.info"
            :dataset="dataset"
            :problem="datasetProblem"
            :can-log="canLog"
            @next="open('split')"
          />
          <StepSplit
            v-else-if="s.id === 'split' && dataset && split"
            v-model:test-fraction="testFraction"
            v-model:seed="seed"
            v-model:notebook-mode="notebookMode"
            v-model:subsample="subsample"
            :split="split"
            :base-train="baseSplit?.train.length ?? 0"
            :notebook-available="notebookAvailable"
            @next="open('model')"
          />
          <StepModel
            v-else-if="s.id === 'model' && dataset"
            v-model:template="template"
            v-model:restarts="restarts"
            :baukasten-available="urlKernel !== null"
            :ard-blocked="ardBlocked"
            :max-ard="MAX_ARD_DIM"
            :preview="modelPreview"
            :run="runView"
            :can-start="canStart"
            @start="startRun"
            @cancel="cancelRun"
          />
          <StepResult
            v-else-if="s.id === 'result'"
            :run="current"
            :meta="currentMeta"
            :runs="runs"
            @show="showRun"
            @clear="clearRuns"
            @goto="open"
          />
        </div>
      </li>
    </ol>

  </div>
</template>

<style>
/* Shared look of the Daten-Lab and its step components (unscoped, prefixed with .dl). */
.dl {
  --serif: 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif;
  max-width: 1320px;
  margin: 0 auto;
  display: grid;
  gap: 1rem;
}
.dl > *,
.dl .steps > * {
  min-width: 0;
}
.dl .dl-head {
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--border);
}
.dl .title {
  margin: 0;
  font-family: var(--serif);
  font-size: 1.75rem;
  font-weight: 600;
  letter-spacing: 0.005em;
}
.dl .lead {
  margin: 0.25rem 0 0;
  max-width: 70ch;
  color: var(--text-muted);
  font-size: 0.95rem;
}
.dl .steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}
.dl .card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  min-width: 0;
}
.dl .card.open {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  box-shadow: 0 1px 0 color-mix(in srgb, var(--accent) 25%, transparent);
}
.dl .card-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.55rem 1rem;
  flex-wrap: wrap;
}
.dl .card-head h3 {
  margin: 0;
  flex: 1 1 17rem;
  min-width: 0;
}
.dl .step-btn {
  all: unset;
  box-sizing: border-box;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  cursor: pointer;
  border-radius: 4px;
  padding: 0.15rem 0;
}
.dl .step-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.dl .step-btn:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 3px;
}
.dl .step-no {
  flex: none;
  width: 1.9rem;
  height: 1.9rem;
  border-radius: 50%;
  display: inline-grid;
  place-items: center;
  font-family: var(--serif);
  font-weight: 600;
  font-size: 1rem;
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.dl .card.open .step-no {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--surface);
}
.dl .step-text {
  display: grid;
  line-height: 1.2;
}
.dl .step-kicker {
  font-size: 0.7rem;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.dl .step-title {
  font-family: var(--serif);
  font-size: 1.15rem;
  font-weight: 600;
}
.dl .step-summary {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 0.85rem;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}
.dl .card-body {
  padding: 0.25rem 1rem 1rem;
  border-top: 1px solid var(--grid);
  min-width: 0;
}
.dl .panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.85rem 1rem;
  min-width: 0;
}
.dl .panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}
.dl h4 {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.dl .field-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 0.3rem;
}
.dl select,
.dl input[type='number'] {
  font: inherit;
  font-size: 0.9rem;
  padding: 0.3rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  color: var(--text);
  max-width: 100%;
}
.dl select:focus-visible,
.dl input:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.dl input[type='checkbox'] {
  accent-color: var(--accent);
  width: 1rem;
  height: 1rem;
}
.dl .btn {
  font: inherit;
  font-size: 0.85rem;
  padding: 0.35rem 0.8rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}
.dl .btn:hover:not(:disabled) {
  border-color: var(--accent);
}
.dl .btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dl .btn:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.dl .btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--surface);
  font-weight: 600;
  padding: 0.5rem 1rem;
}
.dl .actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-top: 0.9rem;
}
.dl .muted {
  color: var(--text-muted);
  font-size: 0.85rem;
}
.dl .small {
  font-size: 0.8rem;
}
.dl .tabular {
  font-variant-numeric: tabular-nums;
}
.dl .note {
  margin: 0.6rem 0 0;
  padding: 0.45rem 0.7rem;
  border-radius: 4px;
  border-left: 4px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 7%, transparent);
  font-size: 0.88rem;
  max-width: 85ch;
}
.dl .note.warn {
  border-left-color: var(--c-y);
  background: color-mix(in srgb, var(--c-y) 10%, transparent);
}
.dl .error-box {
  margin: 0.6rem 0 0;
  border: 1px solid var(--error);
  border-left-width: 4px;
  background: var(--error-bg);
  color: var(--text);
  padding: 0.5rem 0.8rem;
  border-radius: 4px;
  font-size: 0.9rem;
}
.dl .tag {
  display: inline-block;
  font-size: 0.75rem;
  padding: 0.05rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--accent);
  color: var(--accent);
}
.dl .sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
@media (max-width: 640px) {
  .dl .card-head,
  .dl .card-body {
    padding-left: 0.7rem;
    padding-right: 0.7rem;
  }
  .dl .step-summary {
    margin-left: 2.65rem;
    flex-basis: 100%;
  }
}
</style>
