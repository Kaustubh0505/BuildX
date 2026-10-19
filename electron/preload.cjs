const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('buildx', {
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (input) => ipcRenderer.invoke('projects:create', input),
    get: (id) => ipcRenderer.invoke('projects:get', id),
    rename: (id, title) => ipcRenderer.invoke('projects:rename', id, title),
    delete: (id) => ipcRenderer.invoke('projects:delete', id),
    saveInput: (id, input) => ipcRenderer.invoke('projects:save-input', id, input),
    saveSection: (id, section, content) =>
      ipcRenderer.invoke('projects:save-section', id, section, content),
  },
  generation: {
    status: () => ipcRenderer.invoke('generation:status'),
    setApiKey: (key) => ipcRenderer.invoke('generation:set-api-key', key),
    clearApiKey: () => ipcRenderer.invoke('generation:clear-api-key'),
    generate: (id) => ipcRenderer.invoke('generation:generate', id),
  },
  exports: {
    markdown: (id) => ipcRenderer.invoke('exports:markdown', id),
    pdf: (id) => ipcRenderer.invoke('exports:pdf', id),
  },
})
