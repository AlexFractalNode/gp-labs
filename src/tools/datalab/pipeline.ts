/**
 * Daten-Lab pipeline (Spec §6, Notebook Code 90–94): dataset preparation, split, StandardScaler (fitted on the
 * training rows only), kernel templates and the evaluation of a fitted GP (errors **and** uncertainty).
 *
 * Transform order: (optional) log y → standardise y with the train mean/std → GP. Predictions: GP mean ± z·sdY in
 * model space → un-standardise → (optional) exp, applied to each bound separately (asymmetric bands). With log y,
 * the point prediction exp(mean) is the median. Metrics are in original units. No optimisation happens here
 * (optimizeHyperparameters runs in the worker on `prepareRun(cfg)`).
 */
import type { Table } from '../../core/csv'
import { inferColumns } from '../../core/csv'
import { GpError } from '../../core/errors'
import { fitModel, posterior, posteriorMean, type Fit, type GpModel } from '../../core/gp'
import type { KernelSpec } from '../../core/kernels'
import { zeros, type Mat } from '../../core/linalg'
import { calibration, coverage, r2, rmse } from '../../core/metrics'
import { createRng } from '../../core/rng'
import { NOTEBOOK_SPLIT } from './notebookSplit'
import {
  clampSigmaN,
  DEFAULT_SIGMA_N,
  fromBaukasten,
  templateKernel,
  TEMPLATE_IDS,
  type BaukastenNotice,
  type TemplateId,
} from './templates'

export { NOTEBOOK_SPLIT }

/** Minimum number of rows after cleaning (Spec §6). */
export const MIN_ROWS = 10
/** Above this many training rows the lab warns about the O(n³) runtime. */
export const LARGE_N = 2000
/** Width of the displayed bands and of `coverage2sd` in sd units (nominal 95.45 %). */
const BAND_Z = 2

export interface Dataset {
  X: Mat
  y: Float64Array
  featureNames: string[]
  /** Rows removed because the target or a used feature was missing. */
  droppedRows: number
  excluded: { name: string; reason: 'text' | 'constant' }[]
}

export interface Split {
  readonly train: readonly number[]
  readonly test: readonly number[]
}

export interface Scaler {
  mean: Float64Array
  scale: Float64Array
}

export interface RunConfig {
  dataset: Dataset
  split: Split
  logTarget: boolean
  template: TemplateId | KernelSpec
  restarts: number
  seed: number
}

export type RunWarning = 'lengthscaleAtBound' | 'negativePredictions' | 'largeN'

export interface RunResult {
  id: number
  /** Template id, or 'baukasten' for a kernel from the Kernel-Baukasten. */
  label: string
  model: GpModel
  logML: number
  metrics: {
    r2Train: number
    r2Test: number
    rmseTrain: number
    rmseTest: number
    /** Fraction of test points inside ±2·sdY (nominal 95.45 %). */
    coverage2sd: number
    /** Number of test points inside ±2·sdY (coverage2sd = coveredCount / nTest). */
    coveredCount: number
    calibration: { level: number; observed: number }[]
  }
  test: {
    yTrue: number[]
    /** Point prediction in original units (the median exp(mean) with log y). */
    yPred: number[]
    /** ±2·sdY bounds in original units (asymmetric with log y). */
    lowerY: number[]
    upperY: number[]
    /** Model space: scaled y, or scaled log y. */
    sdF: number[]
    sdY: number[]
  }
  /** ARD length scales per feature (small ℓ = large influence). */
  relevance?: { feature: string; ell: number }[]
  warnings: RunWarning[]
}

// ---------------------------------------------------------------- dataset

function columnIndex(t: Table, name: string): number {
  const j = t.columns.indexOf(name)
  if (j < 0) throw new GpError('InvalidInput', { reason: 'unknownColumn', column: name })
  return j
}

