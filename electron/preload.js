const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopUpdates", {
  getState: () => ipcRenderer.invoke("updates:get-state"),
  check: () => ipcRenderer.invoke("updates:check"),
  download: () => ipcRenderer.invoke("updates:download"),
  install: () => ipcRenderer.invoke("updates:install"),
  openReleases: () => ipcRenderer.invoke("updates:open-releases"),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("updates:state", listener);
    return () => ipcRenderer.removeListener("updates:state", listener);
  },
});

// This app's first contextBridge. Kept deliberately narrow — only what the
// embedded 网申浏览器 panel needs — since anything exposed here is reachable
// from every page this window ever loads (all of them are our own Next app,
// but no reason to widen the surface beyond what's used).
contextBridge.exposeInMainWorld("desktopBridge", {
  navigate: (url) => ipcRenderer.invoke("browser:navigate", url),
  back: () => ipcRenderer.invoke("browser:back"),
  forward: () => ipcRenderer.invoke("browser:forward"),
  reload: () => ipcRenderer.invoke("browser:reload"),
  stop: () => ipcRenderer.invoke("browser:stop"),
  setBounds: (rect) => ipcRenderer.invoke("browser:set-bounds", rect),
  autofill: (resumeVersionId) => ipcRenderer.invoke("browser:autofill", resumeVersionId),
  saveCorrections: () => ipcRenderer.invoke("browser:save-corrections"),
  clearMarks: () => ipcRenderer.invoke("browser:clear-marks"),
  capturePage: () => ipcRenderer.invoke("browser:capture-page"),
  screenshot: () => ipcRenderer.invoke("browser:screenshot"),
  zoomIn: () => ipcRenderer.invoke("browser:zoom-in"),
  zoomOut: () => ipcRenderer.invoke("browser:zoom-out"),
  zoomReset: () => ipcRenderer.invoke("browser:zoom-reset"),
  newTab: (url) => ipcRenderer.invoke("browser:new-tab", url),
  switchTab: (id) => ipcRenderer.invoke("browser:switch-tab", id),
  closeTab: (id) => ipcRenderer.invoke("browser:close-tab", id),
  getTabs: () => ipcRenderer.invoke("browser:get-tabs"),
  openExternal: () => ipcRenderer.invoke("browser:open-external"),
  copyUrl: () => ipcRenderer.invoke("browser:copy-url"),
  history: () => ipcRenderer.invoke("browser:history"),
  clearHistory: () => ipcRenderer.invoke("browser:clear-history"),
  showDownload: (file) => ipcRenderer.invoke("browser:show-download", file),
  clearSiteData: () => ipcRenderer.invoke("browser:clear-site-data"),
  find: (options) => ipcRenderer.invoke("browser:find", options),
  findStop: () => ipcRenderer.invoke("browser:find-stop"),
  onTabs: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("browser:tabs", listener);
    return () => ipcRenderer.removeListener("browser:tabs", listener);
  },
  onAutofillStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("browser:autofill-status", listener);
    return () => ipcRenderer.removeListener("browser:autofill-status", listener);
  },
  onShortcut: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("browser:shortcut", listener);
    return () => ipcRenderer.removeListener("browser:shortcut", listener);
  },
  onDownload: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("browser:download", listener);
    return () => ipcRenderer.removeListener("browser:download", listener);
  },
  onFindResult: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("browser:find-result", listener);
    return () => ipcRenderer.removeListener("browser:find-result", listener);
  },
});
