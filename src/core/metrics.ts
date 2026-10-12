/** Error and uncertainty metrics of a regression (Lehrbuch Kap. 14, 15, 17). */
import { GpError } from './errors'
import { normalQuantile } from './stats'

function checkLengths(...arrays: ArrayLike<number>[]): number {
  const n = arrays[0].length
  if (n === 0) throw new GpError('InvalidInput', { reason: 'emptyMetricInput' })
  for (const a of arrays) {
    if (a.length !== n) throw new GpError('InvalidInput', { reason: 'metricLengthMismatch', expected: n, got: a.length })
  }
  return n
}

/** Coefficient of determination 1 − SS_res/SS_tot. Constant yTrue: 1 for a perfect fit, else 0 (sklearn). */
export function r2(yTrue: ArrayLike<number>, yPred: ArrayLike<number>): number {
  const n = checkLengths(yTrue, yPred)
  let mean = 0
  for (let i = 0; i < n; i++) mean += yTrue[i]
  mean /= n
  let ssRes = 0
  let ssTot = 0
  for (let i = 0; i < n; i++) {
    ssRes += (yTrue[i] - yPred[i]) ** 2
    ssTot += (yTrue[i] - mean) ** 2
  }
  if (ssTot === 0) return ssRes === 0 ? 1 : 0
  return 1 - ssRes / ssTot
}

/** Root mean squared error. */
export function rmse(yTrue: ArrayLike<number>, yPred: ArrayLike<number>): number {
  const n = checkLengths(yTrue, yPred)
  let s = 0
  for (let i = 0; i < n; i++) s += (yTrue[i] - yPred[i]) ** 2
  return Math.sqrt(s / n)
}

/** Fraction of yTrue inside the closed intervals [lower, upper]. */
export function coverage(yTrue: ArrayLike<number>, lower: ArrayLike<number>, upper: ArrayLike<number>): number {
  const n = checkLengths(yTrue, lower, upper)
  let k = 0
  for (let i = 0; i < n; i++) if (yTrue[i] >= lower[i] && yTrue[i] <= upper[i]) k++
  return k / n
}

/**
 * Calibration curve of Gaussian predictive distributions N(mean, sd²): for each nominal level, the observed
 * fraction of |yTrue − mean| ≤ z·sd with z = Φ⁻¹((1 + level)/2).
 */
export function calibration(
  yTrue: ArrayLike<number>,
  mean: ArrayLike<number>,
  sd: ArrayLike<number>,
  levels: readonly number[] = [0.5, 0.68, 0.8, 0.9, 0.95],
): { level: number; observed: number }[] {
  const n = checkLengths(yTrue, mean, sd)
  return levels.map((level) => {
    if (!(level > 0 && level < 1)) throw new GpError('InvalidInput', { reason: 'calibrationLevel', level })
    const z = normalQuantile((1 + level) / 2)
    let k = 0
    for (let i = 0; i < n; i++) if (Math.abs(yTrue[i] - mean[i]) <= z * sd[i]) k++
    return { level, observed: k / n }
  })
}
