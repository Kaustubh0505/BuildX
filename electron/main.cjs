const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')

const unavailable = () => ({
  ok: false,
  code: 'NOT_AVAILABLE_YET',
  message: 'This feature is not available yet.',
})

// Keep one explicit handler per public action. Later milestones will replace
// these responses with validated project, generation, and export operations.
ipcMain.handle('projects:list', unavailable)
ipcMain.handle('projects:create', unavailable)
ipcMain.handle('projects:get', unavailable)
ipcMain.handle('projects:rename', unavailable)
ipcMain.handle('projects:delete', unavailable)
ipcMain.handle('projects:save-input', unavailable)
ipcMain.handle('projects:save-section', unavailable)
ipcMain.handle('generation:set-api-key', unavailable)
ipcMain.handle('generation:clear-api-key', unavailable)
ipcMain.handle('generation:generate', unavailable)
ipcMain.handle('exports:markdown', unavailable)
ipcMain.handle('exports:pdf', unavailable)

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
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
