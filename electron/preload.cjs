const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('buildx', {
  auth: {
    signup: (input) => ipcRenderer.invoke('auth:signup', input),
    login: (input) => ipcRenderer.invoke('auth:login', input),
    logout: () => ipcRenderer.invoke('auth:logout'),
    status: () => ipcRenderer.invoke('auth:status'),
    onSessionExpired: (listener) => {
      const handler = () => listener()
      ipcRenderer.on('auth:expired', handler)
      return () => ipcRenderer.removeListener('auth:expired', handler)
    },
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (input) => ipcRenderer.invoke('projects:create', input),
    get: (id) => ipcRenderer.invoke('projects:get', id),
    rename: (id, title, version) => ipcRenderer.invoke('projects:rename', id, title, version),
    delete: (id, version) => ipcRenderer.invoke('projects:delete', id, version),
    saveInput: (id, input, version) => ipcRenderer.invoke('projects:save-input', id, input, version),
    saveSection: (id, section, content, version) =>
      ipcRenderer.invoke('projects:save-section', id, section, content, version),
  },
  generation: {
    status: () => ipcRenderer.invoke('generation:status'),
    setApiKey: (key) => ipcRenderer.invoke('generation:set-api-key', key),
    clearApiKey: () => ipcRenderer.invoke('generation:clear-api-key'),
    generate: (id, version) => ipcRenderer.invoke('generation:generate', id, version),
  },
  exports: {
    markdown: (id) => ipcRenderer.invoke('exports:markdown', id),
    pdf: (id) => ipcRenderer.invoke('exports:pdf', id),
  },
})
