// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, watch, type EffectScope, type Ref } from 'vue'
import type { Scenario } from '../../src/tools/scenarios'

/*
 * happy-dom fires `hashchange` asynchronously after every hash change, also after history.replaceState (browsers do
 * not). These tests do not rely on either: a capture listener, registered before any router listener, stops every
 * hashchange the test did not dispatch itself. Navigation is "set the hash, then dispatch HashChangeEvent", and a
 * replaceState (removeScenarioParam, toggleLang) never reaches the router, as in a browser.
 */
const own = new WeakSet<Event>()
window.addEventListener(
  'hashchange',
  (e) => {
    if (!own.has(e)) e.stopImmediatePropagation()
  },
  true,
)

function navigate(hash: string): void {
  history.replaceState(null, '', hash)
  const e = new HashChangeEvent('hashchange')
  own.add(e)
  window.dispatchEvent(e)
}

/** Lets happy-dom deliver its own (swallowed) events and Vue flush its queues. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20))
  await nextTick()
  await nextTick()
}

type Mod = typeof import('../../src/tools/useScenario')
type Tool = 'playground' | 'kernels' | 'datalab'

interface Harness {
  mod: Mod
  api: ReturnType<Mod['useScenario']>
  adopted: string[]
  actions: Array<[string, number]>
  settled: Ref<boolean>
  live: Ref<string>
  notices: () => string[]
}

let scope: EffectScope | null = null

beforeEach(() => {
  history.replaceState(null, '', '/#/')
  vi.resetModules()
})

afterEach(() => {
  scope?.stop()
  scope = null
  history.replaceState(null, '', '/#/')
})

/** Runs useScenario for `tool` at `hash` inside an effect scope (stand-in for the view's setup). */
async function start(tool: Tool, hash: string): Promise<Harness> {
  history.replaceState(null, '', hash)
  const mod: Mod = await import('../../src/tools/useScenario')
  const { useNotices } = await import('../../src/notify')
  const adopted: string[] = []
  const actions: Array<[string, number]> = []
  const settled = ref(true)
  const live = ref('live')
  let api!: Harness['api']
  scope = effectScope()
  scope.run(() => {
    api = mod.useScenario(tool, {
      adopt: (s: Scenario) => adopted.push(s.id),
      liveKey: () => live.value,
      expectedKey: (s: Scenario) => `expected:${s.id}`,
      settled: () => settled.value,
      actions: { startRun: (s: Scenario, gen: number) => void actions.push([s.id, gen]) },
    })
  })
  await settle()
  return { mod, api, adopted, actions, settled, live, notices: () => useNotices().value.map((n) => n.key) }
}

