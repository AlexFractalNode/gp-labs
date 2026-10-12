import { fileURLToPath } from 'node:url'
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

const samples = '[data-verify-unit="kernel-samples"]'
const validity = '[data-verify-unit="kernel-validity"]'
const heatmap = '[data-verify-unit="kernel-heatmap"]'
const builder = '[data-verify-unit="kernel-builder"]'
const noticeBar = '[data-verify-unit="notice-bar"]'
const sddDir = fileURLToPath(new URL('../../.superpowers/sdd/2026-10-12-gp-labs/', import.meta.url))

test('power-exp: valid for p = 2, error (not PSD) for p = 3, valid again for p = 1.5', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/kernels?preset=power-exp&lang=de')
  await expect(page.locator(samples)).toHaveAttribute('data-verify-state', 'ready')
  await expect(page.locator(validity)).toHaveAttribute('data-verify-state', 'ready')
  await expect(page.locator(heatmap)).toHaveAttribute('data-verify-state', 'ready')
  await expect(page.locator(builder)).toHaveAttribute('data-verify-count', '1')
  await expect(page.locator(`${samples} path[data-layer="line"]`)).toHaveCount(5)

  const p = page.getByRole('slider', { name: 'Exponent p' })
  await p.fill('3')
  await expect(page.locator(samples)).toHaveAttribute('data-verify-state', 'error')
  await expect(page.locator(samples)).toHaveAttribute('data-verify-error', 'error.notPsd')
  await expect(page.locator(validity)).toHaveAttribute('data-verify-state', 'error')
  await expect(page.locator(validity)).toHaveAttribute('data-verify-error', 'error.notPsd')
  await expect(page.locator(`${samples} path[data-layer="line"]`)).toHaveCount(0)
  await expect(page.locator(`${validity} rect[data-eigen="negative"]`).first()).toBeVisible()

  await p.fill('1.5')
  await expect(page.locator(samples)).toHaveAttribute('data-verify-state', 'ready')
  await expect(page.locator(validity)).toHaveAttribute('data-verify-state', 'ready')
  expect(errors).toEqual([])
})

test('a valid RBF shows no red eigenvalue bars (rounding-level eigenvalues are grey)', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/kernels?preset=expquad')
  await expect(page.locator(validity)).toHaveAttribute('data-verify-state', 'ready')
  await expect(page.locator(validity)).toHaveAttribute('data-verify-count', '30')
  await expect(page.locator(`${validity} rect[data-eigen="negative"]`)).toHaveCount(0)
  await expect(page.locator(`${validity} rect[data-eigen="zero"]`).first()).toBeAttached()
  expect(errors).toEqual([])
})

test('"Im Playground verwenden" on periodic opens the playground with the kernel', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/kernels?preset=periodic&lang=de')
  await expect(page.locator(samples)).toHaveAttribute('data-verify-state', 'ready')
  await page.getByRole('button', { name: 'Im Playground verwenden' }).click()
  await expect(page).toHaveURL(/#\/playground\?kernel=/)
  await expect(page.locator('[data-verify-unit="playground-plot"]')).toHaveAttribute('data-verify-state', 'ready')
  await expect(page.locator(noticeBar)).toHaveAttribute('data-verify-state', 'empty')
  expect(errors).toEqual([])
})

test('builder: add and remove factors and terms, limits disable the buttons', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/kernels?preset=expquad&lang=de')
  await expect(page.locator(builder)).toHaveAttribute('data-verify-count', '1')
  const addFactor = page.getByRole('button', { name: 'Faktor hinzufügen, Term 1' })
  for (let i = 0; i < 3; i++) await addFactor.click()
  await expect(page.locator(builder)).toHaveAttribute('data-verify-count', '4')
  await expect(addFactor).toBeDisabled()
  const addTerm = page.getByRole('button', { name: 'Term hinzufügen' })
  for (let i = 0; i < 5; i++) await addTerm.click()
  await expect(page.locator(builder)).toHaveAttribute('data-verify-count', '9')
  await expect(addTerm).toBeDisabled()
  await page.getByRole('button', { name: 'Term 6 entfernen' }).click()
  await expect(page.locator(builder)).toHaveAttribute('data-verify-count', '8')
  await expect(addTerm).toBeEnabled()
  await page.getByRole('button', { name: 'Faktor 1.2 entfernen' }).click()
  await expect(page.locator(builder)).toHaveAttribute('data-verify-count', '7')
  await expect(page.locator(samples)).toHaveAttribute('data-verify-state', 'ready')
  await expect(page.locator(validity)).toHaveAttribute('data-verify-state', 'ready')
  expect(errors).toEqual([])
})

