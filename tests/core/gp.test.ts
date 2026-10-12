import { describe, expect, it } from 'vitest'
import { GpError } from '../../src/core/errors'
import {
  drawSamples,
  logMarginalLikelihood,
  modelParams,
  observationSd,
  posterior,
  priorMoments,
  standardNormals,
  withModelLogParams,
  type GpModel,
} from '../../src/core/gp'
import { type KernelSpec } from '../../src/core/kernels'
import { cholesky, fromRows, zeros, type Mat } from '../../src/core/linalg'
import { fitGls, meanValues, type MeanSpec } from '../../src/core/mean'
import { createRng } from '../../src/core/rng'
import { loadGolden } from '../helpers/golden'

const col = (xs: number[]): Mat => fromRows(xs.map((x) => [x]))
const rbf = (sigma: number, ell: number): KernelSpec => ({ terms: [[{ kind: 'rbf', params: { sigma, ell } }]] })
const model = (sigma: number, ell: number, sigmaN: number, mean: MeanSpec = { kind: 'zero' }): GpModel => ({
  kernel: rbf(sigma, ell),
  sigmaN,
  mean,
})

function maxRel(a: ArrayLike<number>, b: ArrayLike<number>): number {
  expect(a.length).toBe(b.length)
  let m = 0
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]) / Math.max(Math.abs(b[i]), 1e-300))
  return m
}

function maxAbs(a: ArrayLike<number>, b: ArrayLike<number>): number {
  expect(a.length).toBe(b.length)
  let m = 0
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]))
  return m
}

function expectThrowsCode(fn: () => unknown, code: string): void {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(GpError)
    expect((e as GpError).code).toBe(code)
    return
  }
  throw new Error(`expected GpError(${code})`)
}

/** Central finite differences of the log-ML in log-parameter space. */
function fdGradient(m: GpModel, X: Mat, y: Float64Array, h = 1e-5): Float64Array {
  const info = modelParams(m, X.cols)
  const g = new Float64Array(info.names.length)
  for (let i = 0; i < g.length; i++) {
    const p = Float64Array.from(info.logValues)
    p[i] += h
    const up = logMarginalLikelihood(withModelLogParams(m, X.cols, p), X, y).value
    p[i] -= 2 * h
    const down = logMarginalLikelihood(withModelLogParams(m, X.cols, p), X, y).value
    g[i] = (up - down) / (2 * h)
  }
  return g
}

