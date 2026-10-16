import { describe, expect, it } from 'vitest'
import de from '../../src/i18n/de'
import en from '../../src/i18n/en'
import { HELP_TOPICS } from '../../src/tools/helpTopics'
import { TOOL_REFS } from '../../src/tools/toolRefs'
import type { ToolId } from '../../src/tools/scenarios'

/** Reading lines per tool: one per panel the tool shows. */
const READ: Record<ToolId, string[]> = {
  playground: ['plot', 'layers', 'inspector', 'model', 'mean', 'likelihood', 'covariance'],
  kernels: ['formula', 'samples', 'heatmap', 'slice', 'validity', 'builder'],
  datalab: ['steps', 'data', 'target', 'split', 'model', 'result', 'parity', 'calibration', 'slice', 'relevance', 'runs'],
}
/** Control lines per tool: one per control the tool shows. */
const CONTROLS: Record<ToolId, string[]> = {
  playground: [
    'points',
    'clear',
    'layers',
    'samples',
    'reset',
    'fitAxes',
    'pin',
    'kernelParams',
    'hyper',
    'sigmaN',
    'mean',
    'optimize',
  ],
  kernels: ['gallery', 'reset', 'builder', 'dims', 'warp', 'params', 'redraw', 'fitAxes', 'x0', 'use', 'useDatalab'],
  datalab: [
    'data',
    'csv',
    'next',
    'target',
    'logTarget',
    'features',
    'split',
    'seed',
    'notebook',
    'subsample',
    'template',
    'restarts',
    'start',
    'sliceFeature',
    'compare',
    'clearRuns',
  ],
}
const TOOLS = Object.keys(CONTROLS) as ToolId[]
const CATALOGUES = { de, en } as const

type Tree = { [k: string]: string | Tree }
const help = (lang: 'de' | 'en', tool: ToolId): Tree =>
  (CATALOGUES[lang] as unknown as { help?: Record<string, Tree> }).help?.[tool] ?? {}

function lookup(lang: 'de' | 'en', key: string): unknown {
  let cur: unknown = CATALOGUES[lang]
  for (const part of key.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

describe('help texts', () => {
  it('HELP_TOPICS lists the panels and controls of each tool', () => {
    expect(Object.keys(HELP_TOPICS).sort()).toEqual([...TOOLS].sort())
    for (const tool of TOOLS) {
      expect(HELP_TOPICS[tool].read.map((r) => r.key), tool).toEqual(READ[tool])
      expect(HELP_TOPICS[tool].controls.map((c) => c.key), tool).toEqual(CONTROLS[tool])
    }
  })

  for (const lang of ['de', 'en'] as const) {
    it(`${lang}: the drawer frame texts exist`, () => {
      for (const k of [
        'button',
        'heading',
        'close',
        'purposeTitle',
        'readTitle',
        'controlsTitle',
        'courseTitle',
        'scenariosTitle',
        'scenariosHint',
      ]) {
        const v = lookup(lang, `help.${k}`)
        expect(typeof v, k).toBe('string')
        expect((v as string).trim().length, k).toBeGreaterThan(0)
      }
      expect(lookup(lang, 'help.heading') as string).toContain('{tool}')
    })

    for (const tool of TOOLS) {
      it(`${lang}/${tool}: purpose and every reading line exist and are free of digits`, () => {
        const h = help(lang, tool)
        expect(typeof h.purpose).toBe('string')
        expect((h.purpose as string).trim().length).toBeGreaterThan(0)
        expect(h.purpose as string).not.toMatch(/\d/)
        const read = (h.read ?? {}) as Tree
        expect(Object.keys(read).sort()).toEqual([...READ[tool]].sort())
        for (const key of READ[tool]) {
          expect(typeof read[key], key).toBe('string')
          expect((read[key] as string).trim().length, key).toBeGreaterThan(0)
          expect(read[key] as string, key).not.toMatch(/\d/)
        }
      })

      it(`${lang}/${tool}: every control line exists`, () => {
        const controls = (help(lang, tool).controls ?? {}) as Tree
        expect(Object.keys(controls).sort()).toEqual([...CONTROLS[tool]].sort())
        for (const key of CONTROLS[tool]) {
          expect(typeof controls[key], key).toBe('string')
          expect((controls[key] as string).trim().length, key).toBeGreaterThan(0)
        }
      })

      it(`${lang}/${tool}: every panel title and control label is an existing catalogue text`, () => {
        for (const r of HELP_TOPICS[tool].read) {
          expect(typeof lookup(lang, r.title), r.title).toBe('string')
        }
        for (const c of HELP_TOPICS[tool].controls) {
          if (typeof c.label === 'string') expect(typeof lookup(lang, c.label), c.label).toBe('string')
          else expect(c.label.literal.trim().length, c.key).toBeGreaterThan(0)
        }
      })
    }
  }

  it('TOOL_REFS carries the chapter and notebook-cell ranges of the home cards', () => {
    expect(TOOL_REFS).toEqual({
      playground: { chapter: '1, 6–8, 10–12', code: '17–48' },
      kernels: { chapter: '5, 8, 13', code: '53–70' },
      datalab: { chapter: '14, 15, 17', code: '87–94' },
    })
  })
})
