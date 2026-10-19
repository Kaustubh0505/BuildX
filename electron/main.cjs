const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')
const { createProjectStore, ProjectStoreError } = require('./project-store.cjs')

app.setName('BuildX')

const unavailable = () => ({
  ok: false,
  code: 'NOT_AVAILABLE_YET',
  message: 'This feature is not available yet.',
})

ipcMain.handle('generation:set-api-key', unavailable)
ipcMain.handle('generation:clear-api-key', unavailable)
ipcMain.handle('generation:generate', unavailable)
ipcMain.handle('exports:markdown', unavailable)
ipcMain.handle('exports:pdf', unavailable)

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
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
