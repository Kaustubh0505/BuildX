const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const SCHEMA_VERSION = 1
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const INTAKE_KEYS = ['title', 'problem', 'desiredFeatures', 'constraints']
const SECTION_KEYS = Object.freeze([
  'goalsAndAssumptions',
  'mvpFeatures',
  'userFlows',
  'screens',
  'architecture',
  'dataEntities',
  'apiEndpoints',
  'implementationPhases',
  'testPlan',
])

class ProjectStoreError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ProjectStoreError'
    this.code = code
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalidInput(message) {
  return new ProjectStoreError('INVALID_INPUT', message)
}

function storageError() {
  return new ProjectStoreError('STORAGE_ERROR', 'Project storage is unavailable.')
}

function validateId(id) {
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    throw invalidInput('Invalid project ID.')
  }
  return id
}

function validateDraft(value, requireAll = false) {
  if (!isRecord(value) || Object.keys(value).some((key) => !INTAKE_KEYS.includes(key))) {
    throw invalidInput('Project input contains invalid fields.')
  }

  const fields = {}
  for (const key of INTAKE_KEYS) {
    if (requireAll && !Object.hasOwn(value, key)) {
      throw invalidInput('All project input fields are required when saving.')
    }
    const field = Object.hasOwn(value, key) ? value[key] : ''
    if (typeof field !== 'string') {
      throw invalidInput('Project input fields must be text.')
    }
    fields[key] = key === 'title' ? field.trim() : field
  }
  return fields
}

function isIsoDate(value) {
  if (typeof value !== 'string') return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.toISOString() === value
}

function validateSections(value, code = 'CORRUPT_PROJECT') {
  if (!isRecord(value)) {
    throw new ProjectStoreError(code, 'Blueprint sections are invalid.')
  }
  const sections = {}
  for (const key of SECTION_KEYS) {
    if (typeof value[key] !== 'string') {
      throw new ProjectStoreError(code, 'Blueprint sections are invalid.')
    }
    sections[key] = value[key]
  }
  return sections
}

function validateProject(value, expectedId) {
  if (!isRecord(value)) {
    throw new ProjectStoreError('CORRUPT_PROJECT', 'Project file is invalid.')
  }
  if (Number.isInteger(value.schemaVersion) && value.schemaVersion !== SCHEMA_VERSION) {
    throw new ProjectStoreError('UNSUPPORTED_VERSION', 'Project file uses an unsupported version.')
  }
  if (
    value.schemaVersion !== SCHEMA_VERSION ||
    value.id !== expectedId ||
    !isIsoDate(value.createdAt) ||
    !isIsoDate(value.updatedAt) ||
    typeof value.title !== 'string' ||
    !isRecord(value.input) ||
    typeof value.input.problem !== 'string' ||
    typeof value.input.desiredFeatures !== 'string' ||
    typeof value.input.constraints !== 'string'
  ) {
    throw new ProjectStoreError('CORRUPT_PROJECT', 'Project file is invalid.')
  }

  let blueprint = null
  if (value.blueprint !== null) {
    if (!isRecord(value.blueprint) || !isIsoDate(value.blueprint.generatedAt)) {
      throw new ProjectStoreError('CORRUPT_PROJECT', 'Project blueprint is invalid.')
    }
    blueprint = {
      generatedAt: value.blueprint.generatedAt,
      sections: validateSections(value.blueprint.sections),
    }
  }

  // Rebuild from the allowlist so unexpected fields never reach IPC or a later save.
  return {
    schemaVersion: SCHEMA_VERSION,
    id: value.id,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    title: value.title,
    input: {
      problem: value.input.problem,
      desiredFeatures: value.input.desiredFeatures,
      constraints: value.input.constraints,
    },
    blueprint,
  }
}

