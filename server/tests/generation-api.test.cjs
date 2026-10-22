const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startFixture } = require('./support.cjs')
const { SECTION_KEYS } = require('../../electron/project-store.cjs')
const content = Object.fromEntries(SECTION_KEYS.map((key) => [key, `**${key}** managed plan`]))
let fixture, alice, bob, calls = 0, handler
before(async () => {
  fixture = await startFixture({ geminiApiKey: 'private-managed-test-key', createGeminiClient: async (key) => {
    assert.equal(key, 'private-managed-test-key')
    return { interactions: { create: async () => { calls++; return handler() } } }
  } })
  alice = await fixture.account()
  bob = await fixture.account()
})
after(async () => { await fixture?.close() })
async function project(account = alice) {
  return (await fixture.call('/projects', { method: 'POST', token: account.token, body: { title: 'Managed plan', problem: 'Generate a blueprint without a user API key.' } })).project
}
const generate = (p, account = alice) => fixture.call(`/projects/${p.id}/generate`, { method: 'POST', token: account.token, body: { version: p.version } })

test('managed generation authenticates owners and never accepts or returns a user key', async () => {
  const p = await project()
  const before = calls
  assert.equal((await fixture.call(`/projects/${p.id}/generate`, { method: 'POST', body: { version: p.version } })).status, 401)
  assert.equal((await generate(p, bob)).status, 404)
  assert.equal((await fixture.call(`/projects/${p.id}/generate`, { method: 'POST', token: alice.token, body: { version: p.version, apiKey: 'user-key' } })).status, 400)
  assert.equal(calls, before)
  handler = async () => ({ output_text: JSON.stringify(content) })
  const result = await generate(p)
  assert.equal(result.status, 200)
  assert.equal(result.project.version, 2)
  assert.deepEqual(result.project.blueprint.sections, content)
  assert.equal(JSON.stringify(result).includes('private-managed-test-key'), false)
  assert.equal(JSON.stringify(await fixture.db.collection('projects').findOne({ id: p.id })).includes('private-managed-test-key'), false)
})

test('malformed responses retry once and provider errors preserve saved sections without leaking secrets', async () => {
  const p = await project()
  let attempt = 0
  handler = async () => ({ output_text: ++attempt === 1 ? '{invalid' : JSON.stringify(content) })
  const saved = await generate(p)
  assert.equal(saved.ok, true)
  assert.equal(attempt, 2)
  handler = async () => { throw new Error('SDK error contains private-managed-test-key') }
  const failed = await generate(saved.project)
  assert.equal(failed.code, 'GEMINI_REQUEST_FAILED')
  assert.equal(JSON.stringify(failed).includes('private-managed-test-key'), false)
  const unchanged = await fixture.call(`/projects/${p.id}`, { token: alice.token })
  assert.deepEqual(unchanged.project.blueprint, saved.project.blueprint)
  handler = async () => ({ output_text: '{}' })
  assert.equal((await generate(saved.project)).code, 'INVALID_RESPONSE')
})

test('concurrent generation is locked and an intervening edit prevents replacement', async () => {
  const p = await project()
  let release, started
  const wait = new Promise((resolve) => { started = resolve })
  handler = async () => { started(); await new Promise((resolve) => { release = resolve }); return { output_text: JSON.stringify(content) } }
  const first = generate(p)
  await wait
  assert.equal((await generate(p)).code, 'GENERATION_IN_PROGRESS')
  const edited = await fixture.call(`/projects/${p.id}/title`, { method: 'PATCH', token: alice.token, body: { title: 'An edit from another device', version: p.version } })
  assert.equal(edited.ok, true)
  release()
  assert.equal((await first).code, 'CONFLICT')
  const current = (await fixture.call(`/projects/${p.id}`, { token: alice.token })).project
  assert.equal(current.title, 'An edit from another device')
  assert.equal(current.blueprint, null)
  assert.equal(await fixture.db.collection('generationLocks').countDocuments(), 0)
})

test('a missing server key reports temporary unavailability after ownership validation', async () => {
  const unconfigured = await startFixture({ rateLimits: false })
  try {
    const account = await unconfigured.account()
    const p = (await unconfigured.call('/projects', { method: 'POST', token: account.token, body: { title: 'Test', problem: 'Test configuration' } })).project
    const result = await unconfigured.call(`/projects/${p.id}/generate`, { method: 'POST', token: account.token, body: { version: p.version } })
    assert.equal(result.status, 503)
    assert.equal(result.code, 'GENERATION_UNAVAILABLE')
    assert.equal(result.message.includes('API key'), false)
  } finally { await unconfigured.close() }
})

test('managed generation has a database-backed per-user quota', async () => {
  const account = await fixture.account()
  let p = await project(account)
  handler = async () => ({ output_text: JSON.stringify(content) })
  for (let i = 0; i < 10; i++) {
    const result = await generate(p, account)
    assert.equal(result.status, 200)
    p = result.project
  }
  const before = calls
  assert.equal((await generate(p, account)).status, 429)
  assert.equal(calls, before)
})
