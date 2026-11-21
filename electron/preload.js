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
  recorder: Object.freeze({
    list: () => invoke("noon:recorder-list"),
    create: (options) => invoke("noon:recorder-create", options),
    append: (id, chunk) => invoke("noon:recorder-append", id, chunk),
    state: (id, state) => invoke("noon:recorder-state", id, state),
    chunk: (id, index) => invoke("noon:recorder-chunk", id, index),
    exportAudio: (id) => invoke("noon:recorder-export", id),
    importAudio: () => invoke("noon:recorder-import"),
    saveTranscript: (id, text, source) => invoke("noon:recorder-transcript", id, text, source),
    exportTranscript: (id, format) => invoke("noon:recorder-export-transcript", id, format),
    saveAnalysis: (id, analysis, revision) => invoke("noon:recorder-analysis", id, analysis, revision),
    exportReport: (id, format) => invoke("noon:recorder-report", id, format),
  }),
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
