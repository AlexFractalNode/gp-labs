import { describe, expect, it } from 'vitest'
import { freeParams, withLogParams, type KernelSpec } from '../../src/core/kernels'
import { datalabKey, expectedDatalabSettings, type DatalabSettingsKey } from '../../src/tools/datalab/scenarioKey'
import { KERNEL_PRESETS } from '../../src/tools/kernels/presets'
import { expectedKernelsSettings, kernelsKey } from '../../src/tools/kernels/scenarioKey'
import { loadPreset } from '../../src/tools/playground/presets'
import {
  expectedPlaygroundSettings,
  playgroundKey,
  type PlaygroundSettings,
} from '../../src/tools/playground/scenarioKey'
import { scenarioById } from '../../src/tools/scenarios'

const sc = (id: string) => scenarioById(id)!

/** Multiplies every number in a JSON-like value by (1 + eps): round-off noise of a tween or a log round trip. */
function jiggle<T>(v: T, eps = 1e-15): T {
  if (typeof v === 'number') return (v * (1 + eps)) as T
  if (Array.isArray(v)) return v.map((x) => jiggle(x, eps)) as T
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jiggle(x, eps)])) as T
  }
  return v
}

/** Same object with the property order of every nested object reversed. */
function reversed<T>(v: T): T {
  if (Array.isArray(v)) return v.map(reversed) as T
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v)
        .reverse()
        .map(([k, x]) => [k, reversed(x)]),
    ) as T
  }
  return v
}

/** Playground settings as the view holds them right after loading a preset (no scenario helpers involved). */
function freshPlayground(preset: string, pinnedX: number | null): PlaygroundSettings {
  const { state } = loadPreset(preset)
  return { points: state.points, kernel: state.model.kernel, sigmaN: state.model.sigmaN, mean: state.model.mean, pinnedX }
}

describe('playground key', () => {
  it('equals the expectation for a freshly loaded preset and is memoised per scenario', () => {
    expect(playgroundKey(freshPlayground('kap9', 0))).toBe(playgroundKey(expectedPlaygroundSettings(sc('p1'))))
    expect(playgroundKey(freshPlayground('hyper-43', null))).toBe(playgroundKey(expectedPlaygroundSettings(sc('p3'))))
    expect(playgroundKey(freshPlayground('hyper-43', null))).toBe(playgroundKey(freshPlayground('hyper-43', null)))
    expect(expectedPlaygroundSettings(sc('p3'))).toBe(expectedPlaygroundSettings(sc('p3')))
    expect(expectedPlaygroundSettings(sc('p2')).pinnedX).toBe(3)
    expect(expectedPlaygroundSettings(sc('p3')).pinnedX).toBeNull()
  })

  it('ignores round-off noise and property order', () => {
    const base = expectedPlaygroundSettings(sc('p3'))
    const key = playgroundKey(base)
    expect(playgroundKey(jiggle(base))).toBe(key)
    expect(playgroundKey(reversed(base))).toBe(key)
    const p1 = freshPlayground('kap9', 0)
    expect(playgroundKey({ ...p1, kernel: reversed(p1.kernel), sigmaN: 0.5 * (1 + 1e-15) })).toBe(playgroundKey(p1))
  })

  it('is unchanged after moving a parameter back and forth in log space', () => {
    const base = expectedPlaygroundSettings(sc('p2'))
    const info = freeParams(base.kernel, 1)
    const there = Float64Array.from(info.logValues)
    there[1] += 0.37
    const moved = withLogParams(base.kernel, 1, there)
    const back = Float64Array.from(freeParams(moved, 1).logValues)
    back[1] -= 0.37
    const kernel = withLogParams(moved, 1, back)
    expect(playgroundKey({ ...base, kernel: moved })).not.toBe(playgroundKey(base))
    expect(playgroundKey({ ...base, kernel })).toBe(playgroundKey(base))
  })

  it('changes with σₙ, the points, x* and the mean', () => {
    const base = expectedPlaygroundSettings(sc('p1'))
    const key = playgroundKey(base)
    expect(playgroundKey({ ...base, sigmaN: 0.51 })).not.toBe(key)
    expect(playgroundKey({ ...base, points: [...base.points, { x: 1, y: 0 }] })).not.toBe(key)
    expect(playgroundKey({ ...base, points: [{ x: 0, y: 1.1 }] })).not.toBe(key)
    expect(playgroundKey({ ...base, pinnedX: 1 })).not.toBe(key)
    expect(playgroundKey({ ...base, pinnedX: null })).not.toBe(key)
    expect(playgroundKey({ ...base, mean: { kind: 'constant', c: 0 } })).not.toBe(key)
    expect(playgroundKey({ ...base, mean: { kind: 'gls', basis: 'constant' } })).not.toBe(key)
    expect(playgroundKey({ ...base, mean: { kind: 'gls', basis: 'linear' } })).not.toBe(
      playgroundKey({ ...base, mean: { kind: 'gls', basis: 'constant' } }),
    )
    const ell2: KernelSpec = { terms: [[{ kind: 'rbf', params: { sigma: 1, ell: 2 } }]] }
    expect(playgroundKey({ ...base, kernel: ell2 })).not.toBe(key)
  })
})

