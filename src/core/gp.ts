/**
 * GP regression core (Spec §3.3, Lehrbuch Kap. 10.5, Notebook Code 39 `compute_gpr_parameters`).
 *
 * Notation: K = k(X,X) (n×n, built with sameSet: true), K_star = k(X*,X) (n*×n), K_star2 = k(X*,X*),
 * C_X = K + sigma_n² I. sigma_n is the observation-noise standard deviation.
 * One Cholesky factorisation plus triangular solves; no explicit inverse except C⁻¹ for the log-ML gradient.
 *
 * White-noise kernel terms: they act as extra training noise. They enter K(X,X) (sameSet: true) only.
 * K_star and K_star2 are built with sameSet: false, so `sdF` is the sd of the latent function f and excludes
 * white terms; `sdY = sqrt(sdF² + sigma_n²)` adds the observation noise sigma_n only.
 */
import { GpError } from './errors'
import { freeParams, kernelDiag, kernelGradients, kernelMatrix, withLogParams, type KernelSpec, type ParamInfo } from './kernels'
import {
  cholesky,
  colVec,
  inverseFromCholesky,
  matMul,
  solveLower,
  solveUpperT,
  transpose,
  zeros,
  type Mat,
} from './linalg'
import { basisMatrix, fitGls, meanValues, type MeanSpec } from './mean'

export interface GpModel {
  kernel: KernelSpec
  /** Observation-noise standard deviation (≥ 0). */
  sigmaN: number
  mean: MeanSpec
}

export interface Posterior {
  /** Posterior (or prior) mean of f at the test points. */
  mean: Float64Array
  /** Latent-function sd sqrt(max(diag Cov(f*), 0)). With a GLS mean this is the plug-in sd (η uncertainty excluded). */
  sdF: Float64Array
  /** Observation sd sqrt(sdF² + sigma_n²). */
  sdY: Float64Array
  /** Full Cov(f*) (n*×n*, symmetrised), only with opts.fullCov. */
  cov?: Mat
  /** Jitter added to C_X by the Cholesky fallback (0 if none). */
  jitter: number
  /** GLS coefficients (only for mean.kind === 'gls' with training data). */
  eta?: Float64Array
}

/** Natural-unit bounds of sigma_n (sklearn noise_level ∈ [1e-5, 1e5] is a variance). */
const SIGMA_N_BOUNDS: readonly [number, number] = [Math.sqrt(1e-5), Math.sqrt(1e5)]

/** sqrt(sdF² + sigma_n²): sd of a new observation y* = f* + ε. */
export function observationSd(sdF: number, sigmaN: number): number {
  return Math.sqrt(sdF * sdF + sigmaN * sigmaN)
}

function assertFinite(v: ArrayLike<number>, what: string): void {
  for (let i = 0; i < v.length; i++) {
    if (!Number.isFinite(v[i])) throw new GpError('InvalidInput', { reason: `${what}NonFinite`, index: i })
  }
}

function validate(model: GpModel, X: Mat, y: Float64Array, Xs?: Mat): void {
  if (!(model.sigmaN >= 0) || !Number.isFinite(model.sigmaN)) {
    throw new GpError('InvalidInput', { reason: 'sigmaN', value: model.sigmaN })
  }
  if (X.rows !== y.length) throw new GpError('InvalidInput', { reason: 'yLength', rows: X.rows, y: y.length })
  if (Xs && Xs.cols !== X.cols) throw new GpError('InvalidInput', { reason: 'inputDimMismatch', x: X.cols, xs: Xs.cols })
  assertFinite(X.data, 'x')
  assertFinite(y, 'y')
  if (Xs) assertFinite(Xs.data, 'xStar')
}

/** Factorisation of C_X for one (model, X, y); reusable for posterior, mean-only updates and the log-ML value. */
export interface Fit {
  L: Mat
  /** Jitter added to C_X by the Cholesky fallback (0 if none). */
  jitter: number
  /** α = C_X⁻¹ (y − m_X) */
  alpha: Float64Array
  /** z = L⁻¹ (y − m_X) */
  z: Float64Array
  eta?: Float64Array
}

