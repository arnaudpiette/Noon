// @ts-check
"use strict";

// Primitives de hardening du shell Electron. Ce module reste pur et testable sans Electron.

const fs = require("fs");
const path = require("path");

const BUILD_PROFILES = Object.freeze(["development", "test", "production", "release"]);

/**
 * @param {{ value?: string, packaged?: boolean }} [options]
 * @returns {string}
 */
function resolveBuildProfile({ value = process.env.NOON_BUILD_PROFILE, packaged = false } = {}) {
  const normalized = String(value || "").trim().toLowerCase();
  if (BUILD_PROFILES.includes(normalized)) return normalized;
  return packaged ? "production" : process.env.NODE_ENV === "test" ? "test" : "development";
}

/**
 * @param {unknown} rawUrl
 * @param {string} trustedOrigin
 * @returns {boolean}
 */
function isTrustedRendererUrl(rawUrl, trustedOrigin) {
  try {
    const url = new URL(String(rawUrl || ""));
    return url.origin === trustedOrigin && url.pathname === "/app";
  } catch {
    return false;
  }
}

/**
 * @param {unknown[]} args
 * @param {number} [maxBytes]
 * @returns {void}
 */
function assertBoundedIpcArguments(args, maxBytes = 512 * 1024) {
  let serialized;
  try { serialized = JSON.stringify(args); }
  catch { throw new Error("Charge IPC non sérialisable."); }
  if (Buffer.byteLength(serialized || "", "utf8") > maxBytes) {
    throw new Error("Charge IPC trop volumineuse.");
  }
}

/**
 * Handler IPC de confiance : reçoit l'événement Electron et les arguments bruts du renderer,
 * qu'il doit revalider lui-même.
 * @typedef {(event: import("electron").IpcMainInvokeEvent, ...args: any[]) => unknown} TrustedIpcHandler
 */
/**
 * @param {{
 *   ipcMain: Pick<import("electron").IpcMain, "handle">,
 *   trustedOrigin: string,
 *   now?: () => number,
 *   maxCalls?: number,
 *   windowMs?: number,
 * }} options
 * @returns {(channel: string, handler: TrustedIpcHandler) => void}
 */
function createTrustedIpcRegistrar({ ipcMain, trustedOrigin, now = Date.now, maxCalls = 120, windowMs = 10_000 }) {
  if (!ipcMain?.handle || !trustedOrigin) throw new TypeError("Configuration IPC incomplète.");
  /** @type {Map<string, { startedAt: number, count: number }>} */
  const buckets = new Map();

  return function registerTrustedHandler(channel, handler) {
    if (!/^noon:[a-z0-9-]+$/.test(String(channel)) || typeof handler !== "function") {
      throw new TypeError("Handler IPC invalide.");
    }
    ipcMain.handle(channel, async (event, ...args) => {
      const senderUrl = event?.senderFrame?.url || event?.sender?.getURL?.() || "";
      if (!isTrustedRendererUrl(senderUrl, trustedOrigin)) throw new Error("Origine IPC refusée.");
      assertBoundedIpcArguments(args);

      const senderId = event?.sender?.id || "unknown";
      const key = `${senderId}:${channel}`;
      const currentTime = now();
      const bucket = buckets.get(key);
      const next = !bucket || currentTime - bucket.startedAt >= windowMs
        ? { startedAt: currentTime, count: 1 }
        : { ...bucket, count: bucket.count + 1 };
      buckets.set(key, next);
      if (next.count > maxCalls) throw new Error("Trop de requêtes IPC.");

      return handler(event, ...args);
    });
  };
}

/**
 * @param {string} markerPath
 * @returns {"unclean" | "clean" | "first-run"}
 */
function readPreviousStartupState(markerPath) {
  try {
    const value = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    return value?.state === "starting" || value?.state === "running" ? "unclean" : "clean";
  } catch {
    return "first-run";
  }
}

/**
 * @param {string} markerPath
 * @param {"starting" | "running" | "clean"} state
 * @param {Record<string, unknown>} [details]
 * @returns {void}
 */
function writeStartupState(markerPath, state, details = {}) {
  if (!new Set(["starting", "running", "clean"]).has(state)) throw new TypeError("État de démarrage invalide.");
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  const temporary = `${markerPath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ state, updatedAt: new Date().toISOString(), ...details }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, markerPath);
}

module.exports = {
  BUILD_PROFILES,
  assertBoundedIpcArguments,
  createTrustedIpcRegistrar,
  isTrustedRendererUrl,
  readPreviousStartupState,
  resolveBuildProfile,
  writeStartupState,
};
