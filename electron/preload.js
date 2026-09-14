"use strict";

// Pont IPC minimal exposé au navigateur : aucune API Node.js n’est accessible directement.

const { contextBridge, ipcRenderer } = require("electron");
const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld("noon", Object.freeze({
  getStatus: () => invoke("noon:get-status"),
  getPreferences: () => invoke("noon:get-preferences"),
  setPreference: (key, value) => invoke("noon:set-preference", { key, value }),
  showWindow: () => invoke("noon:show-window"),
  hideWindow: () => invoke("noon:hide-window"),
  getPrivateMemoryProtection: () => invoke("noon:get-private-memory-protection"),
  setPrivateMemoryPassword: (password) => invoke("noon:set-private-memory-password", password),
  authenticatePrivateMemory: (payload) => invoke("noon:authenticate-private-memory", payload),
  openGoogleAuthorization: (url) => invoke("noon:open-google-authorization", url),
  setLiveActive: (active) => invoke("noon:set-live-active", Boolean(active)),
  getWakeWordStatus: () => invoke("noon:get-wake-word-status"),
  setPicovoiceKey: (value) => invoke("noon:set-picovoice-key", value),
  importWakeModel: (kind) => invoke("noon:import-wake-model", kind),
  resetWakeWord: () => invoke("noon:reset-wake-word"),
  getOpenAIKeyStatus: () => invoke("noon:get-openai-key-status"),
  setOpenAIKey: (value) => invoke("noon:set-openai-key", value),
  shareConversation: (payload) => invoke("noon:share-conversation", payload),
  openSystemSettings: (section) => invoke("noon:open-system-settings", section),
  listLocalPermissions: () => invoke("noon:list-local-permissions"),
  addLocalPermission: (payload) => invoke("noon:add-local-permission", payload),
  removeLocalPermission: (targetPath) => invoke("noon:remove-local-permission", targetPath),
  openArtifact: (targetPath) => invoke("noon:open-artifact", targetPath),
  revealArtifact: (targetPath) => invoke("noon:reveal-artifact", targetPath),
  previewArtifact: (targetPath) => invoke("noon:preview-artifact", targetPath),
  downloadArtifact: (targetPath) => invoke("noon:download-artifact", targetPath),
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