/**
 * Steps 1–2: L = chol(C_X), L z = y − m_X, Lᵀ α = z. With GLS, m_X = H η̂ (plug-in, `fitGls`).
 * Validates the inputs and needs at least one training row. Throws GpError('InvalidInput') (incl. reason
 * 'glsRankDeficient' for an underdetermined GLS mean) or GpError('NotPositiveDefinite').
 */
export function fitModel(model: GpModel, X: Mat, y: Float64Array): Fit {
  validate(model, X, y)
  if (X.rows === 0) throw new GpError('InvalidInput', { reason: 'noTrainingData' })
  return fit(model, X, y)
}

function fit(model: GpModel, X: Mat, y: Float64Array): Fit {
  const n = X.rows
  const C = kernelMatrix(model.kernel, X, X, { sameSet: true })
  let diagSum = 0
  for (let i = 0; i < n; i++) diagSum += C.data[i * n + i]
  const s2 = model.sigmaN * model.sigmaN
  for (let i = 0; i < n; i++) C.data[i * n + i] += s2
  // Jitter scale: mean diagonal of the prior kernel matrix K (cholesky falls back to 1 if it is not > 0).
  const { L, jitter } = cholesky(C, { jitterScale: diagSum / n })

  let mX: Float64Array
  let eta: Float64Array | undefined
  if (model.mean.kind === 'gls') {
    eta = fitGls(L, basisMatrix(model.mean.basis, X), y).eta
    mX = meanValues(model.mean, X, eta)
  } else {
    mX = meanValues(model.mean, X)
  }
  const r = new Float64Array(n)
  for (let i = 0; i < n; i++) r[i] = y[i] - mX[i]
  const zM = solveLower(L, colVec(r))
  const alpha = solveUpperT(L, zM).data
  return { L, jitter, alpha, z: zM.data, eta }
}

function bands(varF: ArrayLike<number>, sigmaN: number): { sdF: Float64Array; sdY: Float64Array } {
  const sdF = new Float64Array(varF.length)
  const sdY = new Float64Array(varF.length)
  for (let i = 0; i < varF.length; i++) {
    sdF[i] = Math.sqrt(Math.max(varF[i], 0))
    sdY[i] = observationSd(sdF[i], sigmaN)
  }
  return { sdF, sdY }
}

function symmetrise(A: Mat): void {
  const n = A.rows
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const v = 0.5 * (A.data[i * n + j] + A.data[j * n + i])
      A.data[i * n + j] = v
      A.data[j * n + i] = v
    }
}

/**
 * Prior moments at Xs: mean m(X*), Cov = K_star2 (sameSet: false, white terms excluded).
 * A GLS mean has no estimate without data, so its prior mean is taken as 0 (eta stays undefined).
 */
export function priorMoments(model: GpModel, Xs: Mat, opts?: { fullCov?: boolean }): Posterior {
  validate(model, zeros(0, Xs.cols), new Float64Array(0), Xs)
  const mean = model.mean.kind === 'gls' ? new Float64Array(Xs.rows) : meanValues(model.mean, Xs)
  const out: Posterior = { mean, ...bands(kernelDiag(model.kernel, Xs, { sameSet: false }), model.sigmaN), jitter: 0 }
  if (opts?.fullCov) {
    const cov = kernelMatrix(model.kernel, Xs, Xs, { sameSet: false })
    symmetrise(cov)
    out.cov = cov
  }
  return out
}

/** Step 4: f̄* = m* + K_star α. */
function meanFromKstar(model: GpModel, f: Fit, Kstar: Mat, Xs: Mat): Float64Array {
  const n = Kstar.cols
  const mean = model.mean.kind === 'gls' ? meanValues(model.mean, Xs, f.eta) : meanValues(model.mean, Xs)
  for (let i = 0; i < Xs.rows; i++) {
    let s = 0
    for (let k = 0; k < n; k++) s += Kstar.data[i * n + k] * f.alpha[k]
    mean[i] += s
  }
  return mean
}

/**
 * Posterior mean only (Code 39 steps 1, 2 and 4, without V = L⁻¹K_starᵀ) from a `fitModel` result of the same
 * model and training inputs X.
 */
