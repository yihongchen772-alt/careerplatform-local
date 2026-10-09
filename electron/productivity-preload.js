const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktopProductivity", {
  open: (kind, id, newWindow) => ipcRenderer.invoke("productivity:open", kind, id, newWindow),
  openPosition: (id) => ipcRenderer.invoke("productivity:position", id),
  pin: (value) => ipcRenderer.invoke("productivity:pin", value),
  setLayer: (layer) => ipcRenderer.invoke("productivity:layer", layer),
  state: () => ipcRenderer.invoke("productivity:state"),
  selectNote: (id) => ipcRenderer.invoke("productivity:note", id),
  setColor: (color) => ipcRenderer.invoke("productivity:color", color),
  openMain: () => ipcRenderer.invoke("productivity:main"),
  setNotesAtLogin: (value) => ipcRenderer.invoke("productivity:notes-at-login", value),
});
