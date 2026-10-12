import { GpError } from './errors'

/** Dense row-major matrix. */
export interface Mat {
  rows: number
  cols: number
  data: Float64Array
}

/** Jitter schedule: plain attempt + JITTER_STEPS jittered attempts = 7 attempts total. */
const JITTER_STEPS = 6
const JITTER_BASE = 1e-10

export function zeros(r: number, c: number): Mat {
  return { rows: r, cols: c, data: new Float64Array(r * c) }
}

export function fromRows(rows: number[][]): Mat {
  const r = rows.length
  const c = r === 0 ? 0 : rows[0].length
  const m = zeros(r, c)
  for (let i = 0; i < r; i++) {
    if (rows[i].length !== c) throw new GpError('InvalidInput', { reason: 'ragged rows' })
    for (let j = 0; j < c; j++) m.data[i * c + j] = rows[i][j]
  }
  return m
}

export function toRows(m: Mat): number[][] {
  const out: number[][] = []
  for (let i = 0; i < m.rows; i++) {
    out.push(Array.from(m.data.subarray(i * m.cols, (i + 1) * m.cols)))
  }
  return out
}

export function get(m: Mat, i: number, j: number): number {
  return m.data[i * m.cols + j]
}

export function transpose(m: Mat): Mat {
  const t = zeros(m.cols, m.rows)
  for (let i = 0; i < m.rows; i++)
    for (let j = 0; j < m.cols; j++) t.data[j * m.rows + i] = m.data[i * m.cols + j]
  return t
}

export function matMul(a: Mat, b: Mat): Mat {
  if (a.cols !== b.rows) {
    throw new GpError('InvalidInput', { reason: 'matMul shape mismatch', a: [a.rows, a.cols], b: [b.rows, b.cols] })
  }
  const n = a.rows
  const k = a.cols
  const m = b.cols
  const out = zeros(n, m)
  for (let i = 0; i < n; i++) {
    for (let p = 0; p < k; p++) {
      const aip = a.data[i * k + p]
      if (aip === 0) continue
      for (let j = 0; j < m; j++) out.data[i * m + j] += aip * b.data[p * m + j]
    }
  }
  return out
}

export function colVec(v: ArrayLike<number>): Mat {
  const m = zeros(v.length, 1)
  for (let i = 0; i < v.length; i++) m.data[i] = v[i]
  return m
}

function assertSquareFinite(A: Mat, what: string): void {
  if (A.rows !== A.cols) {
    throw new GpError('InvalidInput', { reason: `${what}: matrix not square`, rows: A.rows, cols: A.cols })
  }
  for (let i = 0; i < A.data.length; i++) {
    if (!Number.isFinite(A.data[i])) {
      throw new GpError('InvalidInput', { reason: `${what}: non-finite entry`, index: i })
    }
  }
}

/** Single Cholesky attempt on A + jitter*I. Returns null if a pivot is not positive/finite. */
function tryCholesky(A: Mat, jitter: number): Mat | null {
  const n = A.rows
  const L = zeros(n, n)
  for (let j = 0; j < n; j++) {
    let d = A.data[j * n + j] + jitter
    for (let k = 0; k < j; k++) d -= L.data[j * n + k] * L.data[j * n + k]
    if (!(d > 0) || !Number.isFinite(d)) return null
    const ljj = Math.sqrt(d)
    L.data[j * n + j] = ljj
    for (let i = j + 1; i < n; i++) {
      let s = A.data[i * n + j]
      for (let k = 0; k < j; k++) s -= L.data[i * n + k] * L.data[j * n + k]
      const v = s / ljj
      if (!Number.isFinite(v)) return null
      L.data[i * n + j] = v
    }
  }
  return L
}

/**
 * Lower Cholesky factor with escalating jitter.
 * Attempts (7 total): jitter 0, then 1e-10*scale, 1e-9*scale, ..., 1e-5*scale.
 * scale = opts.jitterScale ?? mean(diag A); if that is <= 0 or non-finite, 1.
 * Throws GpError('InvalidInput') for non-square / non-finite A and
 * GpError('NotPositiveDefinite', {lastJitter}) when all attempts fail.
 */