export function posteriorMean(model: GpModel, f: Fit, X: Mat, Xs: Mat): Float64Array {
  if (Xs.cols !== X.cols) throw new GpError('InvalidInput', { reason: 'inputDimMismatch', x: X.cols, xs: Xs.cols })
  if (f.alpha.length !== X.rows) throw new GpError('InvalidInput', { reason: 'fitMismatch', rows: X.rows, fit: f.alpha.length })
  assertFinite(Xs.data, 'xStar')
  return meanFromKstar(model, f, kernelMatrix(model.kernel, Xs, X, { sameSet: false }), Xs)
}

/** Value of the log ML −½ zᵀz − Σ log L_ii − (n/2) log 2π from a fit (no O(n³) gradient). */
export function logMarginalLikelihoodFromFit(f: Fit): number {
  const n = f.z.length
  let value = -0.5 * n * Math.log(2 * Math.PI)
  for (let i = 0; i < n; i++) value -= 0.5 * f.z[i] * f.z[i] + Math.log(f.L.data[i * n + i])
  return value
}

/**
 * Posterior of f at Xs (Code 39, steps 1–5): f̄* = m* + K_star α, Cov(f*) = K_star2 − VᵀV with L V = K_starᵀ.
 * With 0 training rows it returns priorMoments. `opts.fit` (a `fitModel` result for the same model, X and y)
 * skips steps 1–2. With a GLS mean, m = Hη̂ (plug-in) and `eta` is set.
 * Throws GpError('InvalidInput') for mismatched shapes / non-finite inputs, GpError('NotPositiveDefinite')
 * if C_X cannot be factorised even with jitter.
 */
export function posterior(
  model: GpModel,
  X: Mat,
  y: Float64Array,
  Xs: Mat,
  opts?: { fullCov?: boolean; fit?: Fit },
): Posterior {
  validate(model, X, y, Xs)
  if (X.rows === 0) return priorMoments(model, Xs, opts)
  const n = X.rows
  const ns = Xs.rows
  const f = opts?.fit ?? fit(model, X, y)
  if (f.alpha.length !== n) throw new GpError('InvalidInput', { reason: 'fitMismatch', rows: n, fit: f.alpha.length })
  const { L, jitter, eta } = f

  const Kstar = kernelMatrix(model.kernel, Xs, X, { sameSet: false }) // n* × n
  const mean = meanFromKstar(model, f, Kstar, Xs)
  const V = solveLower(L, transpose(Kstar)) // n × n*

  let cov: Mat | undefined
  const varF = new Float64Array(ns)
  if (opts?.fullCov) {
    cov = kernelMatrix(model.kernel, Xs, Xs, { sameSet: false })
    const VtV = matMul(transpose(V), V)
    for (let k = 0; k < cov.data.length; k++) cov.data[k] -= VtV.data[k]
    symmetrise(cov)
    for (let i = 0; i < ns; i++) varF[i] = cov.data[i * ns + i]
  } else {
    const kss = kernelDiag(model.kernel, Xs, { sameSet: false })
    for (let j = 0; j < ns; j++) {
      let s = 0
      for (let k = 0; k < n; k++) s += V.data[k * ns + j] * V.data[k * ns + j]
      varF[j] = kss[j] - s
    }
  }
  const out: Posterior = { mean, ...bands(varF, model.sigmaN), jitter }
  if (cov) out.cov = cov
  if (eta) out.eta = eta
  return out
}

/**
 * log p(y | X, θ) = −½ zᵀz − Σ log L_ii − (n/2) log 2π, and its gradient w.r.t. the log-parameters of
 * modelParams (kernel free params, then log sigma_n): ∂/∂θ_i = ½ tr((ααᵀ − C⁻¹) ∂C/∂θ_i), ∂C/∂log σ_n = 2σ_n² I.
 * With a GLS mean this is the profile likelihood at η̂(θ) (gp-mean-fit, sign of `negative_profile_likelihood`
 * flipped); since ∂ℓ/∂η = 0 at η̂, the gradient at fixed η̂ is exact (envelope theorem).
 * Requires at least one training row.
 */
