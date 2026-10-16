import { expect, test, type Page } from '@playwright/test'
import { scenarioById, scenarioHref, type Scenario, type ToolId } from '../../src/tools/scenarios'
import de from '../../src/i18n/de'
import en from '../../src/i18n/en'

/** Collects console errors and uncaught exceptions of a page. */
function trackErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}

const unit = (name: string) => `[data-verify-unit="${name}"]`
const T = { timeout: 10_000 }
const card = (page: Page, id: string) => page.locator(`${unit('scenario-bar')} [data-scenario="${id}"]`)
const note = (page: Page) => page.locator(unit('scenario-note'))
const lang = (page: Page) => page.locator(unit('lang-toggle'))
const inspector = (page: Page) => page.locator(unit('playground-inspector'))
const field = (page: Page, key: string) => page.locator(`${unit('playground-inspector')} [data-verify-field="${key}"]`)
const plot = (page: Page) => page.locator(unit('playground-plot'))
const validity = (page: Page) => page.locator(unit('kernel-validity'))
const kernelView = (page: Page) => page.locator(unit('kernel-view'))

const scenario = (id: string): Scenario => {
  const s = scenarioById(id)
  if (!s) throw new Error(`no scenario ${id}`)
  return s
}

/** A unit of the view of `tool` whose state shows that the view has rendered. */
const READY: Record<ToolId, string> = {
  playground: 'playground-plot',
  kernels: 'kernel-samples',
  datalab: 'datalab-view',
}

async function openTool(page: Page, tool: ToolId, query = 'lang=de') {
  await page.goto(`/#/${tool}?${query}`)
  await expect(page.locator(unit('scenario-bar'))).toBeVisible(T)
  await expect(page.locator(unit(READY[tool]))).toHaveAttribute('data-verify-state', /^(ready|loading|error)$/, T)
}

async function openScenario(page: Page, s: Scenario, mode: 'click' | 'link') {
  if (mode === 'link') {
    await page.goto(`/${scenarioHref(s, 'de')}`)
  } else {
    await openTool(page, s.tool)
    await card(page, s.id).click()
  }
  await expect(note(page)).toHaveAttribute('data-verify-state', 'ready', T)
  await expect(note(page)).toHaveAttribute('data-verify-scenario', s.id)
  await expect(page).toHaveURL(new RegExp(`scenario=${s.id}(&|$)`))
  await expect(card(page, s.id)).toHaveAttribute('aria-pressed', 'true')
}

/** k3 is invalid: the check finds negative eigenvalues (state as for any invalid kernel). */
async function expectInvalidPowerExp(page: Page) {
  await expect(kernelView(page)).toHaveAttribute('data-verify-preset', 'power-exp', T)
  await expect(validity(page)).toHaveAttribute('data-verify-state', 'error', T)
  await expect(validity(page)).toHaveAttribute('data-verify-error', 'error.notPsd')
  expect(Number(await validity(page).getAttribute('data-verify-negatives'))).toBeGreaterThan(0)
}

/** The core numbers of each scenario, read from the data-verify contracts (DE number format). */
const CHECKS: Record<string, (page: Page) => Promise<void>> = {
  p1: async (page) => {
    await expect(inspector(page)).toHaveAttribute('data-verify-state', 'ready', T)
    await expect(inspector(page)).toHaveAttribute('data-verify-pinned', 'true')
    await expect(field(page, 'mean')).toContainText('0,800')
    await expect(field(page, 'sdF')).toContainText('0,447')
    await expect(field(page, 'sdY')).toContainText('0,671')
  },
  p2: async (page) => {
    await expect(inspector(page)).toHaveAttribute('data-verify-state', 'ready', T)
    await expect(field(page, 'sdF')).toContainText('1,000')
    await expect(field(page, 'sdY')).toContainText('1,005')
  },
  p3: async (page) => {
    // log ML is computed 250 ms after the last change
    await expect(page.locator(unit('playground-logml'))).toContainText(/[−-]1553,39/, T)
  },
  k1: async (page) => {
    await expect(kernelView(page)).toHaveAttribute('data-verify-preset', 'expquad', T)
  },
  k2: async (page) => {
    await expect(kernelView(page)).toHaveAttribute('data-verify-preset', 'lin-plus-periodic', T)
  },
  k3: expectInvalidPowerExp,
}

