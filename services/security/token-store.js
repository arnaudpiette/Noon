// @ts-check
"use strict";

// Coffre des jetons d’intégration, chiffré avec safeStorage lorsque macOS le permet.

const fs = require("fs");
const path = require("path");

/**
 * Sous-ensemble de safeStorage (Electron) utilisé par le coffre.
 * @typedef {{
 *   isEncryptionAvailable?: () => boolean,
 *   encryptString: (value: string) => Buffer,
 *   decryptString: (value: Buffer) => string,
 * }} SafeStorageLike
 */
/**
 * @param {{ filePath: string, safeStorage?: SafeStorageLike | null }} options
 */
function createTokenStore({ filePath, safeStorage = null }) {
  const memory = new Map();
  const persistent = Boolean(safeStorage?.isEncryptionAvailable?.());

  /** @returns {Record<string, string>} */
  function loadEncrypted() {
    if (!persistent) return {};
    try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return {}; }
  }
  /** @param {Record<string, string>} data */
  function saveEncrypted(data) {
    if (!persistent) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(temporary, filePath);
  }
  // `persistent` implique un safeStorage disponible.
  /**
   * @param {string} provider
   * @param {unknown} token
   */
  function set(provider, token) {
    const value = JSON.stringify(token);
    if (!persistent) { memory.set(provider, value); return { persistent: false }; }
    const data = loadEncrypted();
    data[provider] = /** @type {SafeStorageLike} */ (safeStorage).encryptString(value).toString("base64");
    saveEncrypted(data);
    return { persistent: true };
  }
  /** @param {string} provider */
  function get(provider) {
    const encrypted = loadEncrypted()[provider];
    try {
      const raw = persistent && encrypted
        ? /** @type {SafeStorageLike} */ (safeStorage).decryptString(Buffer.from(encrypted, "base64"))
        : memory.get(provider);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  /** @param {string} provider */
  function remove(provider) {
    memory.delete(provider);
    if (persistent) { const data = loadEncrypted(); delete data[provider]; saveEncrypted(data); }
  }
  return { set, get, remove, persistent };
}

module.exports = { createTokenStore };
