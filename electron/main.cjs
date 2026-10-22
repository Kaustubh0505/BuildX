const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron')
const { ProjectStoreError } = require('./project-store.cjs')
const { createCloudClient, CloudError } = require('./cloud-client.cjs')
const { createGenerationService, GenerationError } = require('./generation.cjs')
const { createExportService, ExportError } = require('./exports.cjs')

app.setName('BuildX')

// Let desktop tests use disposable project data without touching a user's files.
if (process.env.BUILDX_E2E === '1' && process.env.BUILDX_E2E_USER_DATA) {
  const directory = process.env.BUILDX_E2E_USER_DATA
  if (!path.isAbsolute(directory)) throw new Error('Test user data path must be absolute')
  fs.mkdirSync(directory, { recursive: true })
  app.setPath('userData', directory)
}

function registerCloudHandlers(cloud) {
  const generation = createGenerationService({ store: null })
  let activeOperations = 0
  let authBusy = false
  const notifyExpired = () => {
    generation.clearApiKey()
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
    if ([CloudError, ProjectStoreError, GenerationError, ExportError].some((Type) => error instanceof Type)) return { ok: false, code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) }
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
        if (method === 'logout') generation.clearApiKey()
        return { ok: true, ...result }
      } catch (error) { return failure(error) } finally { authBusy = false }
    })
  }
  for (const [method, channel, key] of [
    ['list', 'list', null], ['create', 'create', 'project'], ['get', 'get', 'project'],
    ['rename', 'rename', 'project'], ['delete', 'delete', 'project'], ['saveInput', 'save-input', 'project'],
    ['saveSection', 'save-section', 'project'],
  ]) handle(`projects:${channel}`, async (_event, ...args) => {
    return cloud.scope().store[method](...args)
  }, key)
  for (const method of ['status', 'setApiKey', 'clearApiKey']) {
    const channel = { status: 'status', setApiKey: 'set-api-key', clearApiKey: 'clear-api-key' }[method]
    handle(`generation:${channel}`, async (_event, ...args) => { await cloud.status(); return generation[method](...args) }, 'status')
  }
  handle('generation:generate', (_event, id, version) => {
    if (!Number.isSafeInteger(version) || version < 1) throw new CloudError('INVALID_INPUT', 'Reload the project before generating.')
    return generation.generate(id, version, cloud.scope().store)
  }, 'project')
  for (const format of ['markdown', 'pdf']) handle(`exports:${format}`, (event, id) => {
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
