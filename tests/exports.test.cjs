const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createProjectStore, SECTION_KEYS } = require('../electron/project-store.cjs')
const { createExportService, SECTION_TITLES, markdownForProject, pdfForProject, atomicWrite } = require('../electron/exports.cjs')

const fixedDate = new Date('2026-10-20T12:00:00Z')

async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'buildx-exports-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const store = createProjectStore({ directory: path.join(directory, 'projects') })
  const project = await store.create({ title: 'Studio booking', problem: 'People need a simple booking tool.' })
  return { directory, store, project }
}

function sections(label = 'Saved') {
  return Object.fromEntries(SECTION_KEYS.map((key) => [key, `${label} ${key}\n- First item\n- Second item`]))
}

test('export section titles match the stored blueprint schema', () => {
  assert.deepEqual(Object.keys(SECTION_TITLES), SECTION_KEYS)
})

test('Markdown export contains the saved title, date, and every saved section', async (t) => {
  const { directory, store, project } = await setup(t)
  await store.saveBlueprint(project.id, sections())
  await store.saveSection(project.id, 'screens', 'Edited screens\n- Calendar')
  const destination = path.join(directory, 'Studio-booking.md')
  const dialogs = []
  const service = createExportService({
    store,
    now: () => fixedDate,
    showSaveDialog: async (_window, options) => {
      dialogs.push(options)
      return { canceled: false, filePath: destination }
    },
  })
  const result = await service.markdown(project.id)
  assert.deepEqual(result, { canceled: false, filePath: destination })
  assert.equal(dialogs[0].filters[0].extensions[0], 'md')
  assert.equal(dialogs[0].defaultPath, 'Studio-booking.md')
  const exported = await fs.readFile(destination, 'utf8')
  assert.equal(exported, markdownForProject(await store.get(project.id), fixedDate))
  assert.match(exported, /# Studio booking\n\nExported:/)
  assert.match(exported, /Edited screens\n- Calendar/)
  for (const key of SECTION_KEYS) assert.match(exported, new RegExp(key === 'screens' ? 'Edited screens' : `Saved ${key}`))
})

test('PDF export writes an A4 multipage document from saved sections', async (t) => {
  const { directory, store, project } = await setup(t)
  const longSections = sections()
  longSections.architecture = Array.from({ length: 170 }, (_, index) => `Architecture item ${index + 1}: React, Express, and SQLite.`).join('\n')
  await store.saveBlueprint(project.id, longSections)
  const destination = path.join(directory, 'blueprint.pdf')
  let saveOptions
  const service = createExportService({
    store,
    now: () => fixedDate,
    showSaveDialog: async (_window, options) => {
      saveOptions = options
      return { canceled: false, filePath: destination }
    },
  })
  const result = await service.pdf(project.id)
  assert.deepEqual(result, { canceled: false, filePath: destination })
  assert.equal(saveOptions.filters[0].extensions[0], 'pdf')
  const pdf = await fs.readFile(destination)
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
  assert.ok(pdf.length > 10_000)
  assert.ok((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length > 9)
})

test('standalone build prompt exports only the saved Markdown with a dedicated filename', async (t) => {
  const { directory, store, project } = await setup(t)
  const prompt = '# Build: Studio booking\n\n## Requirements\n\n- Implement booking.\n\n## Acceptance criteria\n\n- [ ] Bookings persist.'
  await store.saveBlueprint(project.id, { ...sections(), testPlan: prompt })
  let options
  const service = createExportService({ store, showSaveDialog: async (_window, value) => {
    options = value
    return { canceled: false, filePath: path.join(directory, 'agent-prompt') }
  } })
  const result = await service.prompt(project.id)
  assert.equal(options.defaultPath, 'Studio-booking-build-prompt.md')
  assert.equal(await fs.readFile(result.filePath, 'utf8'), `${prompt}\n`)
  assert.equal(SECTION_TITLES.testPlan, 'AI agent build prompt')
})

test('canceling and exporting without a blueprint leave files untouched', async (t) => {
  const { directory, store, project } = await setup(t)
  let dialogs = 0
  const service = createExportService({ store, showSaveDialog: async () => { dialogs += 1; return { canceled: true } } })
  await assert.rejects(service.markdown(project.id), { code: 'NO_BLUEPRINT' })
  assert.equal(dialogs, 0)
  await store.saveBlueprint(project.id, sections())
  assert.deepEqual(await service.markdown(project.id), { canceled: true })
  assert.deepEqual(await fs.readdir(directory), ['projects'])
})

test('failed export write retains the existing file and cleans temporary data', async (t) => {
  const { directory } = await setup(t)
  const destination = path.join(directory, 'plan.md')
  await fs.writeFile(destination, 'previous export')
  await assert.rejects(atomicWrite(destination, 'new export', {
    ...fs,
    rename: async () => { throw new Error('simulated failure') },
  }), { code: 'EXPORT_WRITE_FAILED' })
  assert.equal(await fs.readFile(destination, 'utf8'), 'previous export')
  assert.deepEqual((await fs.readdir(directory)).filter((name) => name.endsWith('.tmp')), [])
})

test('PDF renderer includes Unicode text without throwing', async (t) => {
  const { store, project } = await setup(t)
  await store.saveBlueprint(project.id, { ...sections(), testPlan: 'Café — 日本語' })
  const pdf = await pdfForProject(await store.get(project.id), fixedDate)
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
})
