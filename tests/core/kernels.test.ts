import { describe, expect, it } from 'vitest'
import { GpError } from '../../src/core/errors'
import {
  checkValidity,
  freeParams,
  isKernelSpec,
  kernelDiag,
  kernelGradients,
  kernelMatrix,
  kernelTex,
  kindParams,
  locationParams,
  logParams,
  withLogParams,
  type BaseKernel,
  type KernelSpec,
} from '../../src/core/kernels'
import { fromRows, type Mat } from '../../src/core/linalg'
import { loadGolden } from '../helpers/golden'

const col = (xs: number[]): Mat => fromRows(xs.map((x) => [x]))
const linspace = (a: number, b: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1))
const one = (f: BaseKernel): KernelSpec => ({ terms: [[f]] })

function maxAbsDiff(a: Mat, b: ArrayLike<number>): number {
  let m = 0
  for (let i = 0; i < a.data.length; i++) m = Math.max(m, Math.abs(a.data[i] - b[i]))
  return m
}

function expectThrowsCode(fn: () => unknown, code: string, reason?: string): void {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(GpError)
    expect((e as GpError).code).toBe(code)
    if (reason) expect((e as GpError).details?.reason).toBe(reason)
    return
  }
  throw new Error('expected a GpError')
}

describe('kernelMatrix vs golden/kernels.json', () => {
  const g = loadGolden('kernels')
  for (const e of g.entries) {
    it(`${e.name} (${e.source})`, () => {
      expect(isKernelSpec(e.spec)).toBe(true)
      const X = col(e.x ?? g.x)
      const K = kernelMatrix(e.spec, X, X, { sameSet: true })
      const flat = (e.K as number[][]).flat()
      expect(K.rows).toBe(X.rows)
      expect(maxAbsDiff(K, flat)).toBeLessThan(1e-10)
      // kernelDiag agrees with the diagonal of the full matrix.
      const d = kernelDiag(e.spec, X)
      for (let i = 0; i < X.rows; i++) expect(Math.abs(d[i] - K.data[i * X.rows + i])).toBeLessThan(1e-14)
    })
  }
  it('covers the extra warp / periodic / fine-grid gibbs entries', () => {
    const names = g.entries.map((e: { name: string }) => e.name)
    for (const n of ['Periodic', 'RBF-TanhWarp', 'RBF-CircleWarp', 'Gibbs-Fine']) expect(names).toContain(n)
  })
})

describe('ARD and activeDims', () => {
  // Notebook Code 68: x1, x2 = meshgrid(linspace(0,1,10), arange(1,4)); rows in C order.
  const pts: number[][] = []
  for (const x2 of [1, 2, 3]) for (const x1 of linspace(0, 1, 10)) pts.push([x1, x2])
  const X2 = fromRows(pts)

  it('ARD rbf with ell_0=0.2, ell_1=1.0 matches the inline NumPy formula', () => {
    const spec = one({ kind: 'rbf', params: { sigma: 1, ell_0: 0.2, ell_1: 1.0 }, ard: true })
    expect(isKernelSpec(spec)).toBe(true)
    const K = kernelMatrix(spec, X2, X2)
    expect(K.rows).toBe(30)
    let m = 0
    for (let i = 0; i < 30; i++)
      for (let j = 0; j < 30; j++) {
        const d0 = (pts[i][0] - pts[j][0]) / 0.2
        const d1 = (pts[i][1] - pts[j][1]) / 1.0
        m = Math.max(m, Math.abs(K.data[i * 30 + j] - Math.exp(-0.5 * (d0 * d0 + d1 * d1))))
      }
    expect(m).toBeLessThan(1e-14)
  })

  it('activeDims selects columns before scaling', () => {
    const spec = one({ kind: 'rbf', params: { sigma: 1, ell: 0.3 }, activeDims: [0] })
    const K = kernelMatrix(spec, X2, X2)
    const d = pts[0][0] - pts[12][0]
    expect(K.data[0 * 30 + 12]).toBeCloseTo(Math.exp(-0.5 * (d / 0.3) ** 2), 14)
    // Points 0 and 10 differ only in x2, which is inactive.
    expect(K.data[0 * 30 + 10]).toBe(1)
  })

  it('throws InvalidInput when the ARD length count does not match the input dimension', () => {
    const spec = one({ kind: 'rbf', params: { sigma: 1, ell_0: 0.2, ell_1: 1, ell_2: 1 }, ard: true })
    expectThrowsCode(() => kernelMatrix(spec, X2, X2), 'InvalidInput')
    expectThrowsCode(() => freeParams(spec, 2), 'InvalidInput')
  })

  it('throws InvalidInput when activeDims exceed the input dimension', () => {
    const spec = one({ kind: 'rbf', params: { sigma: 1, ell: 1 }, activeDims: [2] })
    expectThrowsCode(() => kernelMatrix(spec, X2, X2), 'InvalidInput')
  })
})