test('ard-2d: 2D sample heatmap is drawn, playground button is disabled', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/kernels?preset=ard-2d&lang=de')
  await expect(page.locator(samples)).toHaveAttribute('data-verify-state', 'ready', { timeout: 20_000 })
  await expect(page.locator(samples)).toHaveAttribute('data-verify-mode', '2d')
  await expect(page.locator(`${samples} [data-verify-unit="heatmap"]`)).toHaveAttribute('data-verify-count', '1600')
  await expect(page.locator(validity)).toHaveAttribute('data-verify-state', 'ready')
  await expect(page.getByRole('button', { name: 'Im Playground verwenden' })).toBeDisabled()
  expect(errors).toEqual([])
})

test('unknown preset falls back to expquad with a notice', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/kernels?preset=bogus')
  await expect(page.locator(noticeBar)).toHaveAttribute('data-verify-state', 'ready')
  await expect(page.locator(samples)).toHaveAttribute('data-verify-state', 'ready')
  await expect(page.locator('[data-verify-unit="kernel-view"]')).toHaveAttribute('data-verify-preset', 'expquad')
  expect(errors).toEqual([])
})

test('builder: switching a factor to ARD enters the 2D mode and back without errors', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/kernels?preset=expquad&lang=de')
  await expect(page.locator(samples)).toHaveAttribute('data-verify-state', 'ready')
  const dims = page.locator(`${builder} .chip`).first().locator('select').nth(1)
  await dims.selectOption('ard')
  await expect(page.locator(samples)).toHaveAttribute('data-verify-mode', '2d')
  await expect(page.locator(samples)).toHaveAttribute('data-verify-state', 'ready', { timeout: 20_000 })
  await expect(page.getByRole('slider', { name: 'Längenskala ℓ₂' })).toBeAttached()
  await dims.selectOption('x1')
  await expect(page.locator(samples)).toHaveAttribute('data-verify-state', 'ready', { timeout: 20_000 })
  await dims.selectOption('all')
  await expect(page.locator(samples)).toHaveAttribute('data-verify-mode', '1d')
  await expect(page.locator(samples)).toHaveAttribute('data-verify-state', 'ready')
  expect(errors).toEqual([])
})

test('builder: log warp on a domain with x ≤ 0 shows an explained error, not a blank page', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/kernels?preset=expquad&lang=de')
  const warp = page.locator(`${builder} .chip`).first().locator('select').nth(2)
  await warp.selectOption('log')
  await expect(page.locator(samples)).toHaveAttribute('data-verify-state', 'error')
  await expect(page.locator(samples)).toHaveAttribute('data-verify-error', 'error.logDomain')
  await warp.selectOption('circle')
  await expect(page.locator(samples)).toHaveAttribute('data-verify-state', 'ready')
  expect(errors).toEqual([])
})

test('every gallery preset renders without console errors', async ({ page }) => {
  test.setTimeout(180_000)
  const errors = trackErrors(page)
  const names = await (async () => {
    await page.goto('/#/kernels')
    return page.locator('#kernel-preset option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))
  })()
  expect(names).toHaveLength(21)
  for (const name of names) {
    await page.goto(`/#/kernels?preset=${name}`)
    await expect(page.locator('[data-verify-unit="kernel-view"]')).toHaveAttribute('data-verify-preset', name)
    await expect(page.locator(samples), name).toHaveAttribute('data-verify-state', 'ready', { timeout: 20_000 })
    await expect(page.locator(validity), name).toHaveAttribute('data-verify-state', 'ready')
    await expect(page.locator(`${validity} rect[data-eigen="negative"]`), name).toHaveCount(0)
  }
  expect(errors).toEqual([])
})

test('u stays fixed: moving p away and back restores the same curves; only "Neu ziehen" redraws', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/kernels?preset=power-exp&lang=de')
  await expect(page.locator(samples)).toHaveAttribute('data-verify-state', 'ready')
  const first = page.locator(`${samples} path[data-layer="line"]`).first()
  const d0 = await first.getAttribute('d')
  const p = page.getByRole('slider', { name: 'Exponent p' })
  await p.fill('1.5')
  await expect(first).not.toHaveAttribute('d', d0!)
  await p.fill('2')
  await expect(first).toHaveAttribute('d', d0!)
  await page.getByRole('button', { name: 'Neu ziehen' }).click()
  await expect(page.locator(samples).getByText('Seed 2')).toBeVisible()
  await expect(first).not.toHaveAttribute('d', d0!)
  expect(errors).toEqual([])
})

