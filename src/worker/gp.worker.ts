/// <reference lib="webworker" />
/** Hyperparameter optimisation off the main thread. Protocol: see WorkerRequest / WorkerResponse in client.ts. */
import { GpError } from '../core/errors'
import { fromRows } from '../core/linalg'
import { optimizeHyperparameters } from '../core/optimize'
import type { WorkerRequest, WorkerResponse } from './client'

const scope = self as unknown as DedicatedWorkerGlobalScope

function post(msg: WorkerResponse): void {
  scope.postMessage(msg)
}

scope.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const { runId, job } = ev.data
  try {
    const res = optimizeHyperparameters(job.model, fromRows(job.X), Float64Array.from(job.y), {
      restarts: job.restarts,
      seed: job.seed,
      maxIter: job.maxIter,
      onProgress: (p) => post({ type: 'progress', runId, ...p }),
    })
    post({ type: 'done', runId, model: res.model, logML: res.logML, atBound: res.atBound })
  } catch (e) {
    if (e instanceof GpError) {
      post({ type: 'error', runId, code: e.code, details: e.details, message: e.message })
    } else {
      const message = e instanceof Error ? e.message : String(e)
      post({ type: 'error', runId, code: 'OptimizerFailed', details: { reason: 'internal', message }, message })
    }
  }
}
