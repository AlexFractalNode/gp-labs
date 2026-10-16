/**
 * Every number in a scenario text must be proven by the claims tests (tests/core/claims): the numbers found in the
 * DE and EN texts equal the set CLAIMED[id], in both directions. Plus the writing rules of Spec §3.4.
 */
import { describe, expect, it } from 'vitest'
import de from '../../src/i18n/de'
import en from '../../src/i18n/en'
import { SCENARIOS } from '../../src/tools/scenarios'
import { CLAIMED } from './claims/claimed'

const FIELDS = ['title', 'short', 'see', 'watch', 'next'] as const
const CATALOGUES = { de, en } as const

function texts(lang: keyof typeof CATALOGUES, id: string): Record<(typeof FIELDS)[number], string> {
  const block = (CATALOGUES[lang].scenario as unknown as Record<string, Record<string, string>>)[id]
  return Object.fromEntries(FIELDS.map((f) => [f, block?.[f] ?? ''])) as Record<(typeof FIELDS)[number], string>
}

/** Numbers of a text, normalised: decimal comma → point, U+2212 → '-'. Only U+2212 counts as a minus sign. */
function numbersOf(s: string): string[] {
  return (s.match(/−?\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.').replace('−', '-'))
}

describe('scenario numbers', () => {
  it('CLAIMED lists exactly the nine scenarios, without duplicates', () => {
    expect(Object.keys(CLAIMED).sort()).toEqual(SCENARIOS.map((s) => s.id).sort())
    for (const [id, list] of Object.entries(CLAIMED)) expect(new Set(list).size, id).toBe(list.length)
  })

  for (const s of SCENARIOS) {
    for (const lang of ['de', 'en'] as const) {
      it(`${s.id} (${lang}): the numbers of the texts are exactly the claimed ones`, () => {
        const found = new Set(FIELDS.flatMap((f) => numbersOf(texts(lang, s.id)[f])))
        expect([...found].sort()).toEqual([...CLAIMED[s.id]].sort())
      })
    }
  }

  it('use decimal commas in DE and decimal points in EN', () => {
    for (const s of SCENARIOS) {
      for (const f of FIELDS) {
        // Section numbers (Kap. 13.4) keep their point in both languages; they appear only in the title.
        const deText = f === 'title' ? '' : texts('de', s.id)[f]
        expect(deText, `${s.id}.${f} (de)`).not.toMatch(/\d\.\d/)
        expect(texts('en', s.id)[f], `${s.id}.${f} (en)`).not.toMatch(/\d,\d/)
      }
    }
  })

  it('follow the writing rules', () => {
    for (const s of SCENARIOS) {
      for (const lang of ['de', 'en'] as const) {
        const t = texts(lang, s.id)
        for (const f of FIELDS) {
          // A minus sign is U+2212; a hyphen directly before a digit is neither a minus nor a range dash.
          expect(t[f], `${s.id}.${f} (${lang})`).not.toMatch(/-\d/)
          // No tuple notation such as "k(1, 1,2)" (a single decimal in brackets, "(0,5)", is fine).
          expect(t[f], `${s.id}.${f} (${lang})`).not.toMatch(/\(\s*[−\d][^()]*,\s+[−\d][^()]*\)/)
        }
        // The e2e test looks for the button "Code 45"; titles and short texts must not compete with it.
        for (const f of ['title', 'short'] as const) expect(t[f], `${s.id}.${f} (${lang})`).not.toMatch(/Code 4[357]/)
        expect(t.short.length, `${s.id}.short (${lang})`).toBeLessThanOrEqual(60)
      }
    }
  })
})
