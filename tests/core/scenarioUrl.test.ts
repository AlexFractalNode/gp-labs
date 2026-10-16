// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { removeScenarioParam } from '../../src/tools/scenarioUrl'
import { routeMatchesScenario, scenarioById, type Scenario } from '../../src/tools/scenarios'
import { sameHash } from '../../src/urlState'

const byId = (id: string) => scenarioById(id) as Scenario

afterEach(() => {
  history.replaceState(null, '', '/#/')
})

describe('removeScenarioParam', () => {
  it('removes only `scenario` and keeps the path and the other parameters in order', () => {
    history.replaceState(null, '', '/#/playground?preset=kap9&scenario=p1&x=0&lang=en')
    removeScenarioParam()
    expect(window.location.hash).toBe('#/playground?preset=kap9&x=0&lang=en')
  })

  it('drops the `?` when `scenario` was the only parameter', () => {
    history.replaceState(null, '', '/#/datalab?scenario=d1')
    removeScenarioParam()
    expect(window.location.hash).toBe('#/datalab')
  })

  it('leaves an address without `scenario` untouched', () => {
    history.replaceState(null, '', '/#/kernels?preset=expquad')
    removeScenarioParam()
    expect(window.location.hash).toBe('#/kernels?preset=expquad')
    history.replaceState(null, '', '/#/kernels')
    removeScenarioParam()
    expect(window.location.hash).toBe('#/kernels')
  })
})

describe('sameHash', () => {
  it('ignores the parameter order', () => {
    expect(sameHash('#/playground?preset=kap9&x=0&scenario=p1', '#/playground?scenario=p1&x=0&preset=kap9')).toBe(
      true,
    )
    expect(sameHash('#/datalab?scenario=d1&lang=en', 'datalab?lang=en&scenario=d1')).toBe(true)
  })

  it('differs on another route, another value or another parameter set', () => {
    expect(sameHash('#/playground?scenario=p1', '#/kernels?scenario=p1')).toBe(false)
    expect(sameHash('#/playground?x=0', '#/playground?x=0.5')).toBe(false)
    expect(sameHash('#/playground?x=0', '#/playground?x=0&lang=en')).toBe(false)
    expect(sameHash('#/datalab', '#/datalab?scenario=d1')).toBe(false)
  })

  it('treats two unknown routes apart from the home page', () => {
    expect(sameHash('#/', '#/nowhere')).toBe(false)
  })
})

describe('routeMatchesScenario', () => {
  it('p1 with x=0.5 does not match', () => {
    expect(routeMatchesScenario(new URLSearchParams('preset=kap9&x=0.5&scenario=p1'), byId('p1'))).toBe(false)
    expect(routeMatchesScenario(new URLSearchParams('preset=kap9&x=0&scenario=p1'), byId('p1'))).toBe(true)
  })

  it('k3 with preset=expquad does not match', () => {
    expect(routeMatchesScenario(new URLSearchParams('preset=expquad&scenario=k3'), byId('k3'))).toBe(false)
    expect(routeMatchesScenario(new URLSearchParams('preset=power-exp&scenario=k3'), byId('k3'))).toBe(true)
  })

  it('d1 matches any parameters', () => {
    expect(routeMatchesScenario(new URLSearchParams(''), byId('d1'))).toBe(true)
    expect(routeMatchesScenario(new URLSearchParams('kernel=abc&lang=en&scenario=d1'), byId('d1'))).toBe(true)
  })
})
