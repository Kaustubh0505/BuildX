const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { MongoClient } = require('mongodb')
const { createApi } = require('../app.cjs')
const PASSWORD = 'correct horse battery staple'

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}
async function startFixture(options = {}) {
  let directory, mongo, mongoError
  let uri = process.env.MONGODB_TEST_URI
  if (!uri) {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'buildx-mongo-'))
    const port = await freePort()
    uri = `mongodb://127.0.0.1:${port}`
    mongo = spawn(process.env.MONGOD_BINARY || 'mongod', ['--dbpath', directory, '--bind_ip', '127.0.0.1', '--port', String(port), '--quiet', '--logpath', path.join(directory, 'mongo.log')], { stdio: 'ignore' })
    mongo.on('error', (error) => { mongoError = error })
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 500, connectTimeoutMS: 500 })
  let connected = false
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (mongoError || (mongo && mongo.exitCode !== null)) break
    try { await client.connect(); connected = true; break } catch { await new Promise((resolve) => setTimeout(resolve, 100)) }
  }
  if (!connected) {
    await client.close().catch(() => {})
    if (mongo && mongo.exitCode === null) mongo.kill('SIGTERM')
    if (directory) await fs.rm(directory, { recursive: true, force: true })
    throw new Error('Test MongoDB did not start. Install mongod or set MONGODB_TEST_URI to a disposable test database server.')
  }
  const db = client.db(`buildx_test_${randomUUID().replaceAll('-', '')}`)
  const api = await createApi({ db, ...options })
  const http = api.listen(0, '127.0.0.1')
  await new Promise((resolve) => http.once('listening', resolve))
  const url = `http://127.0.0.1:${http.address().port}`
  async function call(route, { method = 'GET', body, token } = {}) {
    const response = await fetch(`${url}/api${route}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, ...await response.json() }
  }
  async function account(email = `${randomUUID()}@example.com`, name = 'Test Developer') {
    const created = await call('/auth/signup', { method: 'POST', body: { name, email, password: PASSWORD } })
    if (!created.ok) throw new Error(created.message)
    const signedIn = await call('/auth/login', { method: 'POST', body: { email, password: PASSWORD } })
    if (!signedIn.ok) throw new Error(signedIn.message)
    return { ...signedIn, email, password: PASSWORD }
  }
  async function close() {
    await new Promise((resolve) => http.close(resolve))
    await db.dropDatabase()
    await client.close()
    if (mongo && mongo.exitCode === null) await new Promise((resolve) => { mongo.once('exit', resolve); mongo.kill('SIGTERM') })
    if (directory) await fs.rm(directory, { recursive: true, force: true })
  }
  return { db, url, http, call, account, close }
}
module.exports = { startFixture, PASSWORD }
