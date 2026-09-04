const { contextBridge, ipcRenderer } = require("electron");

// This app's first contextBridge. Kept deliberately narrow — only what the
// embedded 网申浏览器 panel needs — since anything exposed here is reachable
// from every page this window ever loads (all of them are our own Next app,
// but no reason to widen the surface beyond what's used).
contextBridge.exposeInMainWorld("desktopBridge", {
  navigate: (url) => ipcRenderer.invoke("browser:navigate", url),
  back: () => ipcRenderer.invoke("browser:back"),
  forward: () => ipcRenderer.invoke("browser:forward"),
  reload: () => ipcRenderer.invoke("browser:reload"),
  setBounds: (rect) => ipcRenderer.invoke("browser:set-bounds", rect),
  autofill: () => ipcRenderer.invoke("browser:autofill"),
  onNavState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("browser:nav-state", listener);
    return () => ipcRenderer.removeListener("browser:nav-state", listener);
  },
  onAutofillStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("browser:autofill-status", listener);
    return () => ipcRenderer.removeListener("browser:autofill-status", listener);
  },
});