export function cholesky(A: Mat, opts?: { jitterScale?: number }): { L: Mat; jitter: number } {
  assertSquareFinite(A, 'cholesky')
  const n = A.rows
  let scale = opts?.jitterScale
  if (scale === undefined) {
    let s = 0
    for (let i = 0; i < n; i++) s += A.data[i * n + i]
    scale = n > 0 ? s / n : 1
  }
  if (!(scale > 0) || !Number.isFinite(scale)) scale = 1

  let jitter = 0
  for (let attempt = 0; attempt <= JITTER_STEPS; attempt++) {
    if (attempt > 0) jitter = attempt === 1 ? JITTER_BASE * scale : jitter * 10
    const L = tryCholesky(A, jitter)
    if (L) return { L, jitter }
  }
  throw new GpError('NotPositiveDefinite', { lastJitter: jitter })
}

/** Solve L X = B (L lower triangular, forward substitution). */
export function solveLower(L: Mat, B: Mat): Mat {
  const n = L.rows
  if (L.cols !== n || B.rows !== n) throw new GpError('InvalidInput', { reason: 'solveLower shape mismatch' })
  const m = B.cols
  const X = zeros(n, m)
  for (let c = 0; c < m; c++) {
    for (let i = 0; i < n; i++) {
      let s = B.data[i * m + c]
      for (let k = 0; k < i; k++) s -= L.data[i * n + k] * X.data[k * m + c]
      X.data[i * m + c] = s / L.data[i * n + i]
    }
  }
  return X
}

/** Solve L^T X = B (L lower triangular, backward substitution). */
export function solveUpperT(L: Mat, B: Mat): Mat {
  const n = L.rows
  if (L.cols !== n || B.rows !== n) throw new GpError('InvalidInput', { reason: 'solveUpperT shape mismatch' })
  const m = B.cols
  const X = zeros(n, m)
  for (let c = 0; c < m; c++) {
    for (let i = n - 1; i >= 0; i--) {
      let s = B.data[i * m + c]
      for (let k = i + 1; k < n; k++) s -= L.data[k * n + i] * X.data[k * m + c]
      X.data[i * m + c] = s / L.data[i * n + i]
    }
  }
  return X
}

/** A^-1 = L^-T L^-1 via triangular solves on the identity. Only for the log-ML gradient. */
export function inverseFromCholesky(L: Mat): Mat {
  const n = L.rows
  const I = zeros(n, n)
  for (let i = 0; i < n; i++) I.data[i * n + i] = 1
  return solveUpperT(L, solveLower(L, I))
}

/** Eigenvalues of a symmetric matrix by cyclic Jacobi, ascending. Intended for n <= 200. */
export function symEigenvalues(A: Mat): Float64Array {
  assertSquareFinite(A, 'symEigenvalues')
  const n = A.rows
  const a = Float64Array.from(A.data)
  // Symmetrise to guard against round-off asymmetry.
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const v = 0.5 * (a[i * n + j] + a[j * n + i])
      a[i * n + j] = v
      a[j * n + i] = v
    }

  const MAX_SWEEPS = 100
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let off = 0
    let diag = 0
    for (let i = 0; i < n; i++) {
      diag += a[i * n + i] * a[i * n + i]
      for (let j = i + 1; j < n; j++) off += a[i * n + j] * a[i * n + j]
    }
    if (off === 0 || off <= 1e-30 * (diag + off)) break
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q]
        if (apq === 0) continue
        const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq)
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p]
          const akq = a[k * n + q]
          a[k * n + p] = c * akp - s * akq
          a[k * n + q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k]
          const aqk = a[q * n + k]
          a[p * n + k] = c * apk - s * aqk
          a[q * n + k] = s * apk + c * aqk
        }
      }
    }
  }
  const ev = new Float64Array(n)
  for (let i = 0; i < n; i++) ev[i] = a[i * n + i]
  ev.sort()
  return ev
}
