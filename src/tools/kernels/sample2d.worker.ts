/// <reference lib="webworker" />
/** One 2D prior sample (40 × 40 = 1600 points) off the main thread; the Cholesky factorisation takes ~1 s. */
import { GpError } from '../../core/errors'
import { kernelMatrix } from '../../core/kernels'
import type { Mat } from '../../core/linalg'
import { priorSamples } from './compute'
import type { Sample2dRequest, Sample2dResponse } from './sample2d'

const scope = self as unknown as DedicatedWorkerGlobalScope

scope.onmessage = (ev: MessageEvent<Sample2dRequest>) => {
  const { id, spec, X, cols, u } = ev.data
  try {
    const inputs: Mat = { rows: X.length / cols, cols, data: X }
    const K = kernelMatrix(spec, inputs, inputs, { sameSet: true })
    const [sample] = priorSamples(K, { rows: 1, cols: u.length, data: u })
    const msg: Sample2dResponse = { id, ok: true, sample }
    scope.postMessage(msg, [sample.buffer])
  } catch (e) {
    const msg: Sample2dResponse =
      e instanceof GpError
        ? { id, ok: false, code: e.code, reason: typeof e.details?.reason === 'string' ? e.details.reason : undefined }
        : { id, ok: false, code: 'InvalidInput', reason: 'internal' }
    if (!(e instanceof GpError)) console.error(e)
    scope.postMessage(msg)
  }
}