test('ard-2d starts with seed 2', async ({ page }) => {
  await page.goto('/#/kernels?preset=ard-2d&lang=de')
  await expect(page.locator(samples).getByText('Seed 2')).toBeVisible()
})

test('"Im Daten-Lab verwenden" on ard-2d opens the lab with the Baukasten template and its notices', async ({ page }) => {
  const errors = trackErrors(page)
  await page.setViewportSize({ width: 1400, height: 1000 })
  await page.goto('/#/kernels?preset=ard-2d&lang=de')
  await expect(page.locator(validity)).toHaveAttribute('data-verify-state', 'ready')
  const toLab = page.getByRole('button', { name: 'Im Daten-Lab verwenden' })
  await expect(toLab).toBeEnabled()
  // 2D kernels cannot go to the 1D Playground, but the Daten-Lab takes them (ARD is made isotropic there).
  await expect(page.getByRole('button', { name: 'Im Playground verwenden' })).toBeDisabled()
  await expect(page.locator(samples)).toHaveAttribute('data-verify-state', 'ready', { timeout: 20_000 })
  await page.locator('section.handover').screenshot({ path: `${sddDir}final-kernels-transfer.png` })
  await toLab.click()
  await expect(page).toHaveURL(/#\/datalab\?kernel=/)

  await page.locator('[data-action="load-yacht"]').click()
  await expect(page.locator('[data-verify-unit="datalab-preview"]')).toHaveAttribute('data-verify-state', 'ready')
  await page.locator('[data-step="model"] [data-action="open-step"]').click()
  await expect(page.locator('select[data-field="template"]')).toHaveValue('baukasten')
  await expect(page.locator('[data-notice="ardDropped"]')).toBeVisible()
  await expect(page.locator('[data-action="start-run"]')).toBeEnabled()
  await page.locator('[data-step="model"]').screenshot({ path: `${sddDir}final-datalab-model.png` })
  expect(errors).toEqual([])
})

test('transfer buttons are disabled while the debounced validity check is pending', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/#/kernels?preset=power-exp&lang=de')
  await expect(page.locator(validity)).toHaveAttribute('data-verify-state', 'ready')
  const toPlayground = page.getByRole('button', { name: 'Im Playground verwenden' })
  const toLab = page.getByRole('button', { name: 'Im Daten-Lab verwenden' })
  await expect(toPlayground).toBeEnabled()
  await expect(toLab).toBeEnabled()
  // Change p and look at the buttons within one frame, i.e. well inside the 150 ms debounce.
  const pending = await page.getByRole('slider', { name: 'Exponent p' }).evaluate(async (el) => {
    const input = el as HTMLInputElement
    input.value = '1.5'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    const btns = [...document.querySelectorAll<HTMLButtonElement>('section.handover button')]
    const reasons = [...document.querySelectorAll('section.handover [data-blocked-reason]')]
    return { disabled: btns.map((b) => b.disabled), reasons: reasons.map((p) => p.getAttribute('data-blocked-reason')) }
  })
  expect(pending).toEqual({ disabled: [true, true], reasons: ['kernels.transfer.pending'] })
  await expect(page.locator('section.handover [data-blocked-reason]')).toHaveCount(0)
  await expect(toPlayground).toBeEnabled()
  await expect(toLab).toBeEnabled()
  expect(errors).toEqual([])
})