describe('freeParams / withLogParams', () => {
  const spec: KernelSpec = {
    terms: [
      [{ kind: 'rbf', params: { sigma: 2, ell: 0.5 } }],
      [
        { kind: 'periodic', params: { sigma: 1, ell: 1, period: 0.5 }, fixed: ['period'] },
        { kind: 'linear', params: { sigma0: 0.7, c: 0.3 } },
      ],
    ],
  }

  it('names free log-parameters by term/factor and excludes fixed and location parameters', () => {
    const p = freeParams(spec, 1)
    expect(p.names).toEqual(['t0.f0.sigma', 't0.f0.ell', 't1.f0.sigma', 't1.f0.ell', 't1.f1.sigma0'])
    expect(Array.from(p.logValues)).toEqual([2, 0.5, 1, 1, 0.7].map(Math.log))
    for (let i = 0; i < p.names.length; i++) {
      expect(p.logLower[i]).toBeCloseTo(Math.log(1e-5), 14)
      expect(p.logUpper[i]).toBeCloseTo(Math.log(1e5), 14)
    }
  })

  it('uses ell_j names for ARD', () => {
    const ard = one({ kind: 'matern52', params: { sigma: 1, ell_0: 0.2, ell_1: 3 }, ard: true })
    expect(freeParams(ard, 2).names).toEqual(['t0.f0.sigma', 't0.f0.ell_0', 't0.f0.ell_1'])
  })

  it('round-trips through withLogParams without mutating the input', () => {
    const p = freeParams(spec, 1)
    const lv = p.logValues.map((v) => v + 0.1)
    const s2 = withLogParams(spec, 1, lv)
    expect(spec.terms[0][0].params.sigma).toBe(2)
    expect(s2.terms[0][0].params.sigma).toBeCloseTo(2 * Math.exp(0.1), 14)
    expect(s2.terms[1][0].params.period).toBe(0.5)
    expect(s2.terms[1][1].params.c).toBe(0.3)
    expect(Array.from(freeParams(s2, 1).logValues)).toEqual(Array.from(lv).map((v) => Math.log(Math.exp(v))))
  })

  it('rejects a logValues vector of the wrong length', () => {
    expectThrowsCode(() => withLogParams(spec, 1, new Float64Array(2)), 'InvalidInput')
  })
})

