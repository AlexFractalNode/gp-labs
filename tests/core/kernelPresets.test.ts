import { describe, expect, it } from 'vitest'
import { checkValidity, isKernelSpec, kernelMatrix, type KernelSpec } from '../../src/core/kernels'
import { fromRows } from '../../src/core/linalg'
import { useNotices } from '../../src/notify'
import { KERNEL_PRESETS, loadKernelPreset } from '../../src/tools/kernels/presets'
import { classifyEigenvalues, inputDimOf, sampleInputs, validityInputs, VALIDITY_N } from '../../src/tools/kernels/compute'

const linspace = (a: number, b: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1))

const withP = (spec: KernelSpec, p: number): KernelSpec => {
  const next = JSON.parse(JSON.stringify(spec)) as KernelSpec
  next.terms[0][0].params.p = p
  return next
}

const CODES: Record<string, string> = {
  matern52: '53',
  matern32: '54',
  expquad: '55',
  white: '56',
  constant: '57',
  ratquad: '58',
  exponential: '59',
  cosine: '60',
  linear: '61',
  polynomial: '62',
  'cos-times-matern': '63',
  warped: '64',
  'periodic-warp': '65',
  periodic: '66',
  gibbs: '67',
  'ard-2d': '68',
  'active-dim': '69',
  'lin-times-cos': '70',
  'lin-plus-periodic': '',
  'rbf-times-periodic': '',
  'power-exp': '',
}

describe('kernel presets', () => {
  it('contains exactly the gallery, combination and validity presets with their code numbers', () => {
    expect(Object.keys(KERNEL_PRESETS).sort()).toEqual(Object.keys(CODES).sort())
    for (const [name, code] of Object.entries(CODES)) expect(KERNEL_PRESETS[name].ref.code, name).toBe(code)
  })

  it('every preset is a valid KernelSpec and a valid covariance on its domain (100 points)', () => {
    for (const [name, p] of Object.entries(KERNEL_PRESETS)) {
      expect(isKernelSpec(p.spec), name).toBe(true)
      const X = validityInputs(p.spec, p.domain, p.domain2)
      expect(X.rows, name).toBe(VALIDITY_N)
      const r = checkValidity(kernelMatrix(p.spec, X, X, { sameSet: true }))
      expect(r.valid, `${name} minRel ${r.minRel}`).toBe(true)
      // Review focus 6: rounding-level eigenvalues of a valid kernel are never classified as negative.
      expect(classifyEigenvalues(r.eigenvalues).filter((b) => b.cls === 'negative'), name).toEqual([])
    }
  })

  it('power-exp is valid for p ≤ 2 and invalid for p > 2', () => {
    const p = KERNEL_PRESETS['power-exp']
    const X = validityInputs(p.spec, p.domain)
    for (const [exp, valid] of [
      [0.5, true],
      [1, true],
      [2, true],
      [2.05, false],
      [3, false],
    ] as const) {
      const r = checkValidity(kernelMatrix(withP(p.spec, exp), X, X, { sameSet: true }))
      expect(r.valid, `p=${exp}`).toBe(valid)
    }
    const bad = checkValidity(kernelMatrix(withP(p.spec, 3), X, X, { sameSet: true }))
    expect(classifyEigenvalues(bad.eigenvalues).some((b) => b.cls === 'negative')).toBe(true)
  })

  it('periodic (ℓ 0.2) equals the circle-warped RBF (ℓ 0.4) on linspace(0, 2, 50) (Code 65/66)', () => {
    const X = fromRows(linspace(0, 2, 50).map((x) => [x]))
    const a = kernelMatrix(KERNEL_PRESETS.periodic.spec, X, X, { sameSet: true })
    const b = kernelMatrix(KERNEL_PRESETS['periodic-warp'].spec, X, X, { sameSet: true })
    let max = 0
    for (let i = 0; i < a.data.length; i++) max = Math.max(max, Math.abs(a.data[i] - b.data[i]))
    expect(max).toBeLessThan(1e-8)
  })

  it('linear presets with σ₀ = 0 list sigma0 as fixed; location parameters are fixed', () => {
    for (const name of ['linear', 'lin-times-cos']) {
      const lin = KERNEL_PRESETS[name].spec.terms.flat().find((f) => f.kind === 'linear')!
      expect(lin.params.sigma0).toBe(0)
      expect(lin.fixed).toContain('sigma0')
      expect(lin.fixed).toContain('c')
    }
    expect(KERNEL_PRESETS['power-exp'].spec.terms[0][0].fixed).toContain('p')
    expect(KERNEL_PRESETS.gibbs.spec.terms[0][0].fixed).toContain('x0')
    expect(KERNEL_PRESETS.polynomial.spec.terms[0][1].fixed).toEqual(['c', 'offset', 'degree'])
  })

  it('2D presets use x₁ ∈ [0, 1], x₂ ∈ [1, 3]; all others are 1D', () => {
    for (const [name, p] of Object.entries(KERNEL_PRESETS)) {
      const two = name === 'ard-2d' || name === 'active-dim'
      expect(inputDimOf(p.spec), name).toBe(two ? 2 : 1)
      if (two) {
        expect(p.domain).toEqual([0, 1])
        expect(p.domain2).toEqual([1, 3])
      }
    }
    expect(KERNEL_PRESETS['lin-times-cos'].domain).toEqual([-2, 2])
  })

  it('loadKernelPreset: known names give independent copies, unknown names fall back to expquad with a notice', () => {
    const a = loadKernelPreset('periodic')
    expect(a.unknown).toBe(false)
    expect(a.preset.name).toBe('periodic')
    a.preset.spec.terms[0][0].params.ell = 9
    expect(KERNEL_PRESETS.periodic.spec.terms[0][0].params.ell).toBe(0.2)

    expect(loadKernelPreset(null)).toMatchObject({ unknown: false, preset: { name: 'expquad' } })
    const notices = useNotices()
    notices.value = []
    const b = loadKernelPreset('bogus')
    expect(b.unknown).toBe(true)
    expect(b.preset.name).toBe('expquad')
    expect(b.preset.spec).toEqual(KERNEL_PRESETS.expquad.spec)
    expect(notices.value.map((n) => n.key)).toEqual(['notice.invalidUrl'])
    // Prototype keys are not presets.
    expect(loadKernelPreset('constructor').unknown).toBe(true)
  })
})