for (const id of ['p1', 'p2', 'p3', 'k1', 'k2', 'k3']) {
  for (const mode of ['click', 'link'] as const) {
    test(`scenario ${id} by ${mode}`, async ({ page }) => {
      const errors = trackErrors(page)
      await openScenario(page, scenario(id), mode)
      await CHECKS[id](page)
      expect(errors).toEqual([])
    })
  }
}

test('p1: an added point marks the scenario as deviated, restore brings back one point', async ({ page }) => {
  const errors = trackErrors(page)
  await openScenario(page, scenario('p1'), 'link')
  await expect(note(page)).toHaveAttribute('data-verify-deviated', 'false')
  await expect(plot(page)).toHaveAttribute('data-verify-count', '1')
  await page.locator(`${unit('playground-plot')} rect.capture`).click({ position: { x: 500, y: 120 } })
  await expect(plot(page)).toHaveAttribute('data-verify-count', '2')
  await expect(note(page)).toHaveAttribute('data-verify-deviated', 'true')
  await note(page).locator('[data-action="restore"]').click()
  await expect(note(page)).toHaveAttribute('data-verify-deviated', 'false', T)
  await expect(plot(page)).toHaveAttribute('data-verify-count', '1')
  await expect(note(page).locator('.note-title')).toBeFocused()
  await CHECKS.p1(page)
  expect(errors).toEqual([])
})

test('p1: clicking the active card again resets an added point', async ({ page }) => {
  const errors = trackErrors(page)
  await openScenario(page, scenario('p1'), 'click')
  await page.locator(`${unit('playground-plot')} rect.capture`).click({ position: { x: 500, y: 120 } })
  await expect(plot(page)).toHaveAttribute('data-verify-count', '2')
  await expect(note(page)).toHaveAttribute('data-verify-deviated', 'true')
  await card(page, 'p1').click()
  await expect(plot(page)).toHaveAttribute('data-verify-count', '1', T)
  await expect(note(page)).toHaveAttribute('data-verify-deviated', 'false')
  await expect(page).toHaveURL(/scenario=p1/)
  expect(errors).toEqual([])
})

