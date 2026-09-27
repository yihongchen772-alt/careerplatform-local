const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktopProductivity", {
  open: (kind, id, newWindow) => ipcRenderer.invoke("productivity:open", kind, id, newWindow),
  openPosition: (id) => ipcRenderer.invoke("productivity:position", id),
  pin: (value) => ipcRenderer.invoke("productivity:pin", value),
  state: () => ipcRenderer.invoke("productivity:state"),
  selectNote: (id) => ipcRenderer.invoke("productivity:note", id),
});
