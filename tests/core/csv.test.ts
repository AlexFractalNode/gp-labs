import { describe, expect, it } from 'vitest'
import { inferColumns, parseCsv } from '../../src/core/csv'
import { GpError } from '../../src/core/errors'

function csvError(fn: () => unknown): GpError {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(GpError)
    return e as GpError
  }
  throw new Error('expected a GpError')
}

describe('parseCsv', () => {
  it('parses German Excel CSV (BOM, ";", decimal comma, quoted header) into numbers', () => {
    const t = parseCsv('﻿"a";"b"\n1,5;2\n3,0;4\n')
    expect(t.columns).toEqual(['a', 'b'])
    expect(t.rows).toEqual([
      [1.5, 2],
      [3, 4],
    ])
  })

  it('parses whitespace UCI format without header as col1 … col7', () => {
    const t = parseCsv('-2.3 0.568 4.78 3.99 3.17 0.125 0.11\n-2.3  0.568 4.78 3.99 3.17 0.150 0.27\n')
    expect(t.columns).toEqual(['col1', 'col2', 'col3', 'col4', 'col5', 'col6', 'col7'])
    expect(t.rows[0]).toEqual([-2.3, 0.568, 4.78, 3.99, 3.17, 0.125, 0.11])
    expect(t.rows).toHaveLength(2)
  })

  it('throws CsvParseError with the 1-based physical line of a ragged row', () => {
    const e = csvError(() => parseCsv('a,b\n1,2\n3\n'))
    expect(e.code).toBe('CsvParseError')
    expect(e.details?.line).toBe(3)
  })

  it('counts skipped blank lines in the reported line number', () => {
    const e = csvError(() => parseCsv('a;b\n\n1;2\n\n4;5;6\n'))
    expect(e.details?.line).toBe(5)
  })

  it('handles CRLF, tabs, empty cells, quoted separators and text cells', () => {
    const t = parseCsv('x\ty\tname\r\n1\t\t"a\tb"\r\n2\t3\tc\r\n')
    expect(t.columns).toEqual(['x', 'y', 'name'])
    expect(t.rows).toEqual([
      [1, null, 'a\tb'],
      [2, 3, 'c'],
    ])
  })

  it('does not read a decimal comma when "," is the separator', () => {
    const t = parseCsv('a,b,c\n1,5,2\n')
    expect(t.rows).toEqual([[1, 5, 2]])
  })

  it('prefers the separator that is consistent across lines (data line with decimal commas first)', () => {
    const t = parseCsv('1,5;2,0\n3;4,25\n5;6\n')
    expect(t.columns).toEqual(['col1', 'col2'])
    expect(t.rows).toEqual([
      [1.5, 2],
      [3, 4.25],
      [5, 6],
    ])
  })

  it('treats common missing-value markers as null and names empty or duplicate header cells', () => {
    const t = parseCsv(';a;a\n1;NA;?\n2;3;4\n')
    expect(t.columns).toEqual(['col1', 'a', 'a_2'])
    expect(t.rows[0]).toEqual([1, null, null])
  })

  it('rejects empty input and single-column input', () => {
    expect(csvError(() => parseCsv('﻿\n\n')).code).toBe('CsvParseError')
    expect(csvError(() => parseCsv('a\n1\n2\n')).code).toBe('CsvParseError')
  })
})

describe('inferColumns', () => {
  it('flags text, constant and missing values', () => {
    const t = parseCsv('x;k;s;y\n1;7;a;2\n2;7;b;\n3;7;c;5\n')
    const info = inferColumns(t)
    expect(info.map((c) => c.type)).toEqual(['numeric', 'numeric', 'text', 'numeric'])
    expect(info.map((c) => c.constant)).toEqual([false, true, false, false])
    expect(info[3].missing).toBe(1)
    expect(info[0].min).toBe(1)
    expect(info[2].min).toBeUndefined()
  })
})
