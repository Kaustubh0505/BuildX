const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createProjectStore, SECTION_KEYS } = require('../electron/project-store.cjs')
const { createGenerationService, MODEL, parseSections, sectionKeysFromEnv, SECTION_ENV } = require('../server/generation.cjs')
const validSections = Object.fromEntries(SECTION_KEYS.map(key => [key, `Plan for ${key}`]))
const sectionKeys = Object.fromEntries(SECTION_KEYS.map(key => [key, `secret-${key}`]))
const response = key => ({ content: JSON.stringify({ [key]: validSections[key] }) })

async function setup(t, handler = async key => response(key), options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'buildx-generation-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const store = createProjectStore({ directory })
  const project = await store.create({ title: 'Booking', problem: 'Studios need simple booking.' })
  const calls = []
  const service = createGenerationService({ store, sectionApiKeys: sectionKeys, ...options,
    createClient: async apiKey => ({ chat: { completions: { create: async (request, requestOptions) => {
      const section = request.response_format.json_schema.schema.required[0]
      calls.push({ apiKey, section, request, requestOptions })
      return { choices: [{ finish_reason: 'stop', message: await handler(section, requestOptions) }] }
    } } } }),
  })
  return { directory, store, project, service, calls }
}

test('all nine requests start in parallel, use their own keys and single-section schemas, then save once', async t => {
  const started = new Set()
  let release, allStarted
  const gate = new Promise(resolve => { release = resolve })
  const ready = new Promise(resolve => { allStarted = resolve })
  const { directory, store, project, service, calls } = await setup(t, async section => {
    started.add(section)
    if (started.size === 9) allStarted()
    await gate
    return response(section)
  })
  const run = service.generate(project.id)
  await ready
  assert.equal((await store.get(project.id)).blueprint, null)
  await assert.rejects(service.generate(project.id), { code: 'GENERATION_IN_PROGRESS' })
  release()
  const generated = await run
  assert.deepEqual(generated.blueprint.sections, validSections)
  assert.equal(calls.length, 9)
  for (const call of calls) {
    assert.equal(call.apiKey, sectionKeys[call.section])
    assert.equal(call.request.model, MODEL)
    assert.deepEqual(Object.keys(call.request.response_format.json_schema.schema.properties), [call.section])
    assert.match(call.request.messages[0].content, /React with Vite/)
    assert.match(call.request.messages[0].content, /Studios need simple booking/)
    assert.equal(call.request.messages[0].content.includes(call.apiKey), false)
  }
  const raw = await fs.readFile(path.join(directory, `${project.id}.json`), 'utf8')
  for (const key of Object.values(sectionKeys)) assert.equal(raw.includes(key), false)
})

test('only the malformed section retries; successful sections run once', async t => {
  const counts = {}
  const { service, project, calls } = await setup(t, async section => {
    counts[section] = (counts[section] || 0) + 1
    return section === 'screens' && counts[section] === 1 ? { content: '{invalid' } : response(section)
  })
  assert.deepEqual((await service.generate(project.id)).blueprint.sections, validSections)
  assert.equal(calls.length, 10)
  for (const section of SECTION_KEYS) assert.equal(counts[section], section === 'screens' ? 2 : 1)
})

test('two malformed responses leave the entire saved blueprint intact', async t => {
  const { service, project, store } = await setup(t, async section => section === 'dataEntities' ? { content: '{}' } : response(section))
  await store.saveBlueprint(project.id, validSections)
  const before = await store.get(project.id)
  await assert.rejects(service.generate(project.id), { code: 'INVALID_RESPONSE' })
  assert.deepEqual(await store.get(project.id), before)
})

test('failure cancels sibling requests, keeps the original error and releases the project lock', async t => {
  let fail = true
  let aborted = 0
  const { service, project, store } = await setup(t, async (section, options) => {
    if (!fail) return response(section)
    if (section === 'testPlan') throw Object.assign(new Error('secret-testPlan'), { status: 429 })
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => {
      aborted++
      reject(options.signal.reason)
    }, { once: true }))
  })
  await assert.rejects(service.generate(project.id), error => error.code === 'GROQ_QUOTA_EXCEEDED' && !error.message.includes('secret'))
  assert.equal(aborted, 8)
  assert.equal((await store.get(project.id)).blueprint, null)
  fail = false
  assert.deepEqual((await service.generate(project.id)).blueprint.sections, validSections)
})

