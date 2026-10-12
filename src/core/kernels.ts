/**
 * Covariance functions (Spec §3.4): base kernels in PyMC conventions, composed as a sum of products,
 * with optional input warping (1D), active dimensions and ARD length scales.
 *
 * Notation: inputs are rows of a Mat; r is the distance after scaling with ℓ (per dimension for ARD).
 * Free parameters live in log space; location/shape parameters (c, x0, offset, degree, p, warp a/b/c)
 * are never free.
 */
import { GpError } from './errors'
import { symEigenvalues, zeros, type Mat } from './linalg'

export type BaseKind =
  | 'rbf'
  | 'matern32'
  | 'matern52'
  | 'exponential'
  | 'rq'
  | 'periodic'
  | 'cosine'
  | 'linear'
  | 'polynomial'
  | 'constant'
  | 'white'
  | 'gibbs'
  | 'powexp'

export type Warp =
  | { kind: 'identity' }
  | { kind: 'square' }
  | { kind: 'log' }
  | { kind: 'circle'; period: number }
  | { kind: 'tanh'; a: number; b: number; c: number }

export interface BaseKernel {
  kind: BaseKind
  params: Record<string, number>
  fixed?: string[]
  warp?: Warp
  activeDims?: number[]
  ard?: boolean
}

/** Sum of products: k = Σ_t Π_f k_{t,f}. */
export interface KernelSpec {
  terms: BaseKernel[][]
}

export interface ParamInfo {
  names: string[]
  logValues: Float64Array
  logLower: Float64Array
  logUpper: Float64Array
}

export const MAX_TERMS = 6
export const MAX_FACTORS = 4
/** Largest number of ARD length scales (ell_0 … ell_9). */
export const MAX_ARD_DIM = 10
/** Natural-unit bounds of every free (log-space) parameter (sklearn defaults). */
export const PARAM_BOUNDS: readonly [number, number] = [1e-5, 1e5]
/** Step of the central finite differences in log space. */
const FD_STEP = 1e-6
/** Validity threshold: invalid iff min λ < −VALIDITY_TOL · max|λ|. */
export const VALIDITY_TOL = 1e-8

interface KindInfo {
  /** Parameter names in canonical order; 'ell' expands to ell_0 … ell_{d−1} under ARD. */
  params: readonly string[]
  /** Parameters that may be free (optimised in log space) unless listed in `fixed`. */
  logParams: readonly string[]
  defaults: Readonly<Record<string, number>>
}

const SCALED: Omit<KindInfo, 'defaults'> = {
  params: ['sigma', 'ell'],
  logParams: ['sigma', 'ell'],
}

const KINDS: Readonly<Record<BaseKind, KindInfo>> = {
  rbf: { ...SCALED, defaults: { sigma: 1, ell: 1 } },
  matern32: { ...SCALED, defaults: { sigma: 1, ell: 1 } },
  matern52: { ...SCALED, defaults: { sigma: 1, ell: 1 } },
  exponential: { ...SCALED, defaults: { sigma: 1, ell: 1 } },
  cosine: { ...SCALED, defaults: { sigma: 1, ell: 1 } },
  rq: {
    params: ['sigma', 'ell', 'alpha'],
    logParams: ['sigma', 'ell', 'alpha'],
    defaults: { sigma: 1, ell: 1, alpha: 1 },
  },
  periodic: {
    params: ['sigma', 'ell', 'period'],
    logParams: ['sigma', 'ell', 'period'],
    defaults: { sigma: 1, ell: 1, period: 1 },
  },
  linear: { params: ['sigma0', 'c'], logParams: ['sigma0'], defaults: { sigma0: 1, c: 0 } },
  polynomial: {
    params: ['c', 'offset', 'degree'],
    logParams: [],
    defaults: { c: 1, offset: 1, degree: 3 },
  },
  constant: { params: ['c'], logParams: ['c'], defaults: { c: 1 } },
  white: { params: ['sigma'], logParams: ['sigma'], defaults: { sigma: 1 } },
  gibbs: {
    params: ['sigma', 'l1', 'l2', 'w', 'x0'],
    logParams: ['sigma', 'l1', 'l2', 'w'],
    defaults: { sigma: 1, l1: 0.05, l2: 0.6, w: 0.3, x0: 1 },
  },
  powexp: {
    params: ['sigma', 'ell', 'p'],
    logParams: ['sigma', 'ell'],
    defaults: { sigma: 1, ell: 1, p: 2 },
  },
}

export const BASE_KINDS = Object.keys(KINDS) as BaseKind[]

