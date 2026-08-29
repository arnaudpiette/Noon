"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function normalizeKey(value) {
  const key = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ""), "base64");
  if (key.length !== 32) throw new Error("Clé de mémoire privée invalide.");
  return key;
}

function createMemoryCipher(masterKey) {
  const key = normalizeKey(masterKey);
  return {
    encrypt(value) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
      return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: ciphertext.toString("base64") });
    },
    decrypt(envelope) {
      const parsed = JSON.parse(String(envelope));
      if (parsed.v !== 1) throw new Error("Version de chiffrement non prise en charge.");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.iv, "base64"));
      decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(parsed.data, "base64")), decipher.final()]).toString("utf8"));
    },
  };
}

function loadOrCreateProtectedMasterKey(dataDirectory, safeStorage) {
  if (!safeStorage?.isEncryptionAvailable?.()) return null;
  const keyPath = path.join(dataDirectory, "private-memory-master-key.bin");
  try { return Buffer.from(safeStorage.decryptString(fs.readFileSync(keyPath)), "base64"); }
  catch {
    const key = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, safeStorage.encryptString(key.toString("base64")), { mode: 0o600 });
    return key;
  }
}

module.exports = { createMemoryCipher, loadOrCreateProtectedMasterKey, normalizeKey };