describe('posterior (Notebook Code 39)', () => {
  it('reproduces the Kap. 9 single-point example', () => {
    const g = loadGolden('kap9')
    const p = posterior(model(g.sigma_f, g.ell, g.sigma_n), col(g.x), Float64Array.from(g.y), col(g.x_star))
    expect(Math.abs(p.mean[0] - 0.8)).toBeLessThan(1e-12)
    expect(Math.abs(p.sdF[0] - Math.sqrt(0.2))).toBeLessThan(1e-12)
    expect(Math.abs(p.sdY[0] - Math.sqrt(0.45))).toBeLessThan(1e-12)
    expect(Math.abs(p.mean[2] - Math.exp(-4.5) / 1.25)).toBeLessThan(1e-12)
    expect(maxAbs(p.mean, g.mean)).toBeLessThan(1e-12)
    expect(maxAbs(p.sdF, g.sdF)).toBeLessThan(1e-12)
    expect(maxAbs(p.sdY, g.sdY)).toBeLessThan(1e-12)
    expect(p.jitter).toBe(0)
    expect(p.eta).toBeUndefined()
  })

  it('observationSd matches exercise 5', () => {
    const g = loadGolden('exercise5')
    expect(Math.abs(2 * observationSd(g.sdF, g.sigma_n) - g.halfwidthY)).toBeLessThan(1e-9)
  })

  it('reproduces mean, variance and log-ML on the sine data', () => {
    const g = loadGolden('sine')
    const m = model(g.sigma_f, g.ell, g.sigma_n)
    const X = col(g.x)
    const y = Float64Array.from(g.y)
    const p = posterior(m, X, y, col(g.x_star))
    expect(maxRel(p.mean, g.mean)).toBeLessThan(1e-8)
    const varF = p.sdF.map((s) => s * s)
    expect(maxRel(varF, g.diagCov)).toBeLessThan(1e-8)
    const lml = logMarginalLikelihood(m, X, y)
    expect(Math.abs(lml.value - g.logML) / Math.abs(g.logML)).toBeLessThan(1e-8)
    expect(lml.jitter).toBe(0)
  })

  it('full covariance is symmetric and its diagonal matches sdF', () => {
    const g = loadGolden('kap9')
    const p = posterior(model(1, 1, 0.5), col([0, 0.5]), Float64Array.from([1, 0.2]), col(g.x_star), {
      fullCov: true,
    })
    const C = p.cov!
    expect(C.rows).toBe(3)
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(Math.sqrt(C.data[i * 3 + i]) - p.sdF[i])).toBeLessThan(1e-14)
      for (let j = 0; j < 3; j++) expect(C.data[i * 3 + j]).toBe(C.data[j * 3 + i])
    }
  })

  it('reproduces all three prescribed mean functions', () => {
    const g = loadGolden('mean_demo')
    const X = col(g.x)
    const y = Float64Array.from(g.y)
    const Xq = col(g.x_query)
    const cases: [string, MeanSpec][] = [
      ['zero', { kind: 'zero' }],
      ['constant22', { kind: 'constant', c: 22 }],
      ['linear', { kind: 'linear', a: 20, b: [3] }],
    ]
    for (const [name, mean] of cases) {
      const p = posterior(model(g.sigma_f, g.ell, g.sigma_n, mean), X, y, Xq)
      expect(maxAbs(p.mean, g.means[name].mean), name).toBeLessThan(1e-8)
      expect(maxAbs(p.sdF, g.means[name].sdF), name).toBeLessThan(1e-8)
    }
  })
})

describe('GLS mean (gp-mean-fit)', () => {
  const g = loadGolden('mean_fit')
  const X = col(g.x_fit)
  const y = Float64Array.from(g.y_fit)
  const m = model(g.signal, g.length, g.noise, { kind: 'gls', basis: 'linear' })

  it('estimates eta and the profile log-ML', () => {
    const lml = logMarginalLikelihood(m, X, y)
    expect(Math.abs(lml.value - g.logML) / Math.abs(g.logML)).toBeLessThan(1e-8)
    const p = posterior(m, X, y, col([0, 1, 2]))
    expect(p.eta).toBeDefined()
    expect(maxRel(p.eta!, g.eta)).toBeLessThan(1e-8)
    // The plug-in mean uses eta at the test points: far from data it reverts to eta0 + eta1 x.
    const far = posterior(m, X, y, col([100]))
    expect(Math.abs(far.mean[0] - (g.eta[0] + 100 * g.eta[1]))).toBeLessThan(1e-8)
  })

  it('fitGls agrees with the posterior eta', () => {
    const n = X.rows
    const C = zeros(n, n)
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const d = (g.x_fit[i] - g.x_fit[j]) / g.length
        C.data[i * n + j] = g.signal ** 2 * Math.exp(-0.5 * d * d) + (i === j ? g.noise ** 2 : 0)
      }
    const { L } = cholesky(C)
    const H = fromRows(g.x_fit.map((x: number) => [1, x]))
    expect(maxRel(fitGls(L, H, y).eta, g.eta)).toBeLessThan(1e-8)
  })

  it('constant basis gives a single coefficient', () => {
    const p = posterior(model(g.signal, g.length, g.noise, { kind: 'gls', basis: 'constant' }), X, y, col([0]))
    expect(p.eta!.length).toBe(1)
    expect(Number.isFinite(p.eta![0])).toBe(true)
  })

  it('rank-deficient H throws InvalidInput', () => {
    // A single training point cannot determine intercept and slope.
    expectThrowsCode(
      () => posterior(model(1, 1, 0.1, { kind: 'gls', basis: 'linear' }), col([0.5]), Float64Array.from([1]), col([0])),
      'InvalidInput',
    )
    // Two identical x values: the columns 1 and x are collinear.
    expectThrowsCode(
      () =>
        logMarginalLikelihood(model(1, 1, 0.1, { kind: 'gls', basis: 'linear' }), col([2, 2]), Float64Array.from([1, 2])),
      'InvalidInput',
    )
  })

  it('meanValues evaluates the basis with eta', () => {
    const v = meanValues({ kind: 'gls', basis: 'linear' }, col([0, 2]), Float64Array.from([1, 0.5]))
    expect(Array.from(v)).toEqual([1, 2])
    expectThrowsCode(() => meanValues({ kind: 'gls', basis: 'linear' }, col([0])), 'InvalidInput')
    expectThrowsCode(() => meanValues({ kind: 'linear', a: 0, b: [1, 2] }, col([0])), 'InvalidInput')
  })
})