/** Parameter names of a kind in canonical order ('ell' stands for ell_0 … ell_{d−1} under ARD). */
export function kindParams(kind: BaseKind): readonly string[] {
  return KINDS[kind].params
}

/** Parameters of a kind that may be free in log space (scales, lengths, α, period, constant c, l1, l2, w). */
export function logParams(kind: BaseKind): readonly string[] {
  return KINDS[kind].logParams
}

const LOCATION_PARAMS = Object.fromEntries(
  BASE_KINDS.map((k) => [k, Object.freeze(KINDS[k].params.filter((q) => !KINDS[k].logParams.includes(q)))]),
) as Readonly<Record<BaseKind, readonly string[]>>

/**
 * Location/shape parameters of a kind (linear/polynomial c, offset, degree, gibbs x0, powexp p). They are never
 * free, use linear sliders and are always treated as fixed.
 */
export function locationParams(kind: BaseKind): readonly string[] {
  return LOCATION_PARAMS[kind]
}

/** A base kernel with the default parameters of the table in Spec §3.4; location/shape params fixed. */
export function defaultKernel(kind: BaseKind): BaseKernel {
  const info = KINDS[kind]
  const fixed = info.params.filter((p) => !info.logParams.includes(p))
  return { kind, params: { ...info.defaults }, ...(fixed.length ? { fixed } : {}) }
}

// ---------------------------------------------------------------- validation

const FACTOR_KEYS = new Set(['kind', 'params', 'fixed', 'warp', 'activeDims', 'ard'])
const ARD_KEY = /^ell_(0|[1-9]\d*)$/

function isObj(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
}

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function hasExactKeys(o: Record<string, unknown>, keys: string[]): boolean {
  const own = Object.keys(o)
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k))
}

function warpProblem(w: unknown): string | null {
  if (!isObj(w)) return 'warp'
  switch (w.kind) {
    case 'identity':
    case 'square':
    case 'log':
      return hasExactKeys(w, ['kind']) ? null : 'warp'
    case 'circle':
      return hasExactKeys(w, ['kind', 'period']) && isFiniteNum(w.period) && w.period > 0 ? null : 'warp'
    case 'tanh':
      return hasExactKeys(w, ['kind', 'a', 'b', 'c']) && isFiniteNum(w.a) && isFiniteNum(w.b) && isFiniteNum(w.c)
        ? null
        : 'warp'
    default:
      return 'warp'
  }
}

/** Expected parameter keys of a factor (ARD: ell → ell_0 … ell_{k−1}, k taken from the params). */
function expectedKeys(kind: BaseKind, params: Record<string, unknown>, ard: boolean): string[] {
  const keys: string[] = []
  for (const p of KINDS[kind].params) {
    if (p === 'ell' && ard) {
      const k = Object.keys(params).filter((key) => ARD_KEY.test(key)).length
      for (let j = 0; j < k; j++) keys.push(`ell_${j}`)
    } else keys.push(p)
  }
  return keys
}

function factorProblem(f: unknown): string | null {
  if (!isObj(f)) return 'factor'
  if (!Object.keys(f).every((k) => FACTOR_KEYS.has(k))) return 'factorKeys'
  if (typeof f.kind !== 'string' || !Object.prototype.hasOwnProperty.call(KINDS, f.kind)) return 'kind'
  const kind = f.kind as BaseKind
  const info = KINDS[kind]
  // Shape checks of the optional fields first, so that later reads never touch a non-object.
  if (f.warp !== undefined) {
    const w = warpProblem(f.warp)
    if (w) return w
  }
  if (f.ard !== undefined && typeof f.ard !== 'boolean') return 'ard'
  const ard = f.ard === true
  if (ard && !info.params.includes('ell')) return 'ard'
  if (ard && f.warp !== undefined && (f.warp as Warp).kind !== 'identity') return 'ardWarp'
  if (!isObj(f.params)) return 'params'
  const params = f.params
  const keys = expectedKeys(kind, params, ard)
  if (ard) {
    const k = keys.filter((key) => ARD_KEY.test(key)).length
    if (k === 0 || k > MAX_ARD_DIM) return 'ardDimension'
  }
  if (!hasExactKeys(params, keys)) return 'params'
  if (!keys.every((k) => isFiniteNum(params[k]))) return 'paramValue'
  if (f.fixed !== undefined) {
    if (!Array.isArray(f.fixed) || !f.fixed.every((x) => typeof x === 'string' && keys.includes(x))) return 'fixed'
  }
  const fixed = new Set((f.fixed ?? []) as string[])
  const p = params as Record<string, number>
  const [lo, hi] = PARAM_BOUNDS
  for (const k of keys) {
    const base = ARD_KEY.test(k) ? 'ell' : k
    if (!info.logParams.includes(base)) continue
    // Log-space parameters lie in PARAM_BOUNDS; only a fixed linear σ₀ may be exactly 0.
    if (kind === 'linear' && k === 'sigma0' && p[k] === 0 && fixed.has('sigma0')) continue
    if (!(p[k] >= lo && p[k] <= hi)) return 'paramRange'
  }
  if (kind === 'polynomial' && !(Number.isInteger(p.degree) && p.degree >= 1 && p.degree <= 5)) return 'paramRange'
  if (kind === 'powexp' && !(p.p >= 0.5 && p.p <= 3)) return 'paramRange'
  if (f.activeDims !== undefined) {
    const ad = f.activeDims
    if (
      !Array.isArray(ad) ||
      ad.length === 0 ||
      !ad.every((d) => Number.isInteger(d) && d >= 0) ||
      new Set(ad).size !== ad.length
    )
      return 'activeDims'
  }
  return null
}

