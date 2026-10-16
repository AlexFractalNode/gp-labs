/** Proofs of scenario d3 (notebook template on log y, no restarts). Long run (≈ 60 s): own file. */
import { describe, expect, it } from 'vitest'
import { NOTEBOOK_SPLIT } from '../../../src/tools/datalab/pipeline'
import { claim, claimChapter, expectAllClaimed } from './claim'
import { bandWidthInSd, runDatalabScenario } from './datalabRun'

/** d1's test RMSE as proven (rounded) in d1.test.ts. */
const D1_RMSE = 0.392

describe('d3 scenario claims', () => {
  it('d3: test RMSE 0.369, no negative prediction, 29 of 31 inside ±2·s_y', { timeout: 300_000 }, () => {
    claimChapter('d3')
    const run = runDatalabScenario('d3')
    const { cfg, result: r } = run
    expect(cfg.template).toBe('notebook')
    expect(cfg.logTarget).toBe(true)
    expect(cfg.split).toBe(NOTEBOOK_SPLIT)
    // "without restarts"
    expect(cfg.restarts).toBe(0)

    claim('d3', '0.369', r.metrics.rmseTest, 3)
    // "smaller than in the notebook run"
    expect(r.metrics.rmseTest).toBeLessThan(D1_RMSE - 0.0005)
    // "no test prediction is negative any more" (and on the log scale none can be)
    expect(r.test.yPred.every((v) => v > 0)).toBe(true)
    expect(r.warnings).not.toContain('negativePredictions')
    claim('d3', '29', r.metrics.coveredCount, 0)
    claim('d3', '31', r.test.yTrue.length, 0)
    claim('d3', '2', bandWidthInSd(run), 0)
  })

  it('every listed number is proven', () => {
    expectAllClaimed('d3')
  })
})