export function logMarginalLikelihood(
  model: GpModel,
  X: Mat,
  y: Float64Array,
): { value: number; grad: Float64Array; jitter: number } {
  validate(model, X, y)
  const n = X.rows
  if (n === 0) throw new GpError('InvalidInput', { reason: 'noTrainingData' })
  const f = fit(model, X, y)
  const { L, jitter, alpha } = f
  const value = logMarginalLikelihoodFromFit(f)

  const Cinv = inverseFromCholesky(L)
  const dK = kernelGradients(model.kernel, X)
  const grad = new Float64Array(dK.length + 1)
  dK.forEach((G, p) => {
    let s = 0
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) s += (alpha[i] * alpha[j] - Cinv.data[i * n + j]) * G.data[i * n + j]
    grad[p] = 0.5 * s
  })
  let aa = 0
  let tr = 0
  for (let i = 0; i < n; i++) {
    aa += alpha[i] * alpha[i]
    tr += Cinv.data[i * n + i]
  }
  grad[dK.length] = model.sigmaN * model.sigmaN * (aa - tr)
  return { value, grad, jitter }
}

/** Kernel free parameters followed by "sigmaN" (log sigma_n, bounds log √1e-5 … log √1e5). */
export function modelParams(model: GpModel, inputDim: number): ParamInfo {
  const k = freeParams(model.kernel, inputDim)
  const m = k.names.length
  const logValues = new Float64Array(m + 1)
  const logLower = new Float64Array(m + 1)
  const logUpper = new Float64Array(m + 1)
  logValues.set(k.logValues)
  logLower.set(k.logLower)
  logUpper.set(k.logUpper)
  logValues[m] = Math.log(model.sigmaN)
  logLower[m] = Math.log(SIGMA_N_BOUNDS[0])
  logUpper[m] = Math.log(SIGMA_N_BOUNDS[1])
  return { names: [...k.names, 'sigmaN'], logValues, logLower, logUpper }
}

/** Copy of `model` with parameters set from logValues (order of modelParams). */
export function withModelLogParams(model: GpModel, inputDim: number, logValues: Float64Array): GpModel {
  const m = freeParams(model.kernel, inputDim).names.length
  if (logValues.length !== m + 1) {
    throw new GpError('InvalidInput', { reason: 'logValuesLength', expected: m + 1, got: logValues.length })
  }
  const sigmaN = Math.exp(logValues[m])
  if (!(sigmaN > 0) || !Number.isFinite(sigmaN)) throw new GpError('InvalidInput', { reason: 'logValue', index: m })
  return {
    kernel: withLogParams(model.kernel, inputDim, logValues.subarray(0, m)),
    sigmaN,
    mean: model.mean.kind === 'linear' ? { ...model.mean, b: [...model.mean.b] } : { ...model.mean },
  }
}

/**
 * Samples m + L u_k with L = chol(cov) (jitter fallback scaled by `jitterScale`, the mean prior diagonal).
 * u is k×n standard normals; row k of the result is sample k. Throws GpError('NotPositiveDefinite') if the
 * covariance cannot be factorised even with jitter.
 */
export function drawSamples(mean: Float64Array, cov: Mat, u: Mat, jitterScale: number): Mat {
  const n = mean.length
  if (cov.rows !== n || cov.cols !== n || u.cols !== n) {
    throw new GpError('InvalidInput', { reason: 'sampleShapeMismatch', n, cov: [cov.rows, cov.cols], u: [u.rows, u.cols] })
  }
  assertFinite(mean, 'mean')
  const { L } = cholesky(cov, { jitterScale })
  const out = zeros(u.rows, n)
  for (let s = 0; s < u.rows; s++) {
    for (let i = 0; i < n; i++) {
      let v = mean[i]
      for (let j = 0; j <= i; j++) v += L.data[i * n + j] * u.data[s * n + j]
      out.data[s * n + i] = v
    }
  }
  return out
}

/** k×n matrix of standard normals from a seeded rng (row-major draw order). */
export function standardNormals(rng: { normal(): number }, k: number, n: number): Mat {
  const out = zeros(k, n)
  for (let i = 0; i < out.data.length; i++) out.data[i] = rng.normal()
  return out
}
