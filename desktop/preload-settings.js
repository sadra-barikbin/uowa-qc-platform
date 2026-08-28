const { contextBridge, ipcRenderer } = require('electron');

// Minimal, explicit bridge for the Settings window only. Exposes just the three API-key actions —
// no general IPC or Node access reaches the page.
contextBridge.exposeInMainWorld('apiKeyApi', {
    status: () => ipcRenderer.invoke('apikey:status'),
    save: (key) => ipcRenderer.invoke('apikey:save', key),
    clear: () => ipcRenderer.invoke('apikey:clear'),
});
