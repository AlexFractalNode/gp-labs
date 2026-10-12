import { describe, expect, it } from 'vitest'
import de from '../../src/i18n/de'
import en from '../../src/i18n/en'

function flatten(o: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') Object.assign(out, flatten(v as Record<string, unknown>, key))
    else out[key] = v
  }
  return out
}

describe('i18n catalogues', () => {
  const d = flatten(de)
  const e = flatten(en)
  it('have identical key sets', () => {
    expect(Object.keys(d).sort()).toEqual(Object.keys(e).sort())
  })
  it('have no empty values', () => {
    for (const [k, v] of [...Object.entries(d), ...Object.entries(e)]) {
      expect(typeof v, k).toBe('string')
      expect((v as string).length, k).toBeGreaterThan(0)
    }
  })
})
