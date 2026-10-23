const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } = require('electron')
const { createServer } = require('node:http')
const { URL } = require('node:url')
const { ProjectStoreError } = require('./project-store.cjs')
const { createCloudClient, CloudError } = require('./cloud-client.cjs')
const { createExportService, ExportError } = require('./exports.cjs')

// ─── Environment configuration ─────────────────────────────────────────────
// Load environment variables from .env files (.env in workspace root, then server/.env)
try {
  const dotenv = require('dotenv')
  dotenv.config({ path: path.join(__dirname, '..', '.env') })
  dotenv.config({ path: path.join(__dirname, '..', 'server', '.env') })
} catch (_) {
  if (typeof process.loadEnvFile === 'function') {
    for (const envPath of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', 'server', '.env')]) {
      try { process.loadEnvFile(envPath) } catch (_) {}
    }
  }
}

// ─── Google OAuth helpers (Authorization Code + PKCE) ──────────────────────
// Redirect URI — must be registered in Google Cloud Console as-is.
const GOOGLE_REDIRECT_URI = 'http://127.0.0.1:42813/oauth/callback'

function getGoogleCredentials() {
  const config = (() => {
    try { return require('../buildx.config.json') } catch { return {} }
  })()
  const clientId = process.env.GOOGLE_CLIENT_ID || config.googleClientId || ''
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || config.googleClientSecret || ''
  return { clientId, clientSecret }
}

/**
 * Generate a PKCE code_verifier and its SHA-256 code_challenge (base64url).
 */
function generatePKCE() {
  const crypto = require('node:crypto')
  const verifier = crypto.randomBytes(32).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

/**
 * Open the Google consent page in the user's default browser using the
 * Authorization Code + PKCE flow, wait for the callback on a local HTTP
 * server, then exchange the code for tokens at Google's token endpoint.
 * Returns the `id_token` JWT string.
 */
function googleOAuthFlow() {
  return new Promise((resolve, reject) => {
    const { clientId, clientSecret } = getGoogleCredentials()
    if (!clientId) {
      return reject(new CloudError('MISSING_CONFIG', 'GOOGLE_CLIENT_ID is not configured. Add it to your .env file or environment.'))
    }
    if (!clientSecret) {
      return reject(new CloudError('MISSING_CONFIG', 'GOOGLE_CLIENT_SECRET is not configured. Add it to your .env file or environment.'))
    }

    const crypto = require('node:crypto')
    const { verifier, challenge } = generatePKCE()
    const state = crypto.randomBytes(16).toString('hex')

    // 1. Build the Authorization URL (response_type=code — the only type
    //    Google still supports for desktop/native apps).
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', GOOGLE_REDIRECT_URI)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', 'openid email profile')
    authUrl.searchParams.set('code_challenge', challenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('access_type', 'online')
    authUrl.searchParams.set('prompt', 'select_account')

    // 2. One-shot local HTTP server to receive the authorization code.
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      if (url.pathname !== '/oauth/callback') { res.writeHead(404); res.end(); return }

      const code = url.searchParams.get('code')
      const returnedState = url.searchParams.get('state')
      const errorParam = url.searchParams.get('error')

      // Always respond to the browser first so it doesn't hang.
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`<!DOCTYPE html><html><head><title>BuildX</title>
        <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f7fa}
        .card{text-align:center;padding:40px;border-radius:12px;background:#fff;box-shadow:0 2px 12px #0001;max-width:380px}
        h2{margin:0 0 10px;color:#203855;font-size:22px}p{color:#5a6a7a;margin:0;font-size:14px}</style></head>
        <body><div class="card"><h2>${errorParam ? '⚠ Sign-in failed' : '✓ Signed in!'}</h2>
        <p>${errorParam ? 'An error occurred. You can close this tab.' : 'You are signed in to BuildX. You can close this tab.'}</p></div></body></html>`)
      server.close()

      if (errorParam) return reject(new CloudError('OAUTH_DENIED', `Google sign-in was cancelled or denied: ${errorParam}`))
      if (returnedState !== state) return reject(new CloudError('OAUTH_STATE_MISMATCH', 'OAuth state mismatch. Please try signing in again.'))
      if (!code) return reject(new CloudError('OAUTH_NO_CODE', 'Google did not return an authorization code.'))

      // 3. Exchange the authorization code for tokens at Google's token endpoint.
      try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: GOOGLE_REDIRECT_URI,
            grant_type: 'authorization_code',
            code_verifier: verifier,
          }),
          signal: AbortSignal.timeout(15000),
        })
        const tokens = await tokenRes.json()
        if (!tokenRes.ok || !tokens.id_token) {
          return reject(new CloudError('OAUTH_TOKEN_EXCHANGE_FAILED', tokens.error_description || 'Could not exchange the Google authorization code.'))
        }
        resolve(tokens.id_token)
      } catch (err) {
        reject(new CloudError('OAUTH_TOKEN_EXCHANGE_FAILED', `Token exchange failed: ${err.message}`))
      }
    })

    server.listen(42813, '127.0.0.1', () => {
      shell.openExternal(authUrl.toString())
    })
    server.on('error', (err) => reject(new CloudError('OAUTH_SERVER_ERROR', `Could not start the OAuth callback server: ${err.message}`)))

    // Time out after 5 minutes if the user does not complete the flow.
    const timeout = setTimeout(() => {
      server.close()
      reject(new CloudError('OAUTH_TIMEOUT', 'Google sign-in timed out. Please try again.'))
    }, 5 * 60 * 1000)
    server.on('close', () => clearTimeout(timeout))
  })
}

