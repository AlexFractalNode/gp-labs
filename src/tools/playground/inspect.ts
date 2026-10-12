/**
 * Inspector logic: posterior (or prior) moments at a single x*, plus the Kap. 9 terms of the only data point.
 */
import { GpError } from '../../core/errors'
import { posterior, priorMoments, type Fit } from '../../core/gp'
import { kernelMatrix } from '../../core/kernels'
import { fromRows, zeros } from '../../core/linalg'
import { meanValues } from '../../core/mean'
import type { PlaygroundState } from './presets'

/** Kap. 9 one-point terms: w = k*1 / (k11 + σn²), f̄* = m* + w (y1 − m1), s_f² = k** − w k*1. */
export interface OnePointTerms {
  /** k(x*, x1) */
  kStar1: number
  /** k(x1, x1) (white terms included, as in K) */
  k11: number
  /** k(x*, x*) (latent f, white terms excluded) */
  kStarStar: number
  /** m(x*) and m(x1) of the prescribed mean */
  mStar: number
  m1: number
}

export interface InspectResult {
  mean: number
  sdF: number
  sdY: number
  /** k(x*,x1) / (k(x1,x1) + σn²); only with exactly 1 data point. */
  weight?: number
  /** Terms behind `weight`; only with exactly 1 data point and a prescribed (non-GLS) mean. */
  onePoint?: OnePointTerms
  /** Set when a GLS mean is underdetermined (fewer points than basis columns / identical x): prior moments are shown. */
  fallback?: 'glsUnderdetermined'
}

/**
 * Moments at x*. `opts.fit` (a core `fitModel` result for state.model and state.points) avoids refactorising
 * C_X; without it the fit is computed here.
 */
export function inspectAt(state: PlaygroundState, xStar: number, opts?: { fit?: Fit }): InspectResult {
  const { model, points } = state
  const Xs = fromRows([[xStar]])
  const X = points.length ? fromRows(points.map((p) => [p.x])) : zeros(0, 1)
  const y = Float64Array.from(points.map((p) => p.y))

  let post
  let fallback: InspectResult['fallback']
  try {
    post = posterior(model, X, y, Xs, opts?.fit ? { fit: opts.fit } : undefined)
  } catch (e) {
    if (e instanceof GpError && e.code === 'InvalidInput' && model.mean.kind === 'gls' && e.details?.reason === 'glsRankDeficient') {
      post = priorMoments(model, Xs)
      fallback = 'glsUnderdetermined'
    } else throw e
  }

  const out: InspectResult = { mean: post.mean[0], sdF: post.sdF[0], sdY: post.sdY[0] }
  if (points.length === 1 && !fallback) {
    const kStar1 = kernelMatrix(model.kernel, Xs, X, { sameSet: false }).data[0]
    const k11 = kernelMatrix(model.kernel, X, X, { sameSet: true }).data[0]
    out.weight = kStar1 / (k11 + model.sigmaN * model.sigmaN)
    if (model.mean.kind !== 'gls') {
      out.onePoint = {
        kStar1,
        k11,
        kStarStar: kernelMatrix(model.kernel, Xs, Xs, { sameSet: false }).data[0],
        mStar: meanValues(model.mean, Xs)[0],
        m1: meanValues(model.mean, X)[0],
      }
    }
  }
  if (fallback) out.fallback = fallback
  return out
}
