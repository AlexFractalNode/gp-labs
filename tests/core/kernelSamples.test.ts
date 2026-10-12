import { describe, expect, it } from 'vitest'
import { standardNormals } from '../../src/core/gp'
import { kernelMatrix, type KernelSpec } from '../../src/core/kernels'
import { createRng } from '../../src/core/rng'
import { KERNEL_PRESETS } from '../../src/tools/kernels/presets'
import { GRID_2D, lineInputs, priorSamples, SAMPLE_COUNT, SAMPLE_N, sampleInputs } from '../../src/tools/kernels/compute'
import { createSample2dClient, type Sample2dRequest, type Sample2dResult } from '../../src/tools/kernels/sample2d'

const rbf = (ell: number): KernelSpec => ({ terms: [[{ kind: 'rbf', params: { sigma: 1, ell } }]] })
const maxDiff = (a: Float64Array[], b: Float64Array[]) =>
  Math.max(...a.map((r, k) => Math.max(...r.map((v, i) => Math.abs(v - b[k][i])))))

describe('prior samples with fixed u (x = L u)', () => {
  const X = lineInputs([0, 2], SAMPLE_N)
  const draw = (spec: KernelSpec, seed: number) =>
    priorSamples(kernelMatrix(spec, X, X, { sameSet: true }), standardNormals(createRng(seed), SAMPLE_COUNT, SAMPLE_N))

  it('the same seed gives identical samples for the same kernel (no redraw)', () => {
    expect(maxDiff(draw(rbf(0.3), 1), draw(rbf(0.3), 1))).toBe(0)
  })

  it('a small parameter change morphs the curves; only a new seed redraws them', () => {
    const base = draw(rbf(0.3), 1)
    const morph = maxDiff(base, draw(rbf(0.303), 1))
    const redraw = maxDiff(base, draw(rbf(0.3), 2))
    expect(morph).toBeGreaterThan(0)
    expect(morph).toBeLessThan(0.1)
    expect(redraw).toBeGreaterThan(1)
  })

  it('ard-2d starts with seed 2, whose sample crosses zero', () => {
    const p = KERNEL_PRESETS['ard-2d']
    expect(p.seed).toBe(2)
    const Xg = sampleInputs(p.domain, p.domain2!, GRID_2D)
    const [s] = priorSamples(
      kernelMatrix(p.spec, Xg, Xg, { sameSet: true }),
      standardNormals(createRng(p.seed!), 1, GRID_2D * GRID_2D),
    )
    expect(Math.min(...s)).toBeLessThan(-0.5)
    expect(Math.max(...s)).toBeGreaterThan(0.5)
  })
})

/** Minimal Worker double: records posted jobs; `reply` delivers a response to the client. */
function fakeWorker() {
  const posted: Sample2dRequest[] = []
  const w = {
    onmessage: null as ((ev: MessageEvent) => void) | null,
    onerror: null as ((ev: ErrorEvent) => void) | null,
    postMessage: (msg: Sample2dRequest) => posted.push(msg),
    terminate: () => {},
  }
  const reply = (id: number, value: number) =>
    w.onmessage!({ data: { id, ok: true, sample: Float64Array.from([value]) } } as MessageEvent)
  return { w, posted, reply }
}

describe('sample2d client (latest wins)', () => {
  it('drops the reply of a superseded request and delivers only the newest one', () => {
    const { w, posted, reply } = fakeWorker()
    const client = createSample2dClient(() => w as unknown as Worker)
    const job = { spec: rbf(1), X: new Float64Array(2), cols: 2, u: new Float64Array(1) }
    const first: Sample2dResult[] = []
    const second: Sample2dResult[] = []
    client.request(job, (r) => first.push(r))
    client.request(job, (r) => second.push(r)) // queued: the worker is busy with the first job
    expect(posted.map((p) => p.id)).toEqual([1])
    reply(1, 111) // stale: request 2 superseded it
    expect(first).toEqual([])
    expect(second).toEqual([])
    expect(posted.map((p) => p.id)).toEqual([1, 2]) // the queued newest job is sent next
    reply(2, 222)
    expect(first).toEqual([])
    expect(second).toHaveLength(1)
    expect(second[0].ok && second[0].sample[0]).toBe(222)
    client.dispose()
  })

  it('a third request while one is queued replaces the queued job', () => {
    const { w, posted, reply } = fakeWorker()
    const client = createSample2dClient(() => w as unknown as Worker)
    const job = { spec: rbf(1), X: new Float64Array(2), cols: 2, u: new Float64Array(1) }
    const got: number[] = []
    for (let k = 0; k < 3; k++) client.request(job, (r) => got.push(r.ok ? r.sample[0] : NaN))
    reply(1, 1)
    expect(posted.map((p) => p.id)).toEqual([1, 3])
    reply(3, 3)
    expect(got).toEqual([3])
    client.dispose()
  })
})
