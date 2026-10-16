/**
 * Hyperparameter optimisation (Lehrbuch Kap. 10.5): maximise the log marginal likelihood over the
 * log-parameters of `modelParams` by minimising f = −log ML with a bounded (projected) L-BFGS and multistarts.
 */
import { GpError } from './errors'
import { logMarginalLikelihood, modelParams, withModelLogParams, type GpModel } from './gp'
import type { Mat } from './linalg'
import { createRng } from './rng'

export interface OptResult {
  x: Float64Array
  value: number
  iterations: number
  converged: boolean
}

/** One multistart run of optimizeHyperparameters, in likelihood orientation. */
export interface HyperparameterRun {
  /** Final log-parameters (order of modelParams). */
  x: Float64Array
  /** log ML at x (+log ML, not the minimised −log ML); −Infinity if the run never reached a finite value. */
  logML: number
  iterations: number
  converged: boolean
}

export type Objective = (x: Float64Array) => { value: number; grad: Float64Array }

/** Armijo sufficient-decrease constant. */
const C1 = 1e-4
/** Maximum number of step halvings per line search. */
const MAX_BACKTRACK = 50
/** Curvature pairs with sᵀy at or below this are skipped. */
const MIN_CURVATURE = 1e-10
/**
 * Default relative-reduction tolerance: scipy's L-BFGS-B default factr·eps = 1e7 · 2.22e-16 (what sklearn uses).
 * Without it, flat directions (an ARD ℓ or σ₀ drifting towards a bound) keep the projected gradient just above
 * `tol` while f only changes at rounding level, and every iteration burns its line search up to maxIter.
 */
const DEFAULT_FTOL = 1e7 * Number.EPSILON
/** Parameters closer than this (log units) to a bound are reported in `atBound`. */
const AT_BOUND_TOL = 1e-3
/** Random starts are drawn within ±START_SPREAD log units of the current values (clipped to the bounds). */
const START_SPREAD = 3

function clampInto(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) {
    if (Number.isFinite(lo) && Number.isFinite(hi)) return 0.5 * (lo + hi)
    return Number.isFinite(lo) ? lo : Number.isFinite(hi) ? hi : 0
  }
  return Math.min(hi, Math.max(lo, v))
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/**
 * Evaluates f; a non-finite value, a non-finite gradient or a thrown GpError (e.g. NotPositiveDefinite)
 * count as +Infinity so the line search shrinks the step. Other errors propagate.
 */
function safeEval(f: Objective, x: Float64Array): { value: number; grad: Float64Array } {
  try {
    const r = f(x)
    if (!Number.isFinite(r.value) || r.grad.length !== x.length || !r.grad.every(Number.isFinite)) {
      return { value: Infinity, grad: r.grad }
    }
    return r
  } catch (e) {
    if (e instanceof GpError) return { value: Infinity, grad: new Float64Array(x.length) }
    throw e
  }
}

/** −H·g by the L-BFGS two-loop recursion on the free variables (active components of g and d are zero). */
function twoLoopDirection(
  g: Float64Array,
  active: Uint8Array,
  S: Float64Array[],
  Y: Float64Array[],
  RHO: number[],
): Float64Array {
  const n = g.length
  const q = Float64Array.from(g, (v, i) => (active[i] ? 0 : v))
  const alphas = new Array<number>(S.length)
  for (let k = S.length - 1; k >= 0; k--) {
    alphas[k] = RHO[k] * dot(S[k], q)
    for (let i = 0; i < n; i++) q[i] -= alphas[k] * Y[k][i]
  }
  const k0 = S.length - 1
  const gamma = k0 >= 0 ? dot(S[k0], Y[k0]) / dot(Y[k0], Y[k0]) : 1
  for (let i = 0; i < n; i++) q[i] *= gamma
  for (let k = 0; k < S.length; k++) {
    const beta = RHO[k] * dot(Y[k], q)
    for (let i = 0; i < n; i++) q[i] += S[k][i] * (alphas[k] - beta)
  }
  return Float64Array.from(q, (v, i) => (active[i] ? 0 : -v))
}

/**
 * Armijo backtracking along the projected path P(x + t d). Initial step: 1 with curvature information,
 * otherwise a unit-length step in the max-norm. Returns null if no step is accepted.
 */