function specProblem(x: unknown): string | null {
  if (!isObj(x) || !hasExactKeys(x, ['terms'])) return 'spec'
  const terms = x.terms
  if (!Array.isArray(terms) || terms.length === 0 || terms.length > MAX_TERMS) return 'terms'
  for (const t of terms) {
    if (!Array.isArray(t) || t.length === 0 || t.length > MAX_FACTORS) return 'factors'
    for (const f of t) {
      const p = factorProblem(f)
      if (p) return p
    }
  }
  return null
}

/**
 * Strict structural and range check: known kinds, exactly the required parameters, finite values in range
 * (scales/lengths/period > 0, degree integer 1–5, p ∈ [0.5, 3], σ₀ = 0 only when fixed), valid warps,
 * activeDims unique non-negative integers, 1–6 terms with 1–4 factors each.
 */
export function isKernelSpec(x: unknown): x is KernelSpec {
  return specProblem(x) === null
}

function assertSpec(spec: KernelSpec): void {
  const p = specProblem(spec)
  if (p) throw new GpError('InvalidInput', { reason: 'invalidSpec', problem: p })
}

// ---------------------------------------------------------------- inputs

function selectColumns(X: Mat, dims: number[]): Mat {
  for (const d of dims) {
    if (d >= X.cols) throw new GpError('InvalidInput', { reason: 'activeDims', dim: d, inputDim: X.cols })
  }
  const out = zeros(X.rows, dims.length)
  for (let i = 0; i < X.rows; i++)
    for (let k = 0; k < dims.length; k++) out.data[i * dims.length + k] = X.data[i * X.cols + dims[k]]
  return out
}

function applyWarp(w: Warp, X: Mat): Mat {
  if (w.kind === 'identity') return X
  if (X.cols !== 1) throw new GpError('InvalidInput', { reason: 'warpRequires1D', inputDim: X.cols })
  const n = X.rows
  if (w.kind === 'circle') {
    const out = zeros(n, 2)
    const c = (2 * Math.PI) / w.period
    for (let i = 0; i < n; i++) {
      out.data[2 * i] = Math.sin(c * X.data[i])
      out.data[2 * i + 1] = Math.cos(c * X.data[i])
    }
    return out
  }
  const out = zeros(n, 1)
  for (let i = 0; i < n; i++) {
    const x = X.data[i]
    if (w.kind === 'square') out.data[i] = x * x
    else if (w.kind === 'log') {
      if (!(x > 0)) throw new GpError('InvalidInput', { reason: 'logWarpDomain', index: i, value: x })
      out.data[i] = Math.log(x)
    } else out.data[i] = 1 + x + w.a * Math.tanh(w.b * (x - w.c))
  }
  return out
}

/** Input as seen by the base kernel: active columns selected, then warped. */
function prepare(f: BaseKernel, X: Mat): Mat {
  const sel = f.activeDims ? selectColumns(X, f.activeDims) : X
  return f.warp ? applyWarp(f.warp, sel) : sel
}

/** Effective input dimension of a factor before warping (after activeDims), with range checks. */
function factorDim(f: BaseKernel, inputDim: number): number {
  if (!f.activeDims) return inputDim
  for (const d of f.activeDims) {
    if (d >= inputDim) throw new GpError('InvalidInput', { reason: 'activeDims', dim: d, inputDim })
  }
  return f.activeDims.length
}

