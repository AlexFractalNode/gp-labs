import { ref, type Ref } from 'vue'
import { parseHash, type Route } from './urlState'

export interface RouteState {
  route: Route
  params: URLSearchParams
  unknownRoute: boolean
}

const hasWindow = typeof window !== 'undefined'
const current: Ref<RouteState> = ref(parseHash(hasWindow ? window.location.hash : ''))
let listening = false

function listen(): void {
  if (!listening && hasWindow) {
    listening = true
    window.addEventListener('hashchange', () => {
      current.value = parseHash(window.location.hash)
    })
  }
}

export function useRoute(): Ref<RouteState> {
  listen()
  return current
}

/**
 * Re-reads the live address into a new route object, so route watchers fire as on `hashchange`. Used when the
 * target address equals the current one (re-applying a scenario), where assigning `location.hash` fires nothing.
 */
export function refreshRoute(): void {
  if (!hasWindow) return
  listen()
  current.value = parseHash(window.location.hash)
}
