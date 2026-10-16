/**
 * Proofs of the Playground scenario texts (p1–p3), computed with exactly the state the registry describes
 * (`expectedPlaygroundSettings`) and the same functions the view uses (inspectAt, fitTraining, log ML).
 */
import { describe, expect, it } from 'vitest'
import { logMarginalLikelihood, posterior, type GpModel } from '../../../src/core/gp'
import type { KernelSpec } from '../../../src/core/kernels'
import { fromRows } from '../../../src/core/linalg'
import { fitTraining, logMarginalLikelihoodValue, type Point } from '../../../src/tools/playground/compute'
import { inspectAt } from '../../../src/tools/playground/inspect'
import { loadPreset, PRESETS, type PlaygroundState } from '../../../src/tools/playground/presets'
import { expectedPlaygroundSettings } from '../../../src/tools/playground/scenarioKey'
import { scenarioById } from '../../../src/tools/scenarios'
import { claim, claimChapter, expectAllClaimed } from './claim'

/** The view state of a Playground scenario: preset defaults with the expected points and model. */
function stateOf(id: string): { state: PlaygroundState; pinnedX: number | null } {
  const s = scenarioById(id)!
  const e = expectedPlaygroundSettings(s)
  const { state } = loadPreset(s.query.preset ?? null)
  return {
    state: { ...state, points: e.points, model: { kernel: e.kernel, sigmaN: e.sigmaN, mean: e.mean } },
    pinnedX: e.pinnedX,
  }
}

const rbfOf = (k: KernelSpec) => {
  expect(k.terms).toHaveLength(1)
  expect(k.terms[0]).toHaveLength(1)
  expect(k.terms[0][0].kind).toBe('rbf')
  return k.terms[0][0].params
}

const logMLOf = (model: GpModel, points: Point[]) => {
  const v = logMarginalLikelihoodValue(fitTraining(model, points))
  expect(v).not.toBeNull()
  return v!
}

/** Notebook code number of a hyper preset ('hyper-45' → 45). */
const codeOf = (name: string) => {
  const m = /^hyper-(\d+)$/.exec(name)
  expect(m, name).not.toBeNull()
  return Number(m![1])
}

