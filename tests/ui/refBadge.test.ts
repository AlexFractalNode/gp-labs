// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RefBadge from '../../src/ui/RefBadge.vue'
import { setLang } from '../../src/i18n'
import de from '../../src/i18n/de'
import en from '../../src/i18n/en'

describe('RefBadge line breaks', () => {
  afterEach(() => setLang('de'))

  it('keeps chapter and code ranges unbroken (nowrap spans), text unchanged', () => {
    setLang('de')
    const w = mount(RefBadge, { props: { chapter: '14–15', code: '87–94' } })
    expect(w.text()).toBe('Lehrbuch Kap. 14–15 · Notebook Code 87–94')
    const ranges = w.findAll('.nowrap').map((s) => s.text())
    expect(ranges).toEqual(['14–15', '87–94'])
  })

  it('works without a code and in English', () => {
    setLang('en')
    const w = mount(RefBadge, { props: { chapter: '9' } })
    expect(w.text()).toBe('Textbook ch. 9')
    expect(w.findAll('.nowrap').map((s) => s.text())).toEqual(['9'])
  })
})

describe('roadmap R1 formula', () => {
  it('cannot break inside x = m + L u (non-breaking spaces)', () => {
    for (const cat of [de, en]) expect(cat.home.roadmap.r1.desc).toContain('x\u00a0=\u00a0m\u00a0+\u00a0L\u00a0u')
  })
})
