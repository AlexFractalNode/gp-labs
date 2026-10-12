/**
 * Playground view logic without Vue: kernel from the URL, grid predictions (bands, mean line, samples),
 * a cheap mean-only update for slow drags, and a stable y-axis range.
 */
import { scaleLinear } from 'd3-scale'
import { GpError } from '../../core/errors'
import {
  drawSamples,
  fitModel,
  logMarginalLikelihoodFromFit,
  posterior,
  posteriorMean,
  priorMoments,
  standardNormals,
  type Fit,
  type GpModel,
  type Posterior,
} from '../../core/gp'
import { freeParams, kernelDiag, kernelMatrix, type BaseKernel, type KernelSpec } from '../../core/kernels'
import { fromRows, zeros, type Mat } from '../../core/linalg'
import { meanValues } from '../../core/mean'
import { createRng } from '../../core/rng'
import { decodeKernel } from '../../urlState'
import type { MessageKey } from '../../i18n'

export type Point = { x: number; y: number }

/** Grid size of the plotted curves and bands (Task 9 brief). */
export const GRID_N = 200
/** Grid size of the covariance heatmap. */
export const COV_GRID_N = 100
export const SAMPLE_COUNT = 5
export const MAX_POINTS = 1000
/** Natural-unit bounds of sigma_n (sklearn noise_level ∈ [1e-5, 1e5] is a variance). */
export const SIGMA_N_BOUNDS: readonly [number, number] = [Math.sqrt(1e-5), Math.sqrt(1e5)]

export function linspace(a: number, b: number, n: number): Float64Array {
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = n === 1 ? a : a + ((b - a) * i) / (n - 1)
  return out
}

const isWhite = (f: BaseKernel) => f.kind === 'white'

/**
 * Kernel for the Playground from the `?kernel=` value. `base` is the preset model (RBF), used whenever the URL
 * kernel is missing or rejected. Single-factor white terms move into sigma_n (in quadrature); a white factor
 * inside a product and multi-dimensional kernels (ARD, activeDims) are rejected. An undecodable value returns
 * the base model without a notice of its own (the app shell reports `notice.invalidUrl`).
 */
export function resolveKernel(
  param: string | null,
  base: GpModel,
): { model: GpModel; fromUrl: boolean; notices: MessageKey[] } {
  const fallback = (notices: MessageKey[]) => ({ model: base, fromUrl: false, notices })
  if (param === null) return fallback([])
  const spec = decodeKernel(param)
  if (!spec) return fallback([])
  const factors = spec.terms.flat()
  if (factors.some((f) => f.ard || f.activeDims !== undefined)) return fallback(['notice.kernel2d'])
  if (spec.terms.some((term) => term.length > 1 && term.some(isWhite))) return fallback(['notice.whiteInProduct'])

  let whiteVar = 0
  const terms = spec.terms.filter((term) => {
    if (term.length === 1 && isWhite(term[0])) {
      whiteVar += term[0].params.sigma ** 2
      return false
    }
    return true
  })
  const notices: MessageKey[] = whiteVar > 0 ? ['notice.whiteMerged'] : []
  const sigmaN = Math.min(Math.max(Math.sqrt(base.sigmaN ** 2 + whiteVar), SIGMA_N_BOUNDS[0]), SIGMA_N_BOUNDS[1])
  if (terms.length === 0) return { model: { ...base, sigmaN }, fromUrl: false, notices }

  const kernel: KernelSpec = { terms }
  try {
    // Must work on 1D input (warps that need more dimensions, etc.).
    freeParams(kernel, 1)
    kernelMatrix(kernel, fromRows([[0], [1]]), fromRows([[0], [1]]), { sameSet: true })
  } catch (e) {
    if (!(e instanceof GpError)) throw e
    return fallback(['notice.kernel2d'])
  }
  return { model: { ...base, kernel, sigmaN }, fromUrl: true, notices }
}

