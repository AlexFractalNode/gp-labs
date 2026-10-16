import { expect, test, type Page } from '@playwright/test'
import type { ToolId } from '../../src/tools/scenarios'
import { TOOL_REFS } from '../../src/tools/toolRefs'

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
const helpBtn = (page: Page) => page.locator('[data-action="help"]')
const drawer = (page: Page) => page.locator(unit('help'))
const heading = (page: Page) => page.locator('#help-title')
const note = (page: Page) => page.locator(unit('scenario-note'))
const closeBtn = (page: Page) => drawer(page).locator('[data-action="help-close"]')
const inert = (page: Page, selector: string) => page.locator(selector).evaluate((el) => el.hasAttribute('inert'))
const sigmaN = (page: Page) => page.getByRole('slider', { name: 'Rauschen σₙ' })

/** One unit per tool that is rendered once the view is up. */
const READY: Record<ToolId, string> = {
  playground: 'playground-plot',
  kernels: 'kernel-samples',
  datalab: 'datalab-view',
}
const TOOLS: ToolId[] = ['playground', 'kernels', 'datalab']

async function openTool(page: Page, tool: ToolId, lang = 'de') {
  await page.goto(`/#/${tool}?lang=${lang}`)
  await expect(page.locator(unit(READY[tool]))).toHaveAttribute('data-verify-state', /^(ready|loading)$/, T)
}

async function openHelp(page: Page, tool: ToolId, lang = 'de') {
  await openTool(page, tool, lang)
  await helpBtn(page).click()
  await expect(drawer(page)).toHaveAttribute('data-verify-state', 'ready', T)
}

test('there is no help button on the home page', async ({ page }) => {
  await page.goto('/#/?lang=de')
  await expect(page.locator(unit('home'))).toHaveAttribute('data-verify-state', 'ready', T)
  await expect(helpBtn(page)).toHaveCount(0)
  await expect(drawer(page)).toHaveAttribute('data-verify-state', 'empty')
  await expect(drawer(page)).toBeHidden()
})

for (const tool of TOOLS) {
  test(`help opens on ${tool}: ready, tool contract, focus on the heading`, async ({ page }) => {
    const errors = trackErrors(page)
    await openTool(page, tool)
    const btn = helpBtn(page)
    await expect(btn).toHaveText('? Hilfe')
    await expect(btn).toHaveAttribute('aria-expanded', 'false')
    await expect(btn).toHaveAttribute('aria-controls', 'help-drawer')
    await expect(drawer(page)).toHaveAttribute('data-verify-state', 'empty')
    await expect(drawer(page)).toBeHidden()
    await btn.click()
    await expect(drawer(page)).toHaveAttribute('data-verify-state', 'ready', T)
    await expect(drawer(page)).toHaveAttribute('data-verify-tool', tool)
    await expect(drawer(page)).toHaveAttribute('id', 'help-drawer')
    await expect(btn).toHaveAttribute('aria-expanded', 'true')
    await expect(heading(page)).toBeFocused()
    await expect(page.getByRole('complementary', { name: /Hilfe/ })).toBeVisible()
    // the help button sits left of the language button
    const hb = (await btn.boundingBox())!
    const lb = (await page.locator(unit('lang-toggle')).boundingBox())!
    expect(hb.x + hb.width).toBeLessThanOrEqual(lb.x)
    // sections: purpose, reading lines, controls, course reference, scenarios
    await expect(drawer(page).locator('[data-help="purpose"]')).toHaveCount(1)
    expect(await drawer(page).locator('[data-help="read"] li').count()).toBeGreaterThanOrEqual(6)
    expect(await drawer(page).locator('[data-help="controls"] li').count()).toBeGreaterThanOrEqual(6)
    const course = drawer(page).locator('[data-help="course"]')
    await expect(course).toContainText('Lehrbuch Kap.')
    await expect(course).toContainText(TOOL_REFS[tool].chapter)
    await expect(course).toContainText(TOOL_REFS[tool].code)
    await expect(drawer(page).locator('a[data-help-scenario]')).toHaveCount(3)
    // no message key leaks through (a missing text would show its dotted key)
    expect(await drawer(page).innerText()).not.toMatch(/\bhelp\.|\{\w+\}/)
    expect(errors).toEqual([])
  })
}

