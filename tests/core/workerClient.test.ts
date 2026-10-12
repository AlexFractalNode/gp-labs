import { describe, expect, it } from 'vitest'
import { GpError } from '../../src/core/errors'
import type { GpModel } from '../../src/core/gp'
import { createOptimizeClient, type OptimizeJob, type WorkerRequest, type WorkerResponse } from '../../src/worker/client'

/** Minimal stand-in for a dedicated Worker: records posted requests, lets the test emit responses. */
class FakeWorker {
  onmessage: ((ev: MessageEvent<WorkerResponse>) => void) | null = null
  onerror: ((ev: ErrorEvent) => void) | null = null
  onmessageerror: ((ev: MessageEvent) => void) | null = null
  posted: WorkerRequest[] = []
  terminated = false
  throwOnPost = false
  postMessage(msg: WorkerRequest): void {
    if (this.throwOnPost) throw new Error('DataCloneError')
    this.posted.push(msg)
  }
  terminate(): void {
    this.terminated = true
  }
  emit(msg: WorkerResponse): void {
    this.onmessage?.({ data: msg } as MessageEvent<WorkerResponse>)
  }
}

const model = (ell: number): GpModel => ({
  kernel: { terms: [[{ kind: 'rbf', params: { sigma: 1, ell } }]] },
  sigmaN: 0.1,
  mean: { kind: 'zero' },
})
const job = (ell: number): OptimizeJob => ({ model: model(ell), X: [[0], [1]], y: [0, 1], restarts: 1, seed: 0 })

function setup(opts: { throwOnPost?: boolean } = {}) {
  const workers: FakeWorker[] = []
  const client = createOptimizeClient(() => {
    const w = new FakeWorker()
    w.throwOnPost = workers.length === 0 && !!opts.throwOnPost
    workers.push(w)
    return w as unknown as Worker
  })
  return { workers, client }
}

describe('worker client', () => {
  it('ignores a stale result after cancel + restart; only the new run resolves (Review Focus 4)', async () => {
    const { workers, client } = setup()
    const progressA: number[] = []
    const progressB: number[] = []
    const a = client.startOptimize(job(1), (p) => progressA.push(p.logML))
    const aOutcome = a.result.then(
      () => 'resolved',
      (e: unknown) => e,
    )
    a.cancel()
    expect(workers[0].terminated).toBe(true)

    const b = client.startOptimize(job(2), (p) => progressB.push(p.logML))
    expect(b.runId).not.toBe(a.runId)
    expect(workers).toHaveLength(2)
    expect(workers[1].posted[0]).toMatchObject({ type: 'optimize', runId: b.runId })

    // Stale messages for A arrive (on the old and on the new worker) before B's result.
    workers[0].emit({ type: 'done', runId: a.runId, model: model(9), logML: 99, atBound: [] })
    workers[1].emit({ type: 'progress', runId: a.runId, restart: 0, logML: 98 })
    workers[1].emit({ type: 'done', runId: a.runId, model: model(9), logML: 99, atBound: [] })
    workers[1].emit({ type: 'progress', runId: b.runId, restart: 0, logML: -5 })
    workers[1].emit({ type: 'done', runId: b.runId, model: model(3), logML: -4, atBound: ['sigmaN'] })

    const resB = await b.result
    expect(resB.logML).toBe(-4)
    expect(resB.model).toEqual(model(3))
    expect(resB.atBound).toEqual(['sigmaN'])
    expect(progressA).toEqual([])
    expect(progressB).toEqual([-5])

    const errA = await aOutcome
    expect(errA).toBeInstanceOf(GpError)
    expect(errA).toMatchObject({ code: 'OptimizerFailed', details: { cancelled: true } })
  })

  it('reuses the worker for consecutive runs and rebuilds GpError from error messages', async () => {
    const { workers, client } = setup()
    const a = client.startOptimize(job(1), () => {})
    workers[0].emit({ type: 'done', runId: a.runId, model: model(1), logML: 1, atBound: [] })
    await a.result
    const b = client.startOptimize(job(1), () => {})
    expect(workers).toHaveLength(1)
    workers[0].emit({ type: 'error', runId: b.runId, code: 'OptimizerFailed', details: { reason: 'x' }, message: 'm' })
    await expect(b.result).rejects.toMatchObject({ code: 'OptimizerFailed', details: { reason: 'x' } })
  })

  it('starting a new run cancels the pending one', async () => {
    const { workers, client } = setup()
    const a = client.startOptimize(job(1), () => {})
    const b = client.startOptimize(job(2), () => {})
    await expect(a.result).rejects.toMatchObject({ code: 'OptimizerFailed', details: { cancelled: true } })
    expect(workers[0].terminated).toBe(true)
    workers[1].emit({ type: 'done', runId: b.runId, model: model(2), logML: 0, atBound: [] })
    await expect(b.result).resolves.toMatchObject({ logML: 0 })
  })

  it('rejects with OptimizerFailed when the worker crashes and recreates it for the next run', async () => {
    const { workers, client } = setup()
    const a = client.startOptimize(job(1), () => {})
    workers[0].onerror?.({ message: 'crash' } as ErrorEvent)
    await expect(a.result).rejects.toMatchObject({ code: 'OptimizerFailed' })
    client.startOptimize(job(1), () => {})
    expect(workers).toHaveLength(2)
  })

  it('cancel after completion is a no-op', async () => {
    const { workers, client } = setup()
    const a = client.startOptimize(job(1), () => {})
    workers[0].emit({ type: 'done', runId: a.runId, model: model(1), logML: 1, atBound: [] })
    await a.result
    a.cancel()
    expect(workers[0].terminated).toBe(false)
  })

  it('rejects (no orphaned pending run) when postMessage throws synchronously, then recovers', async () => {
    const { workers, client } = setup({ throwOnPost: true })
    const a = client.startOptimize(job(1), () => {})
    await expect(a.result).rejects.toMatchObject({ code: 'OptimizerFailed', details: { reason: 'postFailed' } })
    expect(workers[0].terminated).toBe(true)
    const b = client.startOptimize(job(1), () => {})
    expect(workers).toHaveLength(2)
    workers[1].emit({ type: 'done', runId: b.runId, model: model(1), logML: 2, atBound: [] })
    await expect(b.result).resolves.toMatchObject({ logML: 2 })
  })

  it('rejects the current run on a messageerror event', async () => {
    const { workers, client } = setup()
    const a = client.startOptimize(job(1), () => {})
    workers[0].onmessageerror?.({} as MessageEvent)
    await expect(a.result).rejects.toMatchObject({ code: 'OptimizerFailed', details: { reason: 'messageError' } })
    expect(workers[0].terminated).toBe(true)
  })
})
