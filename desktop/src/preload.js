"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gateway", {
  appInfo: () => ipcRenderer.invoke("app:info"),
  status: () => ipcRenderer.invoke("core:status"),
  start: () => ipcRenderer.invoke("core:start"),
  stop: () => ipcRenderer.invoke("core:stop"),
  restart: () => ipcRenderer.invoke("core:restart"),

  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (s, restart) => ipcRenderer.invoke("config:save", s, restart),
  openConfig: () => ipcRenderer.invoke("config:open"),
  openConfigDir: () => ipcRenderer.invoke("config:openDir"),
  importConfig: () => ipcRenderer.invoke("dialog:openConfig"),

  openPanel: () => ipcRenderer.invoke("panel:open"),
  getStats: () => ipcRenderer.invoke("stats:get"),
  getVersion: () => ipcRenderer.invoke("version:get"),
  getAutostart: () => ipcRenderer.invoke("autostart:get"),
  setAutostart: (v) => ipcRenderer.invoke("autostart:set", v),

  onLog: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on("core:log", h);
    return () => ipcRenderer.removeListener("core:log", h);
  },
  onStatus: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on("core:status-changed", h);
    return () => ipcRenderer.removeListener("core:status-changed", h);
  },
  onStats: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on("stats:update", h);
    return () => ipcRenderer.removeListener("stats:update", h);
  },
});
