const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { _electron: electron } = require('playwright-core')
const { createDesktopFixture } = require('./cloud-fixture.cjs')

async function main() {
  const fixture = await createDesktopFixture()
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'buildx-smoke-'))
  const environment = { ...process.env, ELECTRON_RENDERER_URL: '', BUILDX_API_URL: fixture.url, BUILDX_E2E: '1', BUILDX_E2E_USER_DATA: directory }
  delete environment.ELECTRON_RUN_AS_NODE
  let app
  try {
    app = await electron.launch({ args: ['.'], cwd: path.join(__dirname, '..'), env: environment })
    const page = await app.firstWindow()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.getByRole('heading', { name: 'Welcome to BuildX.' }).waitFor()
    assert.equal((await page.evaluate(() => window.buildx.projects.list())).code, 'AUTH_REQUIRED')
    await fixture.authenticate(page)
    const boundary = await page.evaluate(async () => ({
      exposed: Object.keys(window.buildx).sort(),
      require: typeof window.require, process: typeof window.process, ipcRenderer: typeof window.ipcRenderer,
      auth: await window.buildx.auth.status(),
      projects: Object.keys(window.buildx.projects).sort(),
      generationMethods: Object.keys(window.buildx.generation),
      listing: await window.buildx.projects.list(),
    }))
    assert.deepEqual(boundary.exposed, ['auth', 'exports', 'generation', 'projects'])
    for (const key of ['require', 'process', 'ipcRenderer']) assert.equal(boundary[key], 'undefined')
    assert.equal(boundary.auth.user.email, fixture.account.email)
    assert.equal(boundary.auth.token, undefined)
    assert.deepEqual(boundary.projects, ['create', 'delete', 'get', 'list', 'rename', 'saveInput', 'saveSection'])
    assert.deepEqual(boundary.generationMethods, ['generate'])
    assert.equal(boundary.listing.ok, true)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 560))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), true)
    assert.deepEqual(errors, [])
    console.log('Electron smoke passed: authenticated cloud project IPC, restricted bridge, built renderer, resize.')
  } finally {
    if (app) await app.close().catch(() => {})
    await fixture.close()
    await fs.rm(directory, { recursive: true, force: true })
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