function lineSearch(
  f: Objective,
  x: Float64Array,
  fx: number,
  g: Float64Array,
  d: Float64Array,
  lower: Float64Array,
  upper: Float64Array,
  hasHistory: boolean,
): { x: Float64Array; value: number; grad: Float64Array } | null {
  const n = x.length
  let t = hasHistory ? 1 : Math.min(1, 1 / d.reduce((a, v) => Math.max(a, Math.abs(v)), 0))
  for (let bt = 0; bt < MAX_BACKTRACK; bt++) {
    const xn = Float64Array.from(x, (v, i) => clampInto(v + t * d[i], lower[i], upper[i]))
    let decrease = 0
    for (let i = 0; i < n; i++) decrease += g[i] * (xn[i] - x[i])
    if (decrease < 0) {
      const r = safeEval(f, xn)
      if (Number.isFinite(r.value) && r.value <= fx + C1 * decrease) return { x: xn, value: r.value, grad: r.grad }
    }
    t *= 0.5
  }
  return null
}

/**
 * Projected L-BFGS with Armijo backtracking on the box [lower, upper].
 * Iterates are clamped to the bounds; variables at a bound whose gradient points outward are held fixed
 * (their search direction is zero) and the history is reset whenever this active set changes.
 * Converged when the projected-gradient max-norm ‖P(x − g) − x‖∞ < tol, or (scipy's factr criterion) when an
 * accepted step reduces f by at most ftol relative: (f_k − f_{k+1}) / max(|f_k|, |f_{k+1}|, 1) ≤ ftol.
 */
export function lbfgsb(
  f: Objective,
  x0: Float64Array,
  lower: Float64Array,
  upper: Float64Array,
  opts?: { maxIter?: number; m?: number; tol?: number; ftol?: number },
): OptResult {
  const maxIter = opts?.maxIter ?? 200
  const m = opts?.m ?? 7
  const tol = opts?.tol ?? 1e-6
  const ftol = opts?.ftol ?? DEFAULT_FTOL
  const n = x0.length
  if (lower.length !== n || upper.length !== n) {
    throw new GpError('InvalidInput', { reason: 'boundsLength', n, lower: lower.length, upper: upper.length })
  }
  for (let i = 0; i < n; i++) {
    if (!(lower[i] <= upper[i])) throw new GpError('InvalidInput', { reason: 'bounds', index: i })
  }

  let x: Float64Array = Float64Array.from(x0, (v, i) => clampInto(v, lower[i], upper[i]))
  let cur = safeEval(f, x)
  if (!Number.isFinite(cur.value)) return { x, value: Infinity, iterations: 0, converged: false }

  const S: Float64Array[] = []
  const Y: Float64Array[] = []
  const RHO: number[] = []
  let prevActive = ''
  const clearHistory = (): void => {
    S.length = 0
    Y.length = 0
    RHO.length = 0
  }
  let iter = 0

  while (iter < maxIter) {
    const g = cur.grad
    // Projected gradient and active set.
    let pgNorm = 0
    const active = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const p = clampInto(x[i] - g[i], lower[i], upper[i]) - x[i]
      pgNorm = Math.max(pgNorm, Math.abs(p))
      if ((x[i] <= lower[i] && g[i] > 0) || (x[i] >= upper[i] && g[i] < 0)) active[i] = 1
    }
    if (pgNorm < tol) return { x, value: cur.value, iterations: iter, converged: true }
    const activeKey = active.join('')
    if (activeKey !== prevActive) {
      clearHistory()
      prevActive = activeKey
    }

    // Up to two attempts: the L-BFGS direction, then (if its line search fails with a non-empty history)
    // steepest descent with the history dropped.
    let accepted: { x: Float64Array; value: number; grad: Float64Array } | null = null
    for (let attempt = 0; attempt < 2 && !accepted; attempt++) {
      if (attempt === 1) {
        if (S.length === 0) break // the failed direction already was steepest descent
        clearHistory()
      }
      let d = twoLoopDirection(g, active, S, Y, RHO)
      if (!(dot(g, d) < 0)) {
        // Not a descent direction: fall back to steepest descent and drop the history.
        clearHistory()
        d = Float64Array.from(g, (v, i) => (active[i] ? 0 : -v))
        if (!(dot(g, d) < 0)) return { x, value: cur.value, iterations: iter, converged: false }
      }
      accepted = lineSearch(f, x, cur.value, g, d, lower, upper, S.length > 0)
    }
    iter++
    if (!accepted) return { x, value: cur.value, iterations: iter, converged: false }

    const s = Float64Array.from(accepted.x, (v, i) => v - x[i])
    // Restrict the pair to the free subspace: active coordinates have s_i = 0, and a non-zero y_i there would
    // distort γ, ρ and the two-loop recursion. The active set is constant until the next history reset.
    const yv = Float64Array.from(accepted.grad, (v, i) => (active[i] ? 0 : v - g[i]))
    const sy = dot(s, yv)
    if (sy > MIN_CURVATURE) {
      S.push(s)
      Y.push(yv)
      RHO.push(1 / sy)
      if (S.length > m) {
        S.shift()
        Y.shift()
        RHO.shift()
      }
    }
    const reduction = (cur.value - accepted.value) / Math.max(Math.abs(cur.value), Math.abs(accepted.value), 1)
    x = accepted.x
    cur = accepted
    if (reduction <= ftol) return { x, value: cur.value, iterations: iter, converged: true }
  }
  return { x, value: cur.value, iterations: iter, converged: false }
}