function createProjectStore({ directory, filesystem = fs, now = () => new Date(), idFactory = randomUUID }) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw new TypeError('Project directory must be an absolute path.')
  }

  const pending = new Map()

  function projectPath(id) {
    return path.join(directory, `${validateId(id)}.json`)
  }

  async function ensureDirectory() {
    try {
      await filesystem.mkdir(directory, { recursive: true })
    } catch {
      throw storageError()
    }
  }

  async function readProject(id) {
    let raw
    try {
      raw = await filesystem.readFile(projectPath(id), 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new ProjectStoreError('NOT_FOUND', 'Project not found.')
      }
      throw storageError()
    }

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new ProjectStoreError('CORRUPT_PROJECT', 'Project file is invalid.')
    }
    return validateProject(parsed, id)
  }

  async function writeProject(project) {
    const canonical = validateProject(project, project.id)
    const destination = projectPath(canonical.id)
    const temporary = path.join(directory, `${canonical.id}.${randomUUID()}.tmp`)
    let handle

    await ensureDirectory()
    try {
      handle = await filesystem.open(temporary, 'wx', 0o600)
      await handle.writeFile(`${JSON.stringify(canonical, null, 2)}\n`, 'utf8')
      await handle.sync()
      await handle.close()
      handle = null
      await filesystem.rename(temporary, destination)
    } catch {
      throw storageError()
    } finally {
      if (handle) await handle.close().catch(() => {})
      await filesystem.unlink(temporary).catch(() => {})
    }
    return canonical
  }

  function serialize(id, operation) {
    const previous = pending.get(id) ?? Promise.resolve()
    const result = previous.then(operation, operation)
    const settled = result.then(() => {}, () => {})
    pending.set(id, settled)
    settled.then(() => {
      if (pending.get(id) === settled) pending.delete(id)
    })
    return result
  }

  async function update(id, change) {
    validateId(id)
    return serialize(id, async () => {
      const project = await readProject(id)
      change(project)
      project.updatedAt = now().toISOString()
      return writeProject(project)
    })
  }

  return {
    async list() {
      await ensureDirectory()
      let entries
      try {
        entries = await filesystem.readdir(directory, { withFileTypes: true })
      } catch {
        throw storageError()
      }

      const projects = []
      const warnings = []
      for (const entry of entries) {
        if (!entry.name.endsWith('.json')) continue
        const id = entry.name.slice(0, -5)
        if (!entry.isFile() || !UUID_PATTERN.test(id)) {
          warnings.push({ fileName: entry.name, code: 'CORRUPT_PROJECT' })
          continue
        }
        try {
          const project = await readProject(id)
          projects.push({
            id: project.id,
            title: project.title,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
            hasBlueprint: project.blueprint !== null,
          })
        } catch (error) {
          if (error.code !== 'NOT_FOUND') {
            warnings.push({ fileName: entry.name, code: error.code ?? 'STORAGE_ERROR' })
          }
        }
      }
      projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
      warnings.sort((a, b) => a.fileName.localeCompare(b.fileName))
      return { projects, warnings }
    },

    async create(input = {}) {
      const fields = validateDraft(input)
      const id = validateId(idFactory())
      return serialize(id, async () => {
        await ensureDirectory()
        try {
          await filesystem.access(projectPath(id))
          throw new ProjectStoreError('PROJECT_EXISTS', 'Project ID already exists.')
        } catch (error) {
          if (error instanceof ProjectStoreError) throw error
          if (error.code !== 'ENOENT') throw storageError()
        }
        const timestamp = now().toISOString()
        return writeProject({
          schemaVersion: SCHEMA_VERSION,
          id,
          createdAt: timestamp,
          updatedAt: timestamp,
          title: fields.title,
          input: {
            problem: fields.problem,
            desiredFeatures: fields.desiredFeatures,
            constraints: fields.constraints,
          },
          blueprint: null,
        })
      })
    },

    get(id) {
      validateId(id)
      return readProject(id)
    },

    rename(id, title) {
      if (typeof title !== 'string' || !title.trim()) {
        throw invalidInput('Project title cannot be empty.')
      }
      return update(id, (project) => { project.title = title.trim() })
    },

    saveInput(id, input) {
      const fields = validateDraft(input, true)
      return update(id, (project) => {
        project.title = fields.title
        project.input = {
          problem: fields.problem,
          desiredFeatures: fields.desiredFeatures,
          constraints: fields.constraints,
        }
      })
    },

    saveBlueprint(id, sections) {
      const canonicalSections = validateSections(sections, 'INVALID_INPUT')
      return update(id, (project) => {
        project.blueprint = {
          generatedAt: now().toISOString(),
          sections: canonicalSections,
        }
      })
    },

    saveSection(id, section, content) {
      if (!SECTION_KEYS.includes(section) || typeof content !== 'string') {
        throw invalidInput('Invalid blueprint section.')
      }
      return update(id, (project) => {
        if (project.blueprint === null) {
          throw new ProjectStoreError('NO_BLUEPRINT', 'Generate a blueprint before editing sections.')
        }
        project.blueprint.sections[section] = content
      })
    },

    delete(id) {
      validateId(id)
      return serialize(id, async () => {
        const project = await readProject(id)
        try {
          await filesystem.unlink(projectPath(id))
        } catch (error) {
          if (error.code === 'ENOENT') {
            throw new ProjectStoreError('NOT_FOUND', 'Project not found.')
          }
          throw storageError()
        }
        return project
      })
    },
  }
}

module.exports = { createProjectStore, ProjectStoreError, SCHEMA_VERSION, SECTION_KEYS }
