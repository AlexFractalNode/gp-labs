/**
 * Run comparison of the Daten-Lab (Spec §6, step 5): every successful run is kept in memory only (no storage,
 * no export), together with the configuration it was evaluated on (needed for slices and the table's data column).
 */
import { shallowRef, type Ref } from 'vue'
import type { RunConfig, RunResult } from './pipeline'

/** What the runs table shows about the data of a run. */
export interface RunMeta {
  cfg: RunConfig
  /** Display name of the data source ('Yacht' or the file name). */
  source: string
  target: string
}

// Shallow: results stay raw objects, so the WeakMaps here and in the pipeline (fit cache) find them.
const runs: Ref<RunResult[]> = shallowRef([])
const meta = new WeakMap<RunResult, RunMeta>()

export function useRuns(): {
  runs: Ref<RunResult[]>
  add(r: RunResult, m?: RunMeta): void
  clear(): void
} {
  return {
    runs,
    add(r: RunResult, m?: RunMeta) {
      if (m) meta.set(r, m)
      runs.value = [...runs.value, r]
    },
    clear() {
      runs.value = []
    },
  }
}

/** Configuration and data description of a run added with `add(r, meta)`. */
export function runMeta(r: RunResult): RunMeta | undefined {
  return meta.get(r)
}
