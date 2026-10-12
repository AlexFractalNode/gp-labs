import { ref, type Ref } from 'vue'
import de from './de'
import en from './en'

export type Lang = 'de' | 'en'

type Dotted<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Dotted<T[K], `${P}${K}.`>
}[keyof T & string]

export type MessageKey = Dotted<typeof de>

const STORAGE_KEY = 'gp-labs-lang'
const catalogues: Record<Lang, Record<string, unknown>> = { de, en }

function isLang(x: unknown): x is Lang {
  return x === 'de' || x === 'en'
}

function store(l: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, l)
  } catch {
    /* localStorage unavailable */
  }
}

/** ?lang= from the hash query or the search part, or null. */
function langFromUrl(): Lang | null {
  try {
    if (typeof window === 'undefined') return null
    const hashQuery = window.location.hash.split('?')[1] ?? ''
    const fromHash = new URLSearchParams(hashQuery).get('lang')
    if (isLang(fromHash)) return fromHash
    const fromSearch = new URLSearchParams(window.location.search).get('lang')
    if (isLang(fromSearch)) return fromSearch
  } catch {
    /* location unavailable */
  }
  return null
}

/** Language from ?lang= (hash query or search; persisted, so it sticks), then localStorage, then 'de'. */
function initialLang(): Lang {
  const fromUrl = langFromUrl()
  if (fromUrl) {
    store(fromUrl)
    return fromUrl
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isLang(stored)) return stored
  } catch {
    /* localStorage unavailable */
  }
  return 'de'
}

const lang: Ref<Lang> = ref(initialLang())

export function setLang(next: Lang): void {
  lang.value = next
  store(next)
}

/**
 * Switches DE ↔ EN and writes `lang` into the query of the live hash (replaceState: no hashchange, no history
 * entry), so a copied link opens in the same language. The router state is not touched; views that rewrite the
 * hash read the live location and keep the parameter.
 */
export function toggleLang(): void {
  const next: Lang = lang.value === 'de' ? 'en' : 'de'
  setLang(next)
  try {
    if (typeof window === 'undefined') return
    const body = window.location.hash.replace(/^#/, '')
    const q = body.indexOf('?')
    const path = (q >= 0 ? body.slice(0, q) : body) || '/'
    const params = new URLSearchParams(q >= 0 ? body.slice(q + 1) : '')
    params.set('lang', next)
    history.replaceState(history.state, '', `#${path}?${params.toString()}`)
  } catch {
    /* history unavailable: the language still switches */
  }
}

function lookup(cat: Record<string, unknown>, key: string): string | undefined {
  let cur: unknown = cat
  for (const part of key.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return typeof cur === 'string' ? cur : undefined
}

export function translate(
  l: Lang,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const raw = lookup(catalogues[l], key) ?? key
  if (!vars) return raw
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
}

export function useI18n(): {
  lang: Ref<Lang>
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
} {
  // t reads lang.value, so templates calling it re-render on language change.
  const t = (key: MessageKey, vars?: Record<string, string | number>) =>
    translate(lang.value, key, vars)
  return { lang, t }
}
