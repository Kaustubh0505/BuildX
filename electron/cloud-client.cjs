const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { createProjectStore } = require('./project-store.cjs')

class CloudError extends Error {
  constructor(code, message, fields) { super(message); this.code = code; this.fields = fields }
}
function validateApiUrl(value) {
  const url = new URL(value)
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('BuildX API must use HTTPS, or HTTP on loopback for local development, with no path or credentials.')
  return url.origin
}
async function atomicSession(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  let handle
  try {
    handle = await fs.open(temporary, 'wx', 0o600)
    await handle.writeFile(content)
    await handle.sync()
    await handle.close()
    handle = null
    await fs.rename(temporary, file)
  } finally {
    if (handle) await handle.close().catch(() => {})
    await fs.unlink(temporary).catch(() => {})
  }
}
function createCloudClient({ apiUrl, sessionFile, secureStorage, localDirectory, fetchImpl = fetch, now = () => Date.now() }) {
  const baseUrl = validateApiUrl(apiUrl)
  const connectionMessage = new URL(baseUrl).protocol === 'http:'
    ? 'Cannot connect to the local BuildX API. Start the API server and try again.'
    : 'Cannot connect to BuildX. Check your internet connection and try again.'
  let token = null
  let user = null
  let expiresAt = null
  let epoch = 0
  let initialized = false
  let initializing
  let persistenceWarning = ''
  const local = createProjectStore({ directory: localDirectory })
  const migrationDirectory = path.join(path.dirname(sessionFile), 'legacy-migration')
  let migrationPending

  async function migrateLegacyProjects(call) {
    if (migrationPending) return migrationPending
    migrationPending = (async () => {
      const { user: account } = await call('/api/auth/me')
      const ownerFile = path.join(migrationDirectory, 'owner.json')
      try {
        const existing = JSON.parse(await fs.readFile(ownerFile, 'utf8'))
        if (existing.userId !== account.id) return []
      } catch (error) { if (error.code !== 'ENOENT') throw error }
      const listing = await local.list()
      if (!listing.projects.length) return listing.warnings
      await fs.mkdir(migrationDirectory, { recursive: true, mode: 0o700 })
      try {
        const handle = await fs.open(ownerFile, 'wx', 0o600)
        try { await handle.writeFile(JSON.stringify({ userId: account.id })); await handle.sync() } finally { await handle.close() }
      } catch (error) { if (error.code !== 'EEXIST') throw error }
      const owner = JSON.parse(await fs.readFile(ownerFile, 'utf8'))
      if (owner.userId !== account.id) return []
      const warnings = [...listing.warnings]
      for (const summary of listing.projects) {
        const receipt = path.join(migrationDirectory, `${summary.id}.done`)
        try {
          try { await fs.access(receipt); continue } catch (error) { if (error.code !== 'ENOENT') throw error }
          const project = await local.get(summary.id)
          await call('/api/projects/import', { method: 'POST', body: project })
          await atomicSession(receipt, JSON.stringify({ userId: account.id, projectId: summary.id }))
        } catch (error) {
          if (['AUTH_REQUIRED', 'ACCOUNT_CHANGED', 'CONNECTION_FAILED', 'SERVICE_UNAVAILABLE'].includes(error.code)) throw error
          warnings.push({ fileName: `${summary.id}.json`, code: error.code || 'MIGRATION_FAILED' })
        }
      }
      return warnings
    })().finally(() => { migrationPending = null })
    return migrationPending
  }
  async function clear() {
    persistenceWarning = ''
    token = null; user = null; expiresAt = null; epoch += 1
    await fs.unlink(sessionFile).catch((error) => { if (error.code !== 'ENOENT') persistenceWarning = 'Could not remove the saved sign-in on this device.' })
  }
  async function initialize() {
    if (initialized) return
    if (!initializing) initializing = (async () => {
      try {
        if (!secureStorage?.isEncryptionAvailable()) { await clear(); return }
        const saved = JSON.parse(secureStorage.decryptString(await fs.readFile(sessionFile)))
        if (saved.apiUrl === baseUrl && /^[a-f0-9]{64}$/.test(saved.token) && Date.parse(saved.expiresAt) > now()) {
          token = saved.token; expiresAt = saved.expiresAt
        } else await clear()
      } catch { await clear() } finally { initialized = true }
    })()
    await initializing
  }
  async function request(route, { method = 'GET', body, session, expectedEpoch, timeoutMs = 15000 } = {}) {
    if (expectedEpoch !== undefined && expectedEpoch !== epoch) throw new CloudError('ACCOUNT_CHANGED', 'Account changed. Try again from your current workspace.')
    let response, result
    try {
      response = await fetchImpl(`${baseUrl}${route}`, {
        method, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
      })
      result = await response.json()
    } catch { throw new CloudError('CONNECTION_FAILED', connectionMessage) }
    if (expectedEpoch !== undefined && expectedEpoch !== epoch) throw new CloudError('ACCOUNT_CHANGED', 'Account changed. Try again from your current workspace.')
    if (!response.ok || !result?.ok) {
      if (result?.code === 'AUTH_REQUIRED' && session === token) await clear()
      throw new CloudError(result?.code || 'SERVER_ERROR', result?.message || 'The server could not complete this action.', result?.fields)
    }
    return result
  }
  async function requireSession() {
    await initialize()
    if (!token || Date.parse(expiresAt) <= now()) {
      await clear()
      throw new CloudError('AUTH_REQUIRED', 'Sign in to continue.')
    }
  }
  function scope() {
    const session = token
    const expectedEpoch = epoch
    if (!session) throw new CloudError('AUTH_REQUIRED', 'Sign in to continue.')
    const call = (route, options = {}) => request(route, { ...options, session, expectedEpoch })
    const projectRoute = (id) => {
      if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new CloudError('INVALID_INPUT', 'Invalid project ID.')
      return `/api/projects/${encodeURIComponent(id)}`
    }
    const withVersion = (version, extra = {}) => {
      if (!Number.isSafeInteger(version) || version < 1) throw new CloudError('INVALID_INPUT', 'Reload this project before saving it.')
      return { ...extra, version }
    }
    const store = {
      list: async () => {
        const warnings = await migrateLegacyProjects(call)
        const listing = await call('/api/projects')
        return { ...listing, warnings: [...(listing.warnings || []), ...warnings] }
      },
      create: async (input = {}) => (await call('/api/projects', { method: 'POST', body: input })).project,
      get: async (id) => (await call(projectRoute(id))).project,
      rename: async (id, title, version) => (await call(`${projectRoute(id)}/title`, { method: 'PATCH', body: withVersion(version, { title }) })).project,
      delete: async (id, version) => (await call(projectRoute(id), { method: 'DELETE', body: withVersion(version) })).project,
      saveInput: async (id, input, version) => (await call(`${projectRoute(id)}/input`, { method: 'PATCH', body: withVersion(version, input) })).project,
      saveSection: async (id, section, content, version) => (await call(`${projectRoute(id)}/sections/${encodeURIComponent(section)}`, { method: 'PATCH', body: withVersion(version, { content }) })).project,
      generate: async (id, version) => (await call(`${projectRoute(id)}/generate`, { method: 'POST', body: withVersion(version), timeoutMs: 150000 })).project,
      saveBlueprint: async (id, sections, version) => (await call(`${projectRoute(id)}/blueprint`, { method: 'PUT', body: withVersion(version, { sections }) })).project,

    }
    return { store, user }
  }
  return {
    requireSession, scope,
    async status() {
      await initialize()
      if (!token) return { user: null }
      await requireSession()
      const result = await request('/api/auth/me', { session: token, expectedEpoch: epoch })
      user = result.user
      return { user, expiresAt, warning: persistenceWarning }
    },
    async signup(input) { return request('/api/auth/signup', { method: 'POST', body: input }) },
    async login(input) {
      await initialize()
      if (token) throw new CloudError('ALREADY_SIGNED_IN', 'Sign out before switching accounts.')
      const result = await request('/api/auth/login', { method: 'POST', body: input })
      token = result.token; user = result.user; expiresAt = result.expiresAt; epoch += 1
      persistenceWarning = ''
      try {
        if (!secureStorage?.isEncryptionAvailable()) throw new Error('Encryption unavailable')
        await atomicSession(sessionFile, secureStorage.encryptString(JSON.stringify({ apiUrl: baseUrl, token, expiresAt })))
      } catch { persistenceWarning = 'Signed in for this app session. Secure storage was unavailable, so you will need to sign in after closing BuildX.' }
      return { user, expiresAt, warning: persistenceWarning }
    },
    async logout() {
      await initialize()
      let warning = ''
      try { if (token) await request('/api/auth/logout', { method: 'POST', session: token, expectedEpoch: epoch }) } catch (error) {
        if (error.code !== 'AUTH_REQUIRED') warning = 'Signed out on this device. The server could not be reached to revoke the session; it will expire automatically.'
      } finally { await clear() }
      return { user: null, warning: warning || persistenceWarning }
    },
  }
}
module.exports = { createCloudClient, CloudError, validateApiUrl }
