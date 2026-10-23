const fs = require('node:fs/promises')
const { existsSync } = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { PDFDocument } = require('pdfkit')
const { SECTION_KEYS } = require('./project-store.cjs')

const SECTION_TITLES = Object.freeze({
  goalsAndAssumptions: 'Goals and assumptions',
  mvpFeatures: 'MVP features',
  userFlows: 'User flows',
  screens: 'Screens',
  architecture: 'React / Node architecture',
  dataEntities: 'Data entities',
  apiEndpoints: 'API endpoints',
  implementationPhases: 'Implementation phases',
  testPlan: 'AI agent build prompt',
})
const FONT_PATH = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'

class ExportError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

function displayDate(date) {
  return new Intl.DateTimeFormat('en', { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
}

function safeFileName(title) {
  return title.trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80) || 'BuildX-blueprint'
}

function requireBlueprint(project) {
  if (project.blueprint === null) {
    throw new ExportError('NO_BLUEPRINT', 'Generate a blueprint before exporting.')
  }
}

function markdownForProject(project, date) {
  requireBlueprint(project)
  const title = project.title.replace(/\s+/g, ' ').trim() || 'Untitled project'
  const parts = [`# ${title}`, `Exported: ${displayDate(date)}`]
  for (const [index, key] of SECTION_KEYS.entries()) {
    parts.push(`## ${index + 1}. ${SECTION_TITLES[key]}`, project.blueprint.sections[key])
  }
  return `${parts.join('\n\n')}\n`
}

function pdfForProject(project, date, { fontPath = existsSync(FONT_PATH) ? FONT_PATH : null } = {}) {
  requireBlueprint(project)
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 54, bottom: 54, left: 56, right: 56 }, info: { Title: `${project.title || 'Untitled project'} - BuildX Blueprint`, Author: 'BuildX' } })
    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.once('error', reject)
    doc.once('end', () => resolve(Buffer.concat(chunks)))

    try {
      if (fontPath) doc.font(fontPath)
      const bodyFont = fontPath || 'Helvetica'
      const headingFont = fontPath || 'Helvetica-Bold'
      const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
      doc.fillColor('#4775b8').fontSize(10).text('BUILDX  /  IMPLEMENTATION BLUEPRINT')
      doc.moveDown(1.4)
      doc.fillColor('#1c3150').font(headingFont).fontSize(27).text(project.title || 'Untitled project', { width: contentWidth })
      doc.moveDown(0.5)
      doc.fillColor('#65778d').font(bodyFont).fontSize(10).text(`Exported ${displayDate(date)}`)
      doc.moveDown(2)

      for (const [index, key] of SECTION_KEYS.entries()) {
        if (index > 0) doc.addPage()
        doc.fillColor('#4775b8').font(headingFont).fontSize(10).text(`SECTION ${String(index + 1).padStart(2, '0')}`)
        doc.moveDown(0.5)
        doc.fillColor('#1c3150').font(headingFont).fontSize(19).text(SECTION_TITLES[key], { width: contentWidth })
        doc.moveDown(0.7)
        doc.strokeColor('#dbe4ef').lineWidth(1).moveTo(doc.x, doc.y).lineTo(doc.x + contentWidth, doc.y).stroke()
        doc.moveDown(1)
        doc.fillColor('#344760').font(bodyFont).fontSize(10.5).text(project.blueprint.sections[key] || ' ', {
          width: contentWidth,
          lineGap: 3,
          paragraphGap: 4,
        })
      }
      doc.end()
    } catch (error) {
      reject(error)
    }
  })
}

async function atomicWrite(filePath, data, filesystem = fs) {
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  let handle
  try {
    handle = await filesystem.open(temporary, 'wx', 0o600)
    await handle.writeFile(data)
    await handle.sync()
    await handle.close()
    handle = null
    await filesystem.rename(temporary, filePath)
  } catch {
    throw new ExportError('EXPORT_WRITE_FAILED', 'Could not save the export. Choose another location and try again.')
  } finally {
    if (handle) await handle.close().catch(() => {})
    await filesystem.unlink(temporary).catch(() => {})
  }
}

function createExportService({ store, showSaveDialog, filesystem = fs, now = () => new Date(), renderPdf = pdfForProject }) {
  async function exportProject(id, format, window) {
    const project = await store.get(id)
    requireBlueprint(project)
    const extension = format === 'pdf' ? 'pdf' : 'md'
    const result = await showSaveDialog(window, {
      title: format === 'prompt' ? 'Export AI agent build prompt' : `Export ${format === 'pdf' ? 'PDF' : 'Markdown'} blueprint`,
      defaultPath: `${safeFileName(project.title)}${format === 'prompt' ? '-build-prompt' : ''}.${extension}`,
      buttonLabel: 'Export',
      filters: [{ name: format === 'pdf' ? 'PDF document' : 'Markdown document', extensions: [extension] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    const filePath = path.extname(result.filePath).toLowerCase() === `.${extension}` ? result.filePath : `${result.filePath}.${extension}`
    const date = now()
    const data = format === 'pdf' ? await renderPdf(project, date) : format === 'prompt' ? `${project.blueprint.sections.testPlan.trimEnd()}\n` : markdownForProject(project, date)
    await atomicWrite(filePath, data, filesystem)
    return { canceled: false, filePath }
  }

  return {
    markdown: (id, window) => exportProject(id, 'markdown', window),
    pdf: (id, window) => exportProject(id, 'pdf', window),
    prompt: (id, window) => exportProject(id, 'prompt', window),
  }
}

module.exports = { createExportService, ExportError, SECTION_TITLES, markdownForProject, pdfForProject, atomicWrite }
