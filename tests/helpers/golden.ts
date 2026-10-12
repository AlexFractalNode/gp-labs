import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Test-only: parse tests/golden/<name>.json (produced by scripts/make_golden.py). */
export function loadGolden(name: string): any {
  const url = new URL(`../golden/${name}.json`, import.meta.url)
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8'))
}