test('p3: "Code 45" keeps the scenario as deviated, restore loads hyper-43 again', async ({ page }) => {
  const errors = trackErrors(page)
  await openScenario(page, scenario('p3'), 'link')
  await expect(note(page)).toHaveAttribute('data-verify-deviated', 'false')
  await page.getByRole('button', { name: /Code 45/ }).click()
  await expect(page).toHaveURL(/preset=hyper-45/)
  await expect(page).toHaveURL(/scenario=p3/)
  await expect(page.getByRole('button', { name: /Code 45/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(note(page)).toHaveAttribute('data-verify-scenario', 'p3')
  await expect(note(page)).toHaveAttribute('data-verify-deviated', 'true', T)
  await note(page).locator('[data-action="restore"]').click()
  await expect(page).toHaveURL(/preset=hyper-43/)
  await expect(page.getByRole('button', { name: /Code 43/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(note(page)).toHaveAttribute('data-verify-deviated', 'false', T)
  await CHECKS.p3(page)
  expect(errors).toEqual([])
})

test('p1: the language switch keeps the scenario and shows the English box', async ({ page }) => {
  const errors = trackErrors(page)
  await openScenario(page, scenario('p1'), 'link')
  await lang(page).click()
  await expect(page).toHaveURL(/scenario=p1/)
  await expect(page).toHaveURL(/lang=en/)
  await expect(note(page)).toHaveAttribute('data-verify-scenario', 'p1')
  await expect(note(page)).toContainText(en.scenario.p1.title)
  await expect(note(page)).toHaveAttribute('data-verify-deviated', 'false')
  expect(errors).toEqual([])
})

test('p1: unpin and pin keep scenario in the address; unpinned counts as deviated', async ({ page }) => {
  const errors = trackErrors(page)
  await openScenario(page, scenario('p1'), 'link')
  await inspector(page).getByRole('button', { name: de.playground.unpin }).click()
  await expect(inspector(page)).toHaveAttribute('data-verify-pinned', 'false')
  await expect(page).toHaveURL(/scenario=p1/)
  expect(page.url()).not.toMatch(/[?&]x=/)
  await expect(note(page)).toHaveAttribute('data-verify-deviated', 'true')
  await inspector(page).getByRole('button', { name: de.playground.pin }).click()
  await expect(inspector(page)).toHaveAttribute('data-verify-pinned', 'true')
  await expect(page).toHaveURL(/scenario=p1/)
  await expect(page).toHaveURL(/[?&]x=/)
  expect(errors).toEqual([])
})

test('k3: a gallery switch keeps the scenario as deviated with a valid kernel; restore is invalid again', async ({
  page,
}) => {
  const errors = trackErrors(page)
  await openScenario(page, scenario('k3'), 'link')
  await expectInvalidPowerExp(page)
  await expect(note(page)).toHaveAttribute('data-verify-deviated', 'false')
  await page.locator('#kernel-preset').selectOption('expquad')
  await expect(page).toHaveURL(/preset=expquad/)
  await expect(page).toHaveURL(/scenario=k3/)
  await expect(kernelView(page)).toHaveAttribute('data-verify-preset', 'expquad')
  await expect(note(page)).toHaveAttribute('data-verify-deviated', 'true')
  // the gallery preset is loaded as is: no power-exponential spec is left over
  await expect(validity(page)).toHaveAttribute('data-verify-state', 'ready', T)
  await expect(validity(page)).toHaveAttribute('data-verify-negatives', '0')
  await note(page).locator('[data-action="restore"]').click()
  await expect(page).toHaveURL(/preset=power-exp/)
  await expectInvalidPowerExp(page)
  await expect(note(page)).toHaveAttribute('data-verify-deviated', 'false')
  expect(errors).toEqual([])
})

test('k3: clicking the active card again resets a moved exponent', async ({ page }) => {
  const errors = trackErrors(page)
  await openScenario(page, scenario('k3'), 'click')
  await expectInvalidPowerExp(page)
  const p = page.getByRole('slider', { name: 'Exponent p' })
  await expect(p).toHaveValue('2.5')
  await p.focus()
  await page.keyboard.press('Home')
  await expect(p).not.toHaveValue('2.5')
  await expect(validity(page)).toHaveAttribute('data-verify-state', 'ready', T)
  await expect(note(page)).toHaveAttribute('data-verify-deviated', 'true')
  await card(page, 'k3').click()
  await expect(p).toHaveValue('2.5', T)
  await expectInvalidPowerExp(page)
  await expect(note(page)).toHaveAttribute('data-verify-deviated', 'false')
  expect(errors).toEqual([])
})

test('k3: after closing the box, "Reset" loads the plain preset (the scenario spec is not applied)', async ({
  page,
}) => {
  const errors = trackErrors(page)
  await openScenario(page, scenario('k3'), 'link')
  await expectInvalidPowerExp(page)
  await note(page).locator('[data-action="close"]').click()
  await expect(page).not.toHaveURL(/scenario=/)
  await page.getByRole('button', { name: de.kernels.reset }).click()
  await expect(page.getByRole('slider', { name: 'Exponent p' })).toHaveValue('2')
  await expect(validity(page)).toHaveAttribute('data-verify-state', 'ready', T)
  await expect(note(page)).toHaveAttribute('data-verify-state', 'empty')
  expect(errors).toEqual([])
})

test('a scenario of another tool is ignored with a notice and removed from the address at once', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/playground?scenario=d1&lang=de')
  await expect(plot(page)).toHaveAttribute('data-verify-state', 'ready', T)
  const bar = page.locator(unit('notice-bar'))
  expect(Number(await bar.getAttribute('data-verify-count'))).toBeGreaterThanOrEqual(1)
  await expect(bar).toContainText(de.notice.unknownScenario)
  await expect(note(page)).toHaveAttribute('data-verify-state', 'empty')
  await expect(page).not.toHaveURL(/scenario=/)
  await expect(page).toHaveURL(/lang=de/)
  expect(errors).toEqual([])
})

test('closing the box removes scenario from the address and focuses the card', async ({ page }) => {
  const errors = trackErrors(page)
  await openScenario(page, scenario('p1'), 'link')
  await note(page).locator('[data-action="close"]').click()
  await expect(note(page)).toHaveAttribute('data-verify-state', 'empty')
  await expect(page).not.toHaveURL(/scenario=/)
  await expect(page).toHaveURL(/preset=kap9/)
  await expect(card(page, 'p1')).toHaveAttribute('aria-pressed', 'false')
  await expect(card(page, 'p1')).toBeFocused()
  expect(errors).toEqual([])
})

for (const id of ['p1', 'k1', 'd1'] as const) {
  for (const l of ['de', 'en'] as const) {
    const s = scenario(id)
    test(`no horizontal overflow at 375 px: ${s.tool} ${l} with an open scenario box`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 800 })
      await page.goto(`/${scenarioHref(s, l)}`)
      await expect(note(page)).toHaveAttribute('data-verify-state', 'ready', T)
      await expect(page.locator(unit('scenario-bar'))).toBeVisible()
      await expect(note(page)).toBeVisible()
      await expect(page.locator(unit(READY[s.tool]))).toHaveAttribute('data-verify-state', /^(ready|loading)$/, T)
      const widths = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }))
      expect(widths.doc).toBeLessThanOrEqual(375)
      expect(widths.body).toBeLessThanOrEqual(375)
    })
  }
}

