const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const { createProjectStore, ProjectStoreError } = require('./project-store.cjs')
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

function registerExportHandlers(service) {
  for (const format of ['markdown', 'pdf']) {
    ipcMain.handle(`exports:${format}`, async (event, id) => {
      try {
        const window = BrowserWindow.fromWebContents(event.sender)
        const result = await service[format](id, window)
        return { ok: true, ...result }
      } catch (error) {
        if (error instanceof ExportError || error instanceof ProjectStoreError) {
          return { ok: false, code: error.code, message: error.message }
        }
        return { ok: false, code: 'EXPORT_ERROR', message: 'Could not export the blueprint.' }
      }
    })
  }
}

function registerGenerationHandlers(service) {
  const handle = (channel, method, resultKey) => {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        const result = await service[method](...args)
        return { ok: true, [resultKey]: result }
      } catch (error) {
        if (error instanceof GenerationError || error instanceof ProjectStoreError) {
          return { ok: false, code: error.code, message: error.message }
        }
        return { ok: false, code: 'GENERATION_ERROR', message: 'Blueprint generation is unavailable.' }
      }
    })
  }
  handle('generation:status', 'status', 'status')
  handle('generation:set-api-key', 'setApiKey', 'status')
  handle('generation:clear-api-key', 'clearApiKey', 'status')
  handle('generation:generate', 'generate', 'project')
}

function registerProjectHandlers(store) {
  const handle = (channel, method, resultKey) => {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        const result = await store[method](...args)
        return resultKey ? { ok: true, [resultKey]: result } : { ok: true, ...result }
      } catch (error) {
        if (error instanceof ProjectStoreError) {
          return { ok: false, code: error.code, message: error.message }
        }
        return { ok: false, code: 'STORAGE_ERROR', message: 'Project storage is unavailable.' }
      }
    })
  }

  handle('projects:list', 'list')
  handle('projects:create', 'create', 'project')
  handle('projects:get', 'get', 'project')
  handle('projects:rename', 'rename', 'project')
  handle('projects:delete', 'delete', 'project')
  handle('projects:save-input', 'saveInput', 'project')
  handle('projects:save-section', 'saveSection', 'project')
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
  const store = createProjectStore({ directory: path.join(app.getPath('userData'), 'projects') })
  registerProjectHandlers(store)
  registerGenerationHandlers(createGenerationService({ store }))
  registerExportHandlers(createExportService({ store, showSaveDialog: (window, options) => dialog.showSaveDialog(window, options) }))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
