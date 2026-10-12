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

const preview = '[data-verify-unit="datalab-preview"]'
const run = '[data-verify-unit="datalab-run"]'
const runs = '[data-verify-unit="datalab-runs"]'
const result = '[data-verify-unit="datalab-result"]'
const step = (id: string) => `[data-step="${id}"] [data-action="open-step"]`
const fixture = fileURLToPath(new URL('./fixtures/semicolon.csv', import.meta.url))

test('yacht notebook run, cancelled second run keeps the first result, German CSV upload', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = trackErrors(page)
  await page.goto('/#/datalab?lang=de')
  await expect(page.locator(preview)).toHaveAttribute('data-verify-state', 'empty')

  // Step 1: Yacht data.
  await page.locator('[data-action="load-yacht"]').click()
  await expect(page.locator(preview)).toHaveAttribute('data-verify-state', 'ready')
  await expect(page.locator(preview)).toHaveAttribute('data-verify-count', '308')

  // Step 3: reproduce the notebook split (defaults of step 2 are target y with a1–a6).
  await page.locator(step('split')).click()
  await page.locator('[data-action="notebook-split"]').click()
  await expect(page.locator('[data-verify-unit="datalab-split"]')).toHaveAttribute('data-verify-mode', 'notebook')
  await expect(page.locator('[data-verify-unit="datalab-split"]')).toHaveAttribute('data-verify-count', '277')

  // Step 4: notebook template, start.
  await page.locator(step('model')).click()
  await page.locator('select[data-field="template"]').selectOption('notebook')
  await expect(page.locator('[data-note="notebook-fixed"]')).toBeVisible()
  await page.locator('[data-action="start-run"]').click()
  await expect(page.locator(run)).toHaveAttribute('data-verify-state', 'loading')
  await expect(page.locator(run)).toHaveAttribute('data-verify-state', 'ready', { timeout: 120_000 })

  const rmseTile = page.locator(`${result} [data-metric="rmseTest"]`)
  const rmse = Number(await rmseTile.getAttribute('data-value'))
  expect(rmse).toBeGreaterThanOrEqual(0.34)
  expect(rmse).toBeLessThanOrEqual(0.44)
  await expect(page.locator(runs)).toHaveAttribute('data-verify-count', '1')
  // σₙ is tiny for the notebook fit: the slice says that s_f ≈ s_y instead of showing two indistinguishable bands.
  await expect(page.locator('[data-note="sf-equals-sy"]')).toBeVisible()
  const firstRunId = await page.locator(result).getAttribute('data-run-id')
  expect(firstRunId).not.toBeNull()

  // A second run cancelled right away: error state, the first result and the table entry stay.
  await page.locator(step('model')).click()
  await page.locator('[data-action="start-run"]').click()
  await page.locator('[data-action="cancel-run"]').click()
  await expect(page.locator(run)).toHaveAttribute('data-verify-state', 'error')
  await expect(page.locator(runs)).toHaveAttribute('data-verify-count', '1')
  await expect(page.locator(result)).toHaveAttribute('data-verify-state', 'ready')
  await expect(page.locator(result)).toHaveAttribute('data-run-id', firstRunId!)
  await expect(rmseTile).toHaveAttribute('data-value', String(rmse))

  // Step 1 again: a German Excel CSV (BOM, ';', decimal comma, quoted header) parses to 30 numeric rows.
  await page.locator(step('data')).click()
  await page.locator('input[type="file"][data-field="csv-file"]').setInputFiles(fixture)
  await expect(page.locator(preview)).toHaveAttribute('data-verify-state', 'ready')
  await expect(page.locator(preview)).toHaveAttribute('data-verify-count', '30')
  await expect(page.locator(`${preview} [data-column-type="numeric"]`)).toHaveCount(3)
  expect(errors).toEqual([])
})

/** base64url of a JSON kernel spec, as the Kernel-Baukasten writes it into ?kernel=. */
function kernelParam(spec: unknown): string {
  return Buffer.from(JSON.stringify(spec)).toString('base64url')
}

test('the cached lab ignores ?kernel= of other tools and restores the template choice', async ({ page }) => {
  const errors = trackErrors(page)
  const rbf = kernelParam({ terms: [[{ kind: 'rbf', params: { sigma: 1, ell: 0.5 } }]] })
  const template = page.locator('select[data-field="template"]')
  await page.goto('/#/datalab?lang=de')
  await page.locator('[data-action="load-yacht"]').click()
  await expect(page.locator(preview)).toHaveAttribute('data-verify-state', 'ready')
  await page.locator(step('model')).click()
  await template.selectOption('ard-rbf')

  // Another tool's kernel URL must not touch the lab.
  await page.goto(`/#/playground?kernel=${rbf}`)
  await expect(page.locator('[data-verify-unit="playground-plot"]')).toHaveAttribute('data-verify-state', 'ready')
  await page.locator('nav a[href="#/datalab"]').click()
  await expect(template).toHaveValue('ard-rbf')

  // A kernel for the lab itself selects the Baukasten template; without it, the earlier choice comes back.
  await page.goto(`/#/datalab?kernel=${rbf}`)
  await expect(template).toHaveValue('baukasten')
  await page.locator('nav a[href="#/datalab"]').click()
  await expect(template).toHaveValue('ard-rbf')
  expect(errors).toEqual([])
})
