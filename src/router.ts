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

export function useRoute(): Ref<RouteState> {
  if (!listening && hasWindow) {
    listening = true
    window.addEventListener('hashchange', () => {
      current.value = parseHash(window.location.hash)
    })
  }
  return current
}
