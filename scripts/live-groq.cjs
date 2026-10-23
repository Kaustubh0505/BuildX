const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createProjectStore, SECTION_KEYS } = require('../electron/project-store.cjs')
const { createGenerationService, sectionKeysFromEnv } = require('../server/generation.cjs')

async function main() {
  const key = process.env.GROQ_API_KEY
  const sectionApiKeys = sectionKeysFromEnv(process.env)
  if (!key && !SECTION_KEYS.every(section => sectionApiKeys[section])) {
    console.error('Configure all nine section keys or GROQ_API_KEY to run the live Groq test.')
    process.exitCode = 2
    return
  }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'buildx-live-groq-'))
  try {
    const store = createProjectStore({ directory })
    const project = await store.create({
      title: 'Studio booking test',
      problem: 'Small studios need a simple way to manage bookings without double booking.',
      desiredFeatures: 'View availability, make a booking, cancel a booking.',
      constraints: 'Single location. Keep the first release small.',
    })
    const service = createGenerationService({ store, apiKey: key || '', sectionApiKeys })
    const generated = await service.generate(project.id)
    assert.deepEqual(Object.keys(generated.blueprint.sections), SECTION_KEYS)
    assert.ok(SECTION_KEYS.every((section) => generated.blueprint.sections[section].trim()))
    const { dataEntities, testPlan: prompt } = generated.blueprint.sections
    assert.match(prompt, /^# Build:/)
    assert.ok(prompt.split(/\s+/).length >= 600, 'Agent prompt should contain substantial implementation detail')
    assert.ok(dataEntities.split(/\s+/).length < 600, 'Entity summary should stay concise')
    console.log('Live Groq generation passed: all nine sections validated and saved.')
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`Live Groq generation failed: ${error.code || 'REQUEST_FAILED'}. ${error.message}`)
  if (error.cause) console.error(JSON.stringify({ providerStatus: error.cause.status, errorType: error.cause.name }))
  process.exitCode = 1
})
