import { describe, expect, it } from 'vitest'
import { GpError } from '../../src/core/errors'
import { logMarginalLikelihood, modelParams, withModelLogParams, type GpModel } from '../../src/core/gp'
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

  it('keeps L-BFGS curvature pairs on the free subspace when a coordinate sits on a bound', () => {
    // c is pinned at its lower bound 0 (∂f/∂c > 0 everywhere); ∂f/∂c varies strongly with the free a, b.
    // A non-zero y_c in the stored pairs would wreck γ and the two-loop direction (it then stalls far from
    // the optimum within 200 iterations); restricted pairs converge in a handful of iterations.
    const K = 1000
    const f = (x: Float64Array) => {
      const [a, b, c] = x
      return {
        value: (a - 3) ** 2 + 10 * (b - a) ** 2 + c * (1 + K * (a * a + b * b)),
        grad: Float64Array.from([
          2 * (a - 3) - 20 * (b - a) + 2 * K * c * a,
          20 * (b - a) + 2 * K * c * b,
          1 + K * (a * a + b * b),
        ]),
      }
    }
    const r = lbfgsb(f, new Float64Array(3), Float64Array.from([-10, -10, 0]), Float64Array.from([10, 10, 10]))
    expect(r.converged).toBe(true)
    expect(r.iterations).toBeLessThanOrEqual(20)
    expect(r.x[2]).toBe(0)
    expect(Math.abs(r.x[0] - 3)).toBeLessThan(1e-6)
    expect(Math.abs(r.x[1] - 3)).toBeLessThan(1e-6)
  })

  it('retries with steepest descent when the line search along the L-BFGS direction fails', () => {
    // Evaluation 1 is x0, evaluation 2 the accepted first (steepest) step, which stores a curvature pair.
    // Evaluations 3…52 (the 50 trial points along the first L-BFGS direction) fail with a GpError, so that
    // line search fails; the retry with steepest descent must continue to the minimum at (1, 2).
    let calls = 0
    const f = (x: Float64Array) => {
      calls++
      if (calls >= 3 && calls <= 52) throw new GpError('NotPositiveDefinite')
      return {
        value: (x[0] - 1) ** 2 + (x[1] - 2) ** 2,
        grad: Float64Array.from([2 * (x[0] - 1), 2 * (x[1] - 2)]),
      }
    }
    const r = lbfgsb(f, new Float64Array(2), Float64Array.from([-10, -10]), Float64Array.from([10, 10]))
    expect(calls).toBeGreaterThan(52)
    expect(r.converged).toBe(true)
    expect(Math.abs(r.x[0] - 1)).toBeLessThan(1e-6)
    expect(Math.abs(r.x[1] - 2)).toBeLessThan(1e-6)
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
    expect(Math.max(...res.runs.map((run) => run.logML))).toBe(res.logML)
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

  it('reports whether the best run converged (false when the iteration limit stops it)', () => {
    const g = loadGolden('sine')
    const X = col(g.x.slice(0, 30))
    const y = Float64Array.from(g.y.slice(0, 30))
    const cut = optimizeHyperparameters(rbfModel(1, 1, 1), X, y, { restarts: 0, seed: 0, maxIter: 1 })
    expect(cut.converged).toBe(false)
    const full = optimizeHyperparameters(rbfModel(1, 1, 1), X, y, { restarts: 0, seed: 0, maxIter: 500 })
    expect(full.converged).toBe(true)
    expect(full.converged).toBe(full.runs[0].converged)
  })

  it('is deterministic for a fixed seed', () => {
    const g = loadGolden('sine')
    const X = col(g.x.slice(0, 30))
    const y = Float64Array.from(g.y.slice(0, 30))
    const run = () => optimizeHyperparameters(rbfModel(1, 1, 1), X, y, { restarts: 3, seed: 7 })
    const a = run()
    const b = run()
    expect(b.model).toEqual(a.model)
    expect(b.logML).toBe(a.logML)
    expect(b.atBound).toEqual(a.atBound)
    expect(b.runs.map((r) => Array.from(r.x))).toEqual(a.runs.map((r) => Array.from(r.x)))
  })

  it('lets an irrelevant ARD length scale reach its upper bound without failed evaluations', () => {
    // y depends on x0 only, so ell_1 runs to its upper bound log(1e5). The projection lands exactly on the
    // log-bound; if exp(log(1e5)) > 1e5 were rejected there, every iteration would burn its line search on
    // failed points while ell_1 creeps towards the bound (Daten-Lab ARD on Yacht: ~40 evaluations per iteration
    // up to maxIter, 500–650 s per restart instead of ~20 s).
    const rows: number[][] = []
    const yv: number[] = []
    for (let i = 0; i < 30; i++) {
      const x0 = -2 + (4 * i) / 29
      const x1 = Math.sin(7 * i)
      rows.push([x0, x1])
      yv.push(Math.sin(1.5 * x0) + 0.05 * Math.cos(11 * i))
    }
    const X = fromRows(rows)
    const y = Float64Array.from(yv)
    const model: GpModel = {
      kernel: { terms: [[{ kind: 'rbf', params: { sigma: 1, ell_0: 1, ell_1: 1e4 }, ard: true }]] },
      sigmaN: 0.1,
      mean: { kind: 'zero' },
    }
    const info = modelParams(model, 2)
    let evals = 0
    let failed = 0
    const objective = (theta: Float64Array) => {
      evals++
      try {
        const r = logMarginalLikelihood(withModelLogParams(model, 2, theta), X, y)
        return { value: -r.value, grad: r.grad.map((v) => -v) }
      } catch (e) {
        failed++
        throw e
      }
    }
    // ftol 0: f is already flat in ell_1 at the start, the relative-reduction stop would end the run before the bound.
    const res = lbfgsb(objective, info.logValues, info.logLower, info.logUpper, { maxIter: 200, ftol: 0 })
    expect(failed).toBe(0)
    expect(res.x[2]).toBe(info.logUpper[2])
    expect(res.iterations).toBeLessThan(100)
    expect(evals).toBeLessThan(400)
  })
})