test('missing credentials fail before requests; shared key is an explicit fallback; environment mapping is stable', async t => {
  const { service, project, calls } = await setup(t, undefined, { sectionApiKeys: { screens: 'screen-override' } })
  assert.deepEqual(service.status(), { hasApiKey: false })
  await assert.rejects(service.generate(project.id), { code: 'GENERATION_UNAVAILABLE' })
  assert.equal(calls.length, 0)
  service.setApiKey(' shared-key ')
  await service.generate(project.id)
  for (const call of calls) assert.equal(call.apiKey, call.section === 'screens' ? 'screen-override' : 'shared-key')
  service.clearApiKey()
  assert.deepEqual(service.status(), { hasApiKey: false })
  assert.deepEqual(sectionKeysFromEnv(Object.fromEntries(SECTION_KEYS.map(key => [SECTION_ENV[key], sectionKeys[key]]))), sectionKeys)
})

test('incomplete briefs make no requests; provider errors expose safe actionable messages', async t => {
  const { service, store, calls } = await setup(t)
  const empty = await store.create()
  await assert.rejects(service.generate(empty.id), { code: 'INCOMPLETE_BRIEF' })
  assert.equal(calls.length, 0)
  for (const [error, code] of [
    [Object.assign(new Error('sensitive'), { status: 503 }), 'GROQ_UNAVAILABLE'],
    [Object.assign(new Error('sensitive'), { status: 401 }), 'GROQ_CONFIGURATION_ERROR'],
    [Object.assign(new Error('sensitive'), { name: 'TimeoutError' }), 'GENERATION_TIMEOUT'],
    [new Error('sensitive'), 'GROQ_REQUEST_FAILED'],
  ]) {
    const context = await setup(t, async () => { throw error })
    await assert.rejects(context.service.generate(context.project.id), e => e.code === code && !e.message.includes('sensitive'))
  }
})

test('parser rejects wrong, blank, oversized, and extra sections', () => {
  assert.equal(parseSections(undefined), null)
  assert.equal(parseSections(JSON.stringify({ ...validSections, testPlan: '  ' })), null)
  assert.equal(parseSections(JSON.stringify({ ...validSections, extra: 'x' })), null)
  assert.equal(parseSections(JSON.stringify({ screens: 'x'.repeat(100001) }), ['screens']), null)
  assert.equal(parseSections(JSON.stringify({ screens: 'x' }), ['dataEntities']), null)
})

test('real Groq SDK sends strict schemas and per-section credentials; truncated completions never save', async t => {
  const Groq = require('../server/node_modules/groq-sdk')
  const { store, project } = await setup(t)
  let truncate = false
  const calls = []
  const service = createGenerationService({ store, sectionApiKeys: sectionKeys,
    createClient: async apiKey => new Groq({ apiKey, maxRetries: 0, fetch: async (url, init) => {
      assert.equal(String(url), 'https://api.groq.com/openai/v1/chat/completions')
      const body = JSON.parse(init.body)
      const section = body.response_format.json_schema.schema.required[0]
      assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${sectionKeys[section]}`)
      assert.equal(body.response_format.type, 'json_schema')
      assert.equal(body.response_format.json_schema.strict, true)
      assert.equal(body.model, 'openai/gpt-oss-120b')
      assert.equal(JSON.stringify(body).includes(apiKey), false)
      calls.push(section)
      return new Response(JSON.stringify({ choices: [{
        finish_reason: truncate && section === 'screens' ? 'length' : 'stop',
        message: { role: 'assistant', content: JSON.stringify({ [section]: validSections[section] }) },
      }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    } }),
  })
  await service.generate(project.id)
  assert.equal(calls.length, 9)
  const saved = await store.get(project.id)
  truncate = true
  await assert.rejects(service.generate(project.id), { code: 'INVALID_RESPONSE' })
  assert.deepEqual(await store.get(project.id), saved)
  assert.equal(calls.filter(section => section === 'screens').length, 3)
})
