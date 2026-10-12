import { describe, expect, it } from 'vitest'
import { GpError } from '../../src/core/errors'
import {
  cholesky,
  colVec,
  fromRows,
  inverseFromCholesky,
  matMul,
  solveLower,
  solveUpperT,
  symEigenvalues,
  toRows,
  transpose,
  zeros,
} from '../../src/core/linalg'

const spd3 = () => fromRows([[4, 1, 0.5], [1, 3, 0.2], [0.5, 0.2, 2]])

describe('cholesky', () => {
  it('factorises [[4,2],[2,3]] without jitter', () => {
    const { L, jitter } = cholesky(fromRows([[4, 2], [2, 3]]))
    const r = toRows(L)
    expect(r[0][0]).toBeCloseTo(2, 14)
    expect(r[0][1]).toBe(0)
    expect(r[1][0]).toBeCloseTo(1, 14)
    expect(r[1][1]).toBeCloseTo(Math.SQRT2, 14)
    expect(jitter).toBe(0)
  })

  it('adds jitter for the singular [[1,1],[1,1]]', () => {
    const { jitter } = cholesky(fromRows([[1, 1], [1, 1]]))
    expect(jitter).toBeGreaterThan(0)
  })

  it('throws NotPositiveDefinite for an indefinite matrix', () => {
    try {
      cholesky(fromRows([[1, 2], [2, 1]]))
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(GpError)
      expect((e as GpError).code).toBe('NotPositiveDefinite')
      expect((e as GpError).details?.lastJitter).toBeGreaterThan(0)
    }
  })

  it('throws InvalidInput for NaN and Infinity, never returns NaN', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      try {
        cholesky(fromRows([[bad, 0], [0, 1]]))
        expect.unreachable()
      } catch (e) {
        expect(e).toBeInstanceOf(GpError)
        expect((e as GpError).code).toBe('InvalidInput')
      }
    }
  })

  it('throws InvalidInput for a non-square matrix', () => {
    expect(() => cholesky(zeros(2, 3))).toThrow(GpError)
  })

  it('honours jitterScale', () => {
    const t = 1e-14
    const A = fromRows([[t, t], [t, t]])
    expect(cholesky(A, { jitterScale: 1 }).jitter).toBeGreaterThanOrEqual(1e-10)
    // default scaling is mean(diag) = 1e-14 -> jitter ~1e-24
    expect(cholesky(A).jitter).toBeLessThan(1e-20)
  })

  it('falls back to scale 1 when the mean diagonal is not positive', () => {
    const { jitter } = cholesky(fromRows([[0, 0], [0, 0]]))
    expect(jitter).toBeGreaterThanOrEqual(1e-10)
  })
})

describe('triangular solves and inverse', () => {
  it('inverseFromCholesky(L) * A = I', () => {
    const A = spd3()
    const { L } = cholesky(A)
    const P = matMul(inverseFromCholesky(L), A)
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) expect(P.data[i * 3 + j]).toBeCloseTo(i === j ? 1 : 0, 12)
  })

  it('solveUpperT(L, solveLower(L, b)) = A^-1 b', () => {
    const A = spd3()
    const { L } = cholesky(A)
    const b = colVec([1, -2, 3])
    const x = solveUpperT(L, solveLower(L, b))
    const Ax = matMul(A, x)
    for (let i = 0; i < 3; i++) expect(Ax.data[i]).toBeCloseTo(b.data[i], 12)
  })

  it('transpose and matMul basics', () => {
    const a = fromRows([[1, 2, 3], [4, 5, 6]])
    expect(toRows(transpose(a))).toEqual([[1, 4], [2, 5], [3, 6]])
    expect(toRows(matMul(a, transpose(a)))).toEqual([[14, 32], [32, 77]])
    expect(() => matMul(a, a)).toThrow(GpError)
  })
})

describe('symEigenvalues', () => {
  it('returns [1,3] for [[2,1],[1,2]]', () => {
    const ev = symEigenvalues(fromRows([[2, 1], [1, 2]]))
    expect(ev[0]).toBeCloseTo(1, 12)
    expect(ev[1]).toBeCloseTo(3, 12)
  })

  it('is ascending and trace-preserving on a random symmetric matrix', () => {
    const n = 30
    let s = 1
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5
    const A = zeros(n, n)
    for (let i = 0; i < n; i++)
      for (let j = 0; j <= i; j++) A.data[i * n + j] = A.data[j * n + i] = rnd()
    const ev = symEigenvalues(A)
    let tr = 0
    for (let i = 0; i < n; i++) tr += A.data[i * n + i]
    expect(Array.from(ev).reduce((a, b) => a + b, 0)).toBeCloseTo(tr, 10)
    for (let i = 1; i < n; i++) expect(ev[i]).toBeGreaterThanOrEqual(ev[i - 1])
  })

  it('throws InvalidInput on NaN', () => {
    expect(() => symEigenvalues(fromRows([[NaN, 0], [0, 1]]))).toThrow(GpError)
  })
})