/** Length scales per dimension of the (prepared) input; ARD count must equal the dimension. */
function lengths(f: BaseKernel, d: number): Float64Array {
  if (!f.ard) return new Float64Array(d).fill(f.params.ell)
  const k = Object.keys(f.params).filter((key) => ARD_KEY.test(key)).length
  if (k !== d) throw new GpError('InvalidInput', { reason: 'ardDimension', lengths: k, inputDim: d })
  const out = new Float64Array(d)
  for (let j = 0; j < d; j++) out[j] = f.params[`ell_${j}`]
  return out
}

// ---------------------------------------------------------------- evaluation

function gibbsLength(p: Record<string, number>, x: number): number {
  return (p.l1 + p.l2) / 2 - ((p.l1 - p.l2) / 2) * Math.tanh((x - p.x0) / p.w)
}

/**
 * Pair function of one base kernel on prepared inputs U (rows i) and V (rows j).
 * `same` marks U and V as the same point set (white noise contributes only then, on i = j).
 */
function pairFn(f: BaseKernel, U: Mat, V: Mat, same: boolean): (i: number, j: number) => number {
  const p = f.params
  const d = U.cols
  const u = U.data
  const v = V.data
  const kind = f.kind
  const s2 = p.sigma * p.sigma
  switch (kind) {
    case 'linear':
    case 'polynomial': {
      const c = p.c
      const dot = (i: number, j: number) => {
        let s = 0
        for (let k = 0; k < d; k++) s += (u[i * d + k] - c) * (v[j * d + k] - c)
        return s
      }
      if (kind === 'linear') {
        const b = p.sigma0 * p.sigma0
        return (i, j) => b + dot(i, j)
      }
      return (i, j) => Math.pow(dot(i, j) + p.offset, p.degree)
    }
    case 'constant':
      return () => p.c
    case 'white':
      return (i, j) => (same && i === j ? s2 : 0)
    case 'gibbs': {
      if (d !== 1) throw new GpError('InvalidInput', { reason: 'gibbsRequires1D', inputDim: d })
      const lu = Float64Array.from(u, (x) => gibbsLength(p, x))
      const lv = Float64Array.from(v, (x) => gibbsLength(p, x))
      return (i, j) => {
        const den = lu[i] * lu[i] + lv[j] * lv[j]
        const dx = u[i] - v[j]
        return s2 * Math.sqrt((2 * lu[i] * lv[j]) / den) * Math.exp(-(dx * dx) / den)
      }
    }
    case 'periodic': {
      const ell = lengths(f, d)
      const T = p.period
      return (i, j) => {
        let s = 0
        for (let k = 0; k < d; k++) {
          const t = Math.sin((Math.PI * (u[i * d + k] - v[j * d + k])) / T) / ell[k]
          s += t * t
        }
        return s2 * Math.exp(-0.5 * s)
      }
    }
    default: {
      const ell = lengths(f, d)
      const r2 = (i: number, j: number) => {
        let s = 0
        for (let k = 0; k < d; k++) {
          const t = (u[i * d + k] - v[j * d + k]) / ell[k]
          s += t * t
        }
        return s
      }
      switch (kind) {
        case 'rbf':
          return (i, j) => s2 * Math.exp(-0.5 * r2(i, j))
        case 'matern32':
          return (i, j) => {
            const r = Math.sqrt(3 * r2(i, j))
            return s2 * (1 + r) * Math.exp(-r)
          }
        case 'matern52':
          return (i, j) => {
            const q = r2(i, j)
            const r = Math.sqrt(5 * q)
            return s2 * (1 + r + (5 * q) / 3) * Math.exp(-r)
          }
        case 'exponential':
          return (i, j) => s2 * Math.exp(-0.5 * Math.sqrt(r2(i, j)))
        case 'rq':
          return (i, j) => s2 * Math.pow(1 + r2(i, j) / (2 * p.alpha), -p.alpha)
        case 'cosine':
          return (i, j) => s2 * Math.cos(2 * Math.PI * Math.sqrt(r2(i, j)))
        case 'powexp':
          return (i, j) => s2 * Math.exp(-Math.pow(r2(i, j), p.p / 2))
      }
    }
  }
  throw new GpError('InvalidInput', { reason: 'unknownKind', kind })
}

function fill(n: number, m: number, fn: (i: number, j: number) => number): Mat {
  const out = zeros(n, m)
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) out.data[i * m + j] = fn(i, j)
  return out
}

function factorMatrix(f: BaseKernel, U: Mat, V: Mat, same: boolean): Mat {
  return fill(U.rows, V.rows, pairFn(f, U, V, same))
}

