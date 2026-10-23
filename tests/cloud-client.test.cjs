const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { startFixture } = require('../server/tests/support.cjs')
const { createCloudClient, validateApiUrl } = require('../electron/cloud-client.cjs')
const { createProjectStore, SECTION_KEYS } = require('../electron/project-store.cjs')
const { createGenerationService } = require('../server/generation.cjs')
let fixture
before(async () => { fixture = await startFixture({ rateLimits: false }) })
after(async () => { await fixture?.close() })

function encryption() {
  const key = crypto.randomBytes(32)
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => {
      const iv = crypto.randomBytes(12)
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
      const data = Buffer.concat([cipher.update(value), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), data])
    },
    decryptString: (value) => {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      decipher.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString()
    },
  }
}
async function setup(t, extra = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'buildx-client-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const account = await fixture.account()
  const options = { apiUrl: fixture.url, sessionFile: path.join(directory, 'auth-session.enc'), localDirectory: path.join(directory, 'projects'), secureStorage: encryption(), ...extra }
  const client = createCloudClient(options)
  return { directory, account, options, client, credentials: { email: account.email, password: account.password } }
}

test('only HTTPS or loopback URLs are accepted, without credential or path injection', () => {
  assert.equal(validateApiUrl('https://api.example.com'), 'https://api.example.com')
  for (const url of ['http://example.com', 'https://user:secret@example.com', 'https://api.example.com/path', 'file:///tmp/test', 'https://example.com?token=secret']) assert.throws(() => validateApiUrl(url))
})

test('encrypted seven-day session survives restart, exposes no token, and logout revokes it', async (t) => {
  const { client, account, credentials, options } = await setup(t)
  const result = await client.login(credentials)
  assert.equal(result.user.id, account.user.id)
  assert.equal(result.token, undefined)
  const contents = await fs.readFile(options.sessionFile)
  assert.equal(contents.includes(Buffer.from(account.email)), false)
  assert.equal(contents.includes(Buffer.from('token')), false)
  const saved = JSON.parse(options.secureStorage.decryptString(contents))
  const reopened = createCloudClient(options)
  assert.equal((await reopened.status()).user.id, account.user.id)
  await reopened.logout()
  assert.equal((await fixture.call('/auth/me', { token: saved.token })).status, 401)
  await assert.rejects(fs.access(options.sessionFile), { code: 'ENOENT' })
  assert.equal((await createCloudClient(options).status()).user, null)
})

test('signup starts a secure session without a separate login', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'buildx-signup-client-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const options = { apiUrl: fixture.url, sessionFile: path.join(directory, 'auth-session.enc'), localDirectory: path.join(directory, 'projects'), secureStorage: encryption() }
  const client = createCloudClient(options)
  const result = await client.signup({ name: 'New Builder', email: 'new-builder@example.com', password: 'pass' })
  assert.equal(result.user.name, 'New Builder')
  assert.equal(result.token, undefined)
  assert.equal((await client.scope().store.list()).projects.length, 0)
  assert.equal((await createCloudClient(options).status()).user.id, result.user.id)
})

test('signup signs in automatically when an older API omits the session', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'buildx-legacy-signup-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  let loginCalls = 0
  const fetchImpl = async (url, options) => {
    const response = await fetch(url, options)
    if (url.endsWith('/api/auth/login')) loginCalls += 1
    if (!url.endsWith('/api/auth/signup')) return response
    const body = await response.json()
    delete body.token
    delete body.expiresAt
    return new Response(JSON.stringify(body), { status: response.status, headers: { 'Content-Type': 'application/json' } })
  }
  const client = createCloudClient({ apiUrl: fixture.url, sessionFile: path.join(directory, 'auth-session.enc'), localDirectory: path.join(directory, 'projects'), secureStorage: encryption(), fetchImpl })
  const result = await client.signup({ name: 'Older API', email: 'older-api@example.com', password: 'pass' })
  assert.equal(result.user.name, 'Older API')
  assert.equal(loginCalls, 1)
  assert.equal((await client.status()).user.id, result.user.id)
})

test('unavailable encryption uses memory only; connection errors preserve saved sessions; offline logout clears them', async (t) => {
  const memory = await setup(t, { secureStorage: { isEncryptionAvailable: () => false } })
  assert.match((await memory.client.login(memory.credentials)).warning, /app session/)
  assert.equal((await memory.client.status()).user.id, memory.account.user.id)
  await assert.rejects(fs.access(memory.options.sessionFile), { code: 'ENOENT' })
  assert.equal((await createCloudClient(memory.options).status()).user, null)
  let offline = false
  const saved = await setup(t, { fetchImpl: (...args) => { if (offline) throw new Error('offline'); return fetch(...args) } })
  await saved.client.login(saved.credentials)
  offline = true
  await assert.rejects(saved.client.status(), { code: 'CONNECTION_FAILED' })
  await fs.access(saved.options.sessionFile)
  offline = false
  assert.equal((await saved.client.status()).user.id, saved.account.user.id)
  offline = true
  assert.match((await saved.client.logout()).warning, /expire automatically/)
  await assert.rejects(fs.access(saved.options.sessionFile), { code: 'ENOENT' })
})

