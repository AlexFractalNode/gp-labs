// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { computed, shallowRef } from 'vue'
import { mount } from '@vue/test-utils'
import ScenarioNote from '../../src/ui/ScenarioNote.vue'
import ScenarioBar from '../../src/ui/ScenarioBar.vue'
import ScenarioArea from '../../src/ui/ScenarioArea.vue'
import type { ScenarioApi } from '../../src/tools/useScenario'
import { scenarioById, type Scenario } from '../../src/tools/scenarios'
import { setLang, type MessageKey } from '../../src/i18n'
import de from '../../src/i18n/de'
import en from '../../src/i18n/en'

setLang('de')
const p1 = scenarioById('p1') as Scenario

describe('ScenarioNote', () => {
  it('renders the title and the three sections when ready', () => {
    const w = mount(ScenarioNote, { props: { scenario: p1, deviated: false } })
    const root = w.find('[data-verify-unit="scenario-note"]')
    expect(root.attributes('data-verify-state')).toBe('ready')
    expect(root.attributes('data-verify-scenario')).toBe('p1')
    expect(root.attributes('data-verify-deviated')).toBe('false')
    expect(root.attributes('hidden')).toBeUndefined()
    expect(w.find('h3').text()).toBe(de.scenario.p1.title)
    const sections = w.findAll('.section')
    expect(sections).toHaveLength(3)
    expect(sections[0].text()).toContain(de.scenario.noteSee)
    expect(sections[0].text()).toContain(de.scenario.p1.see)
    expect(sections[1].text()).toContain(de.scenario.noteWatch)
    expect(sections[1].text()).toContain(de.scenario.p1.watch)
    expect(sections[2].text()).toContain(de.scenario.noteNext)
    expect(sections[2].text()).toContain(de.scenario.p1.next)
    expect(w.find('[data-action="restore"]').exists()).toBe(false)
  })

  it('shows the deviation hint with a restore button that emits restore', async () => {
    const w = mount(ScenarioNote, { props: { scenario: p1, deviated: true } })
    expect(w.find('[data-verify-unit="scenario-note"]').attributes('data-verify-deviated')).toBe('true')
    expect(w.text()).toContain(de.scenario.changed)
    expect(w.find('[role="status"]').text()).toBe(`${de.scenario.p1.title} ${de.scenario.changed}`)
    const restore = w.find('[data-action="restore"]')
    expect(restore.text()).toBe(de.scenario.restore)
    await restore.trigger('click')
    expect(w.emitted('restore')).toHaveLength(1)
  })

  it('emits close from the × button', async () => {
    const w = mount(ScenarioNote, { props: { scenario: p1, deviated: false } })
    const close = w.find('[data-action="close"]')
    expect(close.attributes('aria-label')).toBe(de.scenario.close)
    await close.trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('keeps an empty, hidden root without a scenario', () => {
    const w = mount(ScenarioNote, { props: { scenario: null, deviated: true } })
    const root = w.find('[data-verify-unit="scenario-note"]')
    expect(root.exists()).toBe(true)
    expect(root.attributes('data-verify-state')).toBe('empty')
    expect(root.attributes('data-verify-deviated')).toBe('false')
    expect(root.attributes('hidden')).toBeDefined()
    expect(w.find('h3').exists()).toBe(false)
  })

  it('places the live region outside the hidden element', async () => {
    const w = mount(ScenarioNote, { props: { scenario: null, deviated: false } })
    const root = w.find('[data-verify-unit="scenario-note"]')
    const live = w.find('[role="status"]')
    expect(live.exists()).toBe(true)
    expect(root.find('[role="status"]').exists()).toBe(false)
    expect(root.element.contains(live.element)).toBe(false)
    expect(live.attributes('aria-live')).toBe('polite')
    expect(live.attributes('aria-atomic')).toBe('true')
    expect(live.classes()).toContain('sr-only')
    expect(root.attributes('aria-live')).toBeUndefined()
    expect(live.text()).toBe('')
    await w.setProps({ scenario: p1 })
    expect(w.find('[role="status"]').element).toBe(live.element)
    expect(live.text()).toBe(de.scenario.p1.title)
    await w.setProps({ deviated: true })
    expect(live.text()).toBe(`${de.scenario.p1.title} ${de.scenario.changed}`)
    await w.setProps({ scenario: null })
    expect(live.text()).toBe('')
  })

  it('keeps the announcement on a language toggle and re-announces on a new scenario', async () => {
    setLang('de')
    const w = mount(ScenarioNote, { props: { scenario: p1, deviated: false } })
    const live = w.find('[role="status"]')
    setLang('en')
    await w.vm.$nextTick()
    expect(w.find('h3').text()).toBe(en.scenario.p1.title)
    expect(live.text()).toBe(de.scenario.p1.title)
    await w.setProps({ scenario: scenarioById('p2') as Scenario })
    expect(live.text()).toBe(en.scenario.p2.title)
    setLang('de')
  })
})

describe('ScenarioBar', () => {
  it('renders the three scenarios of the tool as pressed/unpressed buttons and emits apply', async () => {
    const w = mount(ScenarioBar, { props: { tool: 'kernels', activeId: 'k2' } })
    const root = w.find('[data-verify-unit="scenario-bar"]')
    expect(root.attributes('data-verify-state')).toBe('ready')
    expect(root.attributes('data-verify-count')).toBe('3')
    expect(root.attributes('role')).toBe('group')
    expect(root.attributes('aria-label')).toBe(de.scenario.barLabel)
    const cards = w.findAll('button[data-scenario]')
    expect(cards.map((c) => c.attributes('data-scenario'))).toEqual(['k1', 'k2', 'k3'])
    expect(cards.map((c) => c.attributes('aria-pressed'))).toEqual(['false', 'true', 'false'])
    for (const c of cards) {
      const id = c.attributes('data-scenario') as 'k1' | 'k2' | 'k3'
      expect(c.attributes('type')).toBe('button')
      expect(c.text()).toContain(de.scenario[id].title)
      expect(c.text()).toContain(de.scenario[id].short)
    }
    await cards[2].trigger('click')
    expect(w.emitted('apply')).toEqual([[scenarioById('k3')]])
  })
})

describe('ScenarioArea focus', () => {
  function fakeApi(deviatedNow: boolean): ScenarioApi {
    const active = shallowRef<Scenario | null>(scenarioById('d2') as Scenario)
    const deviated = shallowRef(deviatedNow)
    return {
      active,
      deviated: computed(() => active.value !== null && deviated.value),
      problems: shallowRef<MessageKey[]>([]),
      generation: shallowRef(0),
      apply: vi.fn(),
      dismiss: vi.fn(() => {
        active.value = null
      }),
      restore: vi.fn(() => {
        deviated.value = false
      }),
    }
  }

  it('passes the card click to apply', async () => {
    const api = fakeApi(false)
    const w = mount(ScenarioArea, { props: { tool: 'datalab', scenario: api } })
    await w.find('button[data-scenario="d3"]').trigger('click')
    expect(api.apply).toHaveBeenCalledWith(scenarioById('d3'))
  })

  it('moves the focus from the closed note to the card of that scenario', async () => {
    const api = fakeApi(false)
    const w = mount(ScenarioArea, { props: { tool: 'datalab', scenario: api }, attachTo: document.body })
    ;(w.find('[data-action="close"]').element as HTMLElement).focus()
    await w.find('[data-action="close"]').trigger('click')
    await w.vm.$nextTick()
    expect(api.dismiss).toHaveBeenCalledTimes(1)
    expect(w.find('[data-verify-unit="scenario-note"]').attributes('data-verify-state')).toBe('empty')
    expect(document.activeElement).toBe(w.find('button[data-scenario="d2"]').element)
    w.unmount()
  })

  it('moves the focus to the note title after restore removed the button', async () => {
    const api = fakeApi(true)
    const w = mount(ScenarioArea, { props: { tool: 'datalab', scenario: api }, attachTo: document.body })
    ;(w.find('[data-action="restore"]').element as HTMLElement).focus()
    await w.find('[data-action="restore"]').trigger('click')
    await w.vm.$nextTick()
    expect(api.restore).toHaveBeenCalledTimes(1)
    expect(w.find('[data-action="restore"]').exists()).toBe(false)
    const title = w.find('h3')
    expect(title.attributes('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(title.element)
    w.unmount()
  })
})
