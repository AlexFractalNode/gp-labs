/**
 * Kernel templates of the Daten-Lab (Spec §6, step 4). Every template is "+ White": the White term is the
 * observation noise sigma_n of the GpModel (sklearn noise_level = sigma_n²), starting at sigma_n = 1 like
 * sklearn's WhiteKernel(). Starting values are sklearn's defaults.
 */
import { GpError } from '../../core/errors'
import { isKernelSpec, MAX_ARD_DIM, type BaseKernel, type KernelSpec } from '../../core/kernels'

export type TemplateId = 'notebook' | 'rbf' | 'ard-rbf' | 'ard-matern52'

export const TEMPLATE_IDS: readonly TemplateId[] = ['notebook', 'rbf', 'ard-rbf', 'ard-matern52']

/** Natural-unit bounds of sigma_n (sklearn noise_level ∈ [1e-5, 1e5] is a variance). */
const SIGMA_N_BOUNDS: readonly [number, number] = [Math.sqrt(1e-5), Math.sqrt(1e5)]

/** Starting sigma_n of every template (sklearn WhiteKernel noise_level = 1). */
export const DEFAULT_SIGMA_N = 1

function ardFactor(kind: 'rbf' | 'matern52', d: number): BaseKernel {
  if (d > MAX_ARD_DIM) throw new GpError('InvalidInput', { reason: 'tooManyFeaturesForArd', features: d, max: MAX_ARD_DIM })
  const params: Record<string, number> = { sigma: 1 }
  for (let j = 0; j < d; j++) params[`ell_${j}`] = 1
  return { kind, params, ard: true }
}

/** Kernel of a template for d features (without the White term, which is sigma_n). */
export function templateKernel(id: TemplateId, d: number): KernelSpec {
  if (!(Number.isInteger(d) && d >= 1)) throw new GpError('InvalidInput', { reason: 'inputDim', value: d })
  switch (id) {
    case 'notebook':
      // Code 91: RBF() * DotProduct() + WhiteKernel(); sklearn's RBF has no amplitude, so sigma is fixed at 1.
      return {
        terms: [
          [
            { kind: 'rbf', params: { sigma: 1, ell: 1 }, fixed: ['sigma'] },
            { kind: 'linear', params: { sigma0: 1, c: 0 }, fixed: ['c'] },
          ],
        ],
      }
    case 'rbf':
      return { terms: [[{ kind: 'rbf', params: { sigma: 1, ell: 1 } }]] }
    case 'ard-rbf':
      return { terms: [[ardFactor('rbf', d)]] }
    case 'ard-matern52':
      return { terms: [[ardFactor('matern52', d)]] }
  }
  throw new GpError('InvalidInput', { reason: 'unknownTemplate', template: id })
}

export type BaukastenNotice = 'ardDropped' | 'activeDimsDropped' | 'warpDropped' | 'whiteToNoise'

/**
 * Adapts a Kernel-Baukasten spec for d-dimensional (standardised) data: every factor is made isotropic with one
 * shared ℓ (ARD lengths → their geometric mean), activeDims and input warps are dropped (warps act on the raw
 * 1D axis of the Baukasten and are meaningless on standardised features), and single-factor `white` terms
 * become the observation noise: sigmaN = sqrt(Σ σ²) over those terms (null if there are none).
 * Throws GpError('InvalidInput') for an invalid spec ('invalidSpec'), `white` inside a product
 * ('whiteInProduct') or a spec that consists of white terms only ('onlyWhite').
 */
export function fromBaukasten(spec: KernelSpec): { spec: KernelSpec; sigmaN: number | null; notices: BaukastenNotice[] } {
  if (!isKernelSpec(spec)) throw new GpError('InvalidInput', { reason: 'invalidSpec' })
  const notices = new Set<BaukastenNotice>()
  let whiteVar = 0
  let hasWhite = false
  const terms: BaseKernel[][] = []
  for (const term of spec.terms) {
    if (term.some((f) => f.kind === 'white')) {
      if (term.length > 1) throw new GpError('InvalidInput', { reason: 'whiteInProduct' })
      whiteVar += term[0].params.sigma ** 2
      hasWhite = true
      notices.add('whiteToNoise')
      continue
    }
    terms.push(term.map((f) => isotropic(f, notices)))
  }
  if (terms.length === 0) throw new GpError('InvalidInput', { reason: 'onlyWhite' })
  return { spec: { terms }, sigmaN: hasWhite ? Math.sqrt(whiteVar) : null, notices: [...notices] }
}

function isotropic(f: BaseKernel, notices: Set<BaukastenNotice>): BaseKernel {
  const params: Record<string, number> = {}
  let fixed = f.fixed ? [...f.fixed] : undefined
  if (f.ard) {
    notices.add('ardDropped')
    const ells = Object.keys(f.params).filter((k) => /^ell_\d+$/.test(k))
    let logSum = 0
    for (const [k, v] of Object.entries(f.params)) {
      if (ells.includes(k)) logSum += Math.log(v)
      else params[k] = v
    }
    params.ell = Math.exp(logSum / ells.length)
    if (fixed) {
      const ellFixed = fixed.some((k) => ells.includes(k))
      fixed = fixed.filter((k) => !ells.includes(k))
      if (ellFixed) fixed.push('ell')
    }
  } else Object.assign(params, f.params)
  if (f.activeDims) notices.add('activeDimsDropped')
  if (f.warp && f.warp.kind !== 'identity') notices.add('warpDropped')
  const out: BaseKernel = { kind: f.kind, params }
  if (fixed && fixed.length) out.fixed = fixed
  return out
}

/** Clamps sigma_n into its bounds. */
export function clampSigmaN(s: number): number {
  return Math.min(SIGMA_N_BOUNDS[1], Math.max(SIGMA_N_BOUNDS[0], s))
}