function checkInputs(A: Mat, B: Mat, sameSet: boolean): void {
  if (A.cols !== B.cols) throw new GpError('InvalidInput', { reason: 'inputDimMismatch', a: A.cols, b: B.cols })
  if (sameSet && A.rows !== B.rows) throw new GpError('InvalidInput', { reason: 'sameSetSizeMismatch' })
}

/**
 * K(A, B) of a sum-of-products spec. Each factor matrix is computed once and multiplied element-wise.
 * `sameSet` declares A and B to be the same point set; only then does `white` add σ² on the diagonal.
 */
export function kernelMatrix(spec: KernelSpec, A: Mat, B: Mat, opts?: { sameSet?: boolean }): Mat {
  assertSpec(spec)
  const same = opts?.sameSet === true
  checkInputs(A, B, same)
  const K = zeros(A.rows, B.rows)
  for (const term of spec.terms) {
    let prod: Mat | null = null
    for (const f of term) {
      const F = factorMatrix(f, prepare(f, A), prepare(f, B), same)
      if (prod === null) prod = F
      else for (let k = 0; k < F.data.length; k++) prod.data[k] *= F.data[k]
    }
    for (let k = 0; k < K.data.length; k++) K.data[k] += prod!.data[k]
  }
  return K
}

/**
 * diag k(a_i, a_i). White noise is counted only when `sameSet` is true (the default, matching
 * kernelMatrix(spec, A, A, { sameSet: true })); with `sameSet: false` it matches kernelMatrix(spec, A, A).
 */
export function kernelDiag(spec: KernelSpec, A: Mat, opts?: { sameSet?: boolean }): Float64Array {
  assertSpec(spec)
  const same = opts?.sameSet ?? true
  const out = new Float64Array(A.rows)
  for (const term of spec.terms) {
    const prod = new Float64Array(A.rows).fill(1)
    for (const f of term) {
      const U = prepare(f, A)
      const fn = pairFn(f, U, U, same)
      for (let i = 0; i < A.rows; i++) prod[i] *= fn(i, i)
    }
    for (let i = 0; i < A.rows; i++) out[i] += prod[i]
  }
  return out
}

// ---------------------------------------------------------------- parameters

/** Parameter keys of a factor in canonical order (ARD lengths expanded). */
function paramKeys(f: BaseKernel): string[] {
  return expectedKeys(f.kind, f.params, f.ard === true)
}

/** Free (log-space, not fixed) parameter keys of a factor in canonical order. */
function freeKeys(f: BaseKernel): string[] {
  const fixed = new Set(f.fixed ?? [])
  const logParams = KINDS[f.kind].logParams
  return paramKeys(f).filter((key) => logParams.includes(ARD_KEY.test(key) ? 'ell' : key) && !fixed.has(key))
}

/** Free (log-space) parameters in the order term → factor → canonical parameter order. */
export function freeParams(spec: KernelSpec, inputDim: number): ParamInfo {
  assertSpec(spec)
  const names: string[] = []
  const values: number[] = []
  spec.terms.forEach((term, t) =>
    term.forEach((f, fi) => {
      if (f.ard) lengths(f, factorDim(f, inputDim))
      else factorDim(f, inputDim)
      for (const key of freeKeys(f)) {
        names.push(`t${t}.f${fi}.${key}`)
        values.push(Math.log(f.params[key]))
      }
    }),
  )
  const n = names.length
  return {
    names,
    logValues: Float64Array.from(values),
    logLower: new Float64Array(n).fill(Math.log(PARAM_BOUNDS[0])),
    logUpper: new Float64Array(n).fill(Math.log(PARAM_BOUNDS[1])),
  }
}

function copyFactor(f: BaseKernel): BaseKernel {
  const out: BaseKernel = { kind: f.kind, params: { ...f.params } }
  if (f.fixed) out.fixed = [...f.fixed]
  if (f.warp) out.warp = { ...f.warp }
  if (f.activeDims) out.activeDims = [...f.activeDims]
  if (f.ard !== undefined) out.ard = f.ard
  return out
}

/** Copy of `spec` with the free parameters set to exp(logValues) (order of freeParams). */
export function withLogParams(spec: KernelSpec, inputDim: number, logValues: Float64Array): KernelSpec {
  const info = freeParams(spec, inputDim)
  if (logValues.length !== info.names.length) {
    throw new GpError('InvalidInput', { reason: 'logValuesLength', expected: info.names.length, got: logValues.length })
  }
  const out: KernelSpec = { terms: spec.terms.map((t) => t.map(copyFactor)) }
  let idx = 0
  out.terms.forEach((term) =>
    term.forEach((f) => {
      for (const key of freeKeys(f)) {
        const v = Math.exp(logValues[idx++])
        if (!(v > 0) || !Number.isFinite(v)) throw new GpError('InvalidInput', { reason: 'logValue', index: idx - 1 })
        f.params[key] = v
      }
    }),
  )
  return out
}

