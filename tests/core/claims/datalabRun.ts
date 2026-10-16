/**
 * A Daten-Lab scenario run as the app does it: Yacht from public/data/yacht.csv, the expected settings of the
 * registry (`expectedDatalabSettings`), the optimiser with the worker's options (restarts, seed, maxIter 500) and
 * `evaluateRun` on the main-thread side (mirrors DataLabView `startRun`).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'
import { inferColumns, parseCsv } from '../../../src/core/csv'
import { optimizeHyperparameters } from '../../../src/core/optimize'
import {
  buildModelWithNotices,
  evaluateRun,
  NOTEBOOK_SPLIT,
  prepareDataset,
  prepareRun,
  splitIndices,
  type PreparedRun,
  type RunConfig,
  type RunResult,
} from '../../../src/tools/datalab/pipeline'
import { expectedDatalabSettings } from '../../../src/tools/datalab/scenarioKey'
import { scenarioById } from '../../../src/tools/scenarios'

/** maxIter of DataLabView (MAX_ITER) and thus of the worker job. */
const MAX_ITER = 500

export interface ScenarioRun {
  cfg: RunConfig
  prep: PreparedRun
  result: RunResult
}

export function runDatalabScenario(id: string): ScenarioRun {
  const s = scenarioById(id)
  expect(s, id).not.toBeNull()
  const e = expectedDatalabSettings(s!)
  expect(e.source).toBe('yacht')
  expect(e.subsample).toBe(false)
  expect(e.template).not.toBe('baukasten')
  const template = e.template as Exclude<typeof e.template, 'baukasten'>

  const url = new URL('../../../public/data/yacht.csv', import.meta.url)
  const table = parseCsv(readFileSync(fileURLToPath(url), 'utf8'))
  // The view's defaults (`resetSelection`): every usable numeric column except the target is a feature.
  const usable = inferColumns(table)
    .filter((c) => c.type === 'numeric' && !c.constant && c.name !== e.target)
    .map((c) => c.name)
  expect(usable).toEqual(e.features)
  const dataset = prepareDataset(table, e.target, e.features)
  const split = e.notebookMode ? NOTEBOOK_SPLIT : splitIndices(dataset.X.rows, e.testFraction, e.seed)
  const cfg: RunConfig = { dataset, split, logTarget: e.logTarget, template, restarts: e.restarts, seed: e.seed }

  const prep = prepareRun(cfg)
  const { model, notices } = buildModelWithNotices(template, dataset.X.cols)
  expect(notices).toEqual([])
  const opt = optimizeHyperparameters(model, prep.Xtrain, prep.ytrain, { restarts: e.restarts, seed: e.seed, maxIter: MAX_ITER })
  const result = evaluateRun(cfg, opt.model, opt.logML, opt.atBound)
  return { cfg, prep, result }
}

/** Half-width of the band in units of sdY (2 for ±2·s_y), measured on the first test point. */
export function bandWidthInSd(run: ScenarioRun): number {
  const { result, prep } = run
  const t = result.test
  const f = prep.logTarget ? Math.log : (v: number) => v
  return (f(t.upperY[0]) - f(t.yPred[0])) / (t.sdY[0] * prep.yScale)
}
