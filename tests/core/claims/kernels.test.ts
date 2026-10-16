/**
 * Proofs of the Kernel-Baukasten scenario texts (k1–k3), computed with the registry state
 * (`expectedKernelsSettings`) and the functions of the view (kernelMatrix, kernelSlice, validity check).
 */
import { describe, expect, it } from 'vitest'
import { checkValidity, kernelMatrix, type BaseKernel, type KernelSpec } from '../../../src/core/kernels'
import { fromRows } from '../../../src/core/linalg'
import { classifyEigenvalues, kernelSlice, lineInputs, validityInputs } from '../../../src/tools/kernels/compute'
import { KERNEL_PRESETS } from '../../../src/tools/kernels/presets'
import { expectedKernelsSettings } from '../../../src/tools/kernels/scenarioKey'
import { scenarioById } from '../../../src/tools/scenarios'
import { claim, claimChapter, expectAllClaimed } from './claim'

const expected = (id: string) => expectedKernelsSettings(scenarioById(id)!)

/** The single factor of the given kind in a spec. */
function factor(spec: KernelSpec, kind: BaseKernel['kind']): BaseKernel {
  const fs = spec.terms.flat().filter((f) => f.kind === kind)
  expect(fs, kind).toHaveLength(1)
  return fs[0]
}

/** k(a, b) at two exact points. */
const k = (spec: KernelSpec, a: number, b: number) => kernelMatrix(spec, fromRows([[a]]), fromRows([[b]])).data[0]

function verdict(spec: KernelSpec, domain: [number, number]) {
  const X = validityInputs(spec, domain)
  const r = checkValidity(kernelMatrix(spec, X, X, { sameSet: true }))
  const negatives = classifyEigenvalues(r.eigenvalues, r.eigenvalues.length).filter((b) => b.cls === 'negative').length
  return { ...r, negatives }
}

describe('kernels scenario claims', () => {
  it('k1: RBF with ℓ = 0.2 keeps 61 % of the variance at distance 0.2 and 4 % at 0.5', () => {
    claimChapter('k1')
    const { preset, spec } = expected('k1')
    expect(preset).toBe('expquad')
    const rbf = factor(spec, 'rbf')
    claim('k1', '0.2', rbf.params.ell, 1)

    // Exact points (the slice grid of the view does not hit 1.2 and 1.5).
    const x0 = 1
    const variance = k(spec, x0, x0)
    for (const [x, text, pct, closed] of [
      [1.2, '0.2', '61', Math.exp(-0.5)],
      [1.5, '0.5', '4', Math.exp(-3.125)],
    ] as const) {
      claim('k1', text, x - x0, 1)
      const ratio = k(spec, x, x0) / variance
      expect(ratio).toBeCloseTo(closed, 12)
      claim('k1', pct, 100 * ratio, 0)
    }
    // "Drag ℓ larger: the slice gets wider"
    const wider: KernelSpec = { terms: [[{ ...rbf, params: { ...rbf.params, ell: 2 * rbf.params.ell } }]] }
    expect(k(wider, 1.5, x0) / k(wider, x0, x0)).toBeGreaterThan(k(spec, 1.5, x0) / variance)
  })

  it('k2: linear + periodic variance 2 → 6 for x₀ = 0 → 2 (3 at the start); RBF × periodic: 1 and 0.88', () => {
    claimChapter('k2')
    const { preset, spec } = expected('k2')
    expect(preset).toBe('lin-plus-periodic')
    const domain = KERNEL_PRESETS[preset].domain
    claim('k2', '0.5', factor(spec, 'periodic').params.period, 1)
    const X = lineInputs(domain, 201)
    const variance = (s: KernelSpec, x0: number) => kernelSlice(s, X, [x0]).variance

    for (const [x0, xText, vText] of [
      [0, '0', '2'],
      [2, '2', '6'],
    ] as const) {
      claim('k2', xText, x0, 0)
      claim('k2', vText, variance(spec, x0), 0)
      expect(variance(spec, x0)).toBeCloseTo(Number(vText), 12)
    }
    // Start of the view: x₀ in the middle of the domain.
    const start = (domain[0] + domain[1]) / 2
    claim('k2', '1', start, 0)
    claim('k2', '3', variance(spec, start), 0)
    // "grows ... because the linear part increases with the distance from the origin"
    const vs = [0, 0.5, 1, 1.5, 2].map((x0) => variance(spec, x0))
    for (let i = 1; i < vs.length; i++) expect(vs[i]).toBeGreaterThan(vs[i - 1])
    expect(factor(spec, 'linear').params.c).toBe(0)

    const product = KERNEL_PRESETS['rbf-times-periodic'].spec
    for (const x0 of [0, 0.7, 1, 2]) {
      expect(variance(product, x0)).toBeCloseTo(1, 12)
      claim('k2', '1', variance(product, x0), 0)
    }
    const period = factor(product, 'periodic').params.period
    claim('k2', '0.5', period, 1)
    const corr = (d: number) => k(product, 1 + d, 1) / Math.sqrt(k(product, 1 + d, 1 + d) * k(product, 1, 1))
    claim('k2', '0.88', corr(period), 2)
    // "the pattern slowly fades": a further period correlates less
    expect(corr(2 * period)).toBeLessThan(corr(period))
  })

  it('k3: p = 2.5 is invalid (smallest eigenvalue ≈ −2 % of the largest), p = 2 valid', () => {
    claimChapter('k3')
    const { preset, spec } = expected('k3')
    expect(preset).toBe('power-exp')
    const domain = KERNEL_PRESETS[preset].domain
    claim('k3', '2.5', factor(spec, 'powexp').params.p, 1)
    const bad = verdict(spec, domain)
    expect(bad.valid).toBe(false)
    expect(bad.negatives).toBeGreaterThan(0)
    claim('k3', '-2', 100 * bad.minRel, 0)

    const presetSpec = KERNEL_PRESETS[preset].spec
    claim('k3', '2', factor(presetSpec, 'powexp').params.p, 0)
    const good = verdict(presetSpec, domain)
    expect(good.valid).toBe(true)
    expect(good.negatives).toBe(0)
  })

  it('every listed number is proven', () => {
    for (const id of ['k1', 'k2', 'k3']) expectAllClaimed(id)
  })
})
