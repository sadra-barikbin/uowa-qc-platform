const { contextBridge, ipcRenderer } = require('electron');

// Minimal one-way bridge for the main app window: the page reports whether a long AI evaluation
// run is in flight (frontend/src/utils/aiRun.js), so the shell can ask before closing, quitting or
// reloading — all three abort the run, since the backend that serves it is this app's child
// process. One setter, no return channel, no general IPC and no Node access reach the page.
contextBridge.exposeInMainWorld('qcDesktop', {
    setAiBusy: (busy) => ipcRenderer.send('ai:busy', !!busy),
});