describe('kernel builder compute helpers', () => {
  it('validity grid: 100 points on the 1D domain, 10 × 10 on the 2D domain (x₁ fastest)', () => {
    const X1 = validityInputs(KERNEL_PRESETS.expquad.spec, [0, 2])
    expect([X1.rows, X1.cols]).toEqual([100, 1])
    expect(X1.data[0]).toBe(0)
    expect(X1.data[99]).toBeCloseTo(2, 12)
    const X2 = validityInputs(KERNEL_PRESETS['ard-2d'].spec, [0, 1], [1, 3])
    expect([X2.rows, X2.cols]).toEqual([100, 2])
    expect([X2.data[0], X2.data[1]]).toEqual([0, 1])
    expect(X2.data[2]).toBeCloseTo(1 / 9, 12)
    expect([X2.data[198], X2.data[199]]).toEqual([1, 3])
  })

  it('2D sample grid: 40 × 40, top row is the largest x₂, x₁ increases to the right', () => {
    const X = sampleInputs([0, 1], [1, 3], 40)
    expect([X.rows, X.cols]).toEqual([1600, 2])
    expect([X.data[0], X.data[1]]).toEqual([0, 3])
    expect([X.data[2 * 39], X.data[2 * 39 + 1]]).toEqual([1, 3])
    expect([X.data[2 * 1599], X.data[2 * 1599 + 1]]).toEqual([1, 1])
  })

  it('classifyEigenvalues: 30 smallest, |λ| ≤ 1e-8·max|λ| is zero, below is negative', () => {
    const eig = Float64Array.from([-1e-3, -1e-12, 0, 1e-12, 1e-4, ...Array.from({ length: 40 }, (_, i) => i + 1)])
    const bars = classifyEigenvalues(eig)
    expect(bars).toHaveLength(30)
    expect(bars.slice(0, 5).map((b) => b.cls)).toEqual(['negative', 'zero', 'zero', 'zero', 'positive'])
    expect(bars[0].rel).toBeCloseTo(-1e-3 / 40, 15)
    expect(classifyEigenvalues(new Float64Array(0))).toEqual([])
  })
})
