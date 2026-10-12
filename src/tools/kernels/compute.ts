/**
 * Pure helpers of the Kernel-Baukasten: input grids, prior samples with fixed standard normals (x = m + L u, so
 * parameter changes morph the curves continuously), kernel slices and the eigenvalue classification of the
 * validity display (Global Constraints: |λ| ≤ 1e-8·max|λ| counts as zero, below −1e-8·max|λ| is negative).
 */
import { GpError } from '../../core/errors'
import { drawSamples } from '../../core/gp'
import { kernelDiag, kernelMatrix, VALIDITY_TOL, type KernelSpec } from '../../core/kernels'
import { zeros, type Mat } from '../../core/linalg'
import type { MessageKey } from '../../i18n'

/** Points of the validity check (1D: 100 points; 2D: 10 × 10). */
export const VALIDITY_N = 100
/** Grid of the 1D prior samples and covariance heatmap. */
export const SAMPLE_N = 200
/** Number of 1D prior samples. */
export const SAMPLE_COUNT = 5
/** Side of the 2D sample grid (40 × 40 = 1600 points). */
export const GRID_2D = 40
/** Number of smallest eigenvalues shown as bars. */
export const EIGEN_BARS = 30

export function linspace(a: number, b: number, n: number): Float64Array {
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = n === 1 ? a : a + ((b - a) * i) / (n - 1)
  // Exact end point (no round-off in a + (b − a)).
  if (n > 1) out[n - 1] = b
  return out
}

/** 2 when any factor selects dimensions or uses ARD length scales (2D mode), else 1. */
export function inputDimOf(spec: KernelSpec): 1 | 2 {
  return spec.terms.some((t) => t.some((f) => f.ard === true || f.activeDims !== undefined)) ? 2 : 1
}

/** n × 1 input matrix of equally spaced points on the domain. */
export function lineInputs(domain: [number, number], n: number): Mat {
  const xs = linspace(domain[0], domain[1], n)
  return { rows: n, cols: 1, data: xs }
}

/**
 * Inputs of the validity check: 100 points on the 1D domain, or a 10 × 10 grid on domain × domain2
 * (x₁ varies fastest, x₂ ascending, as numpy meshgrid + reshape in Code 68).
 */
export function validityInputs(spec: KernelSpec, domain: [number, number], domain2?: [number, number]): Mat {
  if (inputDimOf(spec) === 1) return lineInputs(domain, VALIDITY_N)
  const m = Math.round(Math.sqrt(VALIDITY_N))
  const x1 = linspace(domain[0], domain[1], m)
  const d2 = domain2 ?? domain
  const x2 = linspace(d2[0], d2[1], m)
  const X = zeros(m * m, 2)
  for (let i = 0; i < m; i++)
    for (let j = 0; j < m; j++) {
      X.data[2 * (i * m + j)] = x1[j]
      X.data[2 * (i * m + j) + 1] = x2[i]
    }
  return X
}

/**
 * m × m grid on domain × domain2 for heatmaps: row 0 is the largest x₂ (top of the picture), x₁ grows to the
 * right; point (row i, column j) has index i·m + j.
 */
export function sampleInputs(domain: [number, number], domain2: [number, number], m: number): Mat {
  const x1 = linspace(domain[0], domain[1], m)
  const x2 = linspace(domain2[1], domain2[0], m)
  const X = zeros(m * m, 2)
  for (let i = 0; i < m; i++)
    for (let j = 0; j < m; j++) {
      X.data[2 * (i * m + j)] = x1[j]
      X.data[2 * (i * m + j) + 1] = x2[i]
    }
  return X
}

/** Mean of the diagonal: the jitter scale of the prior covariance (Global Constraints). */
export function meanDiag(K: Mat): number {
  let s = 0
  for (let i = 0; i < K.rows; i++) s += K.data[i * K.cols + i]
  return K.rows ? s / K.rows : 1
}

/** Prior samples with zero mean: row k is L u_k. Throws GpError('NotPositiveDefinite') if K cannot be factorised. */
export function priorSamples(K: Mat, u: Mat): Float64Array[] {
  const S = drawSamples(new Float64Array(K.rows), K, u, meanDiag(K))
  return Array.from({ length: S.rows }, (_, k) => S.data.slice(k * S.cols, (k + 1) * S.cols))
}

/** k(x_i, x₀) for all rows of X (x₀ one input point) and the variance k(x₀, x₀) (white noise included). */
export function kernelSlice(spec: KernelSpec, X: Mat, x0: number[]): { values: Float64Array; variance: number } {
  const P: Mat = { rows: 1, cols: x0.length, data: Float64Array.from(x0) }
  const K = kernelMatrix(spec, X, P)
  return { values: K.data, variance: kernelDiag(spec, P)[0] }
}

export type EigenClass = 'negative' | 'zero' | 'positive'
export interface EigenBar {
  /** 1-based rank from the smallest eigenvalue. */
  index: number
  value: number
  /** λ / max|λ|. */
  rel: number
  cls: EigenClass
}

/** The `count` smallest eigenvalues (input sorted ascending) with their relative size and class. */
export function classifyEigenvalues(eigenvalues: Float64Array, count = EIGEN_BARS): EigenBar[] {
  let maxAbs = 0
  for (const l of eigenvalues) maxAbs = Math.max(maxAbs, Math.abs(l))
  const out: EigenBar[] = []
  for (let i = 0; i < Math.min(count, eigenvalues.length); i++) {
    const value = eigenvalues[i]
    const rel = maxAbs > 0 ? value / maxAbs : 0
    const cls: EigenClass = rel < -VALIDITY_TOL ? 'negative' : rel <= VALIDITY_TOL ? 'zero' : 'positive'
    out.push({ index: i + 1, value, rel, cls })
  }
  return out
}

/** Message key of a core error raised while evaluating a kernel. */
export function errorKey(e: unknown): MessageKey {
  if (e instanceof GpError) {
    if (e.code === 'NotPositiveDefinite') return 'error.numerical'
    const reason = e.details?.reason
    if (reason === 'logWarpDomain') return 'error.logDomain'
    if (reason === 'warpRequires1D' || reason === 'gibbsRequires1D') return 'error.needs1D'
  }
  return 'error.invalidKernel'
}
