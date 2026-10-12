import { describe, expect, it } from 'vitest'
import { isKernelSpec } from '../../src/core/kernels'
import { inspectAt } from '../../src/tools/playground/inspect'
import { loadPreset, PRESETS } from '../../src/tools/playground/presets'
import {
  computeGrid,
  computeMeanOnly,
  fitTraining,
  fitYDomain,
  logMarginalLikelihoodValue,
  NO_NOTICE_FLAGS,
  noticeTransitions,
  resolveKernel,
} from '../../src/tools/playground/compute'
import { startTween } from '../../src/tools/playground/tween'
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

  it('computeMeanOnly from the shared fit equals the full posterior mean (incl. GLS)', () => {
    const s = PRESETS.extrapolation()
    for (const mean of [s.model.mean, { kind: 'gls' as const, basis: 'linear' as const }]) {
      const model = { ...s.model, mean }
      const tf = fitTraining(model, s.points)
      const full = computeGrid(model, s.points, s.view, { samples: null, seed: 1, training: tf })
      const ref = computeGrid(model, s.points, s.view, { samples: null, seed: 1 })
      const m = computeMeanOnly(model, full.xs, tf)!
      for (let i = 0; i < m.length; i++) {
        expect(m[i]).toBeCloseTo(full.mean[i], 10)
        expect(full.mean[i]).toBe(ref.mean[i])
      }
    }
  })

  it('computeMeanOnly returns null for an underdetermined GLS mean (caller must recompute fully later)', () => {
    const s = PRESETS.kap9()
    const model = { ...s.model, mean: { kind: 'gls' as const, basis: 'linear' as const } }
    const tf = fitTraining(model, s.points)
    expect(tf.glsUnderdetermined).toBe(true)
    expect(computeMeanOnly(model, Float64Array.from([0, 1]), tf)).toBeNull()
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

  it('two identical x with (near) zero noise need jitter, and jitter > 0 raises the notice once (Review Focus 2)', () => {
    const s = PRESETS.kap9()
    // σn = 1e-9 makes C_X = K + 1e-18 I singular for duplicate x, so the Cholesky fallback must add jitter.
    const model = { ...s.model, sigmaN: 1e-9 }
    const r = computeGrid(model, [{ x: 0.5, y: 1 }, { x: 0.5, y: 1 }], s.view, { samples: 'posterior', seed: 1 })
    expect(r.jitter).toBeGreaterThan(0)
    expect(r.mean.every(Number.isFinite)).toBe(true)
    expect(r.samplesFailed || r.samples.length === 5).toBe(true)
    const first = noticeTransitions(NO_NOTICE_FLAGS, r)
    expect(first.raised).toContain('jitter')
    // Same condition on the next recompute: no repeated notice.
    expect(noticeTransitions(first.next, r).raised).toEqual([])
    // Condition gone and back: raised again.
    const clear = noticeTransitions(first.next, { jitter: 0, glsFallback: false, samplesFailed: false })
    expect(noticeTransitions(clear.next, r).raised).toContain('jitter')
  })

  it('noticeTransitions raises the GLS notice only on false -> true', () => {
    const gls = { jitter: 0, glsFallback: true, samplesFailed: false }
    const a = noticeTransitions(NO_NOTICE_FLAGS, gls)
    expect(a.raised).toEqual(['gls'])
    expect(noticeTransitions(a.next, gls).raised).toEqual([])
  })

  it('fitYDomain holds points and prior band', () => {
    const s = PRESETS['mean-demo']()
    const [lo, hi] = fitYDomain(s.model, s.points, s.view)
    const minY = Math.min(...s.points.map((p) => p.y))
    const maxY = Math.max(...s.points.map((p) => p.y))
    expect(s.model.mean.kind).toBe('constant')
    const c = s.model.mean.kind === 'constant' ? s.model.mean.c : NaN
    const sigma = s.model.kernel.terms[0][0].params.sigma
    const priorSdY = Math.sqrt(sigma ** 2 + s.model.sigmaN ** 2)
    expect(lo).toBeLessThanOrEqual(Math.min(minY, c - 2 * priorSdY))
    expect(hi).toBeGreaterThanOrEqual(Math.max(maxY, c + 2 * priorSdY))
  })
})