app.setName('BuildX')

// Let desktop tests use disposable project data without touching a user's files.
if (process.env.BUILDX_E2E === '1' && process.env.BUILDX_E2E_USER_DATA) {
  const directory = process.env.BUILDX_E2E_USER_DATA
  if (!path.isAbsolute(directory)) throw new Error('Test user data path must be absolute')
  fs.mkdirSync(directory, { recursive: true })
  app.setPath('userData', directory)
}

function registerCloudHandlers(cloud) {
  let activeOperations = 0
  let authBusy = false
  const notifyExpired = () => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('auth:expired')
  }
  const trusted = (event) => {
    const { pathToFileURL } = require('node:url')
    const expected = process.env.ELECTRON_RENDERER_URL
      ? new URL(process.env.ELECTRON_RENDERER_URL).href
      : pathToFileURL(path.join(__dirname, '..', 'dist', 'renderer', 'index.html')).href
    return event.senderFrame === event.sender.mainFrame && event.senderFrame.url === expected
  }
  const failure = (error) => {
    if (error.code === 'AUTH_REQUIRED') notifyExpired()
    if ([CloudError, ProjectStoreError, ExportError].some((Type) => error instanceof Type)) return { ok: false, code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) }
    return { ok: false, code: 'ACTION_FAILED', message: 'Could not complete this action. Please try again.' }
  }
  const handle = (channel, action, resultKey, authenticated = true) => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!trusted(event)) return { ok: false, code: 'FORBIDDEN', message: 'Request not allowed.' }
      if (authBusy) return { ok: false, code: 'BUSY', message: 'Wait for sign-in to finish.' }
      activeOperations += 1
      try {
        if (authenticated) await cloud.requireSession()
        const result = await action(event, ...args)
        return resultKey ? { ok: true, [resultKey]: result } : { ok: true, ...result }
      } catch (error) { return failure(error) } finally { activeOperations -= 1 }
    })
  }
  for (const method of ['signup', 'login', 'logout', 'status']) {
    ipcMain.handle(`auth:${method}`, async (event, ...args) => {
      if (!trusted(event)) return { ok: false, code: 'FORBIDDEN', message: 'Request not allowed.' }
      if (authBusy || activeOperations) return { ok: false, code: 'BUSY', message: 'Wait for the current action to finish.' }
      authBusy = true
      try {
        const result = await cloud[method](...args)
        return { ok: true, ...result }
      } catch (error) { return failure(error) } finally { authBusy = false }
    })
  }

  // Google OAuth — opens the system browser, waits for the redirect, then
  // exchanges the id_token with the BuildX backend.
  ipcMain.handle('auth:google-login', async (event) => {
    if (!trusted(event)) return { ok: false, code: 'FORBIDDEN', message: 'Request not allowed.' }
    if (authBusy || activeOperations) return { ok: false, code: 'BUSY', message: 'Wait for the current action to finish.' }
    authBusy = true
    try {
      const idToken = await googleOAuthFlow()
      const result = await cloud.loginWithGoogle(idToken)
      return { ok: true, ...result }
    } catch (error) { return failure(error) } finally { authBusy = false }
  })
  for (const [method, channel, key] of [
    ['list', 'list', null], ['create', 'create', 'project'], ['get', 'get', 'project'],
    ['rename', 'rename', 'project'], ['delete', 'delete', 'project'], ['saveInput', 'save-input', 'project'],
    ['saveSection', 'save-section', 'project'],
  ]) handle(`projects:${channel}`, async (_event, ...args) => {
    return cloud.scope().store[method](...args)
  }, key)
  handle('generation:generate', (_event, id, version) => cloud.scope().store.generate(id, version), 'project')
  for (const format of ['markdown', 'pdf', 'prompt']) handle(`exports:${format}`, (event, id) => {
    const service = createExportService({ store: cloud.scope().store, showSaveDialog: (window, options) => dialog.showSaveDialog(window, options) })
    return service[format](id, BrowserWindow.fromWebContents(event.sender))
  })
}

function createWindow() {
  const window = new BrowserWindow({
    title: 'BuildX',
    width: 1180,
    height: 760,
    minWidth: 680,
    minHeight: 520,
    backgroundColor: '#f5f7fa',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    const url = new URL(rendererUrl)
    if (url.origin !== 'http://127.0.0.1:5173') {
      throw new Error('Unexpected development renderer URL')
    }
    window.loadURL(url.toString())
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'))
  }
}

app.whenReady().then(() => {
  const config = require('../buildx.config.json')
  const cloud = createCloudClient({
    apiUrl: process.env.BUILDX_API_URL || config.apiUrl,
    sessionFile: path.join(app.getPath('userData'), 'auth-session.enc'),
    secureStorage: safeStorage,
    localDirectory: path.join(app.getPath('userData'), 'projects'),
  })
  registerCloudHandlers(cloud)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch(() => {
  dialog.showErrorBox('BuildX could not start', 'Check the BuildX API origin in buildx.config.json or BUILDX_API_URL. Use HTTPS, or HTTP on loopback for local development.')
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
