/**
 * Settings key of the Playground (Spec §3.2): points, kernel spec, σₙ, mean function and pinned x*. The view
 * builds its live settings in the same format; a key different from the scenario's means "changed". Display state
 * (layers, sample seed, hover) is not part of it.
 */
import type { KernelSpec } from '../../core/kernels'
import type { MeanSpec } from '../../core/mean'
import { KERNEL_PARAM } from '../../urlState'
import { assertTool, canonicalKey, type Scenario } from '../scenarios'
import { resolveKernel, type Point } from './compute'
import { loadPreset } from './presets'

export interface PlaygroundSettings {
  points: Point[]
  kernel: KernelSpec
  sigmaN: number
  mean: MeanSpec
  pinnedX: number | null
}

export function playgroundKey(s: PlaygroundSettings): string {
  return canonicalKey({
    points: s.points.map((p) => [p.x, p.y]),
    kernel: s.kernel,
    sigmaN: s.sigmaN,
    mean: s.mean,
    pinnedX: s.pinnedX,
  })
}

const finite = (v: number) => (Number.isFinite(v) ? v : 0)

/** The mean function as PlaygroundView's `mean` computed rebuilds it from a preset mean (kind + parameters). */
export function viewMean(m: MeanSpec): MeanSpec {
  switch (m.kind) {
    case 'constant':
      return { kind: 'constant', c: finite(m.c) }
    case 'linear':
      return { kind: 'linear', a: finite(m.a), b: [finite(m.b[0] ?? 0)] }
    case 'gls':
      return { kind: 'gls', basis: m.basis === 'linear' ? 'linear' : 'constant' }
    default:
      return { kind: 'zero' }
  }
}

/** x* from the `x` parameter as PlaygroundView `load()` reads it (missing, blank or non-finite → none). */
function pinnedFrom(x: string | undefined): number | null {
  if (x === undefined || x.trim() === '') return null
  const v = Number(x)
  return Number.isFinite(v) ? v : null
}

const memo = new Map<string, PlaygroundSettings>()

/**
 * Settings a Playground scenario describes: `loadPreset(query.preset)` + `resolveKernel(query.kernel)`, x* from
 * `query.x`. Memoised per scenario id (the sine presets would rebuild 500 points per call); the result is shared,
 * so callers must not mutate it. Throws for a scenario of another tool.
 */
export function expectedPlaygroundSettings(s: Scenario): PlaygroundSettings {
  assertTool(s, 'playground')
  const hit = memo.get(s.id)
  if (hit) return hit
  const { state } = loadPreset(s.query.preset ?? null)
  const { model } = resolveKernel(s.query[KERNEL_PARAM] ?? null, state.model)
  const settings: PlaygroundSettings = {
    points: state.points,
    kernel: model.kernel,
    sigmaN: model.sigmaN,
    mean: viewMean(model.mean),
    pinnedX: pinnedFrom(s.query.x),
  }
  memo.set(s.id, settings)
  return settings
}