describe('kernelGradients', () => {
  const X = col(linspace(0, 2, 9))

  /** Central differences of the whole matrix in log space, built only from public API. */
  function fdGradients(spec: KernelSpec, Xm: Mat): Mat[] {
    const p = freeParams(spec, Xm.cols)
    const h = 1e-6
    return p.names.map((_, i) => {
      const up = Float64Array.from(p.logValues)
      const dn = Float64Array.from(p.logValues)
      up[i] += h
      dn[i] -= h
      const Ku = kernelMatrix(withLogParams(spec, Xm.cols, up), Xm, Xm, { sameSet: true })
      const Kd = kernelMatrix(withLogParams(spec, Xm.cols, dn), Xm, Xm, { sameSet: true })
      const out = { rows: Ku.rows, cols: Ku.cols, data: new Float64Array(Ku.data.length) }
      for (let k = 0; k < out.data.length; k++) out.data[k] = (Ku.data[k] - Kd.data[k]) / (2 * h)
      return out
    })
  }
  const sum = (m: Mat) => m.data.reduce((a, b) => a + b, 0)

  it('d sum(K) matches finite differences for rbf + periodic*linear (relative 1e-5)', () => {
    const spec: KernelSpec = {
      terms: [
        [{ kind: 'rbf', params: { sigma: 1.3, ell: 0.4 } }],
        [
          { kind: 'periodic', params: { sigma: 0.8, ell: 0.9, period: 0.7 } },
          { kind: 'linear', params: { sigma0: 0.5, c: 0.2 }, fixed: ['c'] },
        ],
      ],
    }
    const G = kernelGradients(spec, X)
    const F = fdGradients(spec, X)
    expect(G.length).toBe(freeParams(spec, 1).names.length)
    expect(G.length).toBe(6)
    for (let i = 0; i < G.length; i++) {
      const a = sum(G[i])
      const b = sum(F[i])
      expect(Math.abs(a - b) / Math.max(Math.abs(b), 1e-12)).toBeLessThan(1e-5)
    }
  })

  // Every kind, with warps and ARD, element-wise against finite differences.
  const cases: [string, KernelSpec, Mat][] = [
    ['matern32*matern52', { terms: [[
      { kind: 'matern32', params: { sigma: 1.2, ell: 0.6 } },
      { kind: 'matern52', params: { sigma: 0.9, ell: 0.8 } },
    ]] }, X],
    ['rq', one({ kind: 'rq', params: { sigma: 1.1, ell: 0.5, alpha: 0.7 } }), X],
    ['constant+white', { terms: [[{ kind: 'constant', params: { c: 1.7 } }], [{ kind: 'white', params: { sigma: 0.3 } }]] }, X],
    ['exponential*cosine', { terms: [[
      { kind: 'exponential', params: { sigma: 1, ell: 0.4 } },
      { kind: 'cosine', params: { sigma: 1, ell: 1.5 } },
    ]] }, X],
    ['gibbs', one({ kind: 'gibbs', params: { sigma: 1, l1: 0.2, l2: 0.6, w: 0.3, x0: 1 }, fixed: ['x0'] }), X],
    ['powexp', one({ kind: 'powexp', params: { sigma: 1, ell: 0.5, p: 1.5 }, fixed: ['p'] }), X],
    ['tanh-warped rbf', one({ kind: 'rbf', params: { sigma: 1, ell: 0.6 }, warp: { kind: 'tanh', a: 1, b: 5, c: 1 } }), X],
    ['circle-warped matern52', one({ kind: 'matern52', params: { sigma: 1, ell: 0.6 }, warp: { kind: 'circle', period: 0.7 } }), X],
    ['ARD rbf + ARD periodic', { terms: [
      [{ kind: 'rbf', params: { sigma: 1, ell_0: 0.4, ell_1: 1.3 }, ard: true }],
      [{ kind: 'periodic', params: { sigma: 1, ell_0: 0.8, ell_1: 1.1, period: 0.9 }, ard: true }],
    ] }, fromRows([[0, 0], [0.3, 1], [0.9, 0.2], [1.4, 1.7], [2, 0.5]])],
    ['ARD rq, matern32', { terms: [[
      { kind: 'rq', params: { sigma: 1, ell_0: 0.7, ell_1: 1.2, alpha: 2 }, ard: true },
      { kind: 'matern32', params: { sigma: 1, ell_0: 0.5, ell_1: 2 }, ard: true },
    ]] }, fromRows([[0, 0], [0.3, 1], [0.9, 0.2], [1.4, 1.7], [2, 0.5]])],
  ]
  for (const [name, spec, Xm] of cases) {
    it(`${name}: element-wise vs finite differences`, () => {
      const G = kernelGradients(spec, Xm)
      const F = fdGradients(spec, Xm)
      expect(G.length).toBe(F.length)
      for (let i = 0; i < G.length; i++) {
        const scale = Math.max(...Array.from(F[i].data, Math.abs), 1e-12)
        expect(maxAbsDiff(G[i], F[i].data) / scale).toBeLessThan(1e-5)
      }
    })
  }
})

