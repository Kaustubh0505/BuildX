const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { _electron: electron } = require('playwright-core')
const { SECTION_KEYS } = require('../electron/project-store.cjs')

const { createDesktopFixture } = require('./cloud-fixture.cjs')

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'buildx-export-ui-'))
  const fixture = await createDesktopFixture()
  const store = fixture.store
  const project = await store.create({ title: 'Export test', problem: 'Check exported sections.' })
  await store.saveBlueprint(project.id, Object.fromEntries(SECTION_KEYS.map((key) => [key, `Saved ${key} content`])))
  await store.saveSection(project.id, 'screens', 'Edited screens content')
  const environment = { ...process.env, ELECTRON_RENDERER_URL: '', BUILDX_API_URL: fixture.url, BUILDX_E2E: '1', BUILDX_E2E_USER_DATA: directory }
  delete environment.ELECTRON_RUN_AS_NODE
  let app

  try {
    app = await electron.launch({ args: ['.'], cwd: path.join(__dirname, '..'), env: environment })
    await app.evaluate(({ dialog }, exportDirectory) => {
      dialog.showSaveDialog = async (_window, options) => ({
        canceled: false,
        filePath: `${exportDirectory}/test-blueprint.${options.filters[0].extensions[0]}`,
      })
    }, directory)
    const page = await app.firstWindow()
    await fixture.authenticate(page)
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.getByRole('button', { name: 'Open Export test' }).click()
    await page.getByRole('tab', { name: 'Blueprint' }).click()
    if (process.env.BUILDX_SCREENSHOT_DIR) {
      await fs.mkdir(process.env.BUILDX_SCREENSHOT_DIR, { recursive: true })
      await page.screenshot({ path: path.join(process.env.BUILDX_SCREENSHOT_DIR, 'buildx-export-toolbar.png') })
    }
    await page.getByRole('button', { name: 'Export Markdown' }).click()
    await page.getByText('Saved test-blueprint.md').waitFor()
    const markdown = await fs.readFile(path.join(directory, 'test-blueprint.md'), 'utf8')
    assert.match(markdown, /Edited screens content/)
    assert.match(markdown, /Saved testPlan content/)

    await page.getByRole('button', { name: 'Export PDF' }).click()
    await page.getByText('Saved test-blueprint.pdf').waitFor()
    const pdf = await fs.readFile(path.join(directory, 'test-blueprint.pdf'))
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')

    await page.locator('#blueprint-screens .tiptap').fill('Not saved')
    assert.equal(await page.getByRole('button', { name: 'Export Markdown' }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: 'Export PDF' }).isDisabled(), true)
    assert.equal((await fs.readFile(path.join(directory, 'test-blueprint.md'), 'utf8')).includes('Not saved'), false)
    if (process.env.BUILDX_SCREENSHOT_DIR) {
      await fs.mkdir(process.env.BUILDX_SCREENSHOT_DIR, { recursive: true })
      await page.screenshot({ path: path.join(process.env.BUILDX_SCREENSHOT_DIR, 'buildx-export-desktop.png') })
    }
    assert.deepEqual(pageErrors, [])
    console.log('Export UI test passed: Markdown/PDF through preload, saved content, unsaved edit guard.')
  } finally {
    if (app) await app.close().catch(() => {})
    await fixture.close()
    await fs.rm(directory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