/**
 * Builds X (used features) and y (target) from a table. Text and constant features are excluded with a reason,
 * the target is never a feature, rows with a null in the target or a used feature are dropped.
 * Throws GpError('InvalidInput') with reason 'unknownColumn', 'targetNotNumeric', 'noFeatures' or 'tooFewRows'
 * (fewer than 10 remaining rows).
 */
export function prepareDataset(t: Table, target: string, features: string[]): Dataset {
  const info = inferColumns(t)
  const ty = columnIndex(t, target)
  if (info[ty].type !== 'numeric') throw new GpError('InvalidInput', { reason: 'targetNotNumeric', column: target })

  const used: number[] = []
  const excluded: Dataset['excluded'] = []
  for (const name of features) {
    const j = columnIndex(t, name)
    if (j === ty || used.includes(j)) continue
    if (info[j].type === 'text') excluded.push({ name, reason: 'text' })
    else if (info[j].constant) excluded.push({ name, reason: 'constant' })
    else used.push(j)
  }
  if (used.length === 0) throw new GpError('InvalidInput', { reason: 'noFeatures' })

  const keep = t.rows.filter((row) => row[ty] !== null && used.every((j) => row[j] !== null))
  if (keep.length < MIN_ROWS) {
    throw new GpError('InvalidInput', { reason: 'tooFewRows', rows: keep.length, min: MIN_ROWS })
  }
  const d = used.length
  const X = zeros(keep.length, d)
  const y = new Float64Array(keep.length)
  keep.forEach((row, i) => {
    used.forEach((j, k) => (X.data[i * d + k] = row[j] as number))
    y[i] = row[ty] as number
  })
  return { X, y, featureNames: used.map((j) => t.columns[j]), droppedRows: t.rows.length - keep.length, excluded }
}

/** log(y) is possible iff every y is finite and > 0 (and there is at least one value). */
export function canLogTarget(y: ArrayLike<number>): boolean {
  if (y.length === 0) return false
  for (let i = 0; i < y.length; i++) if (!(y[i] > 0) || !Number.isFinite(y[i])) return false
  return true
}

/**
 * Seeded random split (Fisher–Yates with createRng): ceil(testFraction·n) test rows, at least one row on each
 * side. Throws GpError('InvalidInput') for testFraction ∉ (0, 1) or n < 2.
 */
export function splitIndices(n: number, testFraction: number, seed: number): { train: number[]; test: number[] } {
  if (!(Number.isInteger(n) && n >= 2)) throw new GpError('InvalidInput', { reason: 'splitSize', n })
  if (!(testFraction > 0 && testFraction < 1)) throw new GpError('InvalidInput', { reason: 'testFraction', value: testFraction })
  const perm = Array.from({ length: n }, (_, i) => i)
  const rng = createRng(seed)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng.uniform() * (i + 1))
    ;[perm[i], perm[j]] = [perm[j], perm[i]]
  }
  const nTest = Math.min(n - 1, Math.max(1, Math.ceil(testFraction * n)))
  return { train: perm.slice(nTest), test: perm.slice(0, nTest) }
}

// ---------------------------------------------------------------- scaling

/**
 * StandardScaler: column means and population std (ddof 0, like sklearn). A constant column gets scale 1, also
 * when rounding leaves a tiny sd (e.g. 3×0.1 → 1.4e-17): like sklearn's `_handle_zeros_in_scale`, scale 1 is used
 * when all values equal the first or sd ≤ 10·ε·max(1, |mean|).
 */
export function fitScaler(X: Mat): Scaler {
  const { rows: n, cols: d } = X
  if (n === 0) throw new GpError('InvalidInput', { reason: 'noTrainingData' })
  const mean = new Float64Array(d)
  const scale = new Float64Array(d)
  for (let j = 0; j < d; j++) {
    let s = 0
    for (let i = 0; i < n; i++) s += X.data[i * d + j]
    const m = s / n
    let v = 0
    let constant = true
    const first = X.data[j]
    for (let i = 0; i < n; i++) {
      const x = X.data[i * d + j]
      v += (x - m) ** 2
      if (x !== first) constant = false
    }
    mean[j] = constant ? first : m
    const sd = Math.sqrt(v / n)
    const tiny = sd <= 10 * Number.EPSILON * Math.max(1, Math.abs(m))
    scale[j] = constant || tiny || !Number.isFinite(sd) ? 1 : sd
  }
  return { mean, scale }
}