describe('kernels key', () => {
  it('expects the preset spec, replaced by the scenario spec when set', () => {
    expect(expectedKernelsSettings(sc('k1'))).toEqual({ preset: 'expquad', spec: KERNEL_PRESETS.expquad.spec })
    expect(expectedKernelsSettings(sc('k2')).spec).toEqual(KERNEL_PRESETS['lin-plus-periodic'].spec)
    const k3 = expectedKernelsSettings(sc('k3'))
    expect(k3.preset).toBe('power-exp')
    expect(k3.spec.terms[0][0].params.p).toBe(2.5)
    // A copy: editing the live spec never reaches the registry.
    k3.spec.terms[0][0].params.p = 1
    expect(expectedKernelsSettings(sc('k3')).spec.terms[0][0].params.p).toBe(2.5)
  })

  it('ignores noise and order, changes with p and the preset', () => {
    const k3 = expectedKernelsSettings(sc('k3'))
    const key = kernelsKey(k3)
    expect(kernelsKey(jiggle(k3))).toBe(key)
    expect(kernelsKey(reversed(k3))).toBe(key)
    const p2 = JSON.parse(JSON.stringify(k3)) as typeof k3
    p2.spec.terms[0][0].params.p = 2
    expect(kernelsKey(p2)).not.toBe(key)
    expect(kernelsKey({ ...k3, preset: 'expquad' })).not.toBe(key)
    expect(kernelsKey(expectedKernelsSettings(sc('k1')))).not.toBe(kernelsKey(expectedKernelsSettings(sc('k2'))))
  })
})

describe('data lab key', () => {
  it('expects the Yacht defaults plus the scenario settings', () => {
    const d3 = expectedDatalabSettings(sc('d3'))
    expect(d3).toEqual({
      source: 'yacht',
      target: 'y',
      features: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'],
      logTarget: true,
      testFraction: 0.1,
      seed: 42,
      notebookMode: true,
      subsample: false,
      template: 'notebook',
      restarts: 0,
    })
    expect(expectedDatalabSettings(sc('d1')).restarts).toBe(5)
    expect(expectedDatalabSettings(sc('d2')).template).toBe('rbf')
  })

  it('changes with template, log target and the other inputs, not with the feature order', () => {
    const d1 = expectedDatalabSettings(sc('d1'))
    const key = datalabKey(d1)
    const variants: Partial<DatalabSettingsKey>[] = [
      { template: 'rbf' },
      { logTarget: true },
      { restarts: 0 },
      { notebookMode: false },
      { testFraction: 0.2 },
      { seed: 7 },
      { subsample: true },
      { source: 'file' },
      { source: null },
      { target: 'a1' },
      { features: ['a1', 'a2'] },
    ]
    for (const v of variants) expect(datalabKey({ ...d1, ...v }), JSON.stringify(v)).not.toBe(key)
    expect(datalabKey({ ...d1, features: [...d1.features].reverse() })).toBe(key)
    expect(datalabKey(jiggle(d1))).toBe(key)
    expect(datalabKey(expectedDatalabSettings(sc('d1')))).not.toBe(datalabKey(expectedDatalabSettings(sc('d2'))))
    expect(datalabKey(expectedDatalabSettings(sc('d1')))).not.toBe(datalabKey(expectedDatalabSettings(sc('d3'))))
  })
})

describe('expectations of another tool', () => {
  it('throw', () => {
    expect(() => expectedPlaygroundSettings(sc('k1'))).toThrow()
    expect(() => expectedKernelsSettings(sc('d1'))).toThrow()
    expect(() => expectedDatalabSettings(sc('p1'))).toThrow()
  })
})
