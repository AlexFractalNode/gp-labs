import { expect, test, type Page } from '@playwright/test'
import { scenarioById, scenarioHref, type Scenario } from '../../src/tools/scenarios'
import de from '../../src/i18n/de'
import en from '../../src/i18n/en'

const scenario = (id: string): Scenario => {
  const s = scenarioById(id)
  if (!s) throw new Error(`no scenario ${id}`)
  return s
}

/** Collects console errors and uncaught exceptions of a page. */
function trackErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}

const home = '[data-verify-unit="home"]'
const tools = '[data-verify-unit="home-tools"]'
const roadmap = '[data-verify-unit="home-roadmap"]'
const heading = `${home} h2`
const SCENARIO_IDS: Record<string, string[]> = {
  playground: ['p1', 'p2', 'p3'],
  kernels: ['k1', 'k2', 'k3'],
  datalab: ['d1', 'd2', 'd3'],
}

test('home shows three tool cards linking to the tools and the R1–R7 roadmap', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/?lang=de')
  await expect(page.locator(home)).toHaveAttribute('data-verify-state', 'ready')
  await expect(page.locator(tools)).toHaveAttribute('data-verify-count', '3')
  const cards = page.locator(`${tools} [data-tool]`)
  await expect(cards).toHaveCount(3)
  for (const route of ['playground', 'kernels', 'datalab']) {
    await expect(page.locator(`${tools} [data-tool="${route}"] a[href="#/${route}"]`)).toHaveCount(1)
  }
  await expect(page.locator(roadmap)).toHaveAttribute('data-verify-count', '7')
  const items = page.locator(`${roadmap} li`)
  await expect(items).toHaveCount(7)
  for (let i = 1; i <= 7; i++) await expect(items.nth(i - 1)).toContainText(`R${i}`)
  await expect(page.locator(home)).toContainText('CC BY 4.0')

  await page.locator(`${tools} [data-tool="kernels"] a[href="#/kernels"]`).click()
  await expect(page.locator('[data-verify-unit="app-shell"]')).toHaveAttribute('data-verify-route', 'kernels')
  expect(errors).toEqual([])
})

test('each card has an open link and three scenario links with their titles', async ({ page }) => {
  const errors = trackErrors(page)
  for (const [lang, catalogue] of [['de', de], ['en', en]] as const) {
    await page.goto('about:blank') // a hash-only navigation would keep the language of the loaded page
    await page.goto(`/#/?lang=${lang}`)
    await expect(page.locator(home)).toHaveAttribute('data-verify-state', 'ready')
    for (const [route, ids] of Object.entries(SCENARIO_IDS)) {
      const card = page.locator(`${tools} [data-tool="${route}"]`)
      await expect(card.locator('[data-open-link]')).toHaveCount(1)
      await expect(card.locator('[data-open-link]')).toHaveAttribute('href', `#/${route}`)
      await expect(card.locator('[data-scenario-link]')).toHaveCount(3)
      await expect(card.getByRole('heading', { name: catalogue.home.scenarios })).toHaveCount(1)
      for (const id of ids) {
        const link = card.locator(`[data-scenario-link="${id}"]`)
        await expect(link).toHaveAttribute('href', scenarioHref(scenario(id)))
        await expect(link).toHaveText(catalogue.scenario[id as 'p1'].title)
      }
    }
  }
  expect(errors).toEqual([])
})

test('the k3 scenario link opens the kernel builder with the invalid power-exponential kernel', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/?lang=de')
  await page.locator(`${tools} [data-scenario-link="k3"]`).click()
  const note = page.locator('[data-verify-unit="scenario-note"]')
  await expect(note).toHaveAttribute('data-verify-state', 'ready', { timeout: 10_000 })
  await expect(note).toHaveAttribute('data-verify-scenario', 'k3')
  await expect(page.locator('[data-verify-unit="app-shell"]')).toHaveAttribute('data-verify-route', 'kernels')
  const validity = page.locator('[data-verify-unit="kernel-validity"]')
  await expect(validity).toHaveAttribute('data-verify-state', 'error', { timeout: 10_000 })
  await expect(validity).toHaveAttribute('data-verify-error', 'error.notPsd')
  expect(errors).toEqual([])
})

test('EN toggle changes the heading and survives a reload', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/')
  await page.evaluate(() => localStorage.removeItem('gp-labs-lang'))
  await page.reload()
  const de = (await page.locator(heading).textContent())?.trim()
  expect(de).toContain('Begleitung')
  await page.locator('[data-verify-unit="lang-toggle"]').click()
  await expect(page.locator(heading)).not.toHaveText(de!)
  await expect(page.locator(heading)).toContainText('companion')
  await page.reload()
  await expect(page.locator(heading)).toContainText('companion')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  expect(errors).toEqual([])
})

test('no horizontal scroll at 375 × 812', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  for (const lang of ['de', 'en']) {
    await page.goto('about:blank') // a hash-only navigation would keep the language of the loaded page
    await page.goto(`/#/?lang=${lang}`)
    await expect(page.locator(home)).toHaveAttribute('data-verify-state', 'ready')
    await expect(page.locator('html')).toHaveAttribute('lang', lang)
    await expect(page.locator(`${tools} [data-scenario-link]`)).toHaveCount(9)
    const width = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(width).toBeLessThanOrEqual(375)
  }
})

test('no horizontal scroll on any route at 390 px (DE and EN)', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 390, height: 844 })
  for (const route of ['', 'playground', 'kernels', 'datalab']) {
    for (const lang of ['de', 'en']) {
      await page.goto(`/#/${route}?lang=${lang}`)
      await expect(page.locator('[data-verify-unit="app-shell"]')).toHaveAttribute('data-verify-route', route || 'home')
      await page.waitForLoadState('networkidle')
      const width = await page.evaluate(() => document.documentElement.scrollWidth)
      expect(width, `#/${route} (${lang})`).toBeLessThanOrEqual(390)
    }
  }
})

test('the language toggle writes ?lang= into the address, a shared link keeps it', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/kernels?preset=periodic&lang=de')
  await page.locator('[data-verify-unit="lang-toggle"]').click()
  await expect(page).toHaveURL(/#\/kernels\?.*lang=en/)
  expect(new URL(page.url()).hash).toContain('preset=periodic')
  await expect(page.locator('[data-verify-unit="kernel-view"]')).toHaveAttribute('data-verify-preset', 'periodic')
  expect(errors).toEqual([])
})
