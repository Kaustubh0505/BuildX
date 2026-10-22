const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const bcrypt = require('bcrypt')
const { randomUUID } = require('node:crypto')
const { startFixture, PASSWORD } = require('./support.cjs')
const { passwordMaterial } = require('../app.cjs')
const { SECTION_KEYS } = require('../../electron/project-store.cjs')
let fixture, alice, bob
let clock = Date.now()
before(async () => {
  fixture = await startFixture({ now: () => new Date(clock) })
  alice = await fixture.account('alice@example.com', 'Alice')
  bob = await fixture.account('bob@example.com', 'Bob')
})
after(async () => { await fixture?.close() })
const call = (...args) => fixture.call(...args)
const completeSections = () => Object.fromEntries(SECTION_KEYS.map((key) => [key, `**${key}** content`]))

test('signup validates required fields and types and preserves password whitespace', async () => {
  for (const body of [{}, { name: ' ', email: 'bad', password: 'short' }, { name: 'Dev', email: { $gt: '' }, password: PASSWORD }]) {
    const response = await call('/auth/signup', { method: 'POST', body })
    assert.equal(response.status, 400)
    assert.equal(response.code, 'INVALID_INPUT')
  }
  const password = ` ${PASSWORD} `
  const response = await call('/auth/signup', { method: 'POST', body: { name: '  New Dev  ', email: '  Mixed.Case@Example.COM ', password } })
  assert.equal(response.status, 201)
  assert.deepEqual(Object.keys(response.user).sort(), ['email', 'id', 'name'])
  assert.equal(response.user.name, 'New Dev')
  assert.equal(response.user.email, 'mixed.case@example.com')
  const stored = await fixture.db.collection('users').findOne({ _id: response.user.id })
  assert.notEqual(stored.passwordHash, password)
  assert.equal(await bcrypt.compare(passwordMaterial(password), stored.passwordHash), true)
  assert.equal(await bcrypt.compare(passwordMaterial(PASSWORD), stored.passwordHash), false)
  assert.equal(bcrypt.getRounds(stored.passwordHash), 12)
  assert.equal(stored.password, undefined)
})

test('short and long Unicode passwords work without bcrypt truncation', async () => {
  for (const [index, value] of ['a', `${'🦊'.repeat(40)}\0 suffix`].entries()) {
    const email = `unrestricted-${index}@example.com`
    const response = await call('/auth/signup', { method: 'POST', body: { name: 'Dev', email, password: value } })
    assert.equal(response.status, 201)
    assert.equal((await call('/auth/login', { method: 'POST', body: { email, password: value } })).ok, true)
    assert.equal((await call('/auth/login', { method: 'POST', body: { email, password: `${value}different` } })).code, 'INVALID_CREDENTIALS')
  }
})

test('existing bcrypt accounts sign in and migrate without a password reset', async () => {
  const id = randomUUID()
  await fixture.db.collection('users').insertOne({ _id: id, name: 'Legacy', email: 'legacy@example.com', passwordHash: await bcrypt.hash(PASSWORD, 12) })
  const response = await call('/auth/login', { method: 'POST', body: { email: 'legacy@example.com', password: PASSWORD } })
  assert.equal(response.ok, true)
  const stored = await fixture.db.collection('users').findOne({ _id: id })
  assert.equal(stored.passwordScheme, 'bcrypt-sha256-v1')
  assert.equal(await bcrypt.compare(passwordMaterial(PASSWORD), stored.passwordHash), true)
})

test('a unique email index resolves simultaneous case-insensitive signups', async () => {
  const responses = await Promise.all(['Race@EXAMPLE.com', 'race@example.com'].map((email) => call('/auth/signup', { method: 'POST', body: { name: 'Race', email, password: PASSWORD } })))
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409])
  assert.equal(await fixture.db.collection('users').countDocuments({ email: 'race@example.com' }), 1)
})

test('login uses generic errors and stores only a token hash with an absolute seven-day expiry', async () => {
  const errors = []
  for (const email of ['alice@example.com', 'absent@example.com']) errors.push(await call('/auth/login', { method: 'POST', body: { email, password: 'an incorrect password' } }))
  assert.equal(errors[0].message, errors[1].message)
  assert.equal(errors[0].status, 401)
  const record = await fixture.db.collection('sessions').findOne({ userId: alice.user.id })
  assert.notEqual(record.tokenHash, alice.token)
  assert.equal(record.token, undefined)
  assert.equal(record.expiresAt.getTime() - record.createdAt.getTime(), 7 * 24 * 60 * 60 * 1000)
  const me = await call('/auth/me', { token: alice.token })
  assert.deepEqual(me.user, alice.user)
  assert.equal(me.token, undefined)
})