describe('log marginal likelihood gradient', () => {
  it('matches finite differences on the sine data (first 50 points)', () => {
    const g = loadGolden('sine')
    const X = col(g.x.slice(0, 50))
    const y = Float64Array.from(g.y.slice(0, 50))
    const m = model(g.sigma_f, g.ell, g.sigma_n)
    const { grad } = logMarginalLikelihood(m, X, y)
    expect(modelParams(m, 1).names).toEqual(['t0.f0.sigma', 't0.f0.ell', 'sigmaN'])
    expect(maxRel(grad, fdGradient(m, X, y))).toBeLessThan(1e-5)
  })

  it('matches finite differences with the GLS linear mean (profile likelihood)', () => {
    const g = loadGolden('mean_fit')
    const X = col(g.x_fit)
    const y = Float64Array.from(g.y_fit)
    const m = model(g.signal, g.length, g.noise, { kind: 'gls', basis: 'linear' })
    const { grad } = logMarginalLikelihood(m, X, y)
    expect(maxRel(grad, fdGradient(m, X, y))).toBeLessThan(1e-5)
  })

  it('includes white-noise kernel terms in the gradient', () => {
    const g = loadGolden('sine')
    const X = col(g.x.slice(0, 30))
    const y = Float64Array.from(g.y.slice(0, 30))
    const m: GpModel = {
      kernel: { terms: [[{ kind: 'rbf', params: { sigma: 1.5, ell: 0.2 } }], [{ kind: 'white', params: { sigma: 0.3 } }]] },
      sigmaN: 0.2,
      mean: { kind: 'constant', c: 0.1 },
    }
    const { grad } = logMarginalLikelihood(m, X, y)
    expect(grad.length).toBe(4)
    expect(maxRel(grad, fdGradient(m, X, y))).toBeLessThan(1e-5)
  })
})

describe('model parameters', () => {
  it('appends log sigmaN with its bounds and round-trips', () => {
    const m = model(2, 0.1, 0.4)
    const info = modelParams(m, 1)
    expect(info.logValues[2]).toBeCloseTo(Math.log(0.4), 15)
    expect(info.logLower[2]).toBeCloseTo(Math.log(Math.sqrt(1e-5)), 15)
    expect(info.logUpper[2]).toBeCloseTo(Math.log(Math.sqrt(1e5)), 15)
    const m2 = withModelLogParams(m, 1, Float64Array.from([Math.log(3), Math.log(0.5), Math.log(0.25)]))
    expect(m2.sigmaN).toBeCloseTo(0.25, 15)
    expect(m2.kernel.terms[0][0].params.sigma).toBeCloseTo(3, 15)
    expect(m.sigmaN).toBe(0.4)
    expectThrowsCode(() => withModelLogParams(m, 1, new Float64Array(2)), 'InvalidInput')
  })
})

