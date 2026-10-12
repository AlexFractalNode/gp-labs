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

test('unpin then hyper quick switch does not bring back ?x= (live URL params)', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/playground?preset=hyper&lang=de&x=0.5')
  const insp = page.locator(inspector)
  await expect(insp).toHaveAttribute('data-verify-pinned', 'true')
  await insp.getByRole('button', { name: 'Lösen' }).click()
  await expect(insp).toHaveAttribute('data-verify-pinned', 'false')
  expect(page.url()).not.toContain('x=')
  await page.getByRole('button', { name: /Code 45/ }).click()
  await expect(page).toHaveURL(/preset=hyper-45/)
  expect(page.url()).not.toContain('x=')
  await expect(insp).toHaveAttribute('data-verify-pinned', 'false')
  expect(errors).toEqual([])
})

test('reloading the preset during optimisation never applies the stale optimum', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/playground?preset=kap9&lang=de')
  await expect(page.locator(plot)).toHaveAttribute('data-verify-state', 'ready')
  const optimizer = page.locator('[data-verify-unit="playground-optimizer"]')
  await page.locator('button[data-action="optimize"]').click()
  await expect(optimizer).toHaveAttribute('data-verify-state', 'loading')
  // The result has arrived: the 400 ms slider tween is now running. Reload the preset in the middle of it.
  await expect(optimizer).toHaveAttribute('data-verify-state', 'ready', { timeout: 20_000 })
  await page.locator('button[data-action="reset"]').click()
  // Longer than the tween: the preset values must survive.
  await page.waitForTimeout(1500)
  const values = await page.locator('[data-verify-unit="playground-model"] [role="slider"]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('aria-valuenow')),
  )
  expect(values).toEqual(['1', '1', '0.5'])
  await expect(page.locator('[data-verify-unit="playground-optimizer"]')).toHaveAttribute('data-verify-state', 'ready')
  expect(errors).toEqual([])
})

test('GLS mean with too few points: prior shown, optimise disabled with a reason', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/playground?preset=kap9&lang=de')
  await page.getByLabel('GLS linear').check()
  await expect(page.locator(plot)).toHaveAttribute('data-verify-mode', 'prior')
  await expect(page.locator(plot)).toHaveAttribute('data-verify-state', 'ready')
  const btn = page.locator('button[data-action="optimize"]')
  await expect(btn).toBeDisabled()
  await expect(btn).toHaveAttribute('aria-describedby', 'optimize-blocked')
  await expect(page.locator('#optimize-blocked')).toBeVisible()
  // Plug-in note under the GLS options: the band does not contain the uncertainty of the estimated η̂.
  await expect(page.locator('[data-note="gls-plug-in"]')).toBeVisible()
  expect(errors).toEqual([])
})
