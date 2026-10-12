/**
 * Kernel-Baukasten presets (Spec §5): one preset per covariance example of the notebook gallery (Code 53–70, PyMC
 * conventions as in Task 5) plus the combinations of Kap. 13.4 and the power-exponential validity demo (Kap. 8.5).
 * Location/shape parameters are always listed in `fixed`; a linear σ₀ of 0 is valid only when fixed.
 */
import type { BaseKernel, KernelSpec } from '../../core/kernels'
import { notify } from '../../notify'

export type PresetGroup = 'gallery' | 'combination' | 'validity'

export interface KernelPreset {
  spec: KernelSpec
  /** Domain of x (1D) or of x₁ (2D). */
  domain: [number, number]
  /** Domain of x₂; only for presets with two input dimensions. */
  domain2?: [number, number]
  /** Textbook section and notebook code number ('' when the preset has no notebook cell). */
  ref: { chapter: string; code: string }
  group: PresetGroup
  /** Start seed of the sample normals u (default 1). */
  seed?: number
}

const SQRT2 = Math.SQRT2

const one = (f: BaseKernel): KernelSpec => ({ terms: [[f]] })
const rbf = (sigma: number, ell: number): BaseKernel => ({ kind: 'rbf', params: { sigma, ell } })
const constant = (c: number): BaseKernel => ({ kind: 'constant', params: { c } })
/** Linear kernel; σ₀ is fixed (and may then be 0) unless `freeSigma0`. */
const linear = (sigma0: number, c: number, freeSigma0 = false): BaseKernel => ({
  kind: 'linear',
  params: { sigma0, c },
  fixed: freeSigma0 ? ['c'] : ['sigma0', 'c'],
})
const cosine = (sigma: number, ell: number): BaseKernel => ({ kind: 'cosine', params: { sigma, ell } })
const periodic = (sigma: number, ell: number, period: number): BaseKernel => ({
  kind: 'periodic',
  params: { sigma, ell, period },
})

const D02: [number, number] = [0, 2]
const gallery = (spec: KernelSpec, chapter: string, code: string, domain = D02): KernelPreset => ({
  spec,
  domain,
  ref: { chapter, code },
  group: 'gallery',
})

export const KERNEL_PRESETS: Readonly<Record<string, KernelPreset>> = {
  matern52: gallery(one({ kind: 'matern52', params: { sigma: SQRT2, ell: 0.2 } }), '13.2', '53'),
  matern32: gallery(one({ kind: 'matern32', params: { sigma: SQRT2, ell: 0.2 } }), '13.2', '54'),
  expquad: gallery(one(rbf(2, 0.2)), '13.2', '55'),
  white: gallery(one({ kind: 'white', params: { sigma: 2 } }), '13.2', '56'),
  constant: gallery(one(constant(2)), '13.2', '57'),
  ratquad: gallery(one({ kind: 'rq', params: { sigma: SQRT2, ell: 0.2, alpha: 0.1 } }), '13.2', '58'),
  exponential: gallery(one({ kind: 'exponential', params: { sigma: 1, ell: 0.2 } }), '13.2', '59'),
  cosine: gallery(one(cosine(1, 0.5)), '13.2', '60'),
  linear: gallery({ terms: [[constant(2), linear(0, 1)]] }, '13.2', '61'),
  polynomial: gallery(
    {
      terms: [
        [
          constant(0.1),
          { kind: 'polynomial', params: { c: 1, offset: 1, degree: 3 }, fixed: ['c', 'offset', 'degree'] },
        ],
      ],
    },
    '13.2',
    '62',
  ),
  'cos-times-matern': gallery(
    { terms: [[{ kind: 'matern32', params: { sigma: 1, ell: 0.5 } }, cosine(1, 0.2)]] },
    '13.4',
    '63',
  ),
  warped: gallery(one({ ...rbf(1, 0.2), warp: { kind: 'tanh', a: 1, b: 5, c: 1 } }), '13.4', '64'),
  'periodic-warp': gallery(one({ ...rbf(1, 0.4), warp: { kind: 'circle', period: 0.5 } }), '13.3', '65'),
  // PyMC's Periodic uses ℓ_periodic = ℓ_warp / 2, so this equals 'periodic-warp' (Code 66 prints the difference).
  periodic: gallery(one(periodic(1, 0.2, 0.5)), '13.3', '66'),
  gibbs: gallery(
    one({ kind: 'gibbs', params: { sigma: 1, l1: 0.05, l2: 0.6, w: 0.3, x0: 1 }, fixed: ['x0'] }),
    '13.4',
    '67',
  ),
  'ard-2d': {
    ...gallery(one({ kind: 'rbf', params: { sigma: 1, ell_0: 0.2, ell_1: 1 }, ard: true }), '13.5', '68', [0, 1]),
    domain2: [1, 3],
    // Seed 1 happens to give an all-positive sample; seed 2 crosses zero and shows the fast x₁ / slow x₂ change.
    seed: 2,
  },
  'active-dim': {
    ...gallery(one({ ...rbf(1, 0.2), activeDims: [0] }), '13.5', '69', [0, 1]),
    domain2: [1, 3],
  },
  'lin-times-cos': gallery({ terms: [[constant(0.5), linear(0, 0), cosine(1, 0.5)]] }, '13.4', '70', [-2, 2]),
  'lin-plus-periodic': {
    spec: { terms: [[linear(1, 0, true)], [periodic(1, 1, 0.5)]] },
    domain: D02,
    ref: { chapter: '13.4', code: '' },
    group: 'combination',
  },
  'rbf-times-periodic': {
    spec: { terms: [[rbf(1, 1), periodic(1, 1, 0.5)]] },
    domain: D02,
    ref: { chapter: '13.4', code: '' },
    group: 'combination',
  },
  'power-exp': {
    spec: one({ kind: 'powexp', params: { sigma: 1, ell: 0.5, p: 2 }, fixed: ['p'] }),
    domain: D02,
    ref: { chapter: '8.5', code: '' },
    group: 'validity',
  },
}

export const DEFAULT_KERNEL_PRESET = 'expquad'

export type LoadedKernelPreset = KernelPreset & { name: string }

/** Deep copy, so that edits in the builder never reach the preset table. */
function copyPreset(name: string): LoadedKernelPreset {
  const p = KERNEL_PRESETS[name]
  return { ...(JSON.parse(JSON.stringify(p)) as KernelPreset), name }
}

/**
 * Resolves a preset name. null means "no preset given" (expquad, no notice); an unknown name falls back to expquad
 * and raises the invalid-URL notice.
 */
export function loadKernelPreset(name: string | null): { preset: LoadedKernelPreset; unknown: boolean } {
  if (name !== null && Object.prototype.hasOwnProperty.call(KERNEL_PRESETS, name)) {
    return { preset: copyPreset(name), unknown: false }
  }
  if (name === null) return { preset: copyPreset(DEFAULT_KERNEL_PRESET), unknown: false }
  notify('notice.invalidUrl')
  return { preset: copyPreset(DEFAULT_KERNEL_PRESET), unknown: true }
}
