/** Shared view types of the Daten-Lab components and the mapping of core errors to i18n messages. */
import { GpError } from '../../core/errors'
import type { MessageKey } from '../../i18n'
import type { BaukastenNotice, TemplateId } from './templates'

export type PanelState = 'loading' | 'empty' | 'ready' | 'error'
export type StepId = 'data' | 'target' | 'split' | 'model' | 'result'
export type TemplateChoice = TemplateId | 'baukasten'

/** A user-facing message: i18n key plus variables (translated at render time, so a language switch applies). */
export interface Problem {
  key: MessageKey
  vars?: Record<string, string | number>
}

export interface ModelPreview {
  /** TeX of the kernel on the standardised features (null if it cannot be rendered). */
  tex: string | null
  notices: BaukastenNotice[]
  problem: Problem | null
}

export interface RunView {
  state: PanelState
  /** Finished optimiser runs of the current job and their total (restarts + 1). */
  run: number
  total: number
  best: number
  problem: Problem | null
  lastId: number
  lastLogML: number
}

const INPUT_REASONS: Record<string, MessageKey> = {
  tooFewRows: 'datalab.error.tooFewRows',
  noFeatures: 'datalab.error.noFeatures',
  targetNotNumeric: 'datalab.error.targetNotNumeric',
  logTargetNotPositive: 'datalab.error.logTargetNotPositive',
  tooManyFeaturesForArd: 'datalab.error.tooManyFeaturesForArd',
  whiteInProduct: 'datalab.error.whiteInProduct',
  onlyWhite: 'datalab.error.onlyWhite',
  gibbsRequires1D: 'datalab.error.gibbsRequires1D',
}

function vars(d: Record<string, unknown>, keys: string[]): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const k of keys) {
    const v = d[k]
    if (typeof v === 'number' || typeof v === 'string') out[k] = v
  }
  return out
}

/** Message for an error thrown by the core (GpError) or anything else (generic, with the error text). */
export function problemOf(e: unknown): Problem {
  if (!(e instanceof GpError)) {
    return { key: 'datalab.error.generic', vars: { code: e instanceof Error ? e.message : String(e) } }
  }
  const d = e.details ?? {}
  const reason = typeof d.reason === 'string' ? d.reason : ''
  if (e.code === 'CsvParseError') {
    if (reason === 'empty') return { key: 'datalab.csvError.empty' }
    if (reason === 'separator') return { key: 'datalab.csvError.separator', vars: vars(d, ['line']) }
    if (reason === 'fieldCount') return { key: 'datalab.csvError.fieldCount', vars: vars(d, ['line', 'expected', 'got']) }
    return { key: 'datalab.csvError.generic', vars: { line: typeof d.line === 'number' ? d.line : 1 } }
  }
  if (e.code === 'NotPositiveDefinite') return { key: 'datalab.error.notPsd' }
  if (e.code === 'InvalidInput' && reason in INPUT_REASONS) {
    return { key: INPUT_REASONS[reason], vars: vars(d, ['rows', 'min', 'max']) }
  }
  return { key: 'datalab.error.generic', vars: { code: reason ? `${e.code}: ${reason}` : e.code } }
}