describe('playground scenario claims', () => {
  it('p1: one point at (0, 1); x* = 0 gives 0.800 / 0.447 / 0.671 and weight 0.8; probes x* = 1 and 3', () => {
    claimChapter('p1')
    const { state, pinnedX } = stateOf('p1')
    expect(state.points).toHaveLength(1)
    const [pt] = state.points
    claim('p1', '0', pt.x, 0)
    claim('p1', '1', pt.y, 0)
    expect(pinnedX).not.toBeNull()
    claim('p1', '0', pinnedX!, 0)

    const r0 = inspectAt(state, pinnedX!)
    claim('p1', '0.800', r0.mean, 3)
    claim('p1', '0.447', r0.sdF, 3)
    claim('p1', '0.671', r0.sdY, 3)
    expect(r0.weight).toBeDefined()
    claim('p1', '0.8', r0.weight!, 1)
    // "the mean is 0.8 times the measured value" (zero prior mean) and "s_f shrinks below the prior width"
    expect(r0.mean).toBeCloseTo(r0.weight! * pt.y, 12)
    expect(r0.onePoint).toBeDefined()
    expect(r0.sdF).toBeLessThan(Math.sqrt(r0.onePoint!.kStarStar))

    const x1 = 1
    claim('p1', '1', x1, 0)
    const r1 = inspectAt(state, x1)
    claim('p1', '0.485', r1.mean, 3)
    claim('p1', '0.840', r1.sdF, 3)
    expect(r1.mean).toBeLessThan(r0.mean)
    expect(r1.sdF).toBeGreaterThan(r0.sdF)

    const x3 = 3
    claim('p1', '3', x3, 0)
    const r3 = inspectAt(state, x3)
    // "f̄* ≈ 0 and s_f ≈ 1": almost the prior (mean 0, sd σ = 1)
    expect(Math.abs(r3.mean)).toBeLessThan(0.01)
    claim('p1', '0', Math.abs(r3.mean), 0)
    expect(r3.sdF).toBeGreaterThan(0.99)
    claim('p1', '1', r3.sdF, 0)
    claim('p1', '1', Math.sqrt(r3.onePoint!.kStarStar), 0)
  })

  it('p2: four points in [−1, 0.5]; at x* = 3 the prior (0, 1.000, 1.005); s_f 0.099 at x* = 0.5', () => {
    claimChapter('p2')
    const { state, pinnedX } = stateOf('p2')
    expect(state.points).toHaveLength(4)
    const xs = state.points.map((p) => p.x)
    claim('p2', '-1', Math.min(...xs), 0)
    expect(Math.max(...xs)).toBe(0.5)
    claim('p2', '0.5', Math.max(...xs), 1)
    expect(pinnedX).not.toBeNull()
    claim('p2', '3', pinnedX!, 0)

    const r3 = inspectAt(state, pinnedX!)
    expect(Math.abs(r3.mean)).toBeLessThan(5e-4)
    claim('p2', '0', Math.abs(r3.mean), 0)
    claim('p2', '1.000', r3.sdF, 3)
    claim('p2', '1.005', r3.sdY, 3)

    // "At the rightmost data point, x* = 0.5"
    const right = Math.max(...xs)
    expect(right).toBe(0.5)
    claim('p2', '0.5', right, 1)
    const r05 = inspectAt(state, right)
    claim('p2', '0.099', r05.sdF, 3)
    // "the further x* moves away from the data, the closer the band gets to the prior width"
    const sds = [right, 1, 1.5, 2, 3].map((x) => inspectAt(state, x).sdF)
    for (let i = 1; i < sds.length; i++) expect(sds[i]).toBeGreaterThan(sds[i - 1])

    // "constant or GLS constant: far from the data the prediction heads for that value instead of 0"
    const X = fromRows(state.points.map((p) => [p.x]))
    const y = Float64Array.from(state.points.map((p) => p.y))
    const far = fromRows([[5]])
    const c = 0.7
    const constant = posterior({ ...state.model, mean: { kind: 'constant', c } }, X, y, far)
    expect(constant.mean[0]).toBeCloseTo(c, 4)
    const gls = posterior({ ...state.model, mean: { kind: 'gls', basis: 'constant' } }, X, y, far)
    expect(gls.eta).toBeDefined()
    expect(Math.abs(gls.eta![0])).toBeGreaterThan(0.1)
    expect(gls.mean[0]).toBeCloseTo(gls.eta![0], 4)
  })

  it('p3: log ML of Code 43/45/47 and of the maximum near ℓ ≈ 0.10', () => {
    claimChapter('p3')
    const s = scenarioById('p3')!
    const { state } = stateOf('p3')
    claim('p3', '43', codeOf(s.query.preset), 0)
    claim('p3', '500', state.points.length, 0)
    const p43 = rbfOf(state.model.kernel)
    claim('p3', '1', p43.ell, 0)
    const lml43 = logMLOf(state.model, state.points)
    claim('p3', '-1553.4', lml43, 1)

    const p45 = PRESETS['hyper-45']()
    claim('p3', '45', codeOf('hyper-45'), 0)
    claim('p3', '0.001', rbfOf(p45.model.kernel).ell, 3)
    const lml45 = logMLOf(p45.model, p45.points)
    claim('p3', '-868.3', lml45, 1)

    const p47 = PRESETS['hyper-47']()
    claim('p3', '47', codeOf('hyper-47'), 0)
    claim('p3', '0.01', rbfOf(p47.model.kernel).ell, 2)
    claim('p3', '5', rbfOf(p47.model.kernel).sigma, 0)
    const lml47 = logMLOf(p47.model, p47.points)
    claim('p3', '-531.9', lml47, 1)
    // Same data in all three presets.
    expect(p45.points).toEqual(state.points)
    expect(p47.points).toEqual(state.points)

    // The maximum: measured on 2026-10-16 with optimizeHyperparameters from hyper-43 as the Playground worker runs
    // it (restarts 3, seed 1): it ends at ℓ = 0.1035, σ = 1.616, σₙ = 0.407, log ML −294.47, which backs
    // "Optimise hyperparameters finds it". That run takes about 4 minutes in Vitest (500 points), too slow for the
    // suite, so the optimiser is not run here; instead a vanishing gradient in log parameters shows that this
    // point is stationary.
    const best = { ell: 0.1035, sigma: 1.6162, sigmaN: 0.4074 }
    const model: GpModel = {
      kernel: { terms: [[{ kind: 'rbf', params: { sigma: best.sigma, ell: best.ell } }]] },
      sigmaN: best.sigmaN,
      mean: { kind: 'zero' },
    }
    claim('p3', '0.10', best.ell, 2)
    claim('p3', '1.62', best.sigma, 2)
    claim('p3', '0.41', best.sigmaN, 2)
    const lmlBest = logMLOf(model, state.points)
    claim('p3', '-294.5', lmlBest, 1)
    const X = fromRows(state.points.map((p) => [p.x]))
    const y = Float64Array.from(state.points.map((p) => p.y))
    const { value, grad } = logMarginalLikelihood(model, X, y)
    expect(value).toBeCloseTo(lmlBest, 8)
    expect(grad.length).toBe(3)
    for (const g of grad) expect(Math.abs(g)).toBeLessThan(0.5)
    expect(lmlBest).toBeGreaterThan(Math.max(lml43, lml45, lml47))
    // "both [small length scales] stay far below the maximum"
    expect(lmlBest - Math.max(lml45, lml47)).toBeGreaterThan(200)
  })

  it('every listed number is proven', () => {
    for (const id of ['p1', 'p2', 'p3']) expectAllClaimed(id)
  })
})