describe('isKernelSpec', () => {
  const rbf = (params: Record<string, number>) => one({ kind: 'rbf', params })

  it('accepts a valid rbf spec', () => {
    expect(isKernelSpec({ terms: [[{ kind: 'rbf', params: { sigma: 1, ell: 1 } }]] })).toBe(true)
  })

  it('rejects the malformed inputs of Review Focus 5', () => {
    const bad: unknown[] = [
      { kind: 'foo' },
      { terms: [[{ kind: 'foo' }]] },
      { terms: [[{ kind: 'rbf', params: {} }]] },
      rbf({ sigma: 1, ell: -1 }),
      one({ kind: 'periodic', params: { sigma: 1, ell: 1, period: 0 } }),
      rbf({ sigma: 1, ell: NaN }),
      { terms: Array.from({ length: 1000 }, () => [{ kind: 'rbf', params: { sigma: 1, ell: 1 } }]) },
      one({ kind: 'polynomial', params: { c: 1, offset: 1, degree: 2.5 } }),
    ]
    for (const b of bad) expect(isKernelSpec(b)).toBe(false)
  })

  it('enforces the remaining structural limits', () => {
    const f = { kind: 'rbf', params: { sigma: 1, ell: 1 } }
    expect(isKernelSpec(null)).toBe(false)
    expect(isKernelSpec({ terms: [] })).toBe(false)
    expect(isKernelSpec({ terms: [[]] })).toBe(false)
    expect(isKernelSpec({ terms: Array(6).fill([f]) })).toBe(true)
    expect(isKernelSpec({ terms: Array(7).fill([f]) })).toBe(false)
    expect(isKernelSpec({ terms: [Array(4).fill(f)] })).toBe(true)
    expect(isKernelSpec({ terms: [Array(5).fill(f)] })).toBe(false)
    expect(isKernelSpec(rbf({ sigma: 1, ell: Infinity }))).toBe(false)
    expect(isKernelSpec(rbf({ sigma: 1, ell: 1, extra: 1 }))).toBe(false)
    expect(isKernelSpec({ terms: [[{ ...f, activeDims: [-1] }]] })).toBe(false)
    expect(isKernelSpec({ terms: [[{ ...f, activeDims: [0.5] }]] })).toBe(false)
    expect(isKernelSpec({ terms: [[{ ...f, activeDims: [1, 0] }]] })).toBe(true)
    expect(isKernelSpec({ terms: [[{ ...f, fixed: ['nope'] }]] })).toBe(false)
    expect(isKernelSpec({ terms: [[{ ...f, warp: { kind: 'circle', period: 0 } }]] })).toBe(false)
    expect(isKernelSpec({ terms: [[{ ...f, warp: { kind: 'tanh', a: 1, b: 5 } }]] })).toBe(false)
    expect(isKernelSpec({ terms: [[{ ...f, warp: { kind: 'log' } }]] })).toBe(true)
    // Degree 1..5 integer; p in [0.5, 3]
    for (const degree of [0, 6, 1.5]) {
      expect(isKernelSpec(one({ kind: 'polynomial', params: { c: 1, offset: 1, degree } }))).toBe(false)
    }
    expect(isKernelSpec(one({ kind: 'polynomial', params: { c: 1, offset: 1, degree: 5 } }))).toBe(true)
    expect(isKernelSpec(one({ kind: 'powexp', params: { sigma: 1, ell: 1, p: 0.4 } }))).toBe(false)
    expect(isKernelSpec(one({ kind: 'powexp', params: { sigma: 1, ell: 1, p: 3 } }))).toBe(true)
    // ARD needs ell_0..ell_{d-1} instead of ell
    expect(isKernelSpec(one({ kind: 'rbf', params: { sigma: 1, ell: 1 }, ard: true }))).toBe(false)
    expect(isKernelSpec(one({ kind: 'rbf', params: { sigma: 1, ell_0: 1, ell_2: 1 }, ard: true }))).toBe(false)
    expect(isKernelSpec(one({ kind: 'linear', params: { sigma0: 1, c: 0 }, ard: true }))).toBe(false)
    // sigma0 = 0 only when fixed
    expect(isKernelSpec(one({ kind: 'linear', params: { sigma0: 0, c: 0 } }))).toBe(false)
    expect(isKernelSpec(one({ kind: 'linear', params: { sigma0: 0, c: 0 }, fixed: ['sigma0'] }))).toBe(true)
    expect(isKernelSpec(one({ kind: 'constant', params: { c: 0 } }))).toBe(false)
  })
})

