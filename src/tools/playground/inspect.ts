/**
 * Inspector logic: posterior (or prior) moments at a single x*, plus the weight of the only data point.
 */
import { GpError } from '../../core/errors'
import { posterior, priorMoments } from '../../core/gp'
import { kernelMatrix } from '../../core/kernels'
import { fromRows, zeros } from '../../core/linalg'
import type { PlaygroundState } from './presets'

export interface InspectResult {
  mean: number
  sdF: number
  sdY: number
  /** k(x*,x1) / (k(x1,x1) + σn²); only with exactly 1 data point. */
  weight?: number
  /** Set when a GLS mean is underdetermined (fewer points than basis columns / identical x): prior moments are shown. */
  fallback?: 'glsUnderdetermined'
}

export function inspectAt(state: PlaygroundState, xStar: number): InspectResult {
  const { model, points } = state
  const Xs = fromRows([[xStar]])
  const X = points.length ? fromRows(points.map((p) => [p.x])) : zeros(0, 1)
  const y = Float64Array.from(points.map((p) => p.y))

  let post
  let fallback: InspectResult['fallback']
  try {
    post = posterior(model, X, y, Xs)
  } catch (e) {
    if (e instanceof GpError && e.code === 'InvalidInput' && model.mean.kind === 'gls' && e.details?.reason === 'glsRankDeficient') {
      post = priorMoments(model, Xs)
      fallback = 'glsUnderdetermined'
    } else throw e
  }

  const out: InspectResult = { mean: post.mean[0], sdF: post.sdF[0], sdY: post.sdY[0] }
  if (points.length === 1 && !fallback) {
    const cross = kernelMatrix(model.kernel, Xs, X, { sameSet: false }).data[0]
    const k11 = kernelMatrix(model.kernel, X, X, { sameSet: true }).data[0]
    out.weight = cross / (k11 + model.sigmaN * model.sigmaN)
  }
  if (fallback) out.fallback = fallback
  return out
}
