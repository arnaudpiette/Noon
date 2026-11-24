// @ts-check
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

/**
 * @param {unknown} value
 * @returns {Buffer}
 */
function normalizeKey(value) {
  const key = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ""), "base64");
  if (key.length !== 32) throw new Error("Clé de mémoire privée invalide.");
  return key;
}

/** @param {unknown} masterKey */
function createMemoryCipher(masterKey) {
  const key = normalizeKey(masterKey);
  return {
    /**
     * @param {unknown} value
     * @returns {string}
     */
    encrypt(value) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
      return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: ciphertext.toString("base64") });
    },
    /**
     * @param {unknown} envelope
     * @returns {any}
     */
    decrypt(envelope) {
      const parsed = JSON.parse(String(envelope));
      if (parsed.v !== 1) throw new Error("Version de chiffrement non prise en charge.");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.iv, "base64"));
      decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(parsed.data, "base64")), decipher.final()]).toString("utf8"));
    },
  };
}

/**
 * @param {"read" | "decrypt"} stage
 * @param {unknown} cause
 */
function unreadableMasterKey(stage, cause) {
  return Object.assign(
    new Error("Clé de mémoire privée illisible : la mémoire privée reste indisponible et la clé existante est conservée.", { cause }),
    { code: "PRIVATE_MEMORY_KEY_UNREADABLE", stage }
  );
}

/**
 * Charge la clé maîtresse de la mémoire privée, ou la crée au tout premier lancement.
 * Une clé existante n'est jamais remplacée. Si elle ne peut pas être lue ou déchiffrée
 * (trousseau verrouillé, application re-signée, fichier corrompu), PRIVATE_MEMORY_KEY_UNREADABLE
 * est levée et la mémoire privée reste indisponible : régénérer la clé rendrait illisibles tous
 * les souvenirs déjà chiffrés.
 * @param {string} dataDirectory
 * @param {{
 *   isEncryptionAvailable?: () => boolean,
 *   encryptString: (value: string) => Buffer,
 *   decryptString: (value: Buffer) => string,
 * } | null | undefined} safeStorage
 * @returns {Buffer | null}
 */
function loadOrCreateProtectedMasterKey(dataDirectory, safeStorage) {
  if (!safeStorage?.isEncryptionAvailable?.()) return null;
  const keyPath = path.join(dataDirectory, "private-memory-master-key.bin");
  /** @type {Buffer | null} */
  let stored = null;
  try { stored = fs.readFileSync(keyPath); }
  catch (error) {
    if (error?.code !== "ENOENT") throw unreadableMasterKey("read", error);
  }
  if (stored) {
    try { return Buffer.from(safeStorage.decryptString(stored), "base64"); }
    catch (error) { throw unreadableMasterKey("decrypt", error); }
  }
  // Premier lancement : écriture atomique (fichier temporaire puis lien), qui échoue au lieu
  // d'écraser une clé apparue entre-temps.
  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  const temporary = `${keyPath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, safeStorage.encryptString(key.toString("base64")), { mode: 0o600, flag: "wx" });
  try { fs.linkSync(temporary, keyPath); }
  finally { fs.rmSync(temporary, { force: true }); }
  return key;
}

module.exports = { createMemoryCipher, loadOrCreateProtectedMasterKey, normalizeKey };