test('the help texts follow the language', async ({ page }) => {
  await openHelp(page, 'kernels', 'en')
  await expect(helpBtn(page)).toHaveText('? Help')
  await expect(heading(page)).toContainText('Help')
  await expect(drawer(page).locator('[data-help="course"]')).toContainText('Textbook ch.')
  await page.locator(unit('lang-toggle')).click()
  await expect(drawer(page).locator('[data-help="course"]')).toContainText('Lehrbuch Kap.')
  await expect(helpBtn(page)).toHaveText('? Hilfe')
})

test('Escape with focus in the drawer closes it and returns focus to the button', async ({ page }) => {
  await openHelp(page, 'playground')
  await page.keyboard.press('Escape')
  await expect(drawer(page)).toHaveAttribute('data-verify-state', 'empty')
  await expect(drawer(page)).toBeHidden()
  await expect(helpBtn(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(helpBtn(page)).toBeFocused()
})

test('Escape with focus in a slider does not close the drawer', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openHelp(page, 'playground')
  const slider = sigmaN(page)
  await slider.focus()
  await expect(slider).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(drawer(page)).toHaveAttribute('data-verify-state', 'ready')
  await expect(slider).toBeFocused()
})

test('the close button closes it and returns focus to the button', async ({ page }) => {
  await openHelp(page, 'datalab')
  await closeBtn(page).click()
  await expect(drawer(page)).toHaveAttribute('data-verify-state', 'empty')
  await expect(helpBtn(page)).toBeFocused()
})

test('the help button toggles the drawer', async ({ page }) => {
  await openHelp(page, 'kernels')
  await helpBtn(page).click()
  await expect(drawer(page)).toHaveAttribute('data-verify-state', 'empty')
  await expect(helpBtn(page)).toHaveAttribute('aria-expanded', 'false')
})

test('switching the tool with the drawer open shows the help of the new tool', async ({ page }) => {
  await openHelp(page, 'playground')
  await page.locator('nav a[href^="#/kernels"]').click()
  await expect(page.locator(unit('kernel-samples'))).toHaveAttribute('data-verify-state', /^(ready|loading)$/, T)
  await expect(drawer(page)).toHaveAttribute('data-verify-tool', 'kernels')
  await expect(drawer(page)).toHaveAttribute('data-verify-state', 'ready')
  await page.locator('nav a[href^="#/datalab"]').click()
  await expect(drawer(page)).toHaveAttribute('data-verify-tool', 'datalab')
  await expect(drawer(page)).toHaveAttribute('data-verify-state', 'ready')
  // back to the start: the drawer closes and the button disappears
  await page.locator('nav a[href="#/"]').click()
  await expect(page.locator(unit('home'))).toHaveAttribute('data-verify-state', 'ready', T)
  await expect(drawer(page)).toHaveAttribute('data-verify-state', 'empty')
  await expect(helpBtn(page)).toHaveCount(0)
  // a later visit to a tool starts closed
  await page.locator('nav a[href^="#/playground"]').click()
  await expect(helpBtn(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(drawer(page)).toHaveAttribute('data-verify-state', 'empty')
})

test('desktop 1280 px: the drawer starts below the header and the content makes room', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openHelp(page, 'playground')
  const box = (await drawer(page).boundingBox())!
  const head = (await page.locator('header.app-head').boundingBox())!
  expect(box.width).toBe(360)
  expect(box.x + box.width).toBe(1280)
  expect(Math.abs(box.y - (head.y + head.height))).toBeLessThanOrEqual(1)
  expect(await page.locator('main').evaluate((el) => getComputedStyle(el).paddingRight)).toBe('376px') // 360 px drawer + the usual 1rem gutter
  // the σₙ slider sits in the right column of the playground: it ends left of the drawer and works by keyboard
  const slider = sigmaN(page)
  await slider.scrollIntoViewIfNeeded()
  const s = (await slider.boundingBox())!
  const after = (await drawer(page).boundingBox())!
  expect(s.x + s.width).toBeLessThanOrEqual(after.x)
  await expect(slider).toBeVisible()
  const before = await slider.getAttribute('aria-valuenow')
  await slider.focus()
  await page.keyboard.press('ArrowRight')
  await expect(slider).not.toHaveAttribute('aria-valuenow', before!)
  await expect(drawer(page)).toHaveAttribute('data-verify-state', 'ready')
  // scrolled down, the drawer moves up with the header's bottom edge
  expect(after.y).toBeLessThanOrEqual(box.y)
  expect(after.y).toBeGreaterThanOrEqual(0)
  // not modal: the page is not inert
  expect(await inert(page, 'main')).toBe(false)
  expect(await inert(page, 'header.app-head')).toBe(false)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280)
})

test('desktop 1280 px: a global notice makes room too and its dismiss button stays clickable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  // an unknown route raises the global notice; it stays when the user moves on to a tool
  await page.goto('/#/gibt-es-nicht?lang=de')
  const bar = page.locator(unit('notice-bar'))
  await expect(bar).toHaveAttribute('data-verify-count', '1', T)
  await page.locator('nav a[href^="#/kernels"]').click()
  await expect(page.locator(unit('kernel-samples'))).toHaveAttribute('data-verify-state', /^(ready|loading)$/, T)
  await helpBtn(page).click()
  await expect(drawer(page)).toHaveAttribute('data-verify-state', 'ready', T)
  await expect(bar).toHaveAttribute('data-verify-count', '1')
  expect(await bar.evaluate((el) => getComputedStyle(el).paddingRight)).toBe('376px')
  const dismiss = bar.locator('.dismiss')
  const d = (await dismiss.boundingBox())!
  const dr = (await drawer(page).boundingBox())!
  expect(d.x + d.width).toBeLessThanOrEqual(dr.x)
  await dismiss.click()
  await expect(bar).toHaveAttribute('data-verify-count', '0')
})