describe('useScenario: reading and adopting', () => {
  it('runs the action exactly once after setup; the view adopts the setup state itself', async () => {
    const h = await start('datalab', '#/datalab?scenario=d1')
    expect(h.api.active.value?.id).toBe('d1')
    expect(h.api.problems.value).toEqual([])
    expect(h.api.generation.value).toBe(1)
    expect(h.adopted).toEqual([])
    expect(h.actions).toEqual([['d1', 1]])
  })

  it('does not run the action again after removeScenarioParam or toggleLang', async () => {
    const h = await start('datalab', '#/datalab?scenario=d1')
    const { toggleLang } = await import('../../src/i18n')
    toggleLang()
    await settle()
    expect(window.location.hash).toContain('scenario=d1')
    expect(window.location.hash).toContain('lang=')
    const { removeScenarioParam } = await import('../../src/tools/scenarioUrl')
    removeScenarioParam()
    await settle()
    expect(window.location.hash).not.toContain('scenario=')
    expect(h.actions).toHaveLength(1)
    expect(h.adopted).toEqual([])
    expect(h.api.generation.value).toBe(1)
  })

  it('apply with the identical address adopts and runs the action again (refreshRoute)', async () => {
    const h = await start('datalab', '#/datalab?lang=en&scenario=d1')
    h.api.apply(h.api.active.value!)
    // the watcher adopts synchronously
    expect(h.adopted).toEqual(['d1'])
    await settle()
    expect(window.location.hash).toBe('#/datalab?lang=en&scenario=d1')
    expect(h.api.generation.value).toBe(2)
    expect(h.actions).toEqual([
      ['d1', 1],
      ['d1', 2],
    ])
    h.api.restore()
    await settle()
    expect(h.adopted).toEqual(['d1', 'd1'])
    expect(h.actions).toHaveLength(3)
  })

  it('apply of another scenario sets the hash (keeping lang); the hashchange adopts it', async () => {
    const h = await start('datalab', '#/datalab?scenario=d1&lang=en')
    const { scenarioById } = await import('../../src/tools/scenarios')
    h.mod.applyScenario(scenarioById('d3')!)
    expect(window.location.hash).toBe('#/datalab?scenario=d3&lang=en')
    expect(h.adopted).toEqual([])
    navigate(window.location.hash)
    expect(h.adopted).toEqual(['d3'])
    await settle()
    expect(h.api.active.value?.id).toBe('d3')
    expect(h.actions).toEqual([
      ['d1', 1],
      ['d3', 2],
    ])
  })

  it('a hash change to another route does nothing (KeepAlive: the watcher still runs)', async () => {
    const h = await start('datalab', '#/datalab?scenario=d1')
    navigate('#/kernels?preset=expquad&scenario=k1')
    await settle()
    navigate('#/playground?scenario=zz')
    await settle()
    expect(h.adopted).toEqual([])
    expect(h.actions).toHaveLength(1)
    expect(h.api.active.value?.id).toBe('d1')
    expect(h.api.problems.value).toEqual([])
    expect(h.notices()).toEqual([])
    // the foreign address is left alone
    expect(window.location.hash).toBe('#/playground?scenario=zz')
  })

  it('returning to the tool without `scenario` only clears active', async () => {
    const h = await start('datalab', '#/datalab?scenario=d1')
    navigate('#/kernels')
    navigate('#/datalab')
    await settle()
    expect(h.api.active.value).toBeNull()
    expect(h.adopted).toEqual([])
    expect(h.actions).toHaveLength(1)
  })

  it('dismiss clears active and removes `scenario` from the address without a new adoption', async () => {
    const h = await start('playground', '#/playground?preset=kap9&x=0&scenario=p1&lang=en')
    expect(h.api.active.value?.id).toBe('p1')
    h.api.dismiss()
    expect(h.api.active.value).toBeNull()
    expect(window.location.hash).toBe('#/playground?preset=kap9&x=0&lang=en')
    await settle()
    expect(h.adopted).toEqual([])
    expect(h.api.active.value).toBeNull()
  })
})

describe('useScenario: invalid values', () => {
  it('an unknown id at setup: problems, notice, no adoption, no action, `scenario` removed at once', async () => {
    const h = await start('datalab', '#/datalab?scenario=zz&lang=en')
    expect(h.api.active.value).toBeNull()
    expect(h.api.problems.value).toEqual(['notice.unknownScenario'])
    expect(h.notices()).toEqual(['notice.unknownScenario'])
    expect(window.location.hash).toBe('#/datalab?lang=en')
    expect(h.api.generation.value).toBe(0)
    expect(h.adopted).toEqual([])
    expect(h.actions).toEqual([])
  })

  it('a scenario of another tool arriving by hashchange is treated as unknown', async () => {
    const h = await start('playground', '#/playground')
    navigate('#/playground?preset=kap9&scenario=d1')
    expect(h.api.problems.value).toEqual(['notice.unknownScenario'])
    expect(window.location.hash).toBe('#/playground?preset=kap9')
    await settle()
    expect(h.api.active.value).toBeNull()
    expect(h.notices()).toEqual(['notice.unknownScenario'])
    expect(h.adopted).toEqual([])
    expect(h.actions).toEqual([])
    expect(h.api.generation.value).toBe(0)
  })
})

describe('useScenario: address not matching the scenario', () => {
  it('at setup: active is set, no adoption is counted, no action', async () => {
    const h = await start('kernels', '#/kernels?preset=expquad&scenario=k3')
    expect(h.api.active.value?.id).toBe('k3')
    expect(h.api.generation.value).toBe(0)
    expect(h.adopted).toEqual([])
  })

  it('by hashchange (Code 45 button with a standing scenario): active stays, no adopt, deviated', async () => {
    const h = await start('playground', '#/playground?preset=hyper-43&scenario=p3')
    expect(h.api.generation.value).toBe(1)
    navigate('#/playground?preset=hyper-45&scenario=p3')
    await settle()
    expect(h.api.active.value?.id).toBe('p3')
    expect(h.adopted).toEqual([])
    expect(h.actions).toEqual([])
    expect(h.api.generation.value).toBe(1)
    expect(h.api.deviated.value).toBe(true)
  })

  it('a valid matching hashchange adopts synchronously and counts a generation', async () => {
    const h = await start('playground', '#/playground')
    navigate('#/playground?preset=kap9&x=0&scenario=p1')
    expect(h.adopted).toEqual(['p1'])
    expect(h.api.generation.value).toBe(1)
    // p1 has no action
    await settle()
    expect(h.actions).toEqual([])
  })
})

