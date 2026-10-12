import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseCsv, type Table } from '../../src/core/csv'
import { GpError } from '../../src/core/errors'
import { logMarginalLikelihoodFromFit, fitModel, type GpModel } from '../../src/core/gp'
import { fromRows, toRows } from '../../src/core/linalg'
import { optimizeHyperparameters } from '../../src/core/optimize'
import { createRng } from '../../src/core/rng'
import {
  applyScaler,
  buildModel,
  canLogTarget,
  evaluateRun,
  fitScaler,
  NOTEBOOK_SPLIT,
  prepareDataset,
  prepareRun,
  sliceAt,
  splitIndices,
  type RunConfig,
} from '../../src/tools/datalab/pipeline'
import { fromBaukasten } from '../../src/tools/datalab/templates'
import { loadGolden } from '../helpers/golden'

function gpError(fn: () => unknown): GpError {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(GpError)
    return e as GpError
  }
  throw new Error('expected a GpError')
}

function yachtTable(): Table {
  const url = new URL('../../public/data/yacht.csv', import.meta.url)
  return parseCsv(readFileSync(fileURLToPath(url), 'utf8'))
}

const FEATURES = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']

/** y = 3 + x1² + 0.5·x2 + small noise (> 0), 60 rows. */
function synthTable(n = 60, seed = 3): Table {
  const rng = createRng(seed)
  const rows: (number | string | null)[][] = []
  for (let i = 0; i < n; i++) {
    const x1 = 4 * rng.uniform() - 2
    const x2 = 4 * rng.uniform() - 2
    rows.push([x1, x2, 3 + x1 * x1 + 0.5 * x2 + 0.05 * rng.normal()])
  }
  return { columns: ['x1', 'x2', 'y'], rows }
}

function relClose(a: ArrayLike<number>, b: ArrayLike<number>, rel: number): void {
  expect(a.length).toBe(b.length)
  for (let i = 0; i < a.length; i++) {
    expect(Math.abs(a[i] - b[i])).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(b[i])))
  }
}

describe('prepareDataset', () => {
  it('throws InvalidInput for a non-numeric target', () => {
    const t: Table = { columns: ['x', 'name'], rows: Array.from({ length: 12 }, (_, i) => [i, `n${i}`]) }
    const e = gpError(() => prepareDataset(t, 'name', ['x']))
    expect(e.code).toBe('InvalidInput')
    expect(e.details?.reason).toBe('targetNotNumeric')
  })

  it('excludes text and constant features and drops rows with missing values', () => {
    const rows = Array.from({ length: 14 }, (_, i) => [i, 5, `t${i}`, i === 3 ? null : 2 * i] as (number | string | null)[])
    rows[5][0] = null
    const ds = prepareDataset({ columns: ['x', 'k', 's', 'y'], rows }, 'y', ['x', 'k', 's'])
    expect(ds.featureNames).toEqual(['x'])
    expect(ds.excluded).toEqual([
      { name: 'k', reason: 'constant' },
      { name: 's', reason: 'text' },
    ])
    expect(ds.droppedRows).toBe(2)
    expect(ds.X.rows).toBe(12)
    expect(ds.y.length).toBe(12)
  })

  it('refuses fewer than 10 valid rows', () => {
    const rows = Array.from({ length: 12 }, (_, i) => [i, i < 9 ? i * 2 : null] as (number | string | null)[])
    const e = gpError(() => prepareDataset({ columns: ['x', 'y'], rows }, 'y', ['x']))
    expect(e.code).toBe('InvalidInput')
    expect(e.details?.reason).toBe('tooFewRows')
  })
})

