/**
 * CSV parsing for the Daten-Lab (Spec §6, step 1): separator (`;` tab `,` or whitespace) and decimal comma are
 * detected automatically; a German Excel export (UTF-8 BOM, `;`, decimal comma, quoted header) parses to numbers.
 * Everything runs in the browser; the data never leaves it.
 */
import { GpError } from './errors'

export interface Table {
  columns: string[]
  rows: (number | string | null)[][]
}

export interface ColumnInfo {
  name: string
  type: 'numeric' | 'text'
  /** Number of null cells. */
  missing: number
  /** All non-null values are equal (also true for a column without values). */
  constant: boolean
  /** Smallest value of a numeric column (undefined for text or all-missing columns). */
  min?: number
}

type Separator = ';' | '\t' | ',' | 'whitespace'
const SEPARATORS: readonly Separator[] = [';', '\t', ',', 'whitespace']
/** Number of leading non-blank lines used to check that a separator gives a constant field count. */
const PROBE_LINES = 20
/** Cells that mean "missing" (besides the empty cell). */
const MISSING = /^(na|n\/a|nan|null|\?)$/i
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/
const DECIMAL_COMMA = /^-?\d+,\d+$/

/** Splits a line at a single-character separator; double quotes protect separators, "" is an escaped quote. */
function splitQuoted(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQuotes = false
      } else cur += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === sep) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

function splitLine(line: string, sep: Separator): string[] {
  if (sep !== 'whitespace') return splitQuoted(line, sep)
  return splitWhitespace(line)
}

/** Splits at runs of whitespace; a double-quoted field may contain spaces ("" is an escaped quote). */
function splitWhitespace(line: string): string[] {
  const out: string[] = []
  let i = 0
  const n = line.length
  const isSpace = (ch: string) => /\s/.test(ch)
  while (i < n) {
    while (i < n && isSpace(line[i])) i++
    if (i >= n) break
    let cur = ''
    let inQuotes = false
    while (i < n && (inQuotes || !isSpace(line[i]))) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQuotes = !inQuotes
      } else cur += ch
      i++
    }
    out.push(cur)
  }
  return out
}

function parseCell(raw: string, sep: Separator): number | string | null {
  const s = raw.trim()
  if (s === '' || MISSING.test(s)) return null
  if (sep !== ',' && DECIMAL_COMMA.test(s)) return Number(s.replace(',', '.'))
  if (NUMBER.test(s)) return Number(s)
  return s
}

/**
 * Separator choice: among the candidates whose field count is ≥ 2 and the same on the first PROBE_LINES
 * non-blank lines, the first by priority ; > tab > , > whitespace (so `1,5;2,0` is split at `;`, not at the
 * decimal commas). If no candidate is consistent, the one with the most fields (≥ 2) in the first line
 * (ties: same priority order).
 */
function detectSeparator(lines: { text: string }[]): Separator | null {
  const probe = lines.slice(0, PROBE_LINES)
  let fallback: Separator | null = null
  let fallbackCount = 1
  for (const sep of SEPARATORS) {
    const counts = probe.map((l) => splitLine(l.text, sep).length)
    const first = counts[0]
    if (first >= 2 && counts.every((c) => c === first)) return sep
    if (first > fallbackCount) {
      fallback = sep
      fallbackCount = first
    }
  }
  return fallback
}

function headerNames(cells: (number | string | null)[]): string[] {
  const seen = new Map<string, number>()
  return cells.map((c, j) => {
    const base = typeof c === 'string' && c !== '' ? c : c === null ? `col${j + 1}` : String(c)
    const k = (seen.get(base) ?? 0) + 1
    seen.set(base, k)
    return k === 1 ? base : `${base}_${k}`
  })
}

/**
 * Parses CSV text. Strips a BOM and skips blank lines. Line 1 is a header iff one of its cells is text;
 * otherwise the columns are named col1, col2, … (UCI whitespace format). Cells: quotes removed, a decimal
 * comma (`1,5`) is read as a number unless `,` is the separator, empty and NA/NaN/null/? cells are null.
 * Throws GpError('CsvParseError', { line }) (1-based physical line) for an empty input, a single column,
 * or a row whose field count differs from the first line.
 */
export function parseCsv(text: string): Table {
  const physical = text.replace(/^﻿/, '').split(/\r\n|\r|\n/)
  const lines: { text: string; line: number }[] = []
  physical.forEach((t, i) => {
    if (t.trim() !== '') lines.push({ text: t, line: i + 1 })
  })
  if (lines.length === 0) throw new GpError('CsvParseError', { line: 1, reason: 'empty' })
  const sep = detectSeparator(lines)
  if (sep === null) throw new GpError('CsvParseError', { line: lines[0].line, reason: 'separator' })

  const expected = splitLine(lines[0].text, sep).length
  const parsed = lines.map((l) => {
    const fields = splitLine(l.text, sep)
    if (fields.length !== expected) {
      throw new GpError('CsvParseError', { line: l.line, reason: 'fieldCount', expected, got: fields.length })
    }
    return fields.map((f) => parseCell(f, sep))
  })
  const hasHeader = parsed[0].some((c) => typeof c === 'string')
  if (hasHeader) {
    // Header cells keep their text (numbers in a header row are names too).
    const names = splitLine(lines[0].text, sep).map((f) => f.trim())
    return { columns: headerNames(names.map((n) => (n === '' ? null : n))), rows: parsed.slice(1) }
  }
  return { columns: Array.from({ length: expected }, (_, j) => `col${j + 1}`), rows: parsed }
}

/** Type, missing count, constancy and minimum per column. A column is numeric iff every non-null cell is a number. */
export function inferColumns(t: Table): ColumnInfo[] {
  return t.columns.map((name, j) => {
    let missing = 0
    let text = false
    let min = Infinity
    let first: number | string | null = null
    let constant = true
    for (const row of t.rows) {
      const v = row[j]
      if (v === null || v === undefined) {
        missing++
        continue
      }
      if (typeof v === 'string') text = true
      else if (v < min) min = v
      if (first === null) first = v
      else if (v !== first) constant = false
    }
    const info: ColumnInfo = { name, type: text ? 'text' : 'numeric', missing, constant }
    if (!text && Number.isFinite(min)) info.min = min
    return info
  })
}
