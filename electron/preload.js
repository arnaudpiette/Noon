// @ts-check
"use strict";

// Pont IPC minimal exposé au navigateur : aucune API Node.js n’est accessible directement.

// V3-L0/A.4 : contrat typé du pont. Ces types décrivent ce que le renderer envoie ; le processus
// principal (electron/main.js) continue de revalider chaque charge comme une entrée non fiable.
/**
 * @typedef {{ x: number, y: number, width: number, height: number }} DevPreviewBounds
 * @typedef {{ url: string, bounds?: DevPreviewBounds }} DevPreviewOpenPayload
 * @typedef {{
 *   action: "create" | "update" | "disable" | "enable" | "delete",
 *   workspaceId: string,
 *   expectedProjectId: string,
 *   ruleId?: string,
 *   expectedVersion?: number,
 *   text?: string,
 * }} DevProjectRulePayload
 * @typedef {{ method: "touch-id" } | { method?: "password", password: string }} PrivateMemoryAuthPayload
 * @typedef {{ target: "mail" | "whatsapp" | "save", markdown: string, suggestedName?: string }} ShareConversationPayload
 * @typedef {{ mode?: "read-only" | "read-write", output?: boolean }} LocalPermissionPayload
 * @typedef {(value: unknown) => void} BridgeListener
 * @typedef {() => void} Unsubscribe
 * @typedef {(event: import("electron").IpcRendererEvent, value: unknown) => void} RendererListener
 */
/**
 * API exposée sous `window.noon`. Chaque méthode correspond à un canal `noon:*` enregistré par
 * `createTrustedIpcRegistrar` (electron/production-hardening.js).
 * @typedef {{
 *   uiValidationMode: boolean,
 *   getStatus: () => Promise<unknown>,
 *   getPreferences: () => Promise<unknown>,
 *   getDevProjectRules: (workspaceId: string) => Promise<unknown>,
 *   devProjectRule: (payload: DevProjectRulePayload) => Promise<unknown>,
 *   setPreference: (key: string, value: unknown) => Promise<unknown>,
 *   showWindow: () => Promise<unknown>,
 *   hideWindow: () => Promise<unknown>,
 *   getPrivateMemoryProtection: () => Promise<unknown>,
 *   setPrivateMemoryPassword: (password: string) => Promise<unknown>,
 *   authenticatePrivateMemory: (payload: PrivateMemoryAuthPayload) => Promise<unknown>,
 *   openGoogleAuthorization: (url: string) => Promise<unknown>,
 *   openExternal: (url: string) => Promise<unknown>,
 *   devPreviewOpen: (payload: DevPreviewOpenPayload) => Promise<unknown>,
 *   devPreviewNavigate: (url: string) => Promise<unknown>,
 *   devPreviewSetBounds: (bounds: DevPreviewBounds) => Promise<unknown>,
 *   devPreviewSetVisible: (visible: unknown) => Promise<unknown>,
 *   devPreviewReload: () => Promise<unknown>,
 *   devPreviewBack: () => Promise<unknown>,
 *   devPreviewForward: () => Promise<unknown>,
 *   devPreviewClose: () => Promise<unknown>,
 *   devPreviewState: () => Promise<unknown>,
 *   devPreviewCapture: () => Promise<unknown>,
 *   devPreviewOpenExternal: (url: string) => Promise<unknown>,
 *   setLiveActive: (active: unknown) => Promise<unknown>,
 *   getWakeWordStatus: () => Promise<unknown>,
 *   setPicovoiceKey: (value: string) => Promise<unknown>,
 *   importWakeModel: (kind: "keyword" | "model") => Promise<unknown>,
 *   resetWakeWord: () => Promise<unknown>,
 *   getOpenAIKeyStatus: () => Promise<unknown>,
 *   setOpenAIKey: (value: string) => Promise<unknown>,
 *   shareConversation: (payload: ShareConversationPayload) => Promise<unknown>,
 *   openSystemSettings: (section: "microphone" | "notifications") => Promise<unknown>,
 *   listLocalPermissions: () => Promise<unknown>,
 *   addLocalPermission: (payload: LocalPermissionPayload) => Promise<unknown>,
 *   removeLocalPermission: (targetPath: string) => Promise<unknown>,
 *   openArtifact: (targetPath: string) => Promise<unknown>,
 *   revealArtifact: (targetPath: string) => Promise<unknown>,
 *   previewArtifact: (targetPath: string) => Promise<unknown>,
 *   downloadArtifact: (targetPath: string) => Promise<unknown>,
 *   onDevPreviewState: (callback: BridgeListener) => Unsubscribe,
 *   onDeepLink: (callback: BridgeListener) => Unsubscribe,
 *   onSystemState: (callback: BridgeListener) => Unsubscribe,
 * }} NoonBridge
 */

const { contextBridge, ipcRenderer } = require("electron");
/** @type {(channel: string, payload?: unknown) => Promise<unknown>} */
const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld("noon", Object.freeze(/** @satisfies {NoonBridge} */ ({
  uiValidationMode: process.env.NOON_UI_VALIDATION === "1",
  getStatus: () => invoke("noon:get-status"),
  getPreferences: () => invoke("noon:get-preferences"),
  getDevProjectRules: (workspaceId) => invoke("noon:dev-project-rules", { workspaceId }),
  devProjectRule: (payload) => invoke("noon:dev-project-rule", payload),
  setPreference: (key, value) => invoke("noon:set-preference", { key, value }),
  showWindow: () => invoke("noon:show-window"),
  hideWindow: () => invoke("noon:hide-window"),
  getPrivateMemoryProtection: () => invoke("noon:get-private-memory-protection"),
  setPrivateMemoryPassword: (password) => invoke("noon:set-private-memory-password", password),
  authenticatePrivateMemory: (payload) => invoke("noon:authenticate-private-memory", payload),
  openGoogleAuthorization: (url) => invoke("noon:open-google-authorization", url),
  openExternal: (url) => invoke("noon:open-external", url),
  devPreviewOpen: (payload) => invoke("noon:dev-preview-open", payload),
  devPreviewNavigate: (url) => invoke("noon:dev-preview-navigate", url),
  devPreviewSetBounds: (bounds) => invoke("noon:dev-preview-set-bounds", bounds),
  devPreviewSetVisible: (visible) => invoke("noon:dev-preview-set-visible", Boolean(visible)),
  devPreviewReload: () => invoke("noon:dev-preview-reload"),
  devPreviewBack: () => invoke("noon:dev-preview-back"),
  devPreviewForward: () => invoke("noon:dev-preview-forward"),
  devPreviewClose: () => invoke("noon:dev-preview-close"),
  devPreviewState: () => invoke("noon:dev-preview-state"),
  devPreviewCapture: () => invoke("noon:dev-preview-capture"),
  devPreviewOpenExternal: (url) => invoke("noon:dev-preview-open-external", url),
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
  onDevPreviewState: (callback) => {
    if (typeof callback !== "function") return () => {};
    /** @type {RendererListener} */
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("noon:dev-preview-state", listener);
    return () => ipcRenderer.removeListener("noon:dev-preview-state", listener);
  },
  onDeepLink: (callback) => {
    if (typeof callback !== "function") return () => {};
    /** @type {RendererListener} */
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("noon:deep-link", listener);
    return () => ipcRenderer.removeListener("noon:deep-link", listener);
  },
  onSystemState: (callback) => {
    if (typeof callback !== "function") return () => {};
    /** @type {RendererListener} */
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("noon:system-state", listener);
    return () => ipcRenderer.removeListener("noon:system-state", listener);
  },
})));
