const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createProjectStore, SECTION_KEYS } = require('../electron/project-store.cjs')
const { createGenerationService } = require('../server/generation.cjs')

async function main() {
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    console.error('Set GEMINI_API_KEY to run the live Gemini test.')
    process.exitCode = 2
    return
  }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'buildx-live-gemini-'))
  try {
    const store = createProjectStore({ directory })
    const project = await store.create({
      title: 'Studio booking test',
      problem: 'Small studios need a simple way to manage bookings without double booking.',
      desiredFeatures: 'View availability, make a booking, cancel a booking.',
      constraints: 'Single location. Keep the first release small.',
    })
    const service = createGenerationService({ store })
    service.setApiKey(key)
    const generated = await service.generate(project.id)
    assert.deepEqual(Object.keys(generated.blueprint.sections), SECTION_KEYS)
    assert.ok(SECTION_KEYS.every((section) => generated.blueprint.sections[section].trim()))
    console.log('Live Gemini generation passed: all nine sections validated and saved.')
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`Live Gemini generation failed: ${error.code || 'REQUEST_FAILED'}. ${error.message}`)
  process.exitCode = 1
})