export interface GridResult {
  xs: Float64Array
  mean: Float64Array
  sdF: Float64Array
  sdY: Float64Array
  /** Specified mean m(x); with GLS the fitted Hη̂ (0 while underdetermined). */
  meanLine: Float64Array
  /** SAMPLE_COUNT rows, empty if not requested or not drawable. */
  samples: Float64Array[]
  samplesFailed: boolean
  jitter: number
  eta?: Float64Array
  /** GLS mean without enough distinct points: prior moments are shown. */
  glsFallback: boolean
  /** True when there are no points (prior) or GLS fell back to the prior. */
  prior: boolean
  /** Posterior covariance on COV_GRID_N points, only with opts.cov. */
  cov?: Mat
}

function trainingData(points: Point[]): { X: Mat; y: Float64Array } {
  return {
    X: points.length ? fromRows(points.map((p) => [p.x])) : zeros(0, 1),
    y: Float64Array.from(points.map((p) => p.y)),
  }
}

const isGlsRankDeficient = (e: unknown) =>
  e instanceof GpError && e.code === 'InvalidInput' && e.details?.reason === 'glsRankDeficient'

/** Training data with its core fit, shared by grid, mean-only path, log-ML and inspector. */
export interface TrainingFit {
  X: Mat
  y: Float64Array
  /** Core `fitModel` result; null without points or with an underdetermined GLS mean. */
  fit: Fit | null
  /** GLS mean without enough distinct points: the prior is shown. */
  glsUnderdetermined: boolean
}

/** Factorises C_X once (core `fitModel`). Other GpErrors (e.g. NotPositiveDefinite) propagate. */
export function fitTraining(model: GpModel, points: Point[]): TrainingFit {
  const { X, y } = trainingData(points)
  if (points.length === 0) return { X, y, fit: null, glsUnderdetermined: false }
  try {
    return { X, y, fit: fitModel(model, X, y), glsUnderdetermined: false }
  } catch (e) {
    if (model.mean.kind === 'gls' && isGlsRankDeficient(e)) return { X, y, fit: null, glsUnderdetermined: true }
    throw e
  }
}

/** Posterior at Xs from a training fit, or prior moments without points / with an underdetermined GLS mean. */
function posteriorOrPrior(model: GpModel, tf: TrainingFit, Xs: Mat, fullCov: boolean): Posterior {
  if (!tf.fit) return priorMoments(model, Xs, { fullCov })
  return posterior(model, tf.X, tf.y, Xs, { fullCov, fit: tf.fit })
}

function meanLine(model: GpModel, Xs: Mat, eta: Float64Array | undefined): Float64Array {
  if (model.mean.kind !== 'gls') return meanValues(model.mean, Xs)
  return eta ? meanValues(model.mean, Xs, eta) : new Float64Array(Xs.rows)
}

/**
 * Full grid prediction. Samples use the fixed standard normals of `seed`, so they morph smoothly while sliders
 * move. `opts.training` (from `fitTraining` for the same model and points) avoids refactorising C_X.
 * Throws GpError (NotPositiveDefinite / InvalidInput) when the posterior itself cannot be computed.
 */
export function computeGrid(
  model: GpModel,
  points: Point[],
  view: [number, number],
  opts: { samples: 'prior' | 'posterior' | null; seed: number; cov?: boolean; training?: TrainingFit },
): GridResult {
  const tf = opts.training ?? fitTraining(model, points)
  const xs = linspace(view[0], view[1], GRID_N)
  const Xs = fromRows(Array.from(xs, (x) => [x]))
  const prior = tf.fit === null
  const wantPriorSamples = opts.samples === 'prior' || prior
  const post = posteriorOrPrior(model, tf, Xs, opts.samples === 'posterior' && !wantPriorSamples)
  const res: GridResult = {
    xs,
    mean: post.mean,
    sdF: post.sdF,
    sdY: post.sdY,
    meanLine: meanLine(model, Xs, post.eta),
    samples: [],
    samplesFailed: false,
    jitter: post.jitter,
    glsFallback: tf.glsUnderdetermined,
    prior,
  }
  if (post.eta) res.eta = post.eta

  if (opts.samples) {
    try {
      const source = wantPriorSamples ? priorMoments(model, Xs, { fullCov: true }) : post
      const kss = kernelDiag(model.kernel, Xs, { sameSet: false })
      let scale = 0
      for (const v of kss) scale += v / kss.length
      const u = standardNormals(createRng(opts.seed), SAMPLE_COUNT, GRID_N)
      const S = drawSamples(source.mean, source.cov!, u, scale)
      for (let k = 0; k < SAMPLE_COUNT; k++) res.samples.push(S.data.slice(k * GRID_N, (k + 1) * GRID_N))
    } catch (e) {
      if (!(e instanceof GpError)) throw e
      res.samplesFailed = true
    }
  }

  if (opts.cov) {
    const xc = linspace(view[0], view[1], COV_GRID_N)
    res.cov = posteriorOrPrior(model, tf, fromRows(Array.from(xc, (x) => [x])), true).cov
  }
  return res
}

