import { describe, expect, it } from 'vitest'
import { GpError } from '../../src/core/errors'
import { calibration, coverage, r2, rmse } from '../../src/core/metrics'
import { createRng } from '../../src/core/rng'
import { normalQuantile } from '../../src/core/stats'

describe('normalQuantile', () => {
  it('matches known quantiles', () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 6)
    expect(normalQuantile(0.5)).toBe(0)
    expect(normalQuantile(0.841344746)).toBeCloseTo(1, 6)
    expect(normalQuantile(0.001)).toBeCloseTo(-3.090232306, 6)
    expect(normalQuantile(1e-10)).toBeCloseTo(-6.361340902, 5)
  })

  it('handles the edges', () => {
    expect(normalQuantile(0)).toBe(-Infinity)
    expect(normalQuantile(1)).toBe(Infinity)
    expect(normalQuantile(Number.NaN)).toBeNaN()
    expect(normalQuantile(1.5)).toBeNaN()
  })
})

describe('metrics', () => {
  it('r2 and rmse', () => {
    expect(rmse([1, 2, 3], [1, 2, 5])).toBeCloseTo(Math.sqrt(4 / 3), 12)
    expect(r2([1, 2, 3], [1, 2, 3])).toBe(1)
    expect(r2([1, 2, 3], [2, 2, 2])).toBeCloseTo(0, 12)
    // sklearn convention for a constant target
    expect(r2([2, 2], [2, 2])).toBe(1)
    expect(r2([2, 2], [1, 2])).toBe(0)
  })

  it('coverage counts points inside the closed interval', () => {
    expect(coverage([1, 2, 3, 4], [0, 2, 3.5, 0], [2, 3, 4, 3])).toBe(0.5)
  })

  it('throws InvalidInput on length mismatch or empty input', () => {
    expect(() => rmse([1], [1, 2])).toThrow(GpError)
    expect(() => r2([], [])).toThrow(GpError)
  })

  it('calibration on perfectly Gaussian data is within 0.02 of every level', () => {
    const rng = createRng(1)
    const n = 20000
    const mean: number[] = []
    const sd: number[] = []
    const y: number[] = []
    for (let i = 0; i < n; i++) {
      const m = 10 * rng.uniform() - 5
      const s = 0.1 + 2 * rng.uniform()
      mean.push(m)
      sd.push(s)
      y.push(m + s * rng.normal())
    }
    const cal = calibration(y, mean, sd)
    expect(cal.map((c) => c.level)).toEqual([0.5, 0.68, 0.8, 0.9, 0.95])
    for (const c of cal) expect(Math.abs(c.observed - c.level)).toBeLessThan(0.02)
  })
})