function validateData(X: Mat, y: Float64Array): void {
  if (X.rows === 0) throw new GpError('InvalidInput', { reason: 'noTrainingData' })
  if (X.rows !== y.length) throw new GpError('InvalidInput', { reason: 'yLength', rows: X.rows, y: y.length })
  for (let i = 0; i < X.data.length; i++) {
    if (!Number.isFinite(X.data[i])) throw new GpError('InvalidInput', { reason: 'xNonFinite', index: i })
  }
  for (let i = 0; i < y.length; i++) {
    if (!Number.isFinite(y[i])) throw new GpError('InvalidInput', { reason: 'yNonFinite', index: i })
  }
}

/**
 * Multistart maximisation of the log marginal likelihood. Run 0 starts at the current parameters (clamped into
 * the bounds); runs 1…restarts start uniformly in the log-bounds clipped to ±3 log units around them (sklearn's
 * n_restarts_optimizer convention: restarts + 1 runs in total). `shouldStop` is checked before every run after
 * the first. Throws GpError('OptimizerFailed') if no run reaches a finite value.
 * Returns the best model, its log ML, whether the best run converged (false: it stopped at the iteration limit or a
 * failed line search, so the result is the best point found), every run (reported as +log ML) and the parameter
 * names within 1e-3 log units of a bound.
 */
export function optimizeHyperparameters(
  model: GpModel,
  X: Mat,
  y: Float64Array,
  opts: {
    restarts: number
    seed: number
    maxIter?: number
    onProgress?: (p: { restart: number; logML: number }) => void
    shouldStop?: () => boolean
  },
): { model: GpModel; logML: number; converged: boolean; runs: HyperparameterRun[]; atBound: string[] } {
  validateData(X, y)
  if (!(opts.restarts >= 0) || !Number.isInteger(opts.restarts)) {
    throw new GpError('InvalidInput', { reason: 'restarts', value: opts.restarts })
  }
  const d = X.cols
  const info = modelParams(model, d)
  const { logLower: lo, logUpper: hi } = info
  const center = Float64Array.from(info.logValues, (v, i) => clampInto(v, lo[i], hi[i]))
  const rng = createRng(opts.seed)

  const objective: Objective = (theta) => {
    const r = logMarginalLikelihood(withModelLogParams(model, d, theta), X, y)
    return { value: -r.value, grad: r.grad.map((v) => -v) }
  }

  const runs: HyperparameterRun[] = []
  let best: OptResult | null = null
  for (let r = 0; r <= opts.restarts; r++) {
    if (r > 0 && opts.shouldStop?.()) break
    const start =
      r === 0
        ? center
        : Float64Array.from(center, (c, i) => {
            const a = Math.max(lo[i], c - START_SPREAD)
            const b = Math.min(hi[i], c + START_SPREAD)
            return a + (b - a) * rng.uniform()
          })
    const res = lbfgsb(objective, start, lo, hi, { maxIter: opts.maxIter ?? 200 })
    runs.push({ x: res.x, logML: -res.value, iterations: res.iterations, converged: res.converged })
    if (Number.isFinite(res.value) && (best === null || res.value < best.value)) best = res
    opts.onProgress?.({ restart: r, logML: best ? -best.value : -Infinity })
  }

  if (best === null) throw new GpError('OptimizerFailed', { reason: 'noFiniteRun', runs: runs.length })
  const bestX = best.x
  const atBound = info.names.filter(
    (_, i) => bestX[i] - lo[i] < AT_BOUND_TOL || hi[i] - bestX[i] < AT_BOUND_TOL,
  )
  return { model: withModelLogParams(model, d, bestX), logML: -best.value, converged: best.converged, runs, atBound }
}
