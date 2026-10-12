import { describe, expect, it } from 'vitest'
import {
  KERNEL_PARAM,
  buildHash,
  decodeKernel,
  encodeKernel,
  fromBase64Url,
  parseHash,
  toBase64Url,
  urlProblems,
  type KernelSpec,
} from '../../src/urlState'
import { useNotices, notify, dismissNotice } from '../../src/notify'

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
  it('round-trips non-ASCII UTF-8 through base64url', () => {
    const text = 'ℓ = 0,2 · σ² — Größe ✓ 𝔼[f]'
    const enc = toBase64Url(text)
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(fromBase64Url(enc)).toBe(text)
  })
  it('round-trips a valid spec', () => {
    const spec: KernelSpec = {
      terms: [[{ kind: 'rbf', params: { sigma: 1.5, ell: 0.2 } }, { kind: 'periodic', params: { sigma: 1, ell: 1, period: 0.5 } }]],
    }
    const s = encodeKernel(spec)
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeKernel(s)).toEqual(spec)
  })
  it('decodes non-ASCII payloads without throwing and rejects them as invalid specs', () => {
    const s = encodeKernel({ terms: [[{ kind: 'ℓ', params: {} }]] } as unknown as KernelSpec)
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeKernel(s)).toBeNull()
  })
  it('rejects corrupt kernel parameters (Review Focus 5)', () => {
    for (const params of [{ sigma: 1, ell: -1 }, { sigma: 1 }, { sigma: 1, ell: null }]) {
      expect(decodeKernel(encodeKernel({ terms: [[{ kind: 'rbf', params }]] } as unknown as KernelSpec))).toBeNull()
    }
    expect(decodeKernel(btoa('{"terms":[[{"kind":"rbf","params":{"sigma":1,"ell":NaN}}]]}'))).toBeNull()
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
    n.value.forEach((x) => dismissNotice(x.id))
    const before = n.value.length
    notify('notice.invalidUrl')
    expect(n.value.length).toBe(before + 1)
    expect(n.value[before].key).toBe('notice.invalidUrl')
  })
})

describe('notify dedupe', () => {
  it('keeps a single entry for a repeated key', () => {
    const n = useNotices()
    n.value.forEach((x) => dismissNotice(x.id))
    notify('notice.invalidUrl')
    notify('notice.invalidUrl')
    expect(n.value.length).toBe(1)
  })
})

describe('urlProblems', () => {
  it('flags unknown routes', () => {
    expect(urlProblems(parseHash('#/nope'))).toEqual(['notice.invalidUrl'])
  })
  it('flags an undecodable kernel param', () => {
    expect(urlProblems(parseHash(`#/playground?${KERNEL_PARAM}=%25%25%25`))).toEqual([
      'notice.invalidUrl',
    ])
  })
  it('accepts valid URLs', () => {
    const h = buildHash('playground', { [KERNEL_PARAM]: encodeKernel({ terms: [[{ kind: 'rbf', params: { sigma: 1, ell: 1 } }]] }) })
    expect(urlProblems(parseHash(h))).toEqual([])
    expect(urlProblems(parseHash('#/kernels'))).toEqual([])
  })
})
