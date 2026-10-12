import { describe, expect, it } from 'vitest'
import { createRng } from '../../src/core/rng'

describe('createRng', () => {
  it('is deterministic per seed', () => {
    const a = createRng(7)
    const b = createRng(7)
    for (let i = 0; i < 100; i++) expect(a.normal()).toBe(b.normal())
    expect(createRng(7).uniform()).not.toBe(createRng(8).uniform())
  })

  it('uniform lies in [0,1)', () => {
    const r = createRng(1)
    for (let i = 0; i < 1000; i++) {
      const u = r.uniform()
      expect(u).toBeGreaterThanOrEqual(0)
      expect(u).toBeLessThan(1)
    }
  })

  it('normals have mean ~0 and variance ~1 and are finite', () => {
    const r = createRng(7)
    const n = 1e5
    let s = 0
    let s2 = 0
    for (let i = 0; i < n; i++) {
      const z = r.normal()
      expect(Number.isFinite(z)).toBe(true)
      s += z
      s2 += z * z
    }
    const mean = s / n
    expect(Math.abs(mean)).toBeLessThan(0.01)
    expect(Math.abs(s2 / n - mean * mean - 1)).toBeLessThan(0.01)
  })
})
