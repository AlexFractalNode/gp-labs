import { describe, expect, it } from 'vitest'
import { isKernelSpec } from '../../src/core/kernels'
import { inspectAt } from '../../src/tools/playground/inspect'
import { loadPreset, PRESETS } from '../../src/tools/playground/presets'

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