describe('helpers', () => {
  it('canLogTarget requires y > 0 everywhere', () => {
    expect(canLogTarget(Float64Array.from([1, 0, 2]))).toBe(false)
    expect(canLogTarget(Float64Array.from([1, -1]))).toBe(false)
    expect(canLogTarget(Float64Array.from([1, 0.5]))).toBe(true)
  })

  it('fitScaler gives scale 1 on a constant column and uses the population std', () => {
    const s = fitScaler(fromRows([[1, 2], [1, 4], [1, 6]]))
    expect(Array.from(s.mean)).toEqual([1, 4])
    expect(s.scale[0]).toBe(1)
    expect(s.scale[1]).toBeCloseTo(Math.sqrt(8 / 3), 14)
    expect(toRows(applyScaler(fromRows([[1, 4]]), s))).toEqual([[0, 0]])
  })

  it('splitIndices is a seeded partition with ceil(testFraction·n) test rows', () => {
    const a = splitIndices(50, 0.1, 7)
    const b = splitIndices(50, 0.1, 7)
    expect(a).toEqual(b)
    expect(a.test).toHaveLength(5)
    expect([...a.train, ...a.test].sort((x, y) => x - y)).toEqual(Array.from({ length: 50 }, (_, i) => i))
    expect(() => splitIndices(50, 0, 1)).toThrow(GpError)
  })

  it('NOTEBOOK_SPLIT equals the golden split', () => {
    const g = loadGolden('yacht_split')
    expect(NOTEBOOK_SPLIT.train).toEqual(g.train)
    expect(NOTEBOOK_SPLIT.test).toEqual(g.test)
  })
})

describe('buildModel / templates', () => {
  it('builds the four templates with zero mean and sigma_n = 1', () => {
    const nb = buildModel('notebook', 6)
    expect(nb.kernel.terms).toHaveLength(1)
    expect(nb.kernel.terms[0].map((f) => f.kind)).toEqual(['rbf', 'linear'])
    expect(nb.sigmaN).toBe(1)
    expect(nb.mean).toEqual({ kind: 'zero' })
    const ard = buildModel('ard-matern52', 3)
    expect(ard.kernel.terms[0][0]).toMatchObject({ kind: 'matern52', ard: true, params: { sigma: 1, ell_0: 1, ell_1: 1, ell_2: 1 } })
    expect(buildModel('rbf', 4).kernel.terms[0][0]).toMatchObject({ kind: 'rbf', params: { sigma: 1, ell: 1 } })
  })

  it('converts single-factor white terms into sigma_n (quadrature, clamped) and removes them', () => {
    const m = buildModel(
      {
        terms: [
          [{ kind: 'rbf', params: { sigma: 1, ell: 0.5 } }],
          [{ kind: 'white', params: { sigma: 0.3 } }],
          [{ kind: 'white', params: { sigma: 0.4 } }],
        ],
      },
      3,
    )
    expect(m.kernel.terms).toHaveLength(1)
    expect(m.kernel.terms.flat().some((f) => f.kind === 'white')).toBe(false)
    expect(m.sigmaN).toBeCloseTo(0.5, 14)
    const tiny = buildModel({ terms: [[{ kind: 'rbf', params: { sigma: 1, ell: 1 } }], [{ kind: 'white', params: { sigma: 1e-5 } }]] }, 2)
    expect(tiny.sigmaN).toBeCloseTo(Math.sqrt(1e-5), 14)
  })

  it('rejects white inside a product', () => {
    const e = gpError(() =>
      buildModel({ terms: [[{ kind: 'rbf', params: { sigma: 1, ell: 1 } }, { kind: 'white', params: { sigma: 0.1 } }]] }, 2),
    )
    expect(e.code).toBe('InvalidInput')
    expect(e.details?.reason).toBe('whiteInProduct')
  })

  it('applies a Baukasten kernel isotropically and reports dropped settings', () => {
    const r = fromBaukasten({
      terms: [[{ kind: 'rbf', params: { sigma: 1, ell_0: 0.5, ell_1: 2 }, ard: true, activeDims: [0, 1], fixed: ['ell_1'] }]],
    })
    expect(r.spec.terms[0][0]).toEqual({ kind: 'rbf', params: { sigma: 1, ell: 1 }, fixed: ['ell'] })
    expect(r.notices).toEqual(expect.arrayContaining(['ardDropped', 'activeDimsDropped']))
    const m = buildModel(
      { terms: [[{ kind: 'rbf', params: { sigma: 1, ell_0: 0.5, ell_1: 2 }, ard: true }]] },
      5,
    )
    expect(m.kernel.terms[0][0].ard).toBeUndefined()
  })
})