/**
 * Posterior mean only (core `posteriorMean`, no V = L⁻¹K_starᵀ), for drags when a full update is slow.
 * Returns null when a GLS mean is underdetermined (the caller keeps its prior picture).
 */
export function computeMeanOnly(model: GpModel, xs: Float64Array, tf: TrainingFit): Float64Array | null {
  const Xs = fromRows(Array.from(xs, (x) => [x]))
  if (tf.glsUnderdetermined) return null
  if (!tf.fit) return model.mean.kind === 'gls' ? new Float64Array(xs.length) : meanValues(model.mean, Xs)
  return posteriorMean(model, tf.fit, tf.X, Xs)
}

/** log-ML value from the shared fit (core `logMarginalLikelihoodFromFit`); null without a fit. */
export function logMarginalLikelihoodValue(tf: TrainingFit): number | null {
  return tf.fit ? logMarginalLikelihoodFromFit(tf.fit) : null
}

/**
 * y-axis range that holds the points, the true function and the prior band m(x) ± 2·s_y, padded and rounded.
 * With a GLS mean the prior band is centred on the mean of y. Fixed per preset/mean so sliders do not
 * rescale the axes.
 */
export function fitYDomain(
  model: GpModel,
  points: Point[],
  view: [number, number],
  truth?: (x: number) => number,
): [number, number] {
  const xs = linspace(view[0], view[1], 50)
  const Xs = fromRows(Array.from(xs, (x) => [x]))
  let lo = Infinity
  let hi = -Infinity
  const take = (v: number) => {
    if (!Number.isFinite(v)) return
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  for (const p of points) take(p.y)
  if (truth) for (const x of xs) take(truth(x))
  try {
    const prior = priorMoments(model, Xs)
    const centre =
      model.mean.kind === 'gls' && points.length ? points.reduce((s, p) => s + p.y, 0) / points.length : 0
    for (let i = 0; i < xs.length; i++) {
      const m = model.mean.kind === 'gls' ? centre : prior.mean[i]
      take(m - 2 * prior.sdY[i])
      take(m + 2 * prior.sdY[i])
    }
  } catch (e) {
    if (!(e instanceof GpError)) throw e
  }
  if (!Number.isFinite(lo)) return [-3, 3]
  if (hi - lo < 1e-9) {
    lo -= 1
    hi += 1
  }
  const pad = 0.06 * (hi - lo)
  return scaleLinear().domain([lo - pad, hi + pad]).nice(8).domain() as [number, number]
}

/** Conditions that raise a notice; a notice fires only when its condition turns from false to true. */
export interface NoticeFlags {
  jitter: boolean
  gls: boolean
  samples: boolean
}
export const NO_NOTICE_FLAGS: NoticeFlags = { jitter: false, gls: false, samples: false }

export function noticeTransitions(
  prev: NoticeFlags,
  r: Pick<GridResult, 'jitter' | 'glsFallback' | 'samplesFailed'>,
): { next: NoticeFlags; raised: (keyof NoticeFlags)[] } {
  const next: NoticeFlags = { jitter: r.jitter > 0, gls: r.glsFallback, samples: r.samplesFailed }
  const raised = (Object.keys(next) as (keyof NoticeFlags)[]).filter((k) => next[k] && !prev[k])
  return { next, raised }
}