// ---------------------------------------------------------------- gradients

const ANALYTIC: ReadonlySet<BaseKind> = new Set<BaseKind>([
  'rbf',
  'matern32',
  'matern52',
  'rq',
  'periodic',
  'linear',
  'constant',
  'white',
])

/** ∂F/∂(log θ) for one parameter of one factor, F = factor matrix on U × U (same set). */
function factorGradient(f: BaseKernel, key: string, U: Mat, F: Mat): Mat {
  const n = U.rows
  const p = f.params
  const scale = (c: number) => {
    const out = zeros(n, n)
    for (let k = 0; k < out.data.length; k++) out.data[k] = c * F.data[k]
    return out
  }
  // Every kind with σ is σ² times a σ-free function, so ∂k/∂log σ = 2k exactly (also for the FD kinds).
  if (key === 'sigma') return scale(2)
  if (!ANALYTIC.has(f.kind)) {
    // Central differences in log space: (F(θ·e^h) − F(θ·e^−h)) / 2h.
    const at = (h: number) => {
      const g = copyFactor(f)
      g.params[key] = Math.exp(Math.log(p[key]) + h)
      return factorMatrix(g, U, U, true)
    }
    const up = at(FD_STEP)
    const dn = at(-FD_STEP)
    const out = zeros(n, n)
    for (let k = 0; k < out.data.length; k++) out.data[k] = (up.data[k] - dn.data[k]) / (2 * FD_STEP)
    return out
  }
  // ∂c/∂log c = c; ∂(σ₀² + …)/∂log σ₀ = 2σ₀².
  if (f.kind === 'constant') return scale(1)
  if (f.kind === 'linear') return fill(n, n, () => 2 * p.sigma0 * p.sigma0)

  const d = U.cols
  const u = U.data
  const ell = lengths(f, d)
  const ardIndex = ARD_KEY.test(key) ? Number(key.slice(4)) : -1
  const s2 = p.sigma * p.sigma
  /** q = Σ_k over the dimensions the length parameter acts on of (Δ_k/ℓ_k)². */
  const lengthTerm = (i: number, j: number, periodic: boolean) => {
    let q = 0
    for (let k = 0; k < d; k++) {
      if (ardIndex >= 0 && k !== ardIndex) continue
      const diff = u[i * d + k] - u[j * d + k]
      const t = (periodic ? Math.sin((Math.PI * diff) / p.period) : diff) / ell[k]
      q += t * t
    }
    return q
  }
  const r2 = (i: number, j: number) => {
    let s = 0
    for (let k = 0; k < d; k++) {
      const t = (u[i * d + k] - u[j * d + k]) / ell[k]
      s += t * t
    }
    return s
  }

  if (f.kind === 'periodic') {
    if (key === 'period') {
      // ∂k/∂log T = k · Σ_k π Δ_k sin(2π Δ_k/T) / (2 T ℓ_k²)
      return fill(n, n, (i, j) => {
        let s = 0
        for (let k = 0; k < d; k++) {
          const diff = u[i * d + k] - u[j * d + k]
          s += (Math.PI * diff * Math.sin((2 * Math.PI * diff) / p.period)) / (2 * p.period * ell[k] * ell[k])
        }
        return F.data[i * n + j] * s
      })
    }
    // ∂k/∂log ℓ_j = k · sin²(πΔ_j/T)/ℓ_j²
    return fill(n, n, (i, j) => F.data[i * n + j] * lengthTerm(i, j, true))
  }
  if (f.kind === 'rq' && key === 'alpha') {
    // ∂k/∂log α = k · (−α log B + r²/(2B)), B = 1 + r²/(2α)
    return fill(n, n, (i, j) => {
      const q = r2(i, j)
      const B = 1 + q / (2 * p.alpha)
      return F.data[i * n + j] * (-p.alpha * Math.log(B) + q / (2 * B))
    })
  }
  // Length scales of the stationary kinds, with q = (Δ_j/ℓ_j)² (ARD) or r² (isotropic).
  switch (f.kind) {
    case 'rbf':
      return fill(n, n, (i, j) => F.data[i * n + j] * lengthTerm(i, j, false))
    case 'matern32':
      return fill(n, n, (i, j) => 3 * s2 * Math.exp(-Math.sqrt(3 * r2(i, j))) * lengthTerm(i, j, false))
    case 'matern52':
      return fill(n, n, (i, j) => {
        const r = Math.sqrt(5 * r2(i, j))
        return ((5 * s2) / 3) * (1 + r) * Math.exp(-r) * lengthTerm(i, j, false)
      })
    case 'rq':
      return fill(
        n,
        n,
        (i, j) => s2 * Math.pow(1 + r2(i, j) / (2 * p.alpha), -p.alpha - 1) * lengthTerm(i, j, false),
      )
  }
  throw new GpError('InvalidInput', { reason: 'noGradient', kind: f.kind, param: key })
}