describe('playground log-ML value and inspector fit reuse', () => {
  it('log-ML value from the shared fit equals the core log marginal likelihood; null without a fit', () => {
    const s = PRESETS['mean-demo']()
    const X = fromRows(s.points.map((p) => [p.x]))
    const y = Float64Array.from(s.points.map((p) => p.y))
    for (const mean of [s.model.mean, { kind: 'gls' as const, basis: 'linear' as const }]) {
      const model = { ...s.model, mean }
      expect(logMarginalLikelihoodValue(fitTraining(model, s.points))).toBeCloseTo(logMarginalLikelihood(model, X, y).value, 10)
    }
    expect(logMarginalLikelihoodValue(fitTraining(s.model, []))).toBeNull()
    expect(logMarginalLikelihoodValue(fitTraining({ ...s.model, mean: { kind: 'gls', basis: 'linear' } }, [s.points[0]]))).toBeNull()
  })

  it('inspectAt with a passed fit equals the standalone result and returns the Kap. 9 terms', () => {
    const s = PRESETS.kap9()
    const fit = fitTraining(s.model, s.points).fit!
    const a = inspectAt(s, 0, { fit })
    const b = inspectAt(s, 0)
    expect(a).toEqual(b)
    expect(a.onePoint).toEqual({ kStar1: 1, k11: 1, kStarStar: 1, mStar: 0, m1: 0 })
    // w = k*1 / (k11 + σn²), f̄ = m* + w (y1 − m1), s_f² = k** − w k*1
    const op = a.onePoint!
    expect(a.weight).toBeCloseTo(op.kStar1 / (op.k11 + s.model.sigmaN ** 2), 12)
    expect(a.mean).toBeCloseTo(op.mStar + a.weight! * (s.points[0].y - op.m1), 12)
    expect(a.sdF ** 2).toBeCloseTo(op.kStarStar - a.weight! * op.kStar1, 12)
    // GLS mean: no prescribed m, so no one-point terms.
    expect(inspectAt({ ...s, model: { ...s.model, mean: { kind: 'gls', basis: 'constant' } } }, 0).onePoint).toBeUndefined()
  })
})

describe('slider tween', () => {
  function fakeFrames() {
    let t = 0
    let next = 1
    const queue = new Map<number, (now: number) => void>()
    return {
      requestFrame: (cb: (now: number) => void) => {
        const id = next++
        queue.set(id, cb)
        return id
      },
      cancelFrame: (id: number) => void queue.delete(id),
      now: () => t,
      advance(ms: number) {
        t += ms
        const due = [...queue.values()]
        queue.clear()
        for (const cb of due) cb(t)
      },
      pending: () => queue.size,
    }
  }

  it('applies eased values and finishes once after the duration', () => {
    const f = fakeFrames()
    const applied: number[] = []
    let finished = 0
    const h = startTween({ from: [0], to: [1], durationMs: 400, apply: (v) => applied.push(v[0]), finish: () => finished++, ...f })
    f.advance(200)
    expect(applied).toEqual([0.5])
    f.advance(250)
    expect(finished).toBe(1)
    expect(h.active).toBe(false)
    expect(f.pending()).toBe(0)
  })

  it('cancel stops all further apply/finish calls (a stale optimum is never applied)', () => {
    const f = fakeFrames()
    const applied: number[] = []
    let finished = 0
    const h = startTween({ from: [0], to: [1], durationMs: 400, apply: (v) => applied.push(v[0]), finish: () => finished++, ...f })
    f.advance(100)
    h.cancel()
    expect(f.pending()).toBe(0)
    f.advance(1000)
    expect(applied).toHaveLength(1)
    expect(finished).toBe(0)
    expect(h.active).toBe(false)
  })
})
