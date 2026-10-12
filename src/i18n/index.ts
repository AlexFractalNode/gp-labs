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

/** Language from ?lang= (hash query or search), then localStorage, then 'de'. */
function initialLang(): Lang {
  try {
    if (typeof window !== 'undefined') {
      const hashQuery = window.location.hash.split('?')[1] ?? ''
      const fromHash = new URLSearchParams(hashQuery).get('lang')
      if (isLang(fromHash)) return fromHash
      const fromSearch = new URLSearchParams(window.location.search).get('lang')
      if (isLang(fromSearch)) return fromSearch
    }
  } catch {
    /* location unavailable */
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
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* localStorage unavailable */
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