// ------------------------------------------------------------------ Daten-Lab (one run takes about 20–60 s)

const lab = (page: Page) => page.locator(unit('datalab-view'))
const labRun = (page: Page) => page.locator(unit('datalab-run'))
const labRuns = (page: Page) => page.locator(unit('datalab-runs'))
const labResult = (page: Page) => page.locator(unit('datalab-result'))
const labTemplate = (page: Page) => page.locator('select[data-field="template"]')
const RUN = { timeout: 200_000 }

/** Waits for the run to finish and checks the numbers of the scenario text (Spec §3.4). */
async function expectRunResult(page: Page, rmse: string, negative: boolean) {
  await expect(labRun(page)).toHaveAttribute('data-verify-state', 'ready', RUN)
  await expect(labResult(page)).toHaveAttribute('data-verify-state', 'ready')
  const value = Number(await labResult(page).locator('[data-metric="rmseTest"]').getAttribute('data-value'))
  expect(value.toFixed(3)).toBe(rmse)
  const warning = labResult(page).locator('[data-warning="negativePredictions"]')
  if (negative) await expect(warning).toBeVisible()
  else await expect(warning).toHaveCount(0)
}

/** base64url of a JSON kernel spec, as the Kernel-Baukasten writes it into ?kernel=. */
function kernelParam(spec: unknown): string {
  return Buffer.from(JSON.stringify(spec)).toString('base64url')
}

