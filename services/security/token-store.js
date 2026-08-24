"use strict";

const fs = require("fs");
const path = require("path");

function createTokenStore({ filePath, safeStorage = null }) {
  const memory = new Map();
  const persistent = Boolean(safeStorage?.isEncryptionAvailable?.());

  function loadEncrypted() {
    if (!persistent) return {};
    try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return {}; }
  }
  function saveEncrypted(data) {
    if (!persistent) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(temporary, filePath);
  }
  function set(provider, token) {
    const value = JSON.stringify(token);
    if (!persistent) { memory.set(provider, value); return { persistent: false }; }
    const data = loadEncrypted();
    data[provider] = safeStorage.encryptString(value).toString("base64");
    saveEncrypted(data);
    return { persistent: true };
  }
  function get(provider) {
    const encrypted = loadEncrypted()[provider];
    try {
      const raw = persistent && encrypted
        ? safeStorage.decryptString(Buffer.from(encrypted, "base64"))
        : memory.get(provider);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function remove(provider) {
    memory.delete(provider);
    if (persistent) { const data = loadEncrypted(); delete data[provider]; saveEncrypted(data); }
  }
  return { set, get, remove, persistent };
}

module.exports = { createTokenStore };
