import { isKernelSpec, type KernelSpec } from './core/kernels'
import type { MessageKey } from './i18n'

export { isKernelSpec, type KernelSpec }

export type Route = 'home' | 'playground' | 'kernels' | 'datalab'

const ROUTES: readonly Route[] = ['home', 'playground', 'kernels', 'datalab']

export function parseHash(hash: string): {
  route: Route
  params: URLSearchParams
  unknownRoute: boolean
} {
  const body = hash.replace(/^#/, '')
  const qIndex = body.indexOf('?')
  const path = qIndex >= 0 ? body.slice(0, qIndex) : body
  const params = new URLSearchParams(qIndex >= 0 ? body.slice(qIndex + 1) : '')
  const name = path.replace(/^\/+/, '').replace(/\/+$/, '')
  if (name === '') return { route: 'home', params, unknownRoute: false }
  if ((ROUTES as readonly string[]).includes(name)) {
    return { route: name as Route, params, unknownRoute: false }
  }
  return { route: 'home', params, unknownRoute: true }
}

export function buildHash(route: Route, params?: Record<string, string>): string {
  const path = route === 'home' ? '#/' : `#/${route}`
  const qs = params ? new URLSearchParams(params).toString() : ''
  return qs ? `${path}?${qs}` : path
}

export function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export function encodeKernel(spec: KernelSpec): string {
  return toBase64Url(JSON.stringify(spec))
}

export function decodeKernel(s: string): KernelSpec | null {
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(s))
    return isKernelSpec(parsed) ? parsed : null
  } catch {
    return null
  }
}

export const KERNEL_PARAM = 'kernel'
/** Query parameter naming the active scenario of a tool (`src/tools/scenarios.ts`). */
export const SCENARIO_PARAM = 'scenario'

/** Problems in the parsed URL that warrant a notice; empty when the URL is fine. */
export function urlProblems(state: {
  route: Route
  params: URLSearchParams
  unknownRoute: boolean
}): MessageKey[] {
  const k = state.params.get(KERNEL_PARAM)
  if (state.unknownRoute || (k !== null && decodeKernel(k) === null)) return ['notice.invalidUrl']
  return []
}