test('d1 by link: one run with the notebook result; time and the language switch start no other; the card again does', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const errors = trackErrors(page)
  // Every value data-verify-deviated ever takes, from the first render on (the box must never flash "changed").
  await page.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { __deviated: string[] }).__deviated = seen
    const record = (el: Element) => {
      const v = el.getAttribute('data-verify-deviated')
      if (v !== null) seen.push(v)
    }
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'attributes') record(m.target as Element)
        else
          for (const n of Array.from(m.addedNodes)) {
            if (!(n instanceof Element)) continue
            record(n)
            n.querySelectorAll('[data-verify-deviated]').forEach(record)
          }
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-verify-deviated'] })
  })
  await openScenario(page, scenario('d1'), 'link')
  await expect(lab(page)).toHaveAttribute('data-verify-runs', '1', T)
  await expect(labRun(page)).toHaveAttribute('data-verify-state', 'loading')
  await expect(lab(page)).toHaveAttribute('data-verify-step', 'model')
  await expectRunResult(page, '0.392', true)
  await expect(labRuns(page)).toHaveAttribute('data-verify-count', '1')
  await page.waitForTimeout(3000)
  await expect(lab(page)).toHaveAttribute('data-verify-runs', '1')
  await lang(page).click()
  await expect(page).toHaveURL(/lang=en/)
  await expect(page).toHaveURL(/scenario=d1/)
  await page.waitForTimeout(500)
  await expect(lab(page)).toHaveAttribute('data-verify-runs', '1')
  await expect(labRun(page)).toHaveAttribute('data-verify-state', 'ready')

  // The active card again: a second run, the runs table keeps both.
  await card(page, 'd1').click()
  await expect(lab(page)).toHaveAttribute('data-verify-runs', '2', T)
  await expect(labRun(page)).toHaveAttribute('data-verify-state', 'loading')
  await expect(labRun(page)).toHaveAttribute('data-verify-state', 'ready', RUN)
  await expect(labRuns(page)).toHaveAttribute('data-verify-count', '2')
  const seen = await page.evaluate(() => (window as unknown as { __deviated: string[] }).__deviated)
  expect(seen.length).toBeGreaterThan(0)
  expect(seen).not.toContain('true')
  expect(errors).toEqual([])
})

for (const [id, rmse, negative] of [
  ['d2', '0.421', true],
  ['d3', '0.369', false],
] as const) {
  test(`${id} by click: one run with the result of the scenario text`, async ({ page }) => {
    test.setTimeout(240_000)
    const errors = trackErrors(page)
    await openScenario(page, scenario(id), 'click')
    await expect(lab(page)).toHaveAttribute('data-verify-runs', '1', T)
    await expectRunResult(page, rmse, negative)
    await expect(note(page)).toHaveAttribute('data-verify-deviated', 'false')
    expect(errors).toEqual([])
  })
}

test('d1: another template marks the scenario as deviated; restore brings back the notebook template and a run', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const errors = trackErrors(page)
  await openScenario(page, scenario('d1'), 'link')
  await expect(lab(page)).toHaveAttribute('data-verify-runs', '1', T)
  await page.locator('[data-action="cancel-run"]').click()
  await expect(labRun(page)).toHaveAttribute('data-verify-state', 'error')
  await expect(note(page)).toHaveAttribute('data-verify-deviated', 'false')
  await labTemplate(page).selectOption('rbf')
  await expect(note(page)).toHaveAttribute('data-verify-deviated', 'true')
  await note(page).locator('[data-action="restore"]').click()
  await expect(lab(page)).toHaveAttribute('data-verify-runs', '2', T)
  await expect(note(page)).toHaveAttribute('data-verify-deviated', 'false')
  await expect(labTemplate(page)).toHaveValue('notebook')
  await expect(labRun(page)).toHaveAttribute('data-verify-state', 'loading')
  await expect(note(page).locator('.note-title')).toBeFocused()
  expect(errors).toEqual([])
})