test('project routes require auth, isolate owners, enforce allowed fields and optimistic versions', async () => {
  assert.equal((await call('/projects')).status, 401)
  assert.equal((await call('/projects', { method: 'POST', token: alice.token, body: { ownerId: bob.user.id } })).status, 400)
  const created = await call('/projects', { method: 'POST', token: alice.token, body: { title: 'Alice project', problem: 'Plan safely.' } })
  const p = created.project
  assert.equal(p.version, 1)
  assert.equal(p.ownerId, undefined)
  for (const [method, route, body] of [
    ['GET', '', undefined], ['PATCH', '/title', { title: 'Stolen', version: 1 }],
    ['PUT', '/blueprint', { sections: completeSections(), version: 1 }],
    ['PATCH', '/sections/screens', { content: 'Stolen', version: 1 }], ['DELETE', '', { version: 1 }],
  ]) assert.equal((await call(`/projects/${p.id}${route}`, { method, body, token: bob.token })).status, 404)
  assert.equal((await call(`/projects/${p.id}/title`, { method: 'PATCH', token: alice.token, body: { title: 'No version' } })).status, 400)
  const updates = await Promise.all(['First', 'Second'].map((title) => call(`/projects/${p.id}/title`, { method: 'PATCH', token: alice.token, body: { title, version: 1 } })))
  assert.deepEqual(updates.map((r) => r.status).sort(), [200, 409])
  assert.equal((await call(`/projects/${p.id}`, { method: 'DELETE', token: alice.token, body: { version: 1 } })).code, 'CONFLICT')
  assert.equal((await call(`/projects/${p.id}/sections/screens`, { method: 'PATCH', token: alice.token, body: { content: 'No blueprint', version: 2 } })).code, 'NO_BLUEPRINT')
  const blueprint = await call(`/projects/${p.id}/blueprint`, { method: 'PUT', token: alice.token, body: { sections: completeSections(), version: 2 } })
  assert.equal(blueprint.project.version, 3)
  assert.equal((await call(`/projects/${p.id}/sections/apiKey`, { method: 'PATCH', token: alice.token, body: { content: 'secret', version: 3 } })).status, 400)
  const saved = await call(`/projects/${p.id}/sections/screens`, { method: 'PATCH', token: alice.token, body: { content: '**Edited screen**', version: 3 } })
  assert.equal(saved.project.version, 4)
  assert.equal(saved.project.blueprint.sections.screens, '**Edited screen**')
  assert.equal((await call(`/projects/${p.id}`, { method: 'DELETE', token: alice.token, body: { version: 4 } })).ok, true)
})

test('local import is idempotent per owner and cannot overwrite an existing cloud project', async () => {
  const timestamp = new Date().toISOString()
  const project = { id: randomUUID(), schemaVersion: 1, title: 'Local project', createdAt: timestamp, updatedAt: timestamp, input: { problem: 'Legacy brief', desiredFeatures: '', constraints: '' }, blueprint: null }
  const responses = await Promise.all([1, 2].map(() => call('/projects/import', { method: 'POST', token: alice.token, body: project })))
  assert.deepEqual(responses.map((r) => r.imported).sort(), [false, true])
  assert.equal((await call('/projects/import', { method: 'POST', token: alice.token, body: { ...project, title: 'Overwrite' } })).project.title, 'Local project')
  assert.equal((await call('/projects/import', { method: 'POST', token: bob.token, body: project })).imported, true)
  assert.equal((await call('/projects/import', { method: 'POST', token: bob.token, body: { ...project, apiKey: 'forbidden' } })).status, 400)
})

test('database-backed login throttling limits guessing even for an unknown email', async () => {
  let response
  for (let attempt = 0; attempt < 11; attempt++) response = await call('/auth/login', { method: 'POST', body: { email: 'limited@example.com', password: PASSWORD } })
  assert.equal(response.status, 429)
  assert.ok(await fixture.db.collection('authAttempts').countDocuments() > 0)
})

test('logout revokes the current session and expired sessions fail before TTL cleanup', async () => {
  assert.equal((await call('/auth/logout', { method: 'POST', token: bob.token })).ok, true)
  assert.equal((await call('/auth/me', { token: bob.token })).status, 401)
  clock += 8 * 24 * 60 * 60 * 1000
  assert.equal((await call('/auth/me', { token: alice.token })).status, 401)
  assert.equal((await call('/projects', { token: alice.token })).status, 401)
})
