/**
 * Settings key of the Daten-Lab (Spec §3.2): source, target, features, log target, split (test fraction, seed,
 * notebook split, subsample), template and restarts. The step card and the run results are not part of it.
 */
import { assertTool, canonicalKey, type Scenario } from '../scenarios'
import type { TemplateChoice } from './labState'

export interface DatalabSettingsKey {
  source: 'yacht' | 'file' | null
  target: string
  features: string[]
  logTarget: boolean
  testFraction: number
  seed: number
  notebookMode: boolean
  subsample: boolean
  template: TemplateChoice
  restarts: number
}

/** Features of the Yacht table, all numeric besides the target `y` (the notebook's X). */
export const YACHT_FEATURES: readonly string[] = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']

/** The features are a set (X always uses table column order), so their order does not change the key. */
export function datalabKey(s: DatalabSettingsKey): string {
  return canonicalKey({ ...s, features: [...s.features].sort() })
}

/**
 * Settings a Daten-Lab scenario describes: the Yacht defaults of DataLabView `resetSelection` (target `y`, every
 * other column a feature, test fraction 0.1, seed 42, no subsample) plus `datalab`; without `datalab` the view's
 * initial template and restarts. Throws for a scenario of another tool.
 */
export function expectedDatalabSettings(s: Scenario): DatalabSettingsKey {
  assertTool(s, 'datalab')
  const d = s.datalab ?? { template: 'notebook', logTarget: false, notebookMode: false, restarts: 5 }
  return {
    source: 'yacht',
    target: 'y',
    features: [...YACHT_FEATURES],
    logTarget: d.logTarget,
    testFraction: 0.1,
    seed: 42,
    notebookMode: d.notebookMode,
    subsample: false,
    template: d.template,
    restarts: d.restarts,
  }
}