describe('checkValidity', () => {
  it('reports the exact spectrum of a matrix with a known negative eigenvalue', () => {
    // [[1,2,0],[2,1,0],[0,0,5]] has eigenvalues -1, 3, 5.
    const r = checkValidity(fromRows([[1, 2, 0], [2, 1, 0], [0, 0, 5]]))
    expect(r.eigenvalues.length).toBe(3)
    expect(Math.abs(r.eigenvalues[0] + 1)).toBeLessThan(1e-12)
    expect(Math.abs(r.eigenvalues[1] - 3)).toBeLessThan(1e-12)
    expect(Math.abs(r.eigenvalues[2] - 5)).toBeLessThan(1e-12)
    expect(r.minRel).toBeCloseTo(-0.2, 12)
    expect(r.valid).toBe(false)
  })

  it('treats round-off negatives below 1e-8·max|λ| as zero', () => {
    const r = checkValidity(fromRows([[2, 0], [0, -1e-9]]))
    expect(r.valid).toBe(true)
    expect(checkValidity(fromRows([[2, 0], [0, -1e-7]])).valid).toBe(false)
  })

  it('rbf ell=0.2 on linspace(0,2,200) is valid (Review Focus 6)', () => {
    const X = col(linspace(0, 2, 200))
    const r = checkValidity(kernelMatrix(one({ kind: 'rbf', params: { sigma: 1, ell: 0.2 } }), X, X))
    expect(r.valid).toBe(true)
    expect(r.minRel).toBeGreaterThan(-1e-8)
  })

  it('powexp with p=2 is valid, with p=3 invalid', () => {
    const X = col(linspace(0, 2, 200))
    const pe = (p: number) => one({ kind: 'powexp', params: { sigma: 1, ell: 0.2, p }, fixed: ['p'] })
    expect(checkValidity(kernelMatrix(pe(2), X, X)).valid).toBe(true)
    expect(checkValidity(kernelMatrix(pe(3), X, X)).valid).toBe(false)
  })

  it('reports non-finite matrices as invalid instead of throwing', () => {
    const r = checkValidity(fromRows([[1, NaN], [NaN, 1]]))
    expect(r.valid).toBe(false)
  })
})

describe('warps and white', () => {
  it('log warp on a grid containing 0 throws InvalidInput (logWarpDomain)', () => {
    const spec = one({ kind: 'rbf', params: { sigma: 1, ell: 1 }, warp: { kind: 'log' } })
    const X = col(linspace(0, 2, 5))
    expectThrowsCode(() => kernelMatrix(spec, X, X), 'InvalidInput', 'logWarpDomain')
    expectThrowsCode(() => kernelDiag(spec, X), 'InvalidInput', 'logWarpDomain')
  })

  it('square and log warps transform the input', () => {
    const X = col([0.5, 2])
    const sq = kernelMatrix(one({ kind: 'rbf', params: { sigma: 1, ell: 1 }, warp: { kind: 'square' } }), X, X)
    expect(sq.data[1]).toBeCloseTo(Math.exp(-0.5 * (4 - 0.25) ** 2), 14)
    const lg = kernelMatrix(one({ kind: 'rbf', params: { sigma: 1, ell: 1 }, warp: { kind: 'log' } }), X, X)
    expect(lg.data[1]).toBeCloseTo(Math.exp(-0.5 * Math.log(4) ** 2), 14)
  })

  it('warps require 1-D input', () => {
    const spec = one({ kind: 'rbf', params: { sigma: 1, ell: 1 }, warp: { kind: 'square' } })
    const X = fromRows([[0, 1], [1, 2]])
    expectThrowsCode(() => kernelMatrix(spec, X, X), 'InvalidInput')
  })

  it('white contributes only with sameSet', () => {
    const spec = one({ kind: 'white', params: { sigma: 2 } })
    const X = col([0, 1, 2])
    expect(Array.from(kernelMatrix(spec, X, X).data).every((v) => v === 0)).toBe(true)
    const K = kernelMatrix(spec, X, X, { sameSet: true })
    expect(K.data[0]).toBe(4)
    expect(K.data[1]).toBe(0)
  })

  it('kernelMatrix handles rectangular cross-covariances', () => {
    const spec = one({ kind: 'rbf', params: { sigma: 1.5, ell: 0.5 } })
    const K = kernelMatrix(spec, col([0, 1, 2]), col([0.5, 1.5]))
    expect(K.rows).toBe(3)
    expect(K.cols).toBe(2)
    expect(K.data[1]).toBeCloseTo(2.25 * Math.exp(-0.5 * (1.5 / 0.5) ** 2), 14)
  })

  it('rejects mismatched input dimensions and invalid specs', () => {
    const spec = one({ kind: 'rbf', params: { sigma: 1, ell: 1 } })
    expectThrowsCode(() => kernelMatrix(spec, col([0]), fromRows([[0, 1]])), 'InvalidInput')
    expectThrowsCode(
      () => kernelMatrix({ terms: [[{ kind: 'rbf', params: { sigma: 1, ell: -1 } }]] }, col([0]), col([0])),
      'InvalidInput',
    )
  })
})