test('d1: back in the cached lab without scenario, runs and settings stay; ?kernel= starts no run', async ({ page }) => {
  test.setTimeout(240_000)
  const errors = trackErrors(page)
  await openScenario(page, scenario('d1'), 'link')
  await expect(labRun(page)).toHaveAttribute('data-verify-state', 'ready', RUN)
  await expect(labRuns(page)).toHaveAttribute('data-verify-count', '1')
  await page.locator('nav a[href="#/playground"]').click()
  await expect(plot(page)).toHaveAttribute('data-verify-state', 'ready', T)
  await page.locator('nav a[href="#/datalab"]').click()
  await expect(note(page)).toHaveAttribute('data-verify-state', 'empty', T)
  await expect(labRuns(page)).toHaveAttribute('data-verify-count', '1')
  await expect(lab(page)).toHaveAttribute('data-verify-runs', '1')
  await expect(labTemplate(page)).toHaveValue('notebook')
  await expect(page.locator(unit('datalab-split'))).toHaveAttribute('data-verify-mode', 'notebook')
  await expect(labRun(page)).toHaveAttribute('data-verify-state', 'ready')

  const rbf = kernelParam({ terms: [[{ kind: 'rbf', params: { sigma: 1, ell: 0.5 } }]] })
  await page.goto(`/#/datalab?kernel=${rbf}`)
  await expect(labTemplate(page)).toHaveValue('baukasten')
  await page.waitForTimeout(1000)
  await expect(lab(page)).toHaveAttribute('data-verify-runs', '1')
  await expect(labRun(page)).toHaveAttribute('data-verify-state', 'ready')
  await expect(labRuns(page)).toHaveAttribute('data-verify-count', '1')
  await expect(note(page)).toHaveAttribute('data-verify-state', 'empty')

  // From another tool straight to the scenario: adopted while the cached lab is still deactivated, then one run.
  await page.locator('nav a[href="#/playground"]').click()
  await expect(plot(page)).toHaveAttribute('data-verify-state', 'ready', T)
  await page.goto(`/${scenarioHref(scenario('d1'), 'de')}`)
  await expect(lab(page)).toHaveAttribute('data-verify-runs', '2', T)
  await expect(labRun(page)).toHaveAttribute('data-verify-state', 'loading')
  await expect(lab(page)).toHaveAttribute('data-verify-step', 'model')
  await expect(labTemplate(page)).toHaveValue('notebook')
  await expect(note(page)).toHaveAttribute('data-verify-deviated', 'false')
  expect(errors).toEqual([])
})

test('an unknown Daten-Lab scenario shows a notice, no box and loads nothing', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/datalab?scenario=p1&lang=de')
  await expect(page.locator(unit('scenario-bar'))).toBeVisible(T)
  await expect(page.locator(unit('notice-bar'))).toContainText(de.notice.unknownScenario)
  await expect(note(page)).toHaveAttribute('data-verify-state', 'empty')
  await expect(page).not.toHaveURL(/scenario=/)
  await expect(page.locator(unit('datalab-preview'))).toHaveAttribute('data-verify-state', 'empty')
  await expect(lab(page)).toHaveAttribute('data-verify-runs', '0')
  expect(errors).toEqual([])
})

test('d1 with a failed Yacht load: no deviation and no run, the data step shows the error', async ({ page }) => {
  const errors = trackErrors(page)
  await page.route('**/data/yacht.csv', (r) => r.abort())
  await page.goto(`/${scenarioHref(scenario('d1'), 'de')}`)
  await expect(note(page)).toHaveAttribute('data-verify-state', 'ready', T)
  await expect(note(page)).toHaveAttribute('data-verify-scenario', 'd1')
  const preview = page.locator(unit('datalab-preview'))
  await expect(preview).toHaveAttribute('data-verify-state', 'error', T)
  await expect(preview).toHaveAttribute('data-verify-error', 'datalab.data.fetchFailed')
  await expect(note(page)).toHaveAttribute('data-verify-deviated', 'false')
  await expect(lab(page)).toHaveAttribute('data-verify-runs', '0')
  await expect(lab(page)).toHaveAttribute('data-verify-step', 'data')
  // the browser logs the aborted request itself; nothing else may fail
  expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([])
})

test('d3 closed while the Yacht data load: its settings are not applied and no run starts', async ({ page }) => {
  const errors = trackErrors(page)
  await page.route('**/data/yacht.csv', async (r) => {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await r.continue()
  })
  await page.goto(`/${scenarioHref(scenario('d3'), 'de')}`)
  await expect(note(page)).toHaveAttribute('data-verify-state', 'ready', T)
  await note(page).locator('[data-action="close"]').click()
  await expect(note(page)).toHaveAttribute('data-verify-state', 'empty')
  await expect(page.locator(unit('datalab-preview'))).toHaveAttribute('data-verify-state', 'ready', T)
  await page.waitForTimeout(500)
  // the defaults of a new table (resetSelection), not the notebook split and log target of d3
  await expect(page.locator(unit('datalab-split'))).toHaveAttribute('data-verify-mode', 'random')
  await expect(page.locator('input[data-field="log-target"]')).not.toBeChecked()
  await expect(lab(page)).toHaveAttribute('data-verify-runs', '0')
  expect(errors).toEqual([])
})