describe('evaluateRun', () => {
  it('log target: yPred, lowerY and upperY are finite and ordered', () => {
    const ds = prepareDataset(synthTable(), 'y', ['x1', 'x2'])
    const cfg: RunConfig = { dataset: ds, split: splitIndices(ds.X.rows, 0.2, 1), logTarget: true, template: 'rbf', restarts: 0, seed: 0 }
    const { Xtrain, ytrain } = prepareRun(cfg)
    const opt = optimizeHyperparameters(buildModel('rbf', 2), Xtrain, ytrain, { restarts: 0, seed: 0, maxIter: 100 })
    const run = evaluateRun(cfg, opt.model, opt.logML, opt.atBound)
    expect(run.test.yPred).toHaveLength(12)
    for (let i = 0; i < run.test.yPred.length; i++) {
      expect(Number.isFinite(run.test.yPred[i])).toBe(true)
      expect(Number.isFinite(run.test.lowerY[i])).toBe(true)
      expect(Number.isFinite(run.test.upperY[i])).toBe(true)
      expect(run.test.lowerY[i]).toBeLessThan(run.test.yPred[i])
      expect(run.test.yPred[i]).toBeLessThan(run.test.upperY[i])
    }
    expect(run.metrics.r2Test).toBeGreaterThan(0.9)
    expect(run.warnings).not.toContain('negativePredictions')
    const s = sliceAt(run, cfg, 0, 25)
    expect(s.x).toHaveLength(25)
    for (let i = 0; i < 25; i++) {
      expect(s.lowerY[i]).toBeLessThanOrEqual(s.lowerF[i])
      expect(s.lowerF[i]).toBeLessThan(s.mean[i])
      expect(s.mean[i]).toBeLessThan(s.upperF[i])
      expect(s.upperF[i]).toBeLessThanOrEqual(s.upperY[i])
    }
  })

  it('refuses a log target when some y ≤ 0 (no NaN)', () => {
    const t = synthTable()
    t.rows[4][2] = 0
    const ds = prepareDataset(t, 'y', ['x1', 'x2'])
    const cfg: RunConfig = { dataset: ds, split: splitIndices(ds.X.rows, 0.2, 1), logTarget: true, template: 'rbf', restarts: 0, seed: 0 }
    const e = gpError(() => prepareRun(cfg))
    expect(e.details?.reason).toBe('logTargetNotPositive')
  })

  it('reports ARD relevance and the length-scale-at-bound warning', () => {
    const ds = prepareDataset(synthTable(), 'y', ['x1', 'x2'])
    const cfg: RunConfig = { dataset: ds, split: splitIndices(ds.X.rows, 0.25, 2), logTarget: false, template: 'ard-rbf', restarts: 0, seed: 0 }
    const run = evaluateRun(cfg, buildModel('ard-rbf', 2), Number.NaN, ['t0.f0.ell_1'])
    expect(run.relevance).toEqual([
      { feature: 'x1', ell: 1 },
      { feature: 'x2', ell: 1 },
    ])
    expect(run.warnings).toEqual(['lengthscaleAtBound'])
  })

  it('warns about negative predictions when all training y > 0', () => {
    // Hinge y = 0.01 + max(0, x): a linear model predicts y < 0 for x well below 0.
    const rows = Array.from({ length: 40 }, (_, i) => {
      const x = -2 + (4 * i) / 39
      return [x, 0.01 + Math.max(0, x)] as (number | string | null)[]
    })
    const ds = prepareDataset({ columns: ['x', 'y'], rows }, 'y', ['x'])
    const split = { train: rows.map((_, i) => i).filter((i) => i % 4 !== 0), test: rows.map((_, i) => i).filter((i) => i % 4 === 0) }
    const linear = { terms: [[{ kind: 'linear' as const, params: { sigma0: 1, c: 0 }, fixed: ['c'] }]] }
    const cfg: RunConfig = { dataset: ds, split, logTarget: false, template: linear, restarts: 0, seed: 0 }
    const run = evaluateRun(cfg, { ...buildModel(linear, 1), sigmaN: 0.1 }, Number.NaN, [])
    expect(run.test.yPred.some((v) => v < 0)).toBe(true)
    expect(run.warnings).toContain('negativePredictions')
  })
})