describe('kernelTex', () => {
  it('renders a sum of products with per-factor parameter subscripts', () => {
    const tex = kernelTex({
      terms: [
        [{ kind: 'rbf', params: { sigma: 1, ell: 1 } }],
        [
          { kind: 'periodic', params: { sigma: 1, ell: 1, period: 1 } },
          { kind: 'linear', params: { sigma0: 1, c: 0 } },
        ],
      ],
    })
    expect(tex.startsWith("k(x,x') = ")).toBe(true)
    expect(tex).toContain('\\exp')
    expect(tex).toContain('\\sin^2')
    expect(tex).toContain(' + ')
    expect(tex).toContain('\\sigma_{1}')
  })

  it('has a formula for every kind', () => {
    const g = loadGolden('kernels')
    for (const e of g.entries) {
      const tex = kernelTex(e.spec)
      expect(tex.startsWith("k(x,x') = ")).toBe(true)
      expect(tex.length).toBeGreaterThan("k(x,x') = ".length)
    }
  })
})

describe('review fixes', () => {
  const hostile = {
    terms: [[{ kind: 'rbf', ard: true, warp: null, params: { sigma: 1, ell_0: 1 } }]],
  }

  it('isKernelSpec returns false (no TypeError) for ard with warp: null', () => {
    expect(() => isKernelSpec(hostile)).not.toThrow()
    expect(isKernelSpec(hostile)).toBe(false)
    expectThrowsCode(() => kernelMatrix(hostile as unknown as KernelSpec, col([0]), col([0])), 'InvalidInput')
  })

  it('guards only ever return false on other hostile shapes', () => {
    const base = { kind: 'rbf', params: { sigma: 1, ell: 1 } }
    const variants: unknown[] = [
      undefined, 42, 'x', [], { terms: null }, { terms: [null] }, { terms: [[null]] }, { terms: [[[]]] },
      { terms: [[{ ...base, params: null }]] },
      { terms: [[{ ...base, params: [] }]] },
      { terms: [[{ ...base, fixed: null }]] },
      { terms: [[{ ...base, fixed: 'sigma' }]] },
      { terms: [[{ ...base, activeDims: null }]] },
      { terms: [[{ ...base, activeDims: ['0'] }]] },
      { terms: [[{ ...base, warp: 'square' }]] },
      { terms: [[{ ...base, warp: [] }]] },
      { terms: [[{ ...base, warp: { kind: null } }]] },
      { terms: [[{ ...base, ard: 'yes', warp: null }]] },
      { terms: [[{ kind: 'rbf', ard: true, warp: 5, params: { sigma: 1, ell_0: 1 } }]] },
      { terms: [[{ kind: 'rbf', ard: true, warp: { kind: 'circle' }, params: { sigma: 1, ell_0: 1 } }]] },
      { terms: [[{ kind: 'toString', params: {} }]] },
      { terms: [[{ kind: '__proto__', params: {} }]] },
      JSON.parse('{"terms":[[{"kind":"rbf","params":{"sigma":1,"ell":1,"__proto__":{"x":1}}}]]}'),
    ]
    for (const v of variants) {
      expect(() => isKernelSpec(v)).not.toThrow()
      expect(isKernelSpec(v)).toBe(false)
      try {
        kernelMatrix(v as KernelSpec, col([0]), col([0]))
        throw new Error('expected a throw')
      } catch (e) {
        expect(e).toBeInstanceOf(GpError)
      }
    }
  })

  it('exports location/shape and log parameter metadata per kind', () => {
    expect(locationParams('rbf')).toEqual([])
    expect(locationParams('linear')).toEqual(['c'])
    expect(locationParams('polynomial')).toEqual(['c', 'offset', 'degree'])
    expect(locationParams('gibbs')).toEqual(['x0'])
    expect(locationParams('powexp')).toEqual(['p'])
    expect(locationParams('constant')).toEqual([])
    expect(logParams('gibbs')).toEqual(['sigma', 'l1', 'l2', 'w'])
    expect(kindParams('rq')).toEqual(['sigma', 'ell', 'alpha'])
    expect(Object.isFrozen(locationParams('polynomial'))).toBe(true)
  })

  it('enforces [1e-5, 1e5] on log-space parameters', () => {
    const rbf = (ell: number) => one({ kind: 'rbf', params: { sigma: 1, ell } })
    expect(isKernelSpec(rbf(1e-300))).toBe(false)
    expect(isKernelSpec(rbf(1e6))).toBe(false)
    expect(isKernelSpec(rbf(1e-5))).toBe(true)
    expect(isKernelSpec(rbf(1e5))).toBe(true)
    expect(isKernelSpec(one({ kind: 'white', params: { sigma: 2e5 } }))).toBe(false)
    expect(isKernelSpec(one({ kind: 'gibbs', params: { sigma: 1, l1: 1e-6, l2: 0.6, w: 0.3, x0: 1 } }))).toBe(false)
    expect(isKernelSpec(one({ kind: 'rbf', params: { sigma: 1, ell_0: 1, ell_1: 1e-9 }, ard: true }))).toBe(false)
    expect(isKernelSpec(one({ kind: 'linear', params: { sigma0: 1e-7, c: 0 } }))).toBe(false)
    expect(isKernelSpec(one({ kind: 'linear', params: { sigma0: 0, c: 0 }, fixed: ['sigma0'] }))).toBe(true)
    // Fixed log parameters must still lie in range, so freeParams stays within its bounds after unfixing.
    expect(isKernelSpec(one({ kind: 'rbf', params: { sigma: 1, ell: 1e6 }, fixed: ['ell'] }))).toBe(false)
    // Location parameters are not range-limited.
    expect(isKernelSpec(one({ kind: 'linear', params: { sigma0: 1, c: -1e7 } }))).toBe(true)
  })

  it('caps ARD at 10 dimensions', () => {
    const ard = (k: number) => {
      const params: Record<string, number> = { sigma: 1 }
      for (let j = 0; j < k; j++) params[`ell_${j}`] = 1
      return one({ kind: 'rbf', params, ard: true })
    }
    expect(isKernelSpec(ard(10))).toBe(true)
    expect(isKernelSpec(ard(11))).toBe(false)
  })

  it('kernelDiag counts white only with sameSet (default true)', () => {
    const spec: KernelSpec = {
      terms: [[{ kind: 'rbf', params: { sigma: 1, ell: 1 } }], [{ kind: 'white', params: { sigma: 2 } }]],
    }
    const X = col([0, 1])
    expect(Array.from(kernelDiag(spec, X))).toEqual([5, 5])
    expect(Array.from(kernelDiag(spec, X, { sameSet: true }))).toEqual([5, 5])
    expect(Array.from(kernelDiag(spec, X, { sameSet: false }))).toEqual([1, 1])
  })

  it('kernelTex shows the per-dimension sum for periodic unless the input is surely 1-D', () => {
    const per = (extra: Partial<BaseKernel> = {}) =>
      one({ kind: 'periodic', params: { sigma: 1, ell: 1, period: 1 }, ...extra })
    expect(kernelTex(per())).toContain('\\sum_j')
    expect(kernelTex(per(), { inputDim: 2 })).toContain('\\sum_j')
    expect(kernelTex(per(), { inputDim: 1 })).not.toContain('\\sum_j')
    expect(kernelTex(per({ activeDims: [1] }))).not.toContain('\\sum_j')
    expect(kernelTex(per({ warp: { kind: 'square' } }))).not.toContain('\\sum_j')
    expect(kernelTex(per({ warp: { kind: 'circle', period: 0.5 } }), { inputDim: 1 })).toContain('\\sum_j')
  })

  it('uses the exact sigma gradient 2k for finite-difference kinds', () => {
    const X = col(linspace(0, 2, 6))
    for (const f of [
      { kind: 'powexp', params: { sigma: 1.3, ell: 0.5, p: 1.5 }, fixed: ['p'] },
      { kind: 'gibbs', params: { sigma: 0.7, l1: 0.2, l2: 0.6, w: 0.3, x0: 1 }, fixed: ['x0'] },
      { kind: 'cosine', params: { sigma: 1.1, ell: 1.5 } },
      { kind: 'exponential', params: { sigma: 0.9, ell: 0.4 } },
    ] as BaseKernel[]) {
      const spec = one(f)
      const K = kernelMatrix(spec, X, X, { sameSet: true })
      const G = kernelGradients(spec, X)[0]
      expect(freeParams(spec, 1).names[0]).toBe('t0.f0.sigma')
      for (let k = 0; k < K.data.length; k++) expect(G.data[k]).toBe(2 * K.data[k])
    }
  })
})
