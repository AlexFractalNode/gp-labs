import { describe, expect, it } from 'vitest'
import { isKernelSpec } from '../../src/core/kernels'
import { inspectAt } from '../../src/tools/playground/inspect'
import { loadPreset, PRESETS } from '../../src/tools/playground/presets'
import { computeGrid, computeMeanOnly, fitYDomain, logMarginalLikelihoodValue, resolveKernel } from '../../src/tools/playground/compute'
import { logMarginalLikelihood } from '../../src/core/gp'
import { fromRows } from '../../src/core/linalg'
import { encodeKernel } from '../../src/urlState'
import type { KernelSpec } from '../../src/core/kernels'

describe('playground presets', () => {
  it('kap9 inspector at x*=0 matches the textbook numbers', () => {
    const r = inspectAt(PRESETS.kap9(), 0)
    expect(r.mean).toBeCloseTo(0.8, 4)
    expect(r.sdF).toBeCloseTo(0.4472, 4)
    expect(r.sdY).toBeCloseTo(0.6708, 4)
    expect(r.weight).toBeCloseTo(0.8, 4)
  })

  it('unknown preset falls back to sine; null does not flag unknown', () => {
    const r = loadPreset('bogus')
    expect(r.unknown).toBe(true)
    expect(r.state.points).toHaveLength(500)
    expect(r.state.view).toEqual([0, 1])
    expect(loadPreset(null).unknown).toBe(false)
    expect(loadPreset('kap9').unknown).toBe(false)
  })

  it('without points inspectAt returns prior moments', () => {
    const s = PRESETS.kap9()
    s.points = []
    const r = inspectAt(s, 0)
    expect(r.mean).toBeCloseTo(0, 10)
    expect(r.sdF).toBeCloseTo(1, 10)
    expect(r.weight).toBeUndefined()
  })

  it('every preset has a valid kernel and fresh state', () => {
    for (const [name, make] of Object.entries(PRESETS)) {
      const s = make()
      expect(isKernelSpec(s.model.kernel), name).toBe(true)
      expect(make()).not.toBe(s)
    }
    expect(PRESETS.sine().truth).toBeTypeOf('function')
  })

  it('hyper presets use sine data with the specified (ell, sigma_f)', () => {
    const k = (n: 'hyper' | 'hyper-43' | 'hyper-45' | 'hyper-47') => PRESETS[n]().model.kernel.terms[0][0].params
    expect(k('hyper')).toEqual({ sigma: 2, ell: 1 })
    expect(k('hyper-43')).toEqual({ sigma: 2, ell: 1 })
    expect(k('hyper-45')).toEqual({ sigma: 2, ell: 0.001 })
    expect(k('hyper-47')).toEqual({ sigma: 5, ell: 0.01 })
    expect(PRESETS['hyper-45']().points).toHaveLength(500)
  })

  it('GLS-linear with too few points falls back to prior moments instead of throwing', () => {
    const s = PRESETS.kap9()
    s.model = { ...s.model, mean: { kind: 'gls', basis: 'linear' } }
    const r = inspectAt(s, 0)
    expect(r.fallback).toBe('glsUnderdetermined')
    expect(r.mean).toBe(0)
    expect(r.sdF).toBeCloseTo(1, 10)
    s.points = [{ x: 1, y: 1 }, { x: 1, y: 2 }]
    expect(inspectAt(s, 0).fallback).toBe('glsUnderdetermined')
    s.points = [{ x: 0, y: 1 }, { x: 1, y: 2 }]
    expect(inspectAt(s, 0).fallback).toBeUndefined()
  })
})

