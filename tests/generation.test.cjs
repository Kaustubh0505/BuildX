const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createProjectStore, SECTION_KEYS } = require('../electron/project-store.cjs')
const { createGenerationService, MODEL, parseSections } = require('../electron/generation.cjs')

const validSections = Object.fromEntries(SECTION_KEYS.map((key) => [key, `Plan for ${key}`]))

async function setup(t, responses) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'buildx-generation-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const store = createProjectStore({ directory })
  const project = await store.create({ title: 'Booking', problem: 'Studios need simple booking.' })
  const calls = []
  const service = createGenerationService({
    store,
    createClient: async (key) => {
      calls.push({ key })
      return { interactions: { create: async (request) => {
        calls.push(request)
        const next = responses.shift()
        if (next instanceof Error) throw next
        return { output_text: next }
      } } }
    },
  })
  return { directory, store, project, service, calls }
}

test('generates a complete blueprint with the requested model and keeps the key out of files', async (t) => {
  const { directory, store, project, service, calls } = await setup(t, [JSON.stringify(validSections)])
  assert.deepEqual(service.status(), { hasApiKey: false })
  assert.deepEqual(service.setApiKey(' secret-test-key '), { hasApiKey: true })
  const generated = await service.generate(project.id)
  assert.equal(generated.blueprint.sections.testPlan, validSections.testPlan)
  assert.equal(calls[0].key, 'secret-test-key')
  assert.equal(calls[1].model, MODEL)
  assert.equal(calls[1].response_format.mime_type, 'application/json')
  assert.deepEqual(calls[1].response_format.schema.required, SECTION_KEYS)
  assert.match(calls[1].input, /React with Vite/)
  assert.match(calls[1].input, /SQLite/)
  assert.equal((await store.get(project.id)).blueprint.sections.screens, validSections.screens)
  const raw = await fs.readFile(path.join(directory, `${project.id}.json`), 'utf8')
  assert.equal(raw.includes('secret-test-key'), false)
  service.clearApiKey()
  assert.deepEqual(service.status(), { hasApiKey: false })
})

test('retries one malformed response, then saves only the valid result', async (t) => {
  const { project, service, calls } = await setup(t, ['{bad json', JSON.stringify(validSections)])
  service.setApiKey('key')
  await service.generate(project.id)
  assert.equal(calls.length, 3)
})

test('two malformed responses preserve the previous blueprint', async (t) => {
  const { project, store, service, calls } = await setup(t, [JSON.stringify({ screens: 'Only screens' }), JSON.stringify({ ...validSections, extra: 'Wrong' })])
  await store.saveBlueprint(project.id, validSections)
  const before = await store.get(project.id)
  service.setApiKey('key')
  await assert.rejects(service.generate(project.id), { code: 'INVALID_RESPONSE' })
  assert.deepEqual((await store.get(project.id)).blueprint, before.blueprint)
  assert.equal(calls.length, 3)
})

test('missing key, incomplete brief, and request failure do not change the project', async (t) => {
  const { project, store, service, calls } = await setup(t, [new Error('secret-test-key in SDK error')])
  await assert.rejects(service.generate(project.id), { code: 'MISSING_API_KEY' })
  assert.throws(() => service.setApiKey('   '), { code: 'INVALID_API_KEY' })
  service.setApiKey('secret-test-key')
  await assert.rejects(service.generate(project.id), { code: 'GEMINI_REQUEST_FAILED', message: /Gemini request failed/ })
  assert.equal(calls.length, 2)
  assert.equal((await store.get(project.id)).blueprint, null)
  const empty = await store.create()
  await assert.rejects(service.generate(empty.id), { code: 'INCOMPLETE_BRIEF' })
})

test('parser rejects missing, blank, and unexpected sections', () => {
  assert.equal(parseSections(undefined), null)
  assert.equal(parseSections(JSON.stringify({ ...validSections, testPlan: '  ' })), null)
  assert.equal(parseSections(JSON.stringify({ ...validSections, extra: 'x' })), null)
})
