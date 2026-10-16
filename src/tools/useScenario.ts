/**
 * Scenario state of one tool view (onboarding, Spec §3.3): which scenario the address names, whether the user
 * deviated from it, and the one-off start action.
 *
 * The views do not write their controls to the address, so the composable decides when a scenario is adopted:
 *  - Setup (cold load, or a view created fresh for the new route): `active` is read; the view adopts the setup state
 *    itself (its `onMounted`). A valid scenario whose address matches (`routeMatchesScenario`) counts as an adoption.
 *  - Route watcher (not `immediate`, so it never repeats the setup run): every new route object of this tool
 *    (`hashchange` or `refreshRoute`) with a valid, matching scenario calls `opts.adopt(s)`. A valid scenario on a
 *    non-matching address (gallery switch, "Code 45" with a standing `scenario`) stays active (the note shows
 *    "changed") without adoption; the view loads it through its normal preset path.
 *  - The watcher is `flush: 'sync'`: one adoption per route object, also when several arrive in one tick (two
 *    clicks on a card), so `generation` counts each of them and only the last one's action runs.
 *  - removeScenarioParam / toggleLang use replaceState and never touch the route ref (no adoption, no action).
 *  - KeepAlive: the watcher keeps running while the view is deactivated; routes of other tools are ignored.
 *
 * Action timing: the action must see the adopted state, so it runs after `await nextTick()` (after the flush the
 * adoption triggered; in setup, after the mount), once per adoption, and only if the scenario is still active, no
 * later adoption happened (`generation`) and the scope is alive.
 */
import {
  computed,
  getCurrentScope,
  nextTick,
  onScopeDispose,
  readonly,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
  type ShallowRef,
} from 'vue'
import type { MessageKey } from '../i18n'
import { notify } from '../notify'
import { refreshRoute, useRoute } from '../router'
import { sameHash } from '../urlState'
import { removeScenarioParam } from './scenarioUrl'
import {
  parseScenarioParam,
  routeMatchesScenario,
  scenarioHref,
  type Scenario,
  type ScenarioAction,
  type ToolId,
} from './scenarios'

/**
 * Applies a scenario from anywhere (bar, note, help drawer): sets the address (keeping the live `lang`); when it is
 * already identical (in any parameter order), re-reads it instead, so the view adopts it again and the action runs
 * again.
 */
export function applyScenario(s: Scenario): void {
  if (typeof window === 'undefined') return
  const live = window.location.hash
  const lang = new URLSearchParams(live.split('?')[1] ?? '').get('lang') ?? undefined
  const target = scenarioHref(s, lang)
  if (sameHash(target, live)) refreshRoute()
  else window.location.hash = target
}

export type ScenarioActionFn = (s: Scenario, generation: number) => void | Promise<void>

export interface ScenarioOptions {
  /** Adopts a valid scenario whose address matches (watcher only; the view adopts the setup state itself). */
  adopt: (s: Scenario) => void
  /** Canonical key of the live view state. */
  liveKey: () => string
  /** Canonical key the view has right after adopting `s`. */
  expectedKey: (s: Scenario) => string
  /** False while the view is still adopting / loading; no deviation is reported then. Default: always settled. */
  settled?: () => boolean
  actions?: Partial<Record<ScenarioAction, ScenarioActionFn>>
}

export interface ScenarioApi {
  active: ShallowRef<Scenario | null>
  deviated: ComputedRef<boolean>
  problems: Ref<MessageKey[]>
  /** Number of adoptions so far; an action or async adoption compares it to drop superseded work. */
  generation: Readonly<Ref<number>>
  apply: (s: Scenario) => void
  dismiss: () => void
  restore: () => void
}

export function useScenario(tool: ToolId, opts: ScenarioOptions): ScenarioApi {
  const route = useRoute()
  // shallow: the registry objects stay raw, so identity checks against them hold
  const active = shallowRef<Scenario | null>(null)
  const problems = ref<MessageKey[]>([])
  const generation = ref(0)
  let disposed = false
  if (getCurrentScope()) onScopeDispose(() => (disposed = true))

  /**
   * Reads `scenario` from the route. Returns the scenario that is due for adoption (valid and matching the address),
   * or null. A route of another tool is ignored (KeepAlive, or this view is about to unmount).
   */
  function read(): Scenario | null {
    const r = route.value
    if (r.route !== tool) return null
    const parsed = parseScenarioParam(tool, r.params)
    active.value = parsed.scenario
    problems.value = parsed.problems
    if (parsed.problems.length > 0) {
      for (const key of parsed.problems) notify(key)
      removeScenarioParam()
      return null
    }
    if (parsed.scenario === null || !routeMatchesScenario(r.params, parsed.scenario)) return null
    return parsed.scenario
  }

  async function runAction(s: Scenario, gen: number): Promise<void> {
    if (s.action === undefined) return
    const fn = opts.actions?.[s.action]
    if (fn === undefined) return
    await nextTick()
    // Skip when the view is gone, the scenario was dismissed / replaced, or a later adoption superseded this one.
    if (disposed || active.value !== s || generation.value !== gen) return
    try {
      // not awaited: a long run must not block anything; its rejection is reported, not left unhandled
      void Promise.resolve(fn(s, gen)).catch((err: unknown) => console.error(`scenario ${s.id}: action failed`, err))
    } catch (err) {
      console.error(`scenario ${s.id}: action failed`, err)
    }
  }

  /**
   * Counts one adoption, lets the view adopt (watcher only) and schedules the action. The generation goes up first:
   * an async adoption in the view reads it to detect being superseded.
   */
  function adoption(s: Scenario, callAdopt: boolean): void {
    generation.value++
    const gen = generation.value
    if (callAdopt) opts.adopt(s)
    void runAction(s, gen)
  }

  const initial = read()
  if (initial !== null) adoption(initial, false)

  watch(
    () => route.value,
    () => {
      const s = read()
      if (s !== null) adoption(s, true)
    },
    { flush: 'sync' },
  )

  const deviated = computed(
    () => active.value !== null && (opts.settled?.() ?? true) && opts.liveKey() !== opts.expectedKey(active.value),
  )

  function dismiss(): void {
    active.value = null
    removeScenarioParam()
  }

  function restore(): void {
    if (active.value) applyScenario(active.value)
  }

  return { active, deviated, problems, generation: readonly(generation), apply: applyScenario, dismiss, restore }
}
