"use strict";

const crypto = require("node:crypto");
const { SYNC_PROTOCOL_VERSION } = require("./sync-schema");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function bytes(value) { return Buffer.from(JSON.stringify(canonical(value))); }
function fingerprint(pem) { return crypto.createHash("sha256").update(String(pem)).digest("hex").slice(0, 32); }

function createDeviceIdentity({ deviceId = `device_${crypto.randomUUID()}`, deviceType = "MAC_PRIMARY", displayName = "Noon Device" } = {}) {
  const signing = crypto.generateKeyPairSync("ed25519");
  const encryption = crypto.generateKeyPairSync("x25519");
  return {
    deviceId, deviceType, displayName,
    publicSigningKey: signing.publicKey.export({ type: "spki", format: "pem" }),
    publicEncryptionKey: encryption.publicKey.export({ type: "spki", format: "pem" }),
    privateSigningKey: signing.privateKey.export({ type: "pkcs8", format: "pem" }),
    privateEncryptionKey: encryption.privateKey.export({ type: "pkcs8", format: "pem" }),
    keyId: `device-key:${fingerprint(signing.publicKey.export({ type: "spki", format: "pem" }))}`,
  };
}

function deriveKey(privateKey, publicKey, salt) {
  const privateKeyObject = privateKey?.type === "private" ? privateKey : crypto.createPrivateKey(privateKey);
  const publicKeyObject = publicKey?.type === "public" ? publicKey : crypto.createPublicKey(publicKey);
  const shared = crypto.diffieHellman({ privateKey: privateKeyObject, publicKey: publicKeyObject });
  return crypto.hkdfSync("sha256", shared, Buffer.from(salt, "base64"), Buffer.from("noon-sync-envelope-v1"), 32);
}

function createSyncCrypto({ identity } = {}) {
  if (!identity?.privateSigningKey || !identity?.privateEncryptionKey) throw new TypeError("Identité cryptographique locale requise.");
  function seal({ targetDevice, header, payload }) {
    if (!targetDevice?.publicEncryptionKey) throw new TypeError("Clé publique de destination requise.");
    const ephemeral = crypto.generateKeyPairSync("x25519");
    const salt = crypto.randomBytes(16); const nonce = crypto.randomBytes(12);
    const ephemeralPublicKey = ephemeral.publicKey.export({ type: "spki", format: "pem" });
    const key = deriveKey(ephemeral.privateKey, targetDevice.publicEncryptionKey, salt.toString("base64"));
    const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
    const immutableHeader = { envelopeId: header.envelopeId || `envelope_${crypto.randomUUID()}`, sourceDeviceId: identity.deviceId, targetDeviceId: targetDevice.deviceId, entityType: header.entityType, entityId: header.entityId, operation: header.operation, entityVersion: header.entityVersion, createdAt: header.createdAt || new Date().toISOString(), keyId: identity.keyId, protocolVersion: SYNC_PROTOCOL_VERSION, schemaVersion: header.schemaVersion || 1 };
    cipher.setAAD(bytes(immutableHeader));
    const ciphertext = Buffer.concat([cipher.update(bytes(payload)), cipher.final()]);
    const unsigned = { ...immutableHeader, ephemeralPublicKey, salt: salt.toString("base64"), nonce: nonce.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
    const signature = crypto.sign(null, bytes(unsigned), crypto.createPrivateKey(identity.privateSigningKey)).toString("base64");
    return { ...unsigned, signature };
  }
  function open(envelope, sourceDevice) {
    if (envelope.protocolVersion !== SYNC_PROTOCOL_VERSION) throw Object.assign(new Error("Version de protocole incompatible."), { code: "SYNC_PROTOCOL_INCOMPATIBLE" });
    const { signature, ...unsigned } = envelope;
    if (!sourceDevice?.publicSigningKey || !crypto.verify(null, bytes(unsigned), crypto.createPublicKey(sourceDevice.publicSigningKey), Buffer.from(String(signature || ""), "base64"))) throw Object.assign(new Error("Signature d'enveloppe invalide."), { code: "SYNC_SIGNATURE_INVALID" });
    try {
      const key = deriveKey(identity.privateEncryptionKey, envelope.ephemeralPublicKey, envelope.salt);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce, "base64"));
      const header = Object.fromEntries(Object.entries(unsigned).filter(([keyName]) => !["ephemeralPublicKey", "salt", "nonce", "authTag", "ciphertext"].includes(keyName)));
      decipher.setAAD(bytes(header)); decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8"));
    } catch (error) { throw Object.assign(new Error("Enveloppe chiffrée invalide."), { code: "SYNC_CIPHERTEXT_INVALID", cause: error }); }
  }
  return { identity: () => ({ deviceId: identity.deviceId, deviceType: identity.deviceType, displayName: identity.displayName, publicSigningKey: identity.publicSigningKey, publicEncryptionKey: identity.publicEncryptionKey, keyId: identity.keyId }), open, seal };
}

module.exports = { canonical, createDeviceIdentity, createSyncCrypto, fingerprint };
