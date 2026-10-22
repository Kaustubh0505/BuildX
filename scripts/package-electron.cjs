const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { _electron: electron } = require('playwright-core')
const { SECTION_KEYS } = require('../electron/project-store.cjs')

const { createDesktopFixture } = require('./cloud-fixture.cjs')

const root = path.join(__dirname, '..')
const bundle = path.join(root, 'release', 'mac-arm64', 'BuildX.app')
const executable = path.join(bundle, 'Contents', 'MacOS', 'BuildX')

async function main() {
  await fs.access(executable)
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'buildx-package-test-'))
  const fixture = await createDesktopFixture()
  const environment = {
    ...process.env,
    ELECTRON_RENDERER_URL: '',
    BUILDX_API_URL: fixture.url,
    BUILDX_E2E: '1',
    BUILDX_E2E_USER_DATA: dataDirectory,
  }
  delete environment.ELECTRON_RUN_AS_NODE
  let packagedApp

  try {
    packagedApp = await electron.launch({ executablePath: executable, args: [], env: environment })
    const page = await packagedApp.firstWindow()
    await fixture.authenticate(page)
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.getByRole('heading', { name: 'Start with a clear plan.' }).waitFor()
    const details = await packagedApp.evaluate(({ app }) => ({ isPackaged: app.isPackaged, userData: app.getPath('userData'), appPath: app.getAppPath() }))
    assert.equal(details.isPackaged, true)
    assert.equal(details.userData, dataDirectory)
    assert.match(details.appPath, /app\.asar$/)
    assert.match(page.url(), /^file:\/\//)

    const created = await page.evaluate(() => window.buildx.projects.create({ title: 'Packaged project', problem: 'Check packaged storage.' }))
    assert.equal(created.ok, true)
    const store = fixture.store
    await store.saveBlueprint(created.project.id, Object.fromEntries(SECTION_KEYS.map((key) => [key, `Packaged ${key}`])))
    const loaded = await page.evaluate((id) => window.buildx.projects.get(id), created.project.id)
    assert.equal(loaded.ok, true)
    assert.equal(loaded.project.blueprint.sections.screens, 'Packaged screens')

    await packagedApp.evaluate(({ dialog }, exportDirectory) => {
      dialog.showSaveDialog = async (_window, options) => ({ canceled: false, filePath: `${exportDirectory}/packaged.${options.filters[0].extensions[0]}` })
    }, dataDirectory)
    const exported = await page.evaluate((id) => window.buildx.exports.pdf(id), created.project.id)
    assert.equal(exported.ok, true)
    const pdf = await fs.readFile(path.join(dataDirectory, 'packaged.pdf'))
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')

    const boundary = await page.evaluate(() => ({
      require: typeof window.require,
      process: typeof window.process,
      ipcRenderer: typeof window.ipcRenderer,
      api: Object.keys(window.buildx).sort(),
    }))
    assert.deepEqual(boundary, { require: 'undefined', process: 'undefined', ipcRenderer: 'undefined', api: ['auth', 'exports', 'generation', 'projects'] })
    assert.deepEqual(pageErrors, [])
    console.log('Packaged .app test passed: launch, isolated storage, PDF export, preload boundary.')
  } finally {
    if (packagedApp) await packagedApp.close().catch(() => {})
    await fixture.close()
    await fs.rm(dataDirectory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