/**
 * ∂K/∂(log θ_i) of K = K(X, X) (same set), in the order of freeParams.
 * Products use the product rule: ∂(Π_f k_f) = Σ_f (∂k_f) Π_{g≠f} k_g.
 */
export function kernelGradients(spec: KernelSpec, X: Mat): Mat[] {
  freeParams(spec, X.cols) // validates spec, activeDims and ARD counts
  const n = X.rows
  const out: Mat[] = []
  for (const term of spec.terms) {
    const inputs = term.map((f) => prepare(f, X))
    const mats = term.map((f, fi) => factorMatrix(f, inputs[fi], inputs[fi], true))
    term.forEach((f, fi) => {
      for (const key of freeKeys(f)) {
        const G = factorGradient(f, key, inputs[fi], mats[fi])
        for (let g = 0; g < term.length; g++) {
          if (g === fi) continue
          for (let k = 0; k < n * n; k++) G.data[k] *= mats[g].data[k]
        }
        out.push(G)
      }
    })
  }
  return out
}

// ---------------------------------------------------------------- validity

/**
 * Eigenvalue-based validity of a kernel matrix (Global Constraints): invalid iff min λ < −1e-8·max|λ|.
 * minRel = min λ / max|λ| (0 for the zero matrix). Non-finite entries are invalid (minRel = −∞).
 */
export function checkValidity(K: Mat): { valid: boolean; eigenvalues: Float64Array; minRel: number } {
  for (const v of K.data) {
    if (!Number.isFinite(v)) return { valid: false, eigenvalues: new Float64Array(0), minRel: -Infinity }
  }
  const eigenvalues = symEigenvalues(K)
  if (eigenvalues.length === 0) return { valid: true, eigenvalues, minRel: 0 }
  let maxAbs = 0
  for (const l of eigenvalues) maxAbs = Math.max(maxAbs, Math.abs(l))
  const min = eigenvalues[0]
  if (maxAbs === 0) return { valid: true, eigenvalues, minRel: 0 }
  return { valid: !(min < -VALIDITY_TOL * maxAbs), eigenvalues, minRel: min / maxAbs }
}

// ---------------------------------------------------------------- KaTeX

function warpTex(w: Warp, name: string): string | null {
  switch (w.kind) {
    case 'identity':
      return null
    case 'square':
      return `${name}(x) = x^2`
    case 'log':
      return `${name}(x) = \\log x`
    case 'circle':
      return `${name}(x) = \\bigl(\\sin(2\\pi x/T),\\, \\cos(2\\pi x/T)\\bigr),\\ T = ${fmt(w.period)}`
    case 'tanh':
      return `${name}(x) = 1 + x + a\\tanh\\bigl(b(x - c)\\bigr),\\ (a,b,c) = (${fmt(w.a)}, ${fmt(w.b)}, ${fmt(w.c)})`
  }
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(4)))
}

