/**
 * Frame-based tween of a parameter vector (log space), used to animate the sliders to the optimiser result.
 * After `cancel()` neither `apply` nor `finish` is called again.
 */
export interface TweenHandle {
  cancel(): void
  readonly active: boolean
}

export interface TweenOptions {
  from: ArrayLike<number>
  to: ArrayLike<number>
  durationMs: number
  /** Intermediate values (eased), called once per frame before the end. */
  apply: (values: Float64Array) => void
  /** Called once at the end (not after cancel); the caller sets the exact target there. */
  finish: () => void
  requestFrame?: (cb: (now: number) => void) => number
  cancelFrame?: (id: number) => void
  now?: () => number
}

/** Cubic ease-in-out on [0, 1]. */
export const ease = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2)

export function startTween(opts: TweenOptions): TweenHandle {
  const requestFrame = opts.requestFrame ?? ((cb) => requestAnimationFrame(cb))
  const cancelFrame = opts.cancelFrame ?? ((id) => cancelAnimationFrame(id))
  const now = opts.now ?? (() => performance.now())
  const t0 = now()
  let frame: number | null = null
  let active = true

  const step = (time: number) => {
    frame = null
    if (!active) return
    const u = Math.min(1, (time - t0) / opts.durationMs)
    if (u >= 1) {
      active = false
      opts.finish()
      return
    }
    const e = ease(u)
    const values = Float64Array.from(opts.from, (v, i) => v + (opts.to[i] - v) * e)
    opts.apply(values)
    frame = requestFrame(step)
  }
  frame = requestFrame(step)

  return {
    cancel() {
      active = false
      if (frame !== null) cancelFrame(frame)
      frame = null
    },
    get active() {
      return active
    },
  }
}
