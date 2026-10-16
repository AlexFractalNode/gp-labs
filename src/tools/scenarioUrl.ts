/**
 * Writing the live address for scenarios (onboarding). Kept apart from src/urlState.ts because the scenario registry
 * imports `buildHash` from there. Uses `history.replaceState`, which fires no `hashchange` in browsers and so never
 * touches the route ref (no view re-init, no scenario adoption, no action).
 */
import { SCENARIO_PARAM } from '../urlState'

/** Removes `scenario` from the live address (replaceState); the path and all other parameters stay in order. */
export function removeScenarioParam(): void {
  if (typeof window === 'undefined') return
  try {
    const body = window.location.hash.replace(/^#/, '')
    const q = body.indexOf('?')
    if (q < 0) return
    const params = new URLSearchParams(body.slice(q + 1))
    if (!params.has(SCENARIO_PARAM)) return
    params.delete(SCENARIO_PARAM)
    const qs = params.toString()
    history.replaceState(history.state, '', `#${body.slice(0, q)}${qs ? `?${qs}` : ''}`)
  } catch {
    /* history unavailable: the box still closes, the address keeps `scenario` */
  }
}