/** KaTeX of one factor; `idx` is the 1-based factor number when the spec has several factors. */
function factorTex(
  f: BaseKernel,
  idx: number | null,
  inProduct: boolean,
  inputDim: number | undefined,
  defs: string[],
): string {
  const sub = (base: string) => (idx === null ? base : `${base}_{${idx}}`)
  const sig2 = `${sub('\\sigma')}^2`
  let x = 'x'
  let xp = "x'"
  if (f.warp && f.warp.kind !== 'identity') {
    const phi = sub('\\varphi')
    x = `${phi}(x)`
    xp = `${phi}(x')`
    defs.push(warpTex(f.warp, phi)!)
  }
  const ard = f.ard === true
  const ell = sub('\\ell')
  const ellj = idx === null ? '\\ell_j' : `\\ell_{${idx},j}`
  const dist = `\\lVert ${x} - ${xp} \\rVert`
  const R = ard ? `\\sqrt{\\textstyle\\sum_j (${x}_j - ${xp}_j)^2/${ellj}^2}` : `\\frac{${dist}}{${ell}}`
  const R2 = ard ? `\\textstyle\\sum_j (${x}_j - ${xp}_j)^2/${ellj}^2` : `\\frac{${dist}^2}{${ell}^2}`
  const c = sub('c')
  switch (f.kind) {
    case 'rbf':
      return `${sig2} \\exp\\left(-\\tfrac{1}{2} ${R2}\\right)`
    case 'matern32':
      return `${sig2} \\left(1 + \\sqrt{3}\\, ${R}\\right) \\exp\\left(-\\sqrt{3}\\, ${R}\\right)`
    case 'matern52':
      return `${sig2} \\left(1 + \\sqrt{5}\\, ${R} + \\tfrac{5}{3} ${R2}\\right) \\exp\\left(-\\sqrt{5}\\, ${R}\\right)`
    case 'exponential':
      return `${sig2} \\exp\\left(-\\tfrac{1}{2} ${R}\\right)`
    case 'rq': {
      const a = sub('\\alpha')
      return `${sig2} \\left(1 + \\frac{1}{2${a}} ${R2}\\right)^{-${a}}`
    }
    case 'periodic': {
      const T = sub('p')
      // The scalar form is exact only when the base kernel surely sees a 1-D input; otherwise Σ_j, as computed.
      const w = f.warp?.kind
      const scalar =
        w === 'square' ||
        w === 'log' ||
        w === 'tanh' ||
        (w !== 'circle' && (f.activeDims ? f.activeDims.length === 1 : inputDim === 1))
      if (ard || !scalar) {
        const lj = ard ? ellj : ell
        return `${sig2} \\exp\\left(-\\tfrac{1}{2} \\textstyle\\sum_j \\sin^2\\bigl(\\pi (${x}_j - ${xp}_j)/${T}\\bigr)/${lj}^2\\right)`
      }
      return `${sig2} \\exp\\left(-\\frac{\\sin^2\\bigl(\\pi\\, ${dist}/${T}\\bigr)}{2${ell}^2}\\right)`
    }
    case 'cosine':
      return `${sig2} \\cos\\left(2\\pi\\, ${R}\\right)`
    case 'linear': {
      const lin = `${idx === null ? '\\sigma_0' : `\\sigma_{0,${idx}}`}^2 + (${x} - ${c})^{\\top}(${xp} - ${c})`
      return inProduct ? `\\left(${lin}\\right)` : lin
    }
    case 'polynomial':
      return `\\left((${x} - ${c})^{\\top}(${xp} - ${c}) + ${sub('o')}\\right)^{${fmt(f.params.degree)}}`
    case 'constant':
      return c
    case 'white':
      return `${sig2}\\, \\delta_{${x},${xp}}`
    case 'gibbs': {
      const l = sub('\\ell')
      const lx = `${l}(${x})`
      const lxp = `${l}(${xp})`
      const l1 = idx === null ? 'l_1' : `l_1^{(${idx})}`
      const l2 = idx === null ? 'l_2' : `l_2^{(${idx})}`
      const w = sub('w')
      const x0 = idx === null ? 'x_0' : `x_0^{(${idx})}`
      defs.push(`${l}(x) = \\tfrac{${l1} + ${l2}}{2} - \\tfrac{${l1} - ${l2}}{2} \\tanh\\frac{x - ${x0}}{${w}}`)
      return (
        `${sig2} \\sqrt{\\frac{2\\, ${lx}\\, ${lxp}}{${lx}^2 + ${lxp}^2}}` +
        ` \\exp\\left(-\\frac{(${x} - ${xp})^2}{${lx}^2 + ${lxp}^2}\\right)`
      )
    }
    case 'powexp':
      return `${sig2} \\exp\\left(-\\left(${R}\\right)^{${fmt(f.params.p)}}\\right)`
  }
}

/**
 * KaTeX string of the whole kernel, e.g. k(x,x') = \sigma^2 \exp(…) + …; warp/ℓ(x) definitions follow.
 * With `inputDim: 1` periodic uses the scalar form sin²(π|x−x'|/p); otherwise (unknown or multi-D input,
 * circle warp) it shows the per-dimension sum that is actually computed.
 */
export function kernelTex(spec: KernelSpec, opts?: { inputDim?: number }): string {
  assertSpec(spec)
  const many = spec.terms.reduce((s, t) => s + t.length, 0) > 1
  const defs: string[] = []
  let idx = 0
  const terms = spec.terms.map((term) =>
    term.map((f) => factorTex(f, many ? ++idx : null, term.length > 1, opts?.inputDim, defs)).join(' \\cdot '),
  )
  const body = `k(x,x') = ${terms.join(' + ')}`
  return defs.length ? `${body},\\quad ${defs.join(',\\quad ')}` : body
}
