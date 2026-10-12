/**
 * Playground presets (Spec §4): factory functions returning fresh, independent state.
 */
import type { GpModel } from '../../core/gp'
import type { KernelSpec } from '../../core/kernels'
import { createRng } from '../../core/rng'

export interface PlaygroundState {
  points: { x: number; y: number }[]
  model: GpModel
  view: [number, number]
  truth?: (x: number) => number
  showPriorSamples: boolean
  seed: number
}

export type PresetName =
  | 'sine'
  | 'kap9'
  | 'mean-demo'
  | 'extrapolation'
  | 'hyper'
  | 'hyper-43'
  | 'hyper-45'
  | 'hyper-47'

const rbf = (sigma: number, ell: number): KernelSpec => ({ terms: [[{ kind: 'rbf', params: { sigma, ell } }]] })

const sineTruth = (x: number): number => Math.sin(4 * Math.PI * x) + Math.sin(7 * Math.PI * x)

function sineData(): { x: number; y: number }[] {
  const n = 500
  const rng = createRng(2026)
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1)
    pts.push({ x, y: sineTruth(x) + 0.4 * rng.normal() })
  }
  return pts
}

function sine(ell = 0.1, sigma = 2): PlaygroundState {
  return {
    points: sineData(),
    model: { kernel: rbf(sigma, ell), sigmaN: 0.4, mean: { kind: 'zero' } },
    view: [0, 1],
    truth: sineTruth,
    showPriorSamples: false,
    seed: 1,
  }
}

export const PRESETS: Record<PresetName, () => PlaygroundState> = {
  sine: () => sine(),
  kap9: () => ({
    points: [{ x: 0, y: 1 }],
    model: { kernel: rbf(1, 1), sigmaN: 0.5, mean: { kind: 'zero' } },
    view: [-4, 4],
    showPriorSamples: false,
    seed: 1,
  }),
  'mean-demo': () => ({
    points: [
      { x: 0, y: 20.1 },
      { x: 0.3, y: 20.8 },
      { x: 0.7, y: 22.0 },
      { x: 1, y: 22.9 },
    ],
    model: { kernel: rbf(1, 0.25), sigmaN: 0.2, mean: { kind: 'constant', c: 22 } },
    view: [-1, 2],
    showPriorSamples: false,
    seed: 1,
  }),
  extrapolation: () => ({
    points: [
      { x: -1, y: 0.5 },
      { x: -0.5, y: 1.2 },
      { x: 0, y: 0.8 },
      { x: 0.5, y: -0.3 },
    ],
    model: { kernel: rbf(1, 0.5), sigmaN: 0.1, mean: { kind: 'zero' } },
    view: [-1.5, 5],
    showPriorSamples: false,
    seed: 1,
  }),
  'hyper-43': () => sine(1, 2),
  'hyper-45': () => sine(0.001, 2),
  'hyper-47': () => sine(0.01, 5),
  hyper: () => sine(1, 2),
}

/** Resolves a preset name; null or unknown names fall back to 'sine' (unknown: true only for non-null unknown names). */
export function loadPreset(name: string | null): { state: PlaygroundState; unknown: boolean } {
  if (name === null) return { state: PRESETS.sine(), unknown: false }
  if (Object.prototype.hasOwnProperty.call(PRESETS, name)) return { state: PRESETS[name as PresetName](), unknown: false }
  return { state: PRESETS.sine(), unknown: true }
}
