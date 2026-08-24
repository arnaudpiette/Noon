"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld("noon", Object.freeze({
  getStatus: () => invoke("noon:get-status"),
  getPreferences: () => invoke("noon:get-preferences"),
  setPreference: (key, value) => invoke("noon:set-preference", { key, value }),
  showWindow: () => invoke("noon:show-window"),
  hideWindow: () => invoke("noon:hide-window"),
  setLiveActive: (active) => invoke("noon:set-live-active", Boolean(active)),
  getWakeWordStatus: () => invoke("noon:get-wake-word-status"),
  setPicovoiceKey: (value) => invoke("noon:set-picovoice-key", value),
  importWakeModel: (kind) => invoke("noon:import-wake-model", kind),
  resetWakeWord: () => invoke("noon:reset-wake-word"),
  getOpenAIKeyStatus: () => invoke("noon:get-openai-key-status"),
  setOpenAIKey: (value) => invoke("noon:set-openai-key", value),
  shareConversation: (payload) => invoke("noon:share-conversation", payload),
  openSystemSettings: (section) => invoke("noon:open-system-settings", section),
  onDeepLink: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("noon:deep-link", listener);
    return () => ipcRenderer.removeListener("noon:deep-link", listener);
  },
  onSystemState: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("noon:system-state", listener);
    return () => ipcRenderer.removeListener("noon:system-state", listener);
  },
}));
