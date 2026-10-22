const { startFixture, PASSWORD } = require('../server/tests/support.cjs')
const { createCloudClient } = require('../electron/cloud-client.cjs')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs/promises')

async function createDesktopFixture() {
  const api = await startFixture({ rateLimits: false })
  const account = await api.account('developer@example.com', 'BuildX Developer')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'buildx-cloud-fixture-'))
  const client = createCloudClient({ apiUrl: api.url, sessionFile: path.join(directory, 'session'), localDirectory: path.join(directory, 'projects'), secureStorage: null })
  await client.login({ email: account.email, password: PASSWORD })
  const remote = client.scope().store
  const store = {
    ...remote,
    saveBlueprint: async (id, sections) => remote.saveBlueprint(id, sections, (await remote.get(id)).version),
    saveSection: async (id, section, content) => remote.saveSection(id, section, content, (await remote.get(id)).version),
  }
  async function authenticate(page) {
    await page.waitForFunction(() => document.querySelector('#auth-email') || document.querySelector('.new-project-button'))
    if (await page.locator('.new-project-button').count()) return
    await page.locator('#auth-email').fill(account.email)
    await page.locator('#auth-password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Log in', exact: true }).last().click()
    await page.getByRole('heading', { name: 'Start with a clear plan.' }).waitFor()
  }
  async function close() { await api.close(); await fs.rm(directory, { recursive: true, force: true }) }
  return { ...api, account, store, authenticate, close }
}
module.exports = { createDesktopFixture }
