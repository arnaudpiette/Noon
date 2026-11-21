"use strict";

// IP-2 : les vecteurs versionnés sont à jour et se vérifient indépendamment, en repartant
// des clés brutes comme le fera CryptoKit côté iPhone.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { buildInteropVectors } = require("../services/remote/remote-interop-vectors");
const { createSyncCrypto } = require("../services/sync/sync-crypto");

const FILE = path.join(__dirname, "fixtures", "remote-interop-vectors.v1.json");
const vectors = JSON.parse(fs.readFileSync(FILE, "utf8"));
const PKCS8 = { ed25519: "302e020100300506032b657004220420", x25519: "302e020100300506032b656e04220420" };

// Réimplémentation indépendante (ce que fera Swift).
const pemFromRaw = (prefixHex, rawHex) => {
  const b64 = Buffer.concat([Buffer.from(prefixHex, "hex"), Buffer.from(rawHex, "hex")]).toString("base64");
  return `-----BEGIN PUBLIC KEY-----\n${b64.match(/.{1,64}/g).join("\n")}\n-----END PUBLIC KEY-----\n`;
};
const sortKeys = (value) => Array.isArray(value) ? value.map(sortKeys)
  : value && typeof value === "object" ? Object.keys(value).sort().reduce((out, key) => { out[key] = sortKeys(value[key]); return out; }, {}) : value;
const privateKey = (kind, rawHex) => crypto.createPrivateKey({ key: Buffer.from(PKCS8[kind] + rawHex, "hex"), format: "der", type: "pkcs8" });
const identityOf = (device) => ({
  deviceId: device.deviceId, deviceType: device.deviceType, displayName: device.displayName, keyId: device.keyId,
  publicSigningKey: device.signing.publicPem, publicEncryptionKey: device.encryption.publicPem,
  privateSigningKey: privateKey("ed25519", device.signing.rawPrivateHex).export({ type: "pkcs8", format: "pem" }),
  privateEncryptionKey: privateKey("x25519", device.encryption.rawPrivateHex).export({ type: "pkcs8", format: "pem" }),
});

test("le fichier versionné correspond exactement au code actuel", () => {
  assert.equal(fs.readFileSync(FILE, "utf8"), `${JSON.stringify(buildInteropVectors(), null, 2)}\n`);
});

test("clés : PEM SPKI reconstruit depuis les octets bruts, publique dérivée de la privée", () => {
  for (const device of Object.values(vectors.devices)) {
    assert.equal(pemFromRaw(vectors.conventions.spkiPrefixHex.ed25519, device.signing.rawPublicHex), device.signing.publicPem);
    assert.equal(pemFromRaw(vectors.conventions.spkiPrefixHex.x25519, device.encryption.rawPublicHex), device.encryption.publicPem);
    assert.equal(crypto.createPublicKey(privateKey("ed25519", device.signing.rawPrivateHex)).export({ type: "spki", format: "pem" }), device.signing.publicPem);
    assert.equal(crypto.createPublicKey(privateKey("x25519", device.encryption.rawPrivateHex)).export({ type: "spki", format: "pem" }), device.encryption.publicPem);
    assert.equal(device.keyId, `device-key:${crypto.createHash("sha256").update(device.signing.publicPem).digest("hex").slice(0, 32)}`);
  }
});

test("JSON canonique", () => {
  for (const item of vectors.canonicalJson) assert.equal(JSON.stringify(sortKeys(item.input)), item.expected);
  assert.match(vectors.canonicalJson[1].expected, /"a\/b"/);
});

test("appairage : empreinte, code de vérification et QR", () => {
  const { mac, iphone } = vectors.devices;
  const { pairing } = vectors;
  assert.equal(pairing.macKeyFingerprint, crypto.createHash("sha256").update(mac.signing.publicPem + mac.encryption.publicPem).digest("hex"));
  const digest = crypto.createHash("sha256").update(`${mac.signing.publicPem}\n${iphone.signing.publicPem}\n${pairing.invitationToken}`).digest();
  assert.equal(pairing.verificationCode, String(digest.readUInt32BE(0) % 1e6).padStart(6, "0"));
  assert.match(pairing.verificationCode, /^\d{6}$/);
  assert.ok(pairing.qr.startsWith("noon-pair:"));
  assert.deepEqual(JSON.parse(Buffer.from(pairing.qr.slice("noon-pair:".length), "base64url").toString("utf8")), pairing.qrPayload);
  assert.equal(pairing.qrPayload.macKeyFingerprint, pairing.macKeyFingerprint);
  assert.equal(pairing.beginRequest.device.publicSigningKey, iphone.signing.publicPem);
});