test('expired or corrupted saved sessions fail closed and old account scopes cannot be reused', async (t) => {
  const { client, credentials, options } = await setup(t)
  await client.login(credentials)
  const oldScope = client.scope()
  await client.logout()
  await client.login(credentials)
  await assert.rejects(oldScope.store.list(), { code: 'ACCOUNT_CHANGED' })
  const expired = createCloudClient({ ...options, now: () => Date.now() + 8 * 24 * 60 * 60 * 1000 })
  assert.equal((await expired.status()).user, null)
  await fs.writeFile(options.sessionFile, 'not an encrypted session')
  assert.equal((await createCloudClient(options).status()).user, null)
})

test('legacy projects appear automatically, stay deduplicated and deleted, and belong to one account', async (t) => {
  const { client, credentials, options, directory } = await setup(t)
  const local = createProjectStore({ directory: options.localDirectory })
  const one = await local.create({ title: 'One', problem: 'First problem' })
  const two = await local.create({ title: 'Two', problem: 'Second problem' })
  await fs.writeFile(path.join(options.localDirectory, 'bad.json'), '{bad')
  const before = await fs.readFile(path.join(options.localDirectory, `${one.id}.json`), 'utf8')
  await client.login(credentials)
  const { store } = client.scope()
  const listings = await Promise.all([store.list(), store.list()])
  for (const listing of listings) {
    assert.equal(listing.projects.length, 2)
    assert.equal(listing.warnings.length, 1)
  }
  assert.equal((await store.get(two.id)).input.problem, 'Second problem')
  const saved = await store.get(one.id)
  await store.rename(one.id, 'Cloud edit', saved.version)
  assert.equal((await store.list()).projects.find((project) => project.id === one.id).title, 'Cloud edit')
  await store.delete(two.id, (await store.get(two.id)).version)
  assert.equal((await store.list()).projects.length, 1)
  const reopened = createCloudClient(options)
  await reopened.status()
  assert.equal((await reopened.scope().store.list()).projects.length, 1)
  const other = await fixture.account()
  const anotherClient = createCloudClient({ ...options, sessionFile: path.join(directory, 'another-session.enc') })
  await anotherClient.login({ email: other.email, password: other.password })
  const otherListing = await anotherClient.scope().store.list()
  assert.deepEqual(otherListing.projects, [])
  assert.deepEqual(otherListing.warnings, [])
  await assert.rejects(anotherClient.scope().store.get(one.id), { code: 'NOT_FOUND' })
  assert.equal(await fs.readFile(path.join(options.localDirectory, `${one.id}.json`), 'utf8'), before)
})

test('generation version conflict preserves the current cloud blueprint and failed network writes can be retried', async (t) => {
  let offline = false
  const { client, credentials } = await setup(t, { fetchImpl: (...args) => { if (offline) throw new Error('offline'); return fetch(...args) } })
  await client.login(credentials)
  const { store } = client.scope()
  const project = await store.create({ title: 'Concurrent plan', problem: 'A complete brief.' })
  const content = Object.fromEntries(SECTION_KEYS.map((key) => [key, `Saved ${key}`]))
  const generated = await store.saveBlueprint(project.id, content, project.version)
  const service = createGenerationService({ store, createClient: async () => ({ chat: { completions: { create: async (request) => {
    if (request.response_format.json_schema.schema.required[0] === 'screens') await store.saveSection(project.id, 'screens', 'An edit from another device', generated.version)
    const section = request.response_format.json_schema.schema.required[0]
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ [section]: content[section] }) } }] }
  } } } }) })
  service.setApiKey('session-only-key')
  await assert.rejects(service.generate(project.id, generated.version), { code: 'CONFLICT' })
  const current = await store.get(project.id)
  assert.equal(current.blueprint.sections.screens, 'An edit from another device')
  offline = true
  await assert.rejects(store.rename(project.id, 'New title', current.version), { code: 'CONNECTION_FAILED' })
  offline = false
  const saved = await store.rename(project.id, 'New title', current.version)
  assert.equal(saved.title, 'New title')
  await assert.rejects(store.rename(project.id, 'Stale title', current.version), { code: 'CONFLICT' })
})