test('desktop: a scenario link applies the scenario and keeps the drawer open', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openHelp(page, 'playground')
  const link = drawer(page).locator('a[data-help-scenario="p1"]')
  await expect(link).toHaveAttribute('href', /#\/playground\?.*scenario=p1/)
  await link.click()
  await expect(note(page)).toHaveAttribute('data-verify-state', 'ready', T)
  await expect(note(page)).toHaveAttribute('data-verify-scenario', 'p1')
  await expect(page).toHaveURL(/scenario=p1/)
  await expect(drawer(page)).toHaveAttribute('data-verify-state', 'ready')
  await expect(link).toBeVisible()
})

test('375 px: header keeps title, help and language on one row', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  for (const lang of ['de', 'en']) {
    await openTool(page, 'datalab', lang)
    const title = (await page.locator('header.app-head h1').boundingBox())!
    const help = (await helpBtn(page).boundingBox())!
    const lb = (await page.locator(unit('lang-toggle')).boundingBox())!
    const nav = (await page.locator('header.app-head nav').boundingBox())!
    // same row: the vertical centres lie within the title's height
    for (const b of [help, lb]) {
      const c = b.y + b.height / 2
      expect(c).toBeGreaterThan(title.y)
      expect(c).toBeLessThan(title.y + title.height)
    }
    expect(help.x + help.width).toBeLessThanOrEqual(lb.x)
    expect(lb.x + lb.width).toBeLessThanOrEqual(375)
    expect(nav.y).toBeGreaterThanOrEqual(Math.max(help.y + help.height, title.y + title.height) - 1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  }
})

test('375 px: full-screen drawer, inert page, scenario link closes it', async ({ page }) => {
  const errors = trackErrors(page)
  await page.setViewportSize({ width: 375, height: 812 })
  for (const tool of TOOLS) {
    for (const lang of ['de', 'en']) {
      await openHelp(page, tool, lang)
      const box = (await drawer(page).boundingBox())!
      expect(box.x).toBe(0)
      expect(box.width).toBe(375)
      expect(box.height).toBeGreaterThanOrEqual(812 - 1)
      await expect(closeBtn(page)).toBeVisible()
      await expect(heading(page)).toBeFocused()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
      expect(await drawer(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
      expect(await inert(page, 'main')).toBe(true)
      expect(await inert(page, 'header.app-head')).toBe(true)
      expect(await inert(page, unit('notice-bar'))).toBe(true)
      expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden')
      await closeBtn(page).click()
      await expect(drawer(page)).toHaveAttribute('data-verify-state', 'empty')
      expect(await inert(page, 'main')).toBe(false)
      expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden')
      await expect(helpBtn(page)).toBeFocused()
    }
  }
  await openHelp(page, 'kernels')
  await drawer(page).locator('a[data-help-scenario="k1"]').click()
  await expect(drawer(page)).toHaveAttribute('data-verify-state', 'empty')
  await expect(note(page)).toHaveAttribute('data-verify-state', 'ready', T)
  await expect(note(page)).toHaveAttribute('data-verify-scenario', 'k1')
  await expect(helpBtn(page)).toBeFocused()
  expect(await inert(page, 'main')).toBe(false)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  expect(errors).toEqual([])
})
