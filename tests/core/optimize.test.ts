import { describe, expect, it } from 'vitest'
import { GpError } from '../../src/core/errors'
import { logMarginalLikelihood, type GpModel } from '../../src/core/gp'
import { fromRows, type Mat } from '../../src/core/linalg'
import { lbfgsb, optimizeHyperparameters } from '../../src/core/optimize'
import { loadGolden } from '../helpers/golden'

const col = (xs: number[]): Mat => fromRows(xs.map((x) => [x]))
const rbfModel = (sigma: number, ell: number, sigmaN: number): GpModel => ({
  kernel: { terms: [[{ kind: 'rbf', params: { sigma, ell } }]] },
  sigmaN,
  mean: { kind: 'zero' },
})

function rosenbrock(x: Float64Array): { value: number; grad: Float64Array } {
  const [a, b] = [x[0], x[1]]
  const value = (1 - a) ** 2 + 100 * (b - a * a) ** 2
  const grad = Float64Array.from([-2 * (1 - a) - 400 * a * (b - a * a), 200 * (b - a * a)])
  return { value, grad }
}

describe('lbfgsb', () => {
  it('minimises Rosenbrock from (-1.2, 1) to (1, 1)', () => {
    const inf = Float64Array.from([-Infinity, -Infinity])
    const sup = Float64Array.from([Infinity, Infinity])
    const r = lbfgsb(rosenbrock, Float64Array.from([-1.2, 1]), inf, sup)
    expect(Math.abs(r.x[0] - 1)).toBeLessThan(1e-4)
    expect(Math.abs(r.x[1] - 1)).toBeLessThan(1e-4)
    expect(r.converged).toBe(true)
  })

  it('respects the upper bound x1 <= 0.5', () => {
    const r = lbfgsb(
      rosenbrock,
      Float64Array.from([-1.2, 1]),
      Float64Array.from([-Infinity, -Infinity]),
      Float64Array.from([0.5, Infinity]),
    )
    expect(r.x[0]).toBe(0.5)
    expect(Math.abs(r.x[1] - 0.25)).toBeLessThan(1e-4)
  })

  it('clamps the start into the bounds and treats non-finite values as +Infinity', () => {
    // f is NaN for x > 1; start outside the bounds; the minimum of (x-2)^2 on [0, 1] is at 1.
    const f = (x: Float64Array) => ({
      value: x[0] > 1 ? NaN : (x[0] - 2) ** 2,
      grad: Float64Array.from([2 * (x[0] - 2)]),
    })
    const r = lbfgsb(f, Float64Array.from([5]), Float64Array.from([0]), Float64Array.from([1]))
    expect(r.x[0]).toBe(1)
    expect(r.value).toBeCloseTo(1, 12)
  })

  it('treats a thrown GpError like a non-finite value, other errors propagate', () => {
    const f = (x: Float64Array) => {
      if (x[0] > 0.3) throw new GpError('NotPositiveDefinite')
      return { value: (x[0] - 1) ** 2, grad: Float64Array.from([2 * (x[0] - 1)]) }
    }
    const r = lbfgsb(f, Float64Array.from([0]), Float64Array.from([-10]), Float64Array.from([10]))
    expect(Number.isFinite(r.value)).toBe(true)
    expect(r.x[0]).toBeLessThanOrEqual(0.3)
    const g = () => {
      throw new TypeError('boom')
    }
    expect(() => lbfgsb(g, Float64Array.from([0]), Float64Array.from([-1]), Float64Array.from([1]))).toThrow(
      TypeError,
    )
  })
})

describe('optimizeHyperparameters', () => {
  it('beats the reference hyperparameters on the first 100 sine points', { timeout: 60_000 }, () => {
    const g = loadGolden('sine')
    const X = col(g.x.slice(0, 100))
    const y = Float64Array.from(g.y.slice(0, 100))
    const reference = logMarginalLikelihood(rbfModel(2, 0.1, 0.4), X, y).value
    const progress: { restart: number; logML: number }[] = []
    const res = optimizeHyperparameters(rbfModel(1, 1, 1), X, y, {
      restarts: 3,
      seed: 0,
      onProgress: (p) => progress.push(p),
    })
    expect(res.logML).toBeGreaterThanOrEqual(reference)
    expect(res.runs).toHaveLength(4)
    expect(progress.map((p) => p.restart)).toEqual([0, 1, 2, 3])
    expect(logMarginalLikelihood(res.model, X, y).value).toBeCloseTo(res.logML, 8)
  })

  it('clamps an out-of-bounds start (sigmaN = 0) and finishes with a finite logML', { timeout: 60_000 }, () => {
    const g = loadGolden('sine')
    const X = col(g.x.slice(0, 40))
    const y = Float64Array.from(g.y.slice(0, 40))
    const res = optimizeHyperparameters(rbfModel(1, 1, 0), X, y, { restarts: 0, seed: 1 })
    expect(Number.isFinite(res.logML)).toBe(true)
    expect(res.model.sigmaN).toBeGreaterThanOrEqual(Math.sqrt(1e-5) * (1 - 1e-12))
  })

  it('reports parameters at a bound in atBound', () => {
    // Constant targets: the best fit drives the noise to its lower bound or the length scale to its upper bound.
    const X = col([0, 1, 2, 3, 4, 5])
    const y = Float64Array.from([1, 1, 1, 1, 1, 1])
    const res = optimizeHyperparameters(rbfModel(1, 1, 0.1), X, y, { restarts: 1, seed: 2, maxIter: 300 })
    expect(res.atBound.length).toBeGreaterThan(0)
    for (const name of res.atBound) expect(['t0.f0.sigma', 't0.f0.ell', 'sigmaN']).toContain(name)
  })

  it('throws OptimizerFailed if no run produces a finite value', () => {
    // z = L⁻¹y overflows for every admissible parameter, so -logML is +Infinity everywhere.
    const X = col([0, 1])
    const y = Float64Array.from([1e200, -1e200])
    expect(() => optimizeHyperparameters(rbfModel(1, 1, 0.1), X, y, { restarts: 2, seed: 0 })).toThrow(
      expect.objectContaining({ code: 'OptimizerFailed' }),
    )
  })

  it('rejects invalid input up front instead of masking it as OptimizerFailed', () => {
    const y = Float64Array.from([0, 1])
    expect(() => optimizeHyperparameters(rbfModel(1, 1, 0.1), col([0, NaN]), y, { restarts: 0, seed: 0 })).toThrow(
      expect.objectContaining({ code: 'InvalidInput' }),
    )
  })

  it('stops early when shouldStop returns true and keeps the best run so far', () => {
    const g = loadGolden('sine')
    const X = col(g.x.slice(0, 30))
    const y = Float64Array.from(g.y.slice(0, 30))
    const res = optimizeHyperparameters(rbfModel(1, 1, 1), X, y, {
      restarts: 5,
      seed: 0,
      shouldStop: () => true,
    })
    expect(res.runs).toHaveLength(1)
    expect(Number.isFinite(res.logML)).toBe(true)
  })
})
