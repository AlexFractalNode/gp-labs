/**
 * Latest-wins client of the 2D sample worker: at most one job in flight plus the newest queued job; only the reply
 * to the newest request is delivered, older replies are dropped.
 */
import { GpError, type GpErrorCode } from '../../core/errors'
import type { KernelSpec } from '../../core/kernels'

export interface Sample2dRequest {
  id: number
  spec: KernelSpec
  /** Row-major inputs (rows × cols). */
  X: Float64Array
  cols: number
  /** One row of standard normals, length = rows. */
  u: Float64Array
}

export type Sample2dResponse =
  | { id: number; ok: true; sample: Float64Array }
  | { id: number; ok: false; code: GpErrorCode; reason?: string }

export type Sample2dResult = { ok: true; sample: Float64Array } | { ok: false; error: GpError }

const defaultCreateWorker = (): Worker =>
  new Worker(new URL('./sample2d.worker.ts', import.meta.url), { type: 'module' })

export function createSample2dClient(createWorker: () => Worker = defaultCreateWorker): {
  request(job: Omit<Sample2dRequest, 'id'>, onResult: (r: Sample2dResult) => void): void
  dispose(): void
} {
  let worker: Worker | null = null
  let busy = false
  let latest = 0
  let queued: Sample2dRequest | null = null
  let deliver: ((r: Sample2dResult) => void) | null = null

  function send(job: Sample2dRequest): void {
    busy = true
    // Plain copy: reactive proxies are not structured-cloneable.
    worker!.postMessage({ ...job, spec: JSON.parse(JSON.stringify(job.spec)) as KernelSpec })
  }

  function next(): void {
    busy = false
    if (queued) {
      const job = queued
      queued = null
      send(job)
    }
  }

  function ensureWorker(): Worker {
    if (worker) return worker
    const w = createWorker()
    w.onmessage = (ev: MessageEvent<Sample2dResponse>) => {
      const msg = ev.data
      if (msg.id === latest && deliver) {
        deliver(
          msg.ok ? { ok: true, sample: msg.sample } : { ok: false, error: new GpError(msg.code, { reason: msg.reason }) },
        )
      }
      next()
    }
    w.onerror = (ev) => {
      ev.preventDefault()
      console.error(ev.message)
      if (deliver) deliver({ ok: false, error: new GpError('InvalidInput', { reason: 'worker' }) })
      w.terminate()
      worker = null
      busy = false
      queued = null
    }
    worker = w
    return w
  }

  return {
    request(job, onResult) {
      const req: Sample2dRequest = { ...job, id: ++latest }
      deliver = onResult
      ensureWorker()
      if (busy) queued = req
      else send(req)
    },
    dispose() {
      deliver = null
      queued = null
      busy = false
      if (worker) {
        worker.onmessage = null
        worker.onerror = null
        worker.terminate()
        worker = null
      }
    },
  }
}
