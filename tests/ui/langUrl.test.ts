// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'gp-labs-lang'

/** Fresh i18n module (the initial language is read once at import time). */
async function loadI18n() {
  vi.resetModules()
  return import('../../src/i18n')
}

describe('language in shared links', () => {
  beforeEach(() => {
    localStorage.clear()
    history.replaceState(null, '', '/#/')
  })
  afterEach(() => {
    localStorage.clear()
    history.replaceState(null, '', '/#/')
  })

  it('a language from ?lang= is used and persisted to localStorage', async () => {
    history.replaceState(null, '', '/#/kernels?preset=periodic&lang=en')
    const { useI18n } = await loadI18n()
    expect(useI18n().lang.value).toBe('en')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('en')
  })

  it('toggleLang writes ?lang= into the live hash and keeps the other parameters', async () => {
    history.replaceState(null, '', '/#/kernels?preset=periodic')
    const { toggleLang, useI18n } = await loadI18n()
    expect(useI18n().lang.value).toBe('de')
    toggleLang()
    expect(useI18n().lang.value).toBe('en')
    const params = new URLSearchParams(window.location.hash.split('?')[1])
    expect(window.location.hash.startsWith('#/kernels?')).toBe(true)
    expect(params.get('preset')).toBe('periodic')
    expect(params.get('lang')).toBe('en')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('en')

    // A later rewrite of the hash by a view (live hash) keeps the parameter; toggling back replaces it.
    history.replaceState(null, '', '/#/kernels?preset=expquad&lang=en')
    toggleLang()
    const back = new URLSearchParams(window.location.hash.split('?')[1])
    expect(back.get('preset')).toBe('expquad')
    expect(back.get('lang')).toBe('de')
  })

  it('toggleLang on the home page without a hash writes #/?lang=', async () => {
    history.replaceState(null, '', '/')
    const { toggleLang } = await loadI18n()
    toggleLang()
    expect(window.location.hash).toBe('#/?lang=en')
  })
})
