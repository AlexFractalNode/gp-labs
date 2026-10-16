/** Proofs of scenario d1 (notebook split, notebook template, 5 restarts). Long run (≈ 25 s): own file. */
import { describe, expect, it } from 'vitest'
import { NOTEBOOK_SPLIT } from '../../../src/tools/datalab/pipeline'
import { claim, claimChapter, expectAllClaimed } from './claim'
import { bandWidthInSd, runDatalabScenario } from './datalabRun'

describe('d1 scenario claims', () => {
  it('d1: test RMSE 0.392, log ML 324.65, 2 of 31 predictions negative, 28 of 31 inside ±2·s_y', { timeout: 300_000 }, () => {
    claimChapter('d1')
    const run = runDatalabScenario('d1')
    const { cfg, result: r } = run
    expect(cfg.template).toBe('notebook')
    expect(cfg.logTarget).toBe(false)
    expect(cfg.split).toBe(NOTEBOOK_SPLIT)
    claim('d1', '5', cfg.restarts, 0)

    claim('d1', '0.392', r.metrics.rmseTest, 3)
    claim('d1', '324.65', r.logML, 2)
    const negatives = r.test.yPred.filter((v) => v < 0).length
    claim('d1', '2', negatives, 0)
    // "although a resistance is never negative – the result warns about it"
    expect(run.prep.yTrainOrig.every((v) => v > 0)).toBe(true)
    expect(r.test.yTrue.every((v) => v > 0)).toBe(true)
    expect(r.warnings).toContain('negativePredictions')
    claim('d1', '31', r.test.yTrue.length, 0)
    claim('d1', '28', r.metrics.coveredCount, 0)
    claim('d1', '2', bandWidthInSd(run), 0)
  })

  it('every listed number is proven', () => {
    expectAllClaimed('d1')
  })
})