describe('useScenario: action timing', () => {
  /*
   * The watcher is flush: 'sync', so the action's wait starts inside the route trigger, possibly before the view's
   * pre-flush watchers are queued. No other flush is pending here (no App.vue watcher): the action must still see
   * that the view's pre watchers ran, registered after useScenario (on the state adopt changed, on the route).
   */
  it('runs after the pre-flush watchers the adoption triggered', async () => {
    history.replaceState(null, '', '#/datalab')
    const mod: Mod = await import('../../src/tools/useScenario')
    const { useRoute } = await import('../../src/router')
    const log: string[] = []
    const loaded = ref(0)
    scope = effectScope()
    scope.run(() => {
      mod.useScenario('datalab', {
        adopt: () => {
          loaded.value++
          log.push(`adopt ${loaded.value}`)
        },
        liveKey: () => '',
        expectedKey: () => '',
        actions: { startRun: (s: Scenario, gen: number) => void log.push(`action ${s.id} ${gen}`) },
      })
      watch(loaded, (n) => log.push(`viewPre loaded ${n}`))
      watch(useRoute(), (r) => log.push(`viewPre route ${r.params.get('scenario')}`))
    })
    await settle()
    expect(log).toEqual([])
    navigate('#/datalab?scenario=d1')
    await settle()
    expect(log).toEqual(['adopt 1', 'viewPre loaded 1', 'viewPre route d1', 'action d1 1'])
    navigate('#/datalab?scenario=d2')
    await settle()
    expect(log.slice(4)).toEqual(['adopt 2', 'viewPre loaded 2', 'viewPre route d2', 'action d2 2'])
  })

  it('runs after the route pre watcher of the view even when adopt queues nothing itself', async () => {
    history.replaceState(null, '', '#/datalab')
    const mod: Mod = await import('../../src/tools/useScenario')
    const { useRoute } = await import('../../src/router')
    const log: string[] = []
    scope = effectScope()
    scope.run(() => {
      mod.useScenario('datalab', {
        adopt: (s: Scenario) => void log.push(`adopt ${s.id}`),
        liveKey: () => '',
        expectedKey: () => '',
        actions: { startRun: (s: Scenario) => void log.push(`action ${s.id}`) },
      })
      watch(useRoute(), (r) => log.push(`viewPre route ${r.params.get('scenario')}`))
    })
    await settle()
    navigate('#/datalab?scenario=d1')
    await settle()
    expect(log).toEqual(['adopt d1', 'viewPre route d1', 'action d1'])
  })
})

describe('useScenario: generation and deviation', () => {
  it('two applies of the same scenario in one tick: generation +2, one action with the last generation', async () => {
    const h = await start('datalab', '#/datalab?scenario=d1')
    expect(h.api.generation.value).toBe(1)
    const s = h.api.active.value!
    h.api.apply(s)
    h.api.apply(s)
    expect(h.api.generation.value).toBe(3)
    expect(h.adopted).toEqual(['d1', 'd1'])
    await settle()
    expect(h.actions).toEqual([
      ['d1', 1],
      ['d1', 3],
    ])
  })

  it('skips the action when the scenario was dismissed before it was due', async () => {
    const h = await start('datalab', '#/datalab?scenario=d1')
    h.api.apply(h.api.active.value!)
    h.api.dismiss()
    await settle()
    expect(h.actions).toEqual([['d1', 1]])
  })

  it('skips the action when the scope was disposed before it was due', async () => {
    const h = await start('datalab', '#/datalab?scenario=d1')
    h.api.apply(h.api.active.value!)
    scope?.stop()
    scope = null
    await settle()
    expect(h.actions).toEqual([['d1', 1]])
  })

  it('deviated is false while settled() is false and compares liveKey with expectedKey', async () => {
    const h = await start('datalab', '#/datalab?scenario=d1')
    h.settled.value = false
    expect(h.api.deviated.value).toBe(false)
    h.settled.value = true
    expect(h.api.deviated.value).toBe(true)
    h.live.value = 'expected:d1'
    expect(h.api.deviated.value).toBe(false)
    h.api.dismiss()
    h.live.value = 'other'
    expect(h.api.deviated.value).toBe(false)
  })
})
