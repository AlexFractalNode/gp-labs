/**
 * Proof helper of the scenario claims: `claim` rounds a value computed by the GP core, compares it with the
 * number as written in the texts and records it. The closing test of every claims file compares the recorded
 * set with CLAIMED[id], so every listed number has a proof and every proof a listed number.
 * The record is module state; Vitest isolates test files, so each file sees only its own claims.
 */
import { expect } from 'vitest'
import { scenarioById } from '../../../src/tools/scenarios'
import { CLAIMED } from './claimed'

const proven = new Map<string, Set<string>>()

/**
 * Proves `text` (normalised: decimal point, '-' minus) for scenario `id`: it must be listed in CLAIMED[id] and
 * equal `actual.toFixed(digits)`. Percentages are passed as 100·x.
 */
export function claim(id: string, text: string, actual: number, digits: number): void {
  const list = CLAIMED[id]
  expect(list, `unknown scenario ${id}`).toBeDefined()
  expect(list, `${id}: "${text}" is not listed in CLAIMED`).toContain(text)
  expect(Number.isFinite(actual), `${id}: "${text}" from a non-finite value ${actual}`).toBe(true)
  expect(actual.toFixed(digits), `${id}: "${text}" (actual ${actual})`).toBe(text)
  let set = proven.get(id)
  if (!set) {
    set = new Set()
    proven.set(id, set)
  }
  set.add(text)
}

/** Proves the chapter numbers of the title against the registry (`'14–15'` → 14 and 15, `'13.4'` → 13.4). */
export function claimChapter(id: string): void {
  const s = scenarioById(id)
  expect(s, `unknown scenario ${id}`).not.toBeNull()
  const numbers = s!.chapter.match(/\d+(?:\.\d+)?/g) ?? []
  expect(numbers.length, `${id}: chapter without a number`).toBeGreaterThan(0)
  for (const n of numbers) claim(id, n, Number(n), (n.split('.')[1] ?? '').length)
}

/** The numbers proven so far for `id`. */
export function claimed(id: string): Set<string> {
  return new Set(proven.get(id) ?? [])
}

/** Closing check of a claims file: the proven numbers are exactly CLAIMED[id]. */
export function expectAllClaimed(id: string): void {
  expect([...claimed(id)].sort(), id).toEqual([...CLAIMED[id]].sort())
}
