const express = require('express')
const helmet = require('helmet')
const bcrypt = require('bcrypt')
const { z } = require('zod')
const { randomUUID, randomBytes, createHash } = require('node:crypto')
const { createGenerationService, GenerationError } = require('./generation.cjs')
const { ProjectStoreError } = require('../electron/project-store.cjs')
const { SECTION_KEYS } = require('../electron/project-store.cjs')

const SESSION_MS = 7 * 24 * 60 * 60 * 1000
const digest = (value) => createHash('sha256').update(value).digest('hex')
const email = z.string().trim().toLowerCase().max(254).email('Enter a valid email address.')
const password = z.string().min(1, 'Enter your password.')
// Domain separation keeps this prehash specific to BuildX. Bcrypt always receives 44 bytes.
const passwordMaterial = (value) => createHash('sha256').update('BuildX password v1\0').update(value, 'utf8').digest('base64')
const signup = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(100).refine((v) => !/[\u0000-\u001f\u007f]/.test(v), 'Enter a valid name.'),
  email,
  password,
}).strict()
const login = z.object({ email, password }).strict()
const text = z.string().max(50000)
const draft = z.object({ title: z.string().trim().max(120), problem: text, desiredFeatures: text, constraints: text }).strict()
const sections = z.object(Object.fromEntries(SECTION_KEYS.map((key) => [key, z.string().max(100000)]))).strict()
const version = z.number().int().positive()
const uuid = z.string().uuid()
const importedProject = z.object({
  id: uuid, schemaVersion: z.literal(1), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  title: z.string().max(120), input: draft.omit({ title: true }),
  blueprint: z.object({ generatedAt: z.string().datetime(), sections }).strict().nullable(),
}).strict()

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}
function parse(schema, data) {
  const result = schema.safeParse(data)
  if (!result.success) {
    const error = new ApiError(400, 'INVALID_INPUT', 'Check the highlighted fields.')
    error.fields = Object.fromEntries(result.error.issues.map((issue) => [issue.path[0] || 'form', issue.message]))
    throw error
  }
  return result.data
}
const publicUser = (user) => ({ id: user._id, name: user.name, email: user.email })
const publicProject = ({ _id, ownerId, ...project }) => project