describe('edge cases', () => {
  it('posterior with no training points equals the prior moments', () => {
    const m = model(1.3, 0.5, 0.2, { kind: 'linear', a: 1, b: [2] })
    const Xs = col([-1, 0, 0.5, 2])
    const p = posterior(m, zeros(0, 1), new Float64Array(0), Xs, { fullCov: true })
    const q = priorMoments(m, Xs, { fullCov: true })
    expect(p).toEqual(q)
    expect(Array.from(q.mean)).toEqual([-1, 1, 2, 5])
    for (const s of q.sdF) expect(s).toBeCloseTo(1.3, 14)
    for (const s of q.sdY) expect(s).toBeCloseTo(Math.hypot(1.3, 0.2), 14)
    expect(q.jitter).toBe(0)
  })

  it('white-noise terms are excluded from the latent sd', () => {
    const m: GpModel = {
      kernel: { terms: [[{ kind: 'rbf', params: { sigma: 1, ell: 1 } }], [{ kind: 'white', params: { sigma: 0.5 } }]] },
      sigmaN: 0.1,
      mean: { kind: 'zero' },
    }
    const q = priorMoments(m, col([0, 1]))
    expect(q.sdF[0]).toBeCloseTo(1, 14)
  })

  it('duplicate x with tiny sigmaN uses jitter and stays finite (Review Focus 2)', () => {
    const m = model(1, 1, 1e-9)
    const p = posterior(m, col([0.3, 0.3]), Float64Array.from([1, 1.2]), col([0, 0.3, 1]))
    expect(p.jitter).toBeGreaterThan(0)
    for (const v of [...p.mean, ...p.sdF, ...p.sdY]) expect(Number.isFinite(v)).toBe(true)
  })

  it('rejects mismatched shapes and non-finite y', () => {
    const m = model(1, 1, 0.1)
    expectThrowsCode(() => posterior(m, col([0, 1]), Float64Array.from([1]), col([0])), 'InvalidInput')
    expectThrowsCode(() => posterior(m, col([0, 1]), Float64Array.from([1, NaN]), col([0])), 'InvalidInput')
    expectThrowsCode(() => posterior(m, col([0, 1]), Float64Array.from([1, 2]), fromRows([[0, 1]])), 'InvalidInput')
    expectThrowsCode(() => logMarginalLikelihood(m, col([0]), Float64Array.from([Infinity])), 'InvalidInput')
    expectThrowsCode(() => logMarginalLikelihood(m, zeros(0, 1), new Float64Array(0)), 'InvalidInput')
    expectThrowsCode(() => posterior(model(1, 1, NaN), col([0]), Float64Array.from([1]), col([0])), 'InvalidInput')
  })
})

describe('samples', () => {
  it('standardNormals is seeded and shaped k×n', () => {
    const a = standardNormals(createRng(7), 5, 3)
    const b = standardNormals(createRng(7), 5, 3)
    expect(a.rows).toBe(5)
    expect(a.cols).toBe(3)
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })

  it('drawSamples returns mean + L u per row', () => {
    const mean = Float64Array.from([1, -1])
    const cov = fromRows([
      [4, 2],
      [2, 2],
    ]) // L = [[2,0],[1,1]]
    const u = fromRows([
      [1, 0],
      [0, 1],
      [0, 0],
    ])
    const s = drawSamples(mean, cov, u, 3)
    expect(s.rows).toBe(3)
    expect(Array.from(s.data)).toEqual([3, 0, 1, 0, 1, -1])
  })

  it('drawSamples handles a rank-deficient posterior covariance via jitter', () => {
    const p = posterior(model(1, 1, 1e-6), col([0]), Float64Array.from([1]), col([0, 0, 1]), { fullCov: true })
    const s = drawSamples(p.mean, p.cov!, standardNormals(createRng(1), 4, 3), 1)
    for (const v of s.data) expect(Number.isFinite(v)).toBe(true)
  })
})