describe('Yacht notebook reproduction (Code 90–94)', () => {
  const g = loadGolden('yacht_fixed')
  const ds = prepareDataset(yachtTable(), 'y', FEATURES)
  const cfg: RunConfig = { dataset: ds, split: NOTEBOOK_SPLIT, logTarget: false, template: 'notebook', restarts: 5, seed: 0 }

  it('NOTEBOOK_SPLIT + yacht.csv + fitScaler reproduce the golden scaled X_train in row order', () => {
    const { Xtrain, Xtest, ytrain, xScaler, yMean, yScale } = prepareRun(cfg)
    relClose(Xtrain.data, (g.X_train as number[][]).flat(), 1e-12)
    relClose(Xtest.data, (g.X_test as number[][]).flat(), 1e-12)
    relClose(ytrain, g.y_train, 1e-12)
    relClose(xScaler.mean, g.scaler_x_mean, 1e-12)
    relClose(xScaler.scale, g.scaler_x_scale, 1e-12)
    expect(yMean).toBeCloseTo(g.scaler_y_mean, 10)
    expect(yScale).toBeCloseTo(g.scaler_y_scale, 10)
  })

  it('evaluateRun at the golden parameters matches the notebook predictions', () => {
    const base = buildModel('notebook', 6)
    const model: GpModel = {
      ...base,
      sigmaN: Math.sqrt(g.white_noise_level + 1e-10),
      kernel: {
        terms: [
          [
            { ...base.kernel.terms[0][0], params: { sigma: 1, ell: g.rbf_length_scale } },
            { ...base.kernel.terms[0][1], params: { sigma0: g.dot_sigma_0, c: 0 } },
          ],
        ],
      },
    }
    const { Xtrain, ytrain } = prepareRun(cfg)
    const logML = logMarginalLikelihoodFromFit(fitModel(model, Xtrain, ytrain))
    expect(Math.abs(logML - g.logML)).toBeLessThan(1e-6 * Math.max(1, Math.abs(g.logML)))

    const run = evaluateRun(cfg, model, logML, [])
    expect(run.logML).toBe(logML)
    relClose(run.test.yTrue, g.y_test, 1e-12)
    relClose(run.test.yPred, g.y_test_pred, 1e-5)
    const sdYOrig = run.test.sdY.map((s) => s * g.scaler_y_scale)
    relClose(sdYOrig, g.y_test_std, 1e-5)
    // sklearn's return_std excludes alpha = 1e-10 (variance in scaled units)
    for (let i = 0; i < sdYOrig.length; i++) {
      expect(Math.abs(sdYOrig[i] - g.sklearn_y_test_std[i])).toBeLessThan(1e-6 * g.scaler_y_scale)
    }
    expect(Math.abs(run.metrics.rmseTest - g.rmse)).toBeLessThan(1e-5)
    expect(run.metrics.r2Test).toBeGreaterThan(0.99)
    expect(run.relevance).toBeUndefined()
    expect(run.metrics.calibration).toHaveLength(5)
    expect(run.metrics.coverage2sd).toBeGreaterThan(0.5)
  })

  it(
    'optimisation (5 restarts, seed 0) reaches the notebook log ML and RMSE',
    () => {
      const { Xtrain, ytrain } = prepareRun(cfg)
      const opt = optimizeHyperparameters(buildModel('notebook', 6), Xtrain, ytrain, { restarts: 5, seed: 0, maxIter: 500 })
      expect(opt.logML).toBeGreaterThanOrEqual(g.logML - 0.5)
      const run = evaluateRun(cfg, opt.model, opt.logML, opt.atBound)
      expect(Math.abs(run.metrics.rmseTest - 0.392)).toBeLessThan(0.05)
    },
    120_000,
  )
})