/** (X − mean) / scale per column. */
export function applyScaler(X: Mat, s: Scaler): Mat {
  const d = X.cols
  if (s.mean.length !== d) throw new GpError('InvalidInput', { reason: 'scalerDim', x: d, scaler: s.mean.length })
  const out = zeros(X.rows, d)
  for (let i = 0; i < X.rows; i++)
    for (let j = 0; j < d; j++) out.data[i * d + j] = (X.data[i * d + j] - s.mean[j]) / s.scale[j]
  return out
}

function selectRows(X: Mat, idx: readonly number[]): Mat {
  const d = X.cols
  const out = zeros(idx.length, d)
  idx.forEach((r, i) => out.data.set(X.data.subarray(r * d, (r + 1) * d), i * d))
  return out
}

function checkSplit(split: Split, n: number): void {
  const ok = (a: readonly number[]) => a.every((i) => Number.isInteger(i) && i >= 0 && i < n)
  if (split.train.length === 0 || split.test.length === 0 || !ok(split.train) || !ok(split.test)) {
    throw new GpError('InvalidInput', { reason: 'split', n, train: split.train.length, test: split.test.length })
  }
}

/** Model-space data of a run: scaled X_train / X_test and standardised (log) y_train. */
export interface PreparedRun {
  Xtrain: Mat
  Xtest: Mat
  /** Standardised (log) y of the training rows: the GP target. */
  ytrain: Float64Array
  /** Raw training inputs (original units, for slices). */
  XtrainRaw: Mat
  xScaler: Scaler
  /** Mean and population std of the (log) training y. */
  yMean: number
  yScale: number
  yTrainOrig: Float64Array
  yTestOrig: Float64Array
  logTarget: boolean
}

/**
 * Split, StandardScaler on the training rows only, optional log y and standardisation of y.
 * Throws GpError('InvalidInput') with reason 'split' for invalid indices and 'logTargetNotPositive' when log y
 * is requested but some y ≤ 0 (Review Focus 3: never NaN).
 */
export function prepareRun(cfg: RunConfig): PreparedRun {
  const { dataset: ds, split, logTarget } = cfg
  checkSplit(split, ds.X.rows)
  if (logTarget && !canLogTarget(ds.y)) throw new GpError('InvalidInput', { reason: 'logTargetNotPositive' })
  const XtrainRaw = selectRows(ds.X, split.train)
  const xScaler = fitScaler(XtrainRaw)
  const yTrainOrig = Float64Array.from(split.train, (i) => ds.y[i])
  const yTestOrig = Float64Array.from(split.test, (i) => ds.y[i])
  const t = logTarget ? yTrainOrig.map(Math.log) : yTrainOrig
  const { mean, scale } = fitScaler({ rows: t.length, cols: 1, data: t })
  const yMean = mean[0]
  const yScale = scale[0]
  return {
    Xtrain: applyScaler(XtrainRaw, xScaler),
    Xtest: applyScaler(selectRows(ds.X, split.test), xScaler),
    ytrain: t.map((v) => (v - yMean) / yScale),
    XtrainRaw,
    xScaler,
    yMean,
    yScale,
    yTrainOrig,
    yTestOrig,
    logTarget,
  }
}

/** Model space → original units: un-standardise, then exp with log y. */
function toOriginal(p: PreparedRun, v: number): number {
  const u = v * p.yScale + p.yMean
  return p.logTarget ? Math.exp(u) : u
}

/** Original units → model space (y > 0 is guaranteed by prepareRun for log y). */
function toModel(p: PreparedRun, y: number): number {
  return ((p.logTarget ? Math.log(y) : y) - p.yMean) / p.yScale
}

// ---------------------------------------------------------------- model

