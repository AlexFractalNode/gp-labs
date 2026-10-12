/**
 * Main-thread client for the hyperparameter worker. One run at a time: starting a run or cancelling terminates
 * the busy worker (a fresh one is created lazily) and every response is matched by `runId`, so a result of a
 * cancelled run is never applied.
 */
import { GpError, type GpErrorCode } from '../core/errors'
import type { GpModel } from '../core/gp'

export interface OptimizeJob {
  model: GpModel
  X: number[][]
  y: number[]
  restarts: number
  seed: number
  /** L-BFGS iteration limit per run (default 200; the Daten-Lab uses 500). */
  maxIter?: number
}

export interface OptimizeProgress {
  /** Index of the finished run (0 = start at the current parameters). */
  restart: number
  /** Best log ML so far. */
  logML: number
}

export interface OptimizeOutcome {
  model: GpModel
  logML: number
  atBound: string[]
}

export type WorkerRequest = { type: 'optimize'; runId: number; job: OptimizeJob }

export type WorkerResponse =
  | ({ type: 'progress'; runId: number } & OptimizeProgress)
  | ({ type: 'done'; runId: number } & OptimizeOutcome)
  | { type: 'error'; runId: number; code: GpErrorCode; details?: Record<string, unknown>; message: string }

export interface OptimizeHandle {
  runId: number
  result: Promise<OptimizeOutcome>
  cancel(): void
}

interface Pending {
  runId: number
  onProgress: (p: OptimizeProgress) => void
  resolve: (r: OptimizeOutcome) => void
  reject: (e: GpError) => void
}

const defaultCreateWorker = (): Worker =>
  new Worker(new URL('./gp.worker.ts', import.meta.url), { type: 'module' })

export function createOptimizeClient(createWorker: () => Worker = defaultCreateWorker): {
  startOptimize(job: OptimizeJob, onProgress: (p: OptimizeProgress) => void): OptimizeHandle
} {
  let worker: Worker | null = null
  let pending: Pending | null = null
  let lastRunId = 0

  function dropWorker(): void {
    if (!worker) return
    worker.onmessage = null
    worker.onerror = null
    worker.terminate()
    worker = null
  }

  function settle(runId: number): Pending | null {
    if (!pending || pending.runId !== runId) return null
    const p = pending
    pending = null
    return p
  }

  function onMessage(ev: MessageEvent<WorkerResponse>): void {
    const msg = ev.data
    if (!pending || msg.runId !== pending.runId) return // stale message of a cancelled or finished run
    if (msg.type === 'progress') {
      pending.onProgress({ restart: msg.restart, logML: msg.logML })
    } else if (msg.type === 'done') {
      settle(msg.runId)?.resolve({ model: msg.model, logML: msg.logML, atBound: msg.atBound })
    } else {
      settle(msg.runId)?.reject(new GpError(msg.code, msg.details, msg.message))
    }
  }

  function onError(ev: ErrorEvent): void {
    const p = pending
    pending = null
    dropWorker()
    p?.reject(new GpError('OptimizerFailed', { reason: 'workerError', message: ev.message }))
  }

  function ensureWorker(): Worker {
    if (!worker) {
      worker = createWorker()
      worker.onmessage = onMessage
      worker.onerror = onError
    }
    return worker
  }

  function cancelRun(runId: number): void {
    const p = settle(runId)
    if (!p) return
    dropWorker()
    p.reject(new GpError('OptimizerFailed', { cancelled: true }))
  }

  function startOptimize(job: OptimizeJob, onProgress: (p: OptimizeProgress) => void): OptimizeHandle {
    if (pending) cancelRun(pending.runId)
    const runId = ++lastRunId
    const result = new Promise<OptimizeOutcome>((resolve, reject) => {
      pending = { runId, onProgress, resolve, reject }
    })
    const request: WorkerRequest = { type: 'optimize', runId, job }
    ensureWorker().postMessage(request)
    return { runId, result, cancel: () => cancelRun(runId) }
  }

  return { startOptimize }
}

let defaultClient: ReturnType<typeof createOptimizeClient> | null = null

/** Starts a run on the shared default worker (created on first use). */
export function startOptimize(job: OptimizeJob, onProgress: (p: OptimizeProgress) => void): OptimizeHandle {
  defaultClient ??= createOptimizeClient()
  return defaultClient.startOptimize(job, onProgress)
}
