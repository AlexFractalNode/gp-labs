import { describe, expect, it } from 'vitest'
import { isKernelSpec, type KernelSpec } from '../../src/core/kernels'
import de from '../../src/i18n/de'
import en from '../../src/i18n/en'
import { KERNEL_PRESETS } from '../../src/tools/kernels/presets'
import { resolveKernel } from '../../src/tools/playground/compute'
import { loadPreset } from '../../src/tools/playground/presets'
import {
  SCENARIOS,
  parseScenarioParam,
  routeMatchesScenario,
  scenarioById,
  scenarioHref,
  scenariosFor,
  type ToolId,
} from '../../src/tools/scenarios'
import { SCENARIO_PARAM } from '../../src/urlState'

const TOOLS: ToolId[] = ['playground', 'kernels', 'datalab']
const FIELDS = ['title', 'short', 'see', 'watch', 'next'] as const

function lookup(cat: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], cat)
}

const withP = (spec: KernelSpec, p: number): KernelSpec => {
  const next = JSON.parse(JSON.stringify(spec)) as KernelSpec
  next.terms[0][0].params.p = p
  return next
}

describe('scenario registry', () => {
  it('has nine scenarios with unique ids, three per tool', () => {
    expect(SCENARIOS).toHaveLength(9)
    expect(SCENARIOS.map((s) => s.id)).toEqual(['p1', 'p2', 'p3', 'k1', 'k2', 'k3', 'd1', 'd2', 'd3'])
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(9)
    for (const tool of TOOLS) {
      expect(scenariosFor(tool), tool).toHaveLength(3)
      for (const s of scenariosFor(tool)) expect(s.tool).toBe(tool)
    }
    expect(scenarioById('k2')?.tool).toBe('kernels')
    expect(scenarioById('nope')).toBeNull()
  })

  it('stores the address parts and settings of the spec table', () => {
    const q = (id: string) => scenarioById(id)!.query
    expect(q('p1')).toEqual({ preset: 'kap9', x: '0' })
    expect(q('p2')).toEqual({ preset: 'extrapolation', x: '3' })
    expect(q('p3')).toEqual({ preset: 'hyper-43' })
    expect(q('k1')).toEqual({ preset: 'expquad' })
    expect(q('k2')).toEqual({ preset: 'lin-plus-periodic' })
    expect(q('k3')).toEqual({ preset: 'power-exp' })
    for (const id of ['d1', 'd2', 'd3']) expect(q(id)).toEqual({})
    expect(scenarioById('d1')!.datalab).toEqual({ template: 'notebook', logTarget: false, notebookMode: true, restarts: 5 })
    expect(scenarioById('d2')!.datalab).toEqual({ template: 'rbf', logTarget: false, notebookMode: true, restarts: 5 })
    expect(scenarioById('d3')!.datalab).toEqual({ template: 'notebook', logTarget: true, notebookMode: true, restarts: 0 })
    expect(scenarioById('k1')!.kernels).toBeUndefined()
    expect(scenarioById('k2')!.kernels).toBeUndefined()
  })

  it('names a chapter for every scenario', () => {
    const chapters = Object.fromEntries(SCENARIOS.map((s) => [s.id, s.chapter]))
    expect(chapters).toEqual({
      p1: '9',
      p2: '11',
      p3: '12',
      k1: '8',
      k2: '13.4',
      k3: '8.5',
      d1: '15',
      d2: '14–15',
      d3: '17',
    })
  })

  it('allows the start action only in the data lab, settings only at their tool', () => {
    for (const s of SCENARIOS) {
      if (s.action !== undefined) expect(s.tool, s.id).toBe('datalab')
      if (s.kernels !== undefined) expect(s.tool, s.id).toBe('kernels')
      if (s.datalab !== undefined) expect(s.tool, s.id).toBe('datalab')
    }
    for (const id of ['d1', 'd2', 'd3']) {
      expect(scenarioById(id)!.action, id).toBe('startRun')
      expect(scenarioById(id)!.datalab, id).toBeDefined()
    }
    for (const id of ['p1', 'p2', 'p3', 'k1', 'k2', 'k3']) expect(scenarioById(id)!.action, id).toBeUndefined()
  })

  it('stores queries that load without a notice', () => {
    for (const s of scenariosFor('playground')) {
      const { state, unknown } = loadPreset(s.query.preset ?? null)
      expect(unknown, s.id).toBe(false)
      if (s.query.x !== undefined) expect(Number.isFinite(Number(s.query.x)), s.id).toBe(true)
      expect(resolveKernel(s.query.kernel ?? null, state.model).notices, s.id).toEqual([])
    }
    for (const s of scenariosFor('kernels')) {
      expect(Object.prototype.hasOwnProperty.call(KERNEL_PRESETS, s.query.preset), s.id).toBe(true)
    }
  })

  it('k3 replaces the power-exp spec by p = 2.5', () => {
    const spec = scenarioById('k3')!.kernels!.spec
    expect(isKernelSpec(spec)).toBe(true)
    expect(spec.terms[0][0].params.p).toBe(2.5)
    expect(spec).toEqual(withP(KERNEL_PRESETS['power-exp'].spec, 2.5))
  })

  it('parses the scenario parameter', () => {
    expect(SCENARIO_PARAM).toBe('scenario')
    const p1 = scenarioById('p1')
    expect(parseScenarioParam('playground', {})).toEqual({ scenario: null, problems: [] })
    expect(parseScenarioParam('playground', new URLSearchParams('preset=kap9'))).toEqual({ scenario: null, problems: [] })
    expect(parseScenarioParam('playground', { scenario: 'p1' })).toEqual({ scenario: p1, problems: [] })
    expect(parseScenarioParam('playground', new URLSearchParams('preset=kap9&scenario=p1'))).toEqual({ scenario: p1, problems: [] })
    expect(parseScenarioParam('playground', { scenario: 'd1' })).toEqual({ scenario: null, problems: ['notice.unknownScenario'] })
    expect(parseScenarioParam('playground', { scenario: 'xyz' })).toEqual({ scenario: null, problems: ['notice.unknownScenario'] })
    expect(parseScenarioParam('datalab', new URLSearchParams('scenario='))).toEqual({
      scenario: null,
      problems: ['notice.unknownScenario'],
    })
  })

  it('matches a route against the scenario query', () => {
    const p1 = scenarioById('p1')!
    expect(routeMatchesScenario(new URLSearchParams('x=0&preset=kap9&scenario=p1&lang=en'), p1)).toBe(true)
    expect(routeMatchesScenario({ preset: 'kap9', x: '0' }, p1)).toBe(true)
    expect(routeMatchesScenario(new URLSearchParams('preset=kap9'), p1)).toBe(false)
    expect(routeMatchesScenario(new URLSearchParams('preset=hyper-45&x=0'), p1)).toBe(false)
    // An empty query matches every route of the tool.
    expect(routeMatchesScenario(new URLSearchParams(''), scenarioById('d1')!)).toBe(true)
    expect(routeMatchesScenario({ kernel: 'abc' }, scenarioById('d2')!)).toBe(true)
  })

  it('builds scenario links', () => {
    expect(scenarioHref(scenarioById('p1')!)).toBe('#/playground?preset=kap9&x=0&scenario=p1')
    expect(scenarioHref(scenarioById('p1')!, 'en')).toBe('#/playground?preset=kap9&x=0&scenario=p1&lang=en')
    expect(scenarioHref(scenarioById('d3')!)).toBe('#/datalab?scenario=d3')
  })

  it('has every scenario text in both languages', () => {
    const keys = [
      ...SCENARIOS.flatMap((s) => FIELDS.map((f) => `scenario.${s.id}.${f}`)),
      ...['barLabel', 'noteSee', 'noteWatch', 'noteNext', 'changed', 'restore', 'close'].map((f) => `scenario.${f}`),
      'notice.unknownScenario',
    ]
    for (const cat of [de, en]) {
      for (const k of keys) {
        const v = lookup(cat, k)
        expect(typeof v, k).toBe('string')
        expect((v as string).trim().length, k).toBeGreaterThan(0)
      }
    }
  })
})