async function createApi({ db, now = () => new Date(), rateLimits = true, groqApiKey = '', groqSectionKeys = {}, createGroqClient }) {
  const users = db.collection('users')
  const sessions = db.collection('sessions')
  const projects = db.collection('projects')
  const attempts = db.collection('authAttempts')
  const generationLocks = db.collection('generationLocks')
  const generation = createGenerationService({ store: null, apiKey: groqApiKey, sectionApiKeys: groqSectionKeys, ...(createGroqClient ? { createClient: createGroqClient } : {}) })
  await Promise.all([
    users.createIndex({ email: 1 }, { unique: true }),
    sessions.createIndex({ tokenHash: 1 }, { unique: true }),
    sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    projects.createIndex({ ownerId: 1, id: 1 }, { unique: true }),
    projects.createIndex({ ownerId: 1, updatedAt: -1 }),
    attempts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    generationLocks.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ])
  const dummyHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12)
  const app = express()
  app.disable('x-powered-by')
  // Trust no forwarded IP headers by default. A deployment may specify its exact proxy hop count.
  if (process.env.TRUST_PROXY_HOPS) app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS))
  app.use(helmet())
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  app.use(express.json({ limit: '2mb', strict: true }))

  async function limit(key, max, windowMs) {
    if (!rateLimits) return
    const bucket = Math.floor(now().getTime() / windowMs)
    const _id = digest(`${key}:${bucket}`)
    let record
    try {
      record = await attempts.findOneAndUpdate({ _id }, {
        $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 1) * windowMs) },
      }, { upsert: true, returnDocument: 'after' })
    } catch (error) {
      if (error.code !== 11000) throw error
      record = await attempts.findOneAndUpdate({ _id }, { $inc: { count: 1 } }, { returnDocument: 'after' })
    }
    if (record.count > max) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a while, then try again.')
  }
  async function auth(req, _res, next) {
    const token = /^Bearer ([a-f0-9]{64})$/.exec(req.get('authorization') || '')?.[1]
    if (!token) throw new ApiError(401, 'AUTH_REQUIRED', 'Sign in to continue.')
    const session = await sessions.findOne({ tokenHash: digest(token), expiresAt: { $gt: now() } })
    if (!session) throw new ApiError(401, 'AUTH_REQUIRED', 'Your session expired. Sign in again.')
    const user = await users.findOne({ _id: session.userId })
    if (!user) throw new ApiError(401, 'AUTH_REQUIRED', 'Sign in to continue.')
    req.user = user
    req.session = session
    next()
  }
  async function startSession(user) {
    const token = randomBytes(32).toString('hex')
    const createdAt = now()
    const expiresAt = new Date(createdAt.getTime() + SESSION_MS)
    await sessions.insertOne({ userId: user._id, tokenHash: digest(token), createdAt, expiresAt })
    return { user: publicUser(user), token, expiresAt: expiresAt.toISOString() }
  }
  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.post('/api/auth/signup', async (req, res) => {
    await limit(`signup:${req.ip}`, 10, 60 * 60 * 1000)
    const input = parse(signup, req.body)
    const timestamp = now()
    const user = { _id: randomUUID(), name: input.name, email: input.email, passwordHash: await bcrypt.hash(passwordMaterial(input.password), 12), passwordScheme: 'bcrypt-sha256-v1', createdAt: timestamp, updatedAt: timestamp }
    try { await users.insertOne(user) } catch (error) {
      if (error.code === 11000) throw new ApiError(409, 'EMAIL_EXISTS', 'An account with this email already exists. Sign in instead.')
      throw error
    }
    res.status(201).json({ ok: true, ...await startSession(user) })
  })
  app.post('/api/auth/login', async (req, res) => {
    await limit(`login-ip:${req.ip}`, 60, 15 * 60 * 1000)
    const input = parse(login, req.body)
    await limit(`login-email:${input.email}`, 10, 15 * 60 * 1000)
    const user = await users.findOne({ email: input.email })
    const legacy = user && !user.passwordScheme
    const candidate = legacy ? input.password : passwordMaterial(input.password)
    const matches = await bcrypt.compare(candidate, user?.passwordHash || dummyHash) && !(legacy && Buffer.byteLength(input.password, 'utf8') > 72)
    if (!user || !matches) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.')
    if (legacy) await users.updateOne({ _id: user._id, passwordHash: user.passwordHash }, { $set: { passwordHash: await bcrypt.hash(passwordMaterial(input.password), 12), passwordScheme: 'bcrypt-sha256-v1', updatedAt: now() } })
    res.json({ ok: true, ...await startSession(user) })
  })
  app.get('/api/auth/me', auth, (req, res) => res.json({ ok: true, user: publicUser(req.user) }))
  app.post('/api/auth/logout', auth, async (req, res) => {
    await sessions.deleteOne({ _id: req.session._id })
    res.json({ ok: true })
  })
  app.use('/api/projects', auth)
  app.get('/api/projects', async (req, res) => {
    const values = await projects.find({ ownerId: req.user._id }).sort({ updatedAt: -1, id: 1 }).toArray()
    res.json({ ok: true, projects: values.map((p) => ({ id: p.id, title: p.title, createdAt: p.createdAt, updatedAt: p.updatedAt, version: p.version, hasBlueprint: p.blueprint !== null })), warnings: [] })
  })
  app.post('/api/projects', async (req, res) => {
    const input = parse(draft.partial(), req.body)
    const timestamp = now().toISOString()
    const project = { ownerId: req.user._id, id: randomUUID(), schemaVersion: 1, version: 1, createdAt: timestamp, updatedAt: timestamp, title: input.title || '', input: { problem: input.problem || '', desiredFeatures: input.desiredFeatures || '', constraints: input.constraints || '' }, blueprint: null }
    await projects.insertOne(project)
    res.status(201).json({ ok: true, project: publicProject(project) })
  })
  app.post('/api/projects/import', async (req, res) => {
    const project = parse(importedProject, req.body)
    const filter = { ownerId: req.user._id, id: project.id }
    let result
    try { result = await projects.updateOne(filter, { $setOnInsert: { ...project, ownerId: req.user._id, version: 1 } }, { upsert: true }) } catch (error) {
      if (error.code !== 11000) throw error
      result = { upsertedCount: 0 }
    }
    res.json({ ok: true, imported: result.upsertedCount === 1, project: publicProject(await projects.findOne(filter)) })
  })
  app.param('id', (req, _res, next, id) => { parse(uuid, id); next() })
  app.get('/api/projects/:id', async (req, res) => {
    const project = await projects.findOne({ ownerId: req.user._id, id: req.params.id })
    if (!project) throw new ApiError(404, 'NOT_FOUND', 'Project not found.')
    res.json({ ok: true, project: publicProject(project) })
  })
  async function mutate(req, update, remove = false) {
    const expectedVersion = parse(version, req.body?.version)
    const filter = { ownerId: req.user._id, id: req.params.id }
    if (!remove) {
      const project = await projects.findOneAndUpdate({ ...filter, version: expectedVersion }, {
        $set: { ...update, updatedAt: now().toISOString() }, $inc: { version: 1 },
      }, { returnDocument: 'after' })
      if (project) return publicProject(project)
    } else {
      const project = await projects.findOneAndDelete({ ...filter, version: expectedVersion })
      if (project) return publicProject(project)
    }
    if (await projects.findOne(filter, { projection: { _id: 1 } })) throw new ApiError(409, 'CONFLICT', 'This project changed on another device. Reload the saved copy before trying again.')
    throw new ApiError(404, 'NOT_FOUND', 'Project not found.')
  }
  app.post('/api/projects/:id/generate', async (req, res) => {
    const input = parse(z.object({ version }).strict(), req.body)
    const owner = { ownerId: req.user._id, id: req.params.id }
    const get = async () => {
      const project = await projects.findOne(owner)
      if (!project) throw new ApiError(404, 'NOT_FOUND', 'Project not found.')
      return publicProject(project)
    }
    const existing = await get()
    if (existing.version !== input.version) throw new ApiError(409, 'CONFLICT', 'This project changed on another device. Reload before generating.')
    if (!existing.title.trim() || !existing.input.problem.trim()) throw new ApiError(400, 'INCOMPLETE_BRIEF', 'Save a project title and problem before generating.')
    if (!generation.status().hasApiKey) throw new ApiError(503, 'GENERATION_UNAVAILABLE', 'Blueprint generation is temporarily unavailable. Please try again later.')
    const lockId = `${req.user._id}:${req.params.id}`
    const nonce = randomUUID()
    try {
      await generationLocks.findOneAndUpdate({ _id: lockId, expiresAt: { $lte: now() } }, { $set: { nonce, expiresAt: new Date(now().getTime() + 8 * 60 * 1000) } }, { upsert: true })
    } catch (error) {
      if (error.code === 11000) throw new ApiError(409, 'GENERATION_IN_PROGRESS', 'This project is already generating a blueprint.')
      throw error
    }
    try {
      await limit(`generation-user:${req.user._id}`, 10, 60 * 60 * 1000)
      await limit(`generation-ip:${req.ip}`, 30, 60 * 60 * 1000)
      const project = await generation.generate(req.params.id, input.version, {
        ownerId: req.user._id, get,
        saveBlueprint: async (_id, value) => mutate(req, { blueprint: { generatedAt: now().toISOString(), sections: value } }),
      })
      res.json({ ok: true, project })
    } finally { await generationLocks.deleteOne({ _id: lockId, nonce }) }
  })
  app.patch('/api/projects/:id/input', async (req, res) => {
    const { version: expected, ...body } = req.body || {}
    const input = parse(draft, body)
    res.json({ ok: true, project: await mutate(req, { title: input.title, input: { problem: input.problem, desiredFeatures: input.desiredFeatures, constraints: input.constraints } }) })
  })
  app.patch('/api/projects/:id/title', async (req, res) => {
    const input = parse(z.object({ title: z.string().trim().min(1).max(120), version }).strict(), req.body)
    res.json({ ok: true, project: await mutate(req, { title: input.title }) })
  })
  app.put('/api/projects/:id/blueprint', async (req, res) => {
    const input = parse(z.object({ sections, version }).strict(), req.body)
    res.json({ ok: true, project: await mutate(req, { blueprint: { generatedAt: now().toISOString(), sections: input.sections } }) })
  })
  app.patch('/api/projects/:id/sections/:section', async (req, res) => {
    if (!SECTION_KEYS.includes(req.params.section)) throw new ApiError(400, 'INVALID_INPUT', 'Invalid blueprint section.')
    const input = parse(z.object({ content: z.string().max(100000), version }).strict(), req.body)
    const project = await projects.findOne({ ownerId: req.user._id, id: req.params.id })
    if (!project) throw new ApiError(404, 'NOT_FOUND', 'Project not found.')
    if (!project.blueprint) throw new ApiError(400, 'NO_BLUEPRINT', 'Generate a blueprint before editing sections.')
    res.json({ ok: true, project: await mutate(req, { [`blueprint.sections.${req.params.section}`]: input.content }) })
  })
  app.delete('/api/projects/:id', async (req, res) => {
    parse(z.object({ version }).strict(), req.body)
    res.json({ ok: true, project: await mutate(req, null, true) })
  })
  app.use((_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Endpoint not found.')))
  app.use((error, _req, res, _next) => {
    if (error instanceof GenerationError || error instanceof ProjectStoreError) return res.status(({ CONFLICT: 409, INCOMPLETE_BRIEF: 400, GROQ_QUOTA_EXCEEDED: 429, GROQ_UNAVAILABLE: 503, GROQ_CONFIGURATION_ERROR: 503, GENERATION_TIMEOUT: 504 })[error.code] || 502).json({ ok: false, code: error.code, message: error.message })
    if (error instanceof ApiError) return res.status(error.status).json({ ok: false, code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) })
    if (error.type === 'entity.too.large') return res.status(413).json({ ok: false, code: 'REQUEST_TOO_LARGE', message: 'This request is too large.' })
    if (error.type === 'entity.parse.failed') return res.status(400).json({ ok: false, code: 'INVALID_INPUT', message: 'Invalid JSON request.' })
    // Deliberately avoid logging request bodies, credentials, connection strings, or driver errors.
    res.status(503).json({ ok: false, code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable. Please try again.' })
  })
  return app
}
module.exports = { createApi, SESSION_MS, digest, passwordMaterial }