describe('playground view logic', () => {
  const base = PRESETS.kap9().model

  it('resolveKernel: missing or garbage kernel keeps the preset RBF', () => {
    expect(resolveKernel(null, base)).toEqual({ model: base, fromUrl: false, notices: [] })
    expect(resolveKernel('garbage', base)).toEqual({ model: base, fromUrl: false, notices: [] })
  })

  it('resolveKernel: single white term moves into sigma_n in quadrature', () => {
    const spec: KernelSpec = {
      terms: [[{ kind: 'matern32', params: { sigma: 1, ell: 0.5 } }], [{ kind: 'white', params: { sigma: 1.2 } }]],
    }
    const r = resolveKernel(encodeKernel(spec), base)
    expect(r.fromUrl).toBe(true)
    expect(r.notices).toEqual(['notice.whiteMerged'])
    expect(r.model.kernel.terms).toHaveLength(1)
    expect(r.model.kernel.terms[0][0].kind).toBe('matern32')
    expect(r.model.sigmaN).toBeCloseTo(Math.sqrt(0.25 + 1.44), 12)
  })

  it('resolveKernel: white in a product and 2D kernels are rejected', () => {
    const prod: KernelSpec = {
      terms: [[{ kind: 'rbf', params: { sigma: 1, ell: 1 } }, { kind: 'white', params: { sigma: 1 } }]],
    }
    expect(resolveKernel(encodeKernel(prod), base)).toEqual({ model: base, fromUrl: false, notices: ['notice.whiteInProduct'] })
    const ard: KernelSpec = { terms: [[{ kind: 'rbf', ard: true, params: { sigma: 1, ell_0: 1, ell_1: 2 } }]] }
    expect(resolveKernel(encodeKernel(ard), base).notices).toEqual(['notice.kernel2d'])
    const active: KernelSpec = { terms: [[{ kind: 'rbf', activeDims: [1], params: { sigma: 1, ell: 1 } }]] }
    expect(resolveKernel(encodeKernel(active), base).notices).toEqual(['notice.kernel2d'])
  })

  it('computeMeanOnly equals the full posterior mean (incl. GLS)', () => {
    const s = PRESETS.extrapolation()
    for (const mean of [s.model.mean, { kind: 'gls' as const, basis: 'linear' as const }]) {
      const model = { ...s.model, mean }
      const full = computeGrid(model, s.points, s.view, { samples: null, seed: 1 })
      const m = computeMeanOnly(model, s.points, full.xs)!
      for (let i = 0; i < m.length; i++) expect(m[i]).toBeCloseTo(full.mean[i], 10)
    }
  })

  it('computeGrid: GLS with one point falls back to the prior; samples are finite', () => {
    const s = PRESETS.kap9()
    const model = { ...s.model, mean: { kind: 'gls' as const, basis: 'linear' as const } }
    const r = computeGrid(model, s.points, s.view, { samples: 'posterior', seed: 3, cov: true })
    expect(r.glsFallback).toBe(true)
    expect(r.prior).toBe(true)
    expect(r.samples).toHaveLength(5)
    expect(r.samples.every((row) => row.every(Number.isFinite))).toBe(true)
    expect(r.cov?.rows).toBe(100)
    // No points at all: prior with s_f = σ = 1.
    const p = computeGrid(s.model, [], s.view, { samples: null, seed: 1 })
    expect(p.prior).toBe(true)
    expect(p.sdF.every((v) => Math.abs(v - 1) < 1e-12)).toBe(true)
  })

  it('computeGrid: two identical x at minimal noise succeed with jitter or exactly', () => {
    const s = PRESETS.kap9()
    const model = { ...s.model, sigmaN: Math.sqrt(1e-5) }
    const r = computeGrid(model, [{ x: 0.5, y: 1 }, { x: 0.5, y: 1 }], s.view, { samples: 'posterior', seed: 1 })
    expect(r.mean.every(Number.isFinite)).toBe(true)
    expect(r.samplesFailed || r.samples.length === 5).toBe(true)
  })

  it('fitYDomain holds points and prior band', () => {
    const s = PRESETS['mean-demo']()
    const [lo, hi] = fitYDomain(s.model, s.points, s.view)
    expect(lo).toBeLessThanOrEqual(20.1 - 0)
    expect(hi).toBeGreaterThanOrEqual(22 + 2 * Math.sqrt(1.04))
  })
})

describe('playground log-ML value', () => {
  it('equals the core log marginal likelihood (prescribed and GLS mean); null without points', () => {
    const s = PRESETS['mean-demo']()
    const X = fromRows(s.points.map((p) => [p.x]))
    const y = Float64Array.from(s.points.map((p) => p.y))
    for (const mean of [s.model.mean, { kind: 'gls' as const, basis: 'linear' as const }]) {
      const model = { ...s.model, mean }
      expect(logMarginalLikelihoodValue(model, s.points)).toBeCloseTo(logMarginalLikelihood(model, X, y).value, 10)
    }
    expect(logMarginalLikelihoodValue(s.model, [])).toBeNull()
    expect(logMarginalLikelihoodValue({ ...s.model, mean: { kind: 'gls', basis: 'linear' } }, [s.points[0]])).toBeNull()
  })
})
