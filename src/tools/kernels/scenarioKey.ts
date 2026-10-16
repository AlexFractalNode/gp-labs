/**
 * Settings key of the Kernel-Baukasten (Spec §3.2): preset name and kernel spec. Display state (sample seed, x₀
 * of the slice) is not part of it.
 */
import type { KernelSpec } from '../../core/kernels'
import { assertTool, canonicalKey, type Scenario } from '../scenarios'
import { loadKernelPreset } from './presets'

export interface KernelsSettingsKey {
  preset: string
  spec: KernelSpec
}

export function kernelsKey(s: KernelsSettingsKey): string {
  return canonicalKey({ preset: s.preset, spec: s.spec })
}

/**
 * Settings a Kernel-Baukasten scenario describes: `loadKernelPreset(query.preset)`, its spec replaced by
 * `kernels.spec` when set. Always a fresh deep copy. Throws for a scenario of another tool.
 */
export function expectedKernelsSettings(s: Scenario): KernelsSettingsKey {
  assertTool(s, 'kernels')
  const { preset } = loadKernelPreset(s.query.preset ?? null)
  const spec = s.kernels ? (JSON.parse(JSON.stringify(s.kernels.spec)) as KernelSpec) : preset.spec
  return { preset: preset.name, spec }
}