/**
 * GpModel (zero mean on standardised y) of a template or a Kernel-Baukasten spec for d features, with the
 * notices of the Baukasten adaptation (empty for templates). Template starting values are sklearn's defaults
 * with sigma_n = 1. A Baukasten spec is applied isotropically (`fromBaukasten`); its single-factor white terms
 * become sigma_n (clamped to the sigma_n bounds). The UI calls this once per run and shows the notices.
 * Throws GpError('InvalidInput') ('invalidSpec', 'whiteInProduct', 'onlyWhite', 'tooManyFeaturesForArd',
 * 'gibbsRequires1D', 'inputDim', 'unknownTemplate').
 */
export function buildModelWithNotices(
  template: TemplateId | KernelSpec,
  d: number,
): { model: GpModel; notices: BaukastenNotice[] } {
  if (!(Number.isInteger(d) && d >= 1)) throw new GpError('InvalidInput', { reason: 'inputDim', value: d })
  if (typeof template === 'string') {
    if (!TEMPLATE_IDS.includes(template)) throw new GpError('InvalidInput', { reason: 'unknownTemplate', template })
    return { model: { kernel: templateKernel(template, d), sigmaN: DEFAULT_SIGMA_N, mean: { kind: 'zero' } }, notices: [] }
  }
  const { spec, sigmaN, notices } = fromBaukasten(template)
  if (d > 1 && spec.terms.some((t) => t.some((f) => f.kind === 'gibbs'))) {
    throw new GpError('InvalidInput', { reason: 'gibbsRequires1D', inputDim: d })
  }
  const model: GpModel = { kernel: spec, sigmaN: sigmaN === null ? DEFAULT_SIGMA_N : clampSigmaN(sigmaN), mean: { kind: 'zero' } }
  return { model, notices }
}

/** `buildModelWithNotices` without the notices. */
export function buildModel(template: TemplateId | KernelSpec, d: number): GpModel {
  return buildModelWithNotices(template, d).model
}

function templateLabel(template: TemplateId | KernelSpec): string {
  return typeof template === 'string' ? template : 'baukasten'
}

let nextRunId = 1

/** Cached factorisation of an evaluated run, so that slices need no new O(n³) fit. */
const fitCache = new WeakMap<RunResult, { cfg: RunConfig; prep: PreparedRun; fit: Fit }>()

function relevanceOf(model: GpModel, featureNames: string[]): RunResult['relevance'] {
  const f = model.kernel.terms.flat().find((k) => k.ard)
  if (!f) return undefined
  return featureNames.map((feature, j) => ({ feature, ell: f.params[`ell_${j}`] }))
}

/**
 * Evaluates a fitted model on the run's split (no optimisation): predictions with ±2·sdY bands, R² and RMSE
 * for train and test, coverage of ±2·sdY, calibration, ARD relevance and warnings ('lengthscaleAtBound' if an
 * ℓ is among `atBound`, 'negativePredictions' if some test prediction < 0 while every training y > 0, 'largeN'
 * above 2000 training rows). Throws GpError('InvalidInput' | 'NotPositiveDefinite') from the GP core.
 */
