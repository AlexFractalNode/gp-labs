import { describe, expect, it } from 'vitest'
import { buildHash, decodeKernel, encodeKernel, parseHash } from '../../src/urlState'
import { useNotices, notify } from '../../src/notify'

describe('parseHash', () => {
  it('parses route and params', () => {
    const r = parseHash('#/kernels?preset=matern52')
    expect(r.route).toBe('kernels')
    expect(r.params.get('preset')).toBe('matern52')
    expect(r.unknownRoute).toBe(false)
  })
  it('falls back to home for unknown routes', () => {
    const r = parseHash('#/nope')
    expect(r.route).toBe('home')
    expect(r.unknownRoute).toBe(true)
  })
  it('treats empty hash as home without flagging', () => {
    expect(parseHash('')).toMatchObject({ route: 'home', unknownRoute: false })
    expect(parseHash('#/')).toMatchObject({ route: 'home', unknownRoute: false })
  })
})

describe('buildHash', () => {
  it('round-trips', () => {
    const h = buildHash('playground', { lang: 'en' })
    expect(h).toBe('#/playground?lang=en')
    expect(parseHash(h).params.get('lang')).toBe('en')
    expect(buildHash('home')).toBe('#/')
  })
})

describe('kernel codec', () => {
  it('round-trips incl. non-ASCII', () => {
    const spec = { terms: [[{ name: 'ℓ', v: 1 }]] }
    const s = encodeKernel(spec)
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeKernel(s)).toEqual(spec)
  })
  it('returns null on garbage or invalid shape', () => {
    expect(decodeKernel('%%%')).toBeNull()
    expect(decodeKernel(btoa('{"terms":5}'))).toBeNull()
    expect(decodeKernel(btoa('not json'))).toBeNull()
  })
})

describe('notify', () => {
  it('appends a notice', () => {
    const n = useNotices()
    const before = n.value.length
    notify('notice.invalidUrl')
    expect(n.value.length).toBe(before + 1)
    expect(n.value[before].key).toBe('notice.invalidUrl')
  })
})
