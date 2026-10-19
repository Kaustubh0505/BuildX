const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { createProjectStore, SECTION_KEYS } = require('../electron/project-store.cjs')

async function temporaryStore(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'buildx-projects-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  return { directory, store: createProjectStore({ directory, ...options }) }
}

function sections(label) {
  return Object.fromEntries(SECTION_KEYS.map((key) => [key, `${label}: ${key}`]))
}

test('two projects keep independent input and blueprint data after reopening storage', async (t) => {
  const { directory, store } = await temporaryStore(t)
  const first = await store.create({ title: 'First', problem: 'Problem one' })
  const second = await store.create({ title: 'Second', problem: 'Problem two' })

  assert.equal(first.schemaVersion, 1)
  assert.equal(first.blueprint, null)
  assert.deepEqual(first.input, {
    problem: 'Problem one',
    desiredFeatures: '',
    constraints: '',
  })

  await store.saveInput(first.id, {
    title: 'First plan',
    problem: 'Updated problem one',
    desiredFeatures: 'Search',
    constraints: 'Offline storage',
  })
  await store.saveBlueprint(first.id, sections('first'))
  await store.saveBlueprint(second.id, sections('second'))
  await Promise.all([
    store.saveSection(first.id, 'screens', 'Edited screen plan'),
    store.saveSection(first.id, 'testPlan', 'Edited test plan'),
  ])

  const reopened = createProjectStore({ directory })
  const savedFirst = await reopened.get(first.id)
  const savedSecond = await reopened.get(second.id)
  assert.equal(savedFirst.title, 'First plan')
  assert.equal(savedFirst.input.desiredFeatures, 'Search')
  assert.equal(savedFirst.blueprint.sections.screens, 'Edited screen plan')
  assert.equal(savedFirst.blueprint.sections.testPlan, 'Edited test plan')
  assert.equal(savedSecond.title, 'Second')
  assert.equal(savedSecond.input.problem, 'Problem two')
  assert.equal(savedSecond.blueprint.sections.screens, 'second: screens')

  const listing = await reopened.list()
  assert.equal(listing.projects.length, 2)
  assert.deepEqual(listing.warnings, [])
  assert.equal(listing.projects.find((project) => project.id === first.id).hasBlueprint, true)

  await reopened.rename(second.id, 'Renamed second')
  const deleted = await reopened.delete(first.id)
  assert.equal(deleted.id, first.id)
  assert.equal((await reopened.list()).projects.length, 1)
  assert.equal((await reopened.get(second.id)).title, 'Renamed second')
  await assert.rejects(reopened.get(first.id), { code: 'NOT_FOUND' })
})

test('invalid IDs and input cannot reach project files', async (t) => {
  const { directory, store } = await temporaryStore(t)
  assert.throws(() => store.get('../outside'), { code: 'INVALID_INPUT' })
  await assert.rejects(store.create({ title: 'Bad', apiKey: 'secret' }), { code: 'INVALID_INPUT' })
  await assert.rejects(store.create({ title: 42 }), { code: 'INVALID_INPUT' })
  await assert.rejects(store.create({ title: null }), { code: 'INVALID_INPUT' })

  const project = await store.create()
  assert.throws(() => store.rename(project.id, '   '), { code: 'INVALID_INPUT' })
  assert.throws(() => store.saveSection(project.id, 'apiKey', 'secret'), { code: 'INVALID_INPUT' })
  await assert.rejects(store.saveSection(project.id, 'screens', 'Draft'), { code: 'NO_BLUEPRINT' })
  assert.throws(() => store.saveInput(project.id, { title: 'Partial' }), { code: 'INVALID_INPUT' })

  const raw = await fs.readFile(path.join(directory, `${project.id}.json`), 'utf8')
  assert.equal(raw.includes('apiKey'), false)
  assert.equal((await store.get(project.id)).blueprint, null)
})

test('listing reports corrupt and unsupported files while preserving valid projects', async (t) => {
  const { directory, store } = await temporaryStore(t)
  const valid = await store.create({ title: 'Valid' })
  const corruptId = randomUUID()
  const unsupportedId = randomUUID()
  const corruptFile = path.join(directory, `${corruptId}.json`)
  const unsupportedFile = path.join(directory, `${unsupportedId}.json`)
  await fs.writeFile(corruptFile, '{not json', 'utf8')
  const unsupported = { ...(await store.get(valid.id)), id: unsupportedId, schemaVersion: 2 }
  await fs.writeFile(unsupportedFile, JSON.stringify(unsupported), 'utf8')

  const listing = await store.list()
  assert.deepEqual(listing.projects.map((project) => project.id), [valid.id])
  assert.deepEqual(listing.warnings.map((warning) => warning.code).sort(), [
    'CORRUPT_PROJECT', 'UNSUPPORTED_VERSION',
  ])
  await assert.rejects(store.get(corruptId), { code: 'CORRUPT_PROJECT' })
  await assert.rejects(store.get(unsupportedId), { code: 'UNSUPPORTED_VERSION' })
  assert.equal(await fs.readFile(corruptFile, 'utf8'), '{not json')
  assert.equal(JSON.parse(await fs.readFile(unsupportedFile, 'utf8')).schemaVersion, 2)
})

test('failed atomic rename keeps the previous project and removes the temporary file', async (t) => {
  const { directory, store } = await temporaryStore(t)
  const project = await store.create({ title: 'Before' })
  const originalFile = await fs.readFile(path.join(directory, `${project.id}.json`), 'utf8')
  const failingStore = createProjectStore({
    directory,
    filesystem: { ...fs, rename: async () => { throw new Error('simulated rename failure') } },
  })

  await assert.rejects(failingStore.rename(project.id, 'After'), { code: 'STORAGE_ERROR' })
  assert.equal(await fs.readFile(path.join(directory, `${project.id}.json`), 'utf8'), originalFile)
  assert.deepEqual((await fs.readdir(directory)).filter((name) => name.endsWith('.tmp')), [])
})