export function evaluateRun(cfg: RunConfig, fitted: GpModel, logML: number, atBound: string[]): RunResult {
  const p = prepareRun(cfg)
  const fit = fitModel(fitted, p.Xtrain, p.ytrain)
  const post = posterior(fitted, p.Xtrain, p.ytrain, p.Xtest, { fit })
  const trainMean = posteriorMean(fitted, fit, p.Xtrain, p.Xtrain)

  const nTest = p.Xtest.rows
  const yTrue = Array.from(p.yTestOrig)
  const yPred: number[] = []
  const lowerY: number[] = []
  const upperY: number[] = []
  const yTrueModel: number[] = []
  for (let i = 0; i < nTest; i++) {
    const m = post.mean[i]
    const s = post.sdY[i]
    yPred.push(toOriginal(p, m))
    lowerY.push(toOriginal(p, m - BAND_Z * s))
    upperY.push(toOriginal(p, m + BAND_Z * s))
    yTrueModel.push(toModel(p, yTrue[i]))
  }
  const yPredTrain = Array.from(trainMean, (m) => toOriginal(p, m))

  const warnings: RunWarning[] = []
  if (atBound.some((name) => /(^|\.)ell(_\d+)?$/.test(name))) warnings.push('lengthscaleAtBound')
  if (yPred.some((v) => v < 0) && p.yTrainOrig.every((v) => v > 0)) warnings.push('negativePredictions')
  if (p.Xtrain.rows > LARGE_N) warnings.push('largeN')

  const result: RunResult = {
    id: nextRunId++,
    label: templateLabel(cfg.template),
    model: fitted,
    logML,
    metrics: {
      r2Train: r2(p.yTrainOrig, yPredTrain),
      r2Test: r2(yTrue, yPred),
      rmseTrain: rmse(p.yTrainOrig, yPredTrain),
      rmseTest: rmse(yTrue, yPred),
      coverage2sd: coverage(yTrue, lowerY, upperY),
      coveredCount: yTrue.reduce((k, v, i) => (v >= lowerY[i] && v <= upperY[i] ? k + 1 : k), 0),
      calibration: calibration(yTrueModel, post.mean, post.sdY),
    },
    test: { yTrue, yPred, lowerY, upperY, sdF: Array.from(post.sdF), sdY: Array.from(post.sdY) },
    warnings,
  }
  const relevance = relevanceOf(fitted, cfg.dataset.featureNames)
  if (relevance) result.relevance = relevance
  fitCache.set(result, { cfg, prep: p, fit })
  return result
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const h = s.length >> 1
  return s.length % 2 ? s[h] : 0.5 * (s[h - 1] + s[h])
}

/**
 * 1D slice (Spec §6, step 5): feature `feature` varies over its training range on n points, the other features
 * sit at their training median. Returns x and mean in original units with the ±2·sdF and ±2·sdY bands
 * (transformed boundwise, so asymmetric with log y).
 */
export function sliceAt(
  run: RunResult,
  cfg: RunConfig,
  feature: number,
  n = 100,
): { x: number[]; mean: number[]; lowerF: number[]; upperF: number[]; lowerY: number[]; upperY: number[] } {
  const d = cfg.dataset.X.cols
  if (!(Number.isInteger(feature) && feature >= 0 && feature < d)) {
    throw new GpError('InvalidInput', { reason: 'sliceFeature', feature, inputDim: d })
  }
  if (!(Number.isInteger(n) && n >= 2)) throw new GpError('InvalidInput', { reason: 'slicePoints', n })
  const cached = fitCache.get(run)
  const p = cached && cached.cfg === cfg ? cached.prep : prepareRun(cfg)
  const fit = cached && cached.cfg === cfg ? cached.fit : fitModel(run.model, p.Xtrain, p.ytrain)

  const raw = p.XtrainRaw
  const col = (j: number) => Array.from({ length: raw.rows }, (_, i) => raw.data[i * d + j])
  const centre = Array.from({ length: d }, (_, j) => median(col(j)))
  const xs = col(feature)
  let lo = Infinity
  let hi = -Infinity
  for (const v of xs) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (lo === hi) {
    lo -= 0.5
    hi += 0.5
  }
  const x = Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1))
  const grid = zeros(n, d)
  for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) grid.data[i * d + j] = j === feature ? x[i] : centre[j]

  const post = posterior(run.model, p.Xtrain, p.ytrain, applyScaler(grid, p.xScaler), { fit })
  const map = (sign: number, sd: Float64Array) => Array.from(post.mean, (m, i) => toOriginal(p, m + sign * BAND_Z * sd[i]))
  return {
    x,
    mean: Array.from(post.mean, (m) => toOriginal(p, m)),
    lowerF: map(-1, post.sdF),
    upperF: map(1, post.sdF),
    lowerY: map(-1, post.sdY),
    upperY: map(1, post.sdY),
  }
}
