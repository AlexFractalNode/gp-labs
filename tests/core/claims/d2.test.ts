/** Proofs of scenario d2 (as d1 with the RBF template). Long run (≈ 55 s): own file. */
import { describe, expect, it } from 'vitest'
import { NOTEBOOK_SPLIT } from '../../../src/tools/datalab/pipeline'
import { claim, claimChapter, expectAllClaimed } from './claim'
import { runDatalabScenario } from './datalabRun'

/** d1's values as proven (rounded) in d1.test.ts; "worse than the notebook kernel" must hold for every value that rounds to them. */
const D1 = { rmseTest: 0.392, logML: 324.65 }

describe('d2 scenario claims', () => {
  it('d2: test RMSE 0.421 and log ML 305.75, both worse than d1', { timeout: 300_000 }, () => {
    claimChapter('d2')
    const { cfg, result: r } = runDatalabScenario('d2')
    expect(cfg.template).toBe('rbf')
    expect(cfg.logTarget).toBe(false)
    expect(cfg.split).toBe(NOTEBOOK_SPLIT)
    expect(cfg.restarts).toBe(5)

    claim('d2', '0.421', r.metrics.rmseTest, 3)
    claim('d2', '305.75', r.logML, 2)
    expect(r.metrics.rmseTest).toBeGreaterThan(D1.rmseTest + 0.0005)
    expect(r.logML).toBeLessThan(D1.logML - 0.005)
    // d2.next: "the negative predictions disappear" (with the log target) presumes d2 has some
    expect(r.test.yPred.some((v) => v < 0)).toBe(true)
    expect(r.warnings).toContain('negativePredictions')
  })

  it('every listed number is proven', () => {
    expectAllClaimed('d2')
  })
})