test("enveloppes : étapes vérifiées une à une puis ouverture par le destinataire", () => {
  const byId = Object.fromEntries(Object.values(vectors.devices).map((device) => [device.deviceId, device]));
  for (const vector of vectors.envelopes) {
    const sender = byId[vector.from]; const recipient = byId[vector.to]; const { envelope, steps, entropy } = vector;
    // X25519 éphémère → HKDF-SHA256 → AES-256-GCM.
    const ephemeral = privateKey("x25519", entropy.ephemeralRawPrivateHex);
    assert.equal(envelope.ephemeralPublicKey, pemFromRaw(vectors.conventions.spkiPrefixHex.x25519, entropy.ephemeralRawPublicHex));
    const shared = crypto.diffieHellman({ privateKey: privateKey("x25519", recipient.encryption.rawPrivateHex), publicKey: crypto.createPublicKey(envelope.ephemeralPublicKey) });
    assert.equal(shared.toString("hex"), steps.sharedSecretHex);
    assert.equal(crypto.diffieHellman({ privateKey: ephemeral, publicKey: crypto.createPublicKey(recipient.encryption.publicPem) }).toString("hex"), steps.sharedSecretHex);
    assert.equal(Buffer.from(envelope.salt, "base64").toString("hex"), entropy.saltHex);
    assert.equal(Buffer.from(envelope.nonce, "base64").toString("hex"), entropy.nonceHex);
    const key = Buffer.from(crypto.hkdfSync("sha256", shared, Buffer.from(entropy.saltHex, "hex"), Buffer.from(steps.hkdfInfo), 32));
    assert.equal(key.toString("hex"), steps.aesKeyHex);
    const { signature, ephemeralPublicKey, salt, nonce, authTag, ciphertext, ...header } = envelope;
    assert.equal(JSON.stringify(sortKeys(header)), steps.aadCanonicalJson);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "base64"));
    decipher.setAAD(Buffer.from(steps.aadCanonicalJson)); decipher.setAuthTag(Buffer.from(authTag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
    assert.equal(plaintext, vector.payloadCanonicalJson);
    // Ed25519 sur le JSON canonique sans `signature`.
    const { signature: _omit, ...unsigned } = envelope;
    assert.equal(JSON.stringify(sortKeys(unsigned)), steps.signedCanonicalJson);
    assert.ok(crypto.verify(null, Buffer.from(steps.signedCanonicalJson), crypto.createPublicKey(sender.signing.publicPem), Buffer.from(signature, "base64")));
    // Code de production côté destinataire.
    assert.deepEqual(createSyncCrypto({ identity: identityOf(recipient) }).open(envelope, identityOf(sender)), vector.payload);
  }
});

test("enveloppes altérées : refus avec le code attendu", () => {
  const byId = Object.fromEntries(Object.values(vectors.devices).map((device) => [device.deviceId, device]));
  for (const vector of vectors.envelopes) {
    const opener = createSyncCrypto({ identity: identityOf(byId[vector.to]) });
    for (const rejection of vector.rejections) {
      assert.throws(() => opener.open(rejection.envelope, identityOf(byId[vector.from])), (error) => error.code === rejection.expectedCode, rejection.name);
    }
  }
});

test("sans entropie fixée, deux scellements diffèrent (aucun déterminisme en production)", () => {
  const { mac, iphone } = vectors.devices;
  const sealer = createSyncCrypto({ identity: identityOf(iphone) });
  const header = { entityType: "remote.text", entityId: "x", operation: "UPSERT", entityVersion: 1 };
  const a = sealer.seal({ targetDevice: identityOf(mac), header, payload: { t: 1 } });
  const b = sealer.seal({ targetDevice: identityOf(mac), header, payload: { t: 1 } });
  assert.notEqual(a.salt, b.salt); assert.notEqual(a.nonce, b.nonce); assert.notEqual(a.ephemeralPublicKey, b.ephemeralPublicKey);
});
