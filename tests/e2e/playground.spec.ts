import { expect, test, type Page } from '@playwright/test'

/** Collects console errors and uncaught exceptions of a page. */
function trackErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}

const plot = '[data-verify-unit="playground-plot"]'
const inspector = '[data-verify-unit="playground-inspector"]'
const noticeBar = '[data-verify-unit="notice-bar"]'

test('kap9 preset: inspector shows the Kap. 9 one-point values (DE format)', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/playground?preset=kap9&lang=de&x=0')
  await expect(page.locator(plot)).toHaveAttribute('data-verify-state', 'ready')
  const insp = page.locator(inspector)
  await expect(insp).toHaveAttribute('data-verify-state', 'ready')
  await expect(insp).toContainText('0,800')
  await expect(insp).toContainText('0,447')
  await expect(insp).toContainText('0,671')
  expect(errors).toEqual([])
})

test('unknown preset falls back to sine with a notice', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/playground?preset=bogus')
  await expect(page.locator(noticeBar)).toHaveAttribute('data-verify-state', 'ready')
  await expect(page.locator(noticeBar)).toBeVisible()
  await expect(page.locator(plot)).toHaveAttribute('data-verify-state', 'ready')
  await expect(page.locator(plot)).toHaveAttribute('data-verify-count', '500')
  expect(errors).toEqual([])
})

test('corrupt kernel parameter falls back to RBF with a notice', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/playground?kernel=garbage')
  await expect(page.locator(noticeBar)).toHaveAttribute('data-verify-state', 'ready')
  await expect(page.locator(noticeBar)).toBeVisible()
  await expect(page.locator(plot)).toHaveAttribute('data-verify-state', 'ready')
  expect(errors).toEqual([])
})

test('deleting all points shows the prior; samples make the plot ready again', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/playground?preset=kap9&lang=de&x=0')
  await expect(page.locator(plot)).toHaveAttribute('data-verify-state', 'ready')
  await page.locator('[data-verify-unit="playground-points"] button[data-action="clear"]').click()
  await expect(page.locator(plot)).toHaveAttribute('data-verify-state', 'empty')
  await expect(page.locator(plot)).toHaveAttribute('data-verify-count', '0')
  // Prior moments of the kap9 kernel at x = 0: mean 0, s_f = 1.
  await expect(page.locator(inspector)).toContainText('1,000')
  await page.locator('input[data-layer-toggle="samples"]').check()
  await expect(page.locator(plot)).toHaveAttribute('data-verify-state', 'ready')
  expect(errors).toEqual([])
})

test('clicking the plot adds a point', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/playground?preset=extrapolation')
  await expect(page.locator(plot)).toHaveAttribute('data-verify-count', '4')
  const capture = page.locator(`${plot} rect.capture`)
  await capture.click({ position: { x: 500, y: 120 } })
  await expect(page.locator(plot)).toHaveAttribute('data-verify-count', '5')
  expect(errors).toEqual([])
})
