/**
 * Mean functions of the GP prior (Lehrbuch Kap. 7, Notebook gp-mean-fit).
 *
 * Prescribed means: zero, constant c, linear a + bᵀx. The GLS mean m(x) = h(x)ᵀη uses the basis
 * h(x) = [1] ('constant') or h(x) = [1, x_1 … x_d] ('linear'); η is estimated from the data by
 * generalised least squares at fixed covariance (`fitGls`, Notebook `fit_mean_gls`).
 */
import { GpError } from './errors'
import { colVec, solveLower, zeros, type Mat } from './linalg'

export type MeanSpec =
  | { kind: 'zero' }
  | { kind: 'constant'; c: number }
  | { kind: 'linear'; a: number; b: number[] }
  | { kind: 'gls'; basis: 'constant' | 'linear' }

/** Relative threshold below which a column of the whitened basis counts as linearly dependent. */
const RANK_TOL = 1e-10

/** Basis matrix H (n × p) of a GLS mean: rows h(x_i) = [1] or [1, x_i1 … x_id]. */
export function basisMatrix(basis: 'constant' | 'linear', X: Mat): Mat {
  const d = X.cols
  const p = basis === 'constant' ? 1 : d + 1
  const H = zeros(X.rows, p)
  for (let i = 0; i < X.rows; i++) {
    H.data[i * p] = 1
    if (basis === 'linear') for (let j = 0; j < d; j++) H.data[i * p + 1 + j] = X.data[i * d + j]
  }
  return H
}

/**
 * Mean values m(x_i) for the rows of X. For `gls`, `eta` (length = number of basis columns) is required.
 * Throws GpError('InvalidInput') for non-finite coefficients or mismatched lengths.
 */
export function meanValues(mean: MeanSpec, X: Mat, eta?: Float64Array): Float64Array {
  const n = X.rows
  const d = X.cols
  const out = new Float64Array(n)
  switch (mean.kind) {
    case 'zero':
      return out
    case 'constant':
      if (!Number.isFinite(mean.c)) throw new GpError('InvalidInput', { reason: 'meanConstant' })
      return out.fill(mean.c)
    case 'linear': {
      if (!Number.isFinite(mean.a) || mean.b.length !== d || !mean.b.every(Number.isFinite)) {
        throw new GpError('InvalidInput', { reason: 'meanLinear', inputDim: d, slopes: mean.b.length })
      }
      for (let i = 0; i < n; i++) {
        let s = mean.a
        for (let j = 0; j < d; j++) s += mean.b[j] * X.data[i * d + j]
        out[i] = s
      }
      return out
    }
    case 'gls': {
      const H = basisMatrix(mean.basis, X)
      const p = H.cols
      if (!eta || eta.length !== p || !eta.every(Number.isFinite)) {
        throw new GpError('InvalidInput', { reason: 'meanEta', expected: p, got: eta?.length ?? 0 })
      }
      for (let i = 0; i < n; i++) {
        let s = 0
        for (let j = 0; j < p; j++) s += H.data[i * p + j] * eta[j]
        out[i] = s
      }
      return out
    }
    default:
      throw new GpError('InvalidInput', { reason: 'meanKind' })
  }
}

/**
 * GLS coefficients η = (Hᵀ C⁻¹ H)⁻¹ Hᵀ C⁻¹ y at fixed C = L Lᵀ, without forming C⁻¹:
 * whiten H_w = L⁻¹H, y_w = L⁻¹y (forward solves) and solve the least-squares problem min ‖H_w η − y_w‖
 * by Householder QR (as `fit_mean_gls`, which uses lstsq on the whitened system).
 * Throws GpError('InvalidInput') if H has fewer rows than columns or is (numerically) rank-deficient.
 */
export function fitGls(L: Mat, H: Mat, y: Float64Array): { eta: Float64Array } {
  const n = L.rows
  const p = H.cols
  if (H.rows !== n || y.length !== n) {
    throw new GpError('InvalidInput', { reason: 'glsShapeMismatch', n, hRows: H.rows, yLength: y.length })
  }
  if (p === 0 || n < p) throw new GpError('InvalidInput', { reason: 'glsRankDeficient', rows: n, cols: p })
  const A = solveLower(L, H) // n × p, overwritten by R in its upper triangle
  const b = solveLower(L, colVec(y)).data
  const a = A.data

  // Column norms of the whitened basis, for a scale-invariant rank test.
  const colNorm = new Float64Array(p)
  for (let j = 0; j < p; j++) {
    let s = 0
    for (let i = 0; i < n; i++) s += a[i * p + j] * a[i * p + j]
    colNorm[j] = Math.sqrt(s)
  }

  const rDiag = new Float64Array(p)
  for (let j = 0; j < p; j++) {
    let norm = 0
    for (let i = j; i < n; i++) norm += a[i * p + j] * a[i * p + j]
    norm = Math.sqrt(norm)
    if (!(norm > RANK_TOL * colNorm[j]) || !Number.isFinite(norm)) {
      throw new GpError('InvalidInput', { reason: 'glsRankDeficient', column: j })
    }
    const alpha = a[j * p + j] > 0 ? -norm : norm
    // Householder vector v = x − alpha e_1 (stored in place below the diagonal), vᵀv = 2 norm (norm + |x_0|).
    a[j * p + j] -= alpha
    const vtv = 2 * norm * (norm + Math.abs(a[j * p + j] + alpha))
    for (let k = j + 1; k < p; k++) {
      let s = 0
      for (let i = j; i < n; i++) s += a[i * p + j] * a[i * p + k]
      const f = (2 * s) / vtv
      for (let i = j; i < n; i++) a[i * p + k] -= f * a[i * p + j]
    }
    let s = 0
    for (let i = j; i < n; i++) s += a[i * p + j] * b[i]
    const f = (2 * s) / vtv
    for (let i = j; i < n; i++) b[i] -= f * a[i * p + j]
    rDiag[j] = alpha
  }

  // Back substitution R η = (Qᵀ y_w)[0:p].
  const eta = new Float64Array(p)
  for (let j = p - 1; j >= 0; j--) {
    let s = b[j]
    for (let k = j + 1; k < p; k++) s -= a[j * p + k] * eta[k]
    eta[j] = s / rDiag[j]
  }
  return { eta }
}
