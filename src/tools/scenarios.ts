/**
 * Scenario registry (onboarding, Spec §3.1): three ready-made states per tool with a short explanation. Pure data
 * and helpers, no framework. A scenario is its address part (`query`, only parameters the view already reads)
 * plus typed settings for everything the view keeps outside the address. The texts live in i18n
 * (`scenario.<id>.*`); every number in them is proven by tests/core/claims.
 */
import type { KernelSpec } from '../core/kernels'
import type { MessageKey } from '../i18n'
import { buildHash, SCENARIO_PARAM } from '../urlState'
import type { TemplateId } from './datalab/templates'

export type ToolId = 'playground' | 'kernels' | 'datalab'
/** One-off start action of a view after the scenario state has been applied (Daten-Lab only). */
export type ScenarioAction = 'startRun'

/** Replaces the preset spec of the Kernel-Baukasten. */
export interface KernelsSettings {
  spec: KernelSpec
}

/** Daten-Lab settings on top of the Yacht defaults (Yacht is always the source). */
export interface DatalabSettings {
  template: TemplateId
  logTarget: boolean
  notebookMode: boolean
  restarts: number
}

export interface Scenario {
  /** 'p1'…'p3', 'k1'…'k3', 'd1'…'d3' */
  id: string
  tool: ToolId
  /** Textbook chapter named in the title ('13.4', '14–15'); proven against the title by the claims tests. */
  chapter: string
  /** Address part in the format the view reads today. */
  query: Record<string, string>
  kernels?: KernelsSettings
  datalab?: DatalabSettings
  action?: ScenarioAction
}

/** Power-exponential preset (Kap. 8.5) with p = 2.5: not a valid covariance. */
const POWER_EXP_25: KernelSpec = {
  terms: [[{ kind: 'powexp', params: { sigma: 1, ell: 0.5, p: 2.5 }, fixed: ['p'] }]],
}

export const SCENARIOS: readonly Scenario[] = [
  { id: 'p1', tool: 'playground', chapter: '9', query: { preset: 'kap9', x: '0' } },
  { id: 'p2', tool: 'playground', chapter: '11', query: { preset: 'extrapolation', x: '3' } },
  { id: 'p3', tool: 'playground', chapter: '12', query: { preset: 'hyper-43' } },
  { id: 'k1', tool: 'kernels', chapter: '8', query: { preset: 'expquad' } },
  { id: 'k2', tool: 'kernels', chapter: '13.4', query: { preset: 'lin-plus-periodic' } },
  { id: 'k3', tool: 'kernels', chapter: '8.5', query: { preset: 'power-exp' }, kernels: { spec: POWER_EXP_25 } },
  {
    id: 'd1',
    tool: 'datalab',
    chapter: '15',
    query: {},
    datalab: { template: 'notebook', logTarget: false, notebookMode: true, restarts: 5 },
    action: 'startRun',
  },
  {
    id: 'd2',
    tool: 'datalab',
    chapter: '14–15',
    query: {},
    datalab: { template: 'rbf', logTarget: false, notebookMode: true, restarts: 5 },
    action: 'startRun',
  },
  {
    id: 'd3',
    tool: 'datalab',
    chapter: '17',
    query: {},
    datalab: { template: 'notebook', logTarget: true, notebookMode: true, restarts: 0 },
    action: 'startRun',
  },
]

export function scenariosFor(tool: ToolId): Scenario[] {
  return SCENARIOS.filter((s) => s.tool === tool)
}

export function scenarioById(id: string): Scenario | null {
  return SCENARIOS.find((s) => s.id === id) ?? null
}

type Params = URLSearchParams | Record<string, string>

function paramOf(params: Params, key: string): string | null {
  if (params instanceof URLSearchParams) return params.get(key)
  return Object.prototype.hasOwnProperty.call(params, key) ? params[key] : null
}

/**
 * The scenario named by the `scenario` parameter: missing → null without a problem; an unknown id (also an empty
 * value) or one of another tool → null with `notice.unknownScenario`.
 */
export function parseScenarioParam(tool: ToolId, params: Params): { scenario: Scenario | null; problems: MessageKey[] } {
  const id = paramOf(params, SCENARIO_PARAM)
  if (id === null) return { scenario: null, problems: [] }
  const s = scenarioById(id)
  if (s === null || s.tool !== tool) return { scenario: null, problems: ['notice.unknownScenario'] }
  return { scenario: s, problems: [] }
}

/** Whether every key of `s.query` has the same value in `params` (an empty query matches every route). */
export function routeMatchesScenario(params: Params, s: Scenario): boolean {
  return Object.entries(s.query).every(([k, v]) => paramOf(params, k) === v)
}

/** Address that applies the scenario (`#/<tool>?<query>&scenario=<id>`), keeping the language when given. */
export function scenarioHref(s: Scenario, lang?: string): string {
  return buildHash(s.tool, { ...s.query, [SCENARIO_PARAM]: s.id, ...(lang ? { lang } : {}) })
}

/**
 * Canonical string of a settings object (Spec §3.2): object keys sorted (KernelSpec, MeanSpec, factors), arrays in
 * order, numbers rounded to 12 significant digits (tween and log round-trip noise), undefined properties left out.
 */
export function canonicalKey(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') return String(Number(value.toPrecision(12)))
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.map(canonicalKey).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalKey(v)}`).join(',')}}`
  }
  throw new TypeError(`canonicalKey: unsupported value of type ${typeof value}`)
}

/** Throws unless `s` belongs to `tool` (the expected settings of another tool's scenario are meaningless). */
export function assertTool(s: Scenario, tool: ToolId): void {
  if (s.tool !== tool) throw new Error(`scenario ${s.id} belongs to ${s.tool}, not ${tool}`)
}
