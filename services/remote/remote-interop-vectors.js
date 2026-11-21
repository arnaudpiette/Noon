"use strict";

// Compagnon iPhone — IP-2 : vecteurs d'interopérabilité Node ↔ CryptoKit.
// Tout est déterministe (clés dérivées de graines publiques, entropie fixée) et produit par
// le code de production (sync-crypto, remote-lan-gateway) : l'app iOS rejoue ces vecteurs
// pour prouver qu'elle encode les clés, le JSON canonique, les enveloppes, l'empreinte du
// QR et le code de vérification exactement comme le Mac.
// CLÉS DE TEST UNIQUEMENT : elles sont publiques et ne doivent jamais servir ailleurs.
// Voir docs/IPHONE_COMPANION_V1_DESIGN.md §6.

const crypto = require("node:crypto");
const { canonical, createSyncCrypto, fingerprint } = require("../sync/sync-crypto");
const { QR_PREFIX, macKeyFingerprint, verificationCode } = require("./remote-lan-gateway");

const VECTORS_VERSION = 1;
const SPKI_PREFIX = Object.freeze({ ed25519: "302a300506032b6570032100", x25519: "302a300506032b656e032100" });
const PKCS8_PREFIX = Object.freeze({ ed25519: "302e020100300506032b657004220420", x25519: "302e020100300506032b656e04220420" });

const seed = (label, size = 32) => crypto.createHash("sha256").update(`noon-interop-v1/${label}`).digest().subarray(0, size);

function keyPairFromSeed(kind, label) {
  const raw = seed(label);
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from(PKCS8_PREFIX[kind], "hex"), raw]), format: "der", type: "pkcs8" });
  const publicKey = crypto.createPublicKey(privateKey);
  const spki = publicKey.export({ type: "spki", format: "der" });
  return { raw, privateKey, publicKey, rawPublic: spki.subarray(SPKI_PREFIX[kind].length / 2), publicPem: publicKey.export({ type: "spki", format: "pem" }), privatePem: privateKey.export({ type: "pkcs8", format: "pem" }) };
}

function identityFromSeeds(name, deviceType, displayName) {
  const signing = keyPairFromSeed("ed25519", `${name}/signing`);
  const encryption = keyPairFromSeed("x25519", `${name}/encryption`);
  return {
    keys: { signing, encryption },
    identity: {
      deviceId: `device_interop_${name}`, deviceType, displayName,
      publicSigningKey: signing.publicPem, publicEncryptionKey: encryption.publicPem,
      privateSigningKey: signing.privatePem, privateEncryptionKey: encryption.privatePem,
      keyId: `device-key:${fingerprint(signing.publicPem)}`,
    },
  };
}

function describeKeys({ keys, identity }) {
  return {
    deviceId: identity.deviceId, deviceType: identity.deviceType, displayName: identity.displayName, keyId: identity.keyId,
    signing: { rawPrivateHex: keys.signing.raw.toString("hex"), rawPublicHex: keys.signing.rawPublic.toString("hex"), publicPem: keys.signing.publicPem },
    encryption: { rawPrivateHex: keys.encryption.raw.toString("hex"), rawPublicHex: keys.encryption.rawPublic.toString("hex"), publicPem: keys.encryption.publicPem },
  };
}

function fixedEntropy(label) {
  const ephemeral = keyPairFromSeed("x25519", `${label}/ephemeral`);
  return {
    ephemeral: () => ({ privateKey: ephemeral.privateKey, publicKey: ephemeral.publicKey }),
    salt: () => seed(`${label}/salt`, 16),
    nonce: () => seed(`${label}/nonce`, 12),
    describe: () => ({ ephemeralRawPrivateHex: ephemeral.raw.toString("hex"), ephemeralRawPublicHex: ephemeral.rawPublic.toString("hex"), saltHex: seed(`${label}/salt`, 16).toString("hex"), nonceHex: seed(`${label}/nonce`, 12).toString("hex") }),
  };
}

// Étapes intermédiaires (secret partagé, clé HKDF, AAD, octets signés) pour déboguer
// chaque couche séparément côté Swift.
function intermediate(envelope, recipientEncryption, entropy) {
  const ephemeral = entropy.ephemeral();
  const shared = crypto.diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipientEncryption.publicKey });
  const key = Buffer.from(crypto.hkdfSync("sha256", shared, Buffer.from(envelope.salt, "base64"), Buffer.from("noon-sync-envelope-v1"), 32));
  const { signature, ...unsigned } = envelope;
  const header = Object.fromEntries(Object.entries(unsigned).filter(([name]) => !["ephemeralPublicKey", "salt", "nonce", "authTag", "ciphertext"].includes(name)));
  return {
    sharedSecretHex: shared.toString("hex"), hkdfInfo: "noon-sync-envelope-v1", aesKeyHex: key.toString("hex"),
    aadCanonicalJson: JSON.stringify(canonical(header)), signedCanonicalJson: JSON.stringify(canonical(unsigned)),
  };
}

function envelopeVector({ name, sender, recipient, header, payload }) {
  const entropy = fixedEntropy(`envelope/${name}`);
  const envelope = createSyncCrypto({ identity: sender.identity, entropy }).seal({ targetDevice: recipient.identity, header, payload });
  const tamperedCiphertext = Buffer.from(envelope.ciphertext, "base64"); tamperedCiphertext[0] ^= 0x01;
  return {
    name, from: sender.identity.deviceId, to: recipient.identity.deviceId,
    entropy: entropy.describe(), payload, payloadCanonicalJson: JSON.stringify(canonical(payload)),
    steps: intermediate(envelope, recipient.keys.encryption, entropy), envelope,
    rejections: [
      { name: "ciphertext-bit-flip", envelope: { ...envelope, ciphertext: tamperedCiphertext.toString("base64") }, expectedCode: "SYNC_SIGNATURE_INVALID" },
      { name: "header-changed", envelope: { ...envelope, entityId: `${envelope.entityId}-x` }, expectedCode: "SYNC_SIGNATURE_INVALID" },
      { name: "protocol-version", envelope: { ...envelope, protocolVersion: envelope.protocolVersion + 1 }, expectedCode: "SYNC_PROTOCOL_INCOMPATIBLE" },
    ],
  };
}

function buildInteropVectors() {
  const mac = identityFromSeeds("mac", "MAC_PRIMARY", "Mac de test");
  const iphone = identityFromSeeds("iphone", "IPHONE", "iPhone de test");
  const invitationToken = seed("invitation-token").toString("base64url");
  const qrPayload = { v: 1, host: "192.168.1.20", port: 47830, macDeviceId: mac.identity.deviceId, macKeyFingerprint: macKeyFingerprint(mac.identity), token: invitationToken, expiresAt: "2026-11-21T10:05:00.000Z" };

  return {
    version: VECTORS_VERSION,
    warning: "Clés de test publiques : ne jamais les utiliser hors des tests.",
    conventions: {
      spkiPrefixHex: SPKI_PREFIX,
      pem: "PEM = '-----BEGIN PUBLIC KEY-----\\n' + base64(SPKI DER), lignes de 64 caractères + '\\n-----END PUBLIC KEY-----\\n'",
      canonicalJson: "clés triées récursivement, sans espaces, '/' non échappé, caractères non ASCII en UTF-8 brut",
      binary: "base64 standard (avec '=') dans les enveloppes ; base64url sans '=' pour le QR et le jeton",
    },
    devices: { mac: describeKeys(mac), iphone: describeKeys(iphone) },
    canonicalJson: [
      { input: { b: 1, a: { d: [3, { z: true, y: null }], c: "x" } }, expected: JSON.stringify(canonical({ b: 1, a: { d: [3, { z: true, y: null }], c: "x" } })) },
      { input: { path: "a/b", text: "Café — « ok »\n\"quoted\" \\ end", emoji: "🌙" }, expected: JSON.stringify(canonical({ path: "a/b", text: "Café — « ok »\n\"quoted\" \\ end", emoji: "🌙" })) },
      { input: { n: -42, big: 9007199254740991, empty: {}, list: [] }, expected: JSON.stringify(canonical({ n: -42, big: 9007199254740991, empty: {}, list: [] })) },
    ],
    pairing: {
      invitationToken,
      macKeyFingerprint: qrPayload.macKeyFingerprint,
      macKeyFingerprintInput: "SHA-256 hex de publicSigningKey PEM + publicEncryptionKey PEM du Mac, concaténés",
      verificationCode: verificationCode({ macSigningKey: mac.identity.publicSigningKey, deviceSigningKey: iphone.identity.publicSigningKey, invitationToken }),
      verificationCodeInput: "SHA-256 de `${macSigningPem}\\n${deviceSigningPem}\\n${token}` → 4 premiers octets big-endian % 1 000 000, sur 6 chiffres",
      qrPayload,
      qrJson: JSON.stringify(qrPayload),
      qr: `${QR_PREFIX}${Buffer.from(JSON.stringify(qrPayload)).toString("base64url")}`,
      beginRequest: {
        protocolVersion: 1, invitationToken,
        device: { deviceId: iphone.identity.deviceId, deviceType: "IPHONE", displayName: iphone.identity.displayName, platform: "iOS", appVersion: "0.1.0", publicSigningKey: iphone.identity.publicSigningKey, publicEncryptionKey: iphone.identity.publicEncryptionKey, requestedScopes: ["CONVERSATIONS", "REMOTE_TEXT"], capabilities: ["text"] },
      },
    },
    envelopes: [
      envelopeVector({ name: "iphone-to-mac-request", sender: iphone, recipient: mac, header: { envelopeId: "envelope_interop_request", entityType: "remote.text", entityId: "conversation_interop", operation: "UPSERT", entityVersion: 1, createdAt: "2026-11-21T10:00:00.000Z" }, payload: { text: "Bonjour Noon — où en est le Brief ?", clientSequence: 1 } }),
      envelopeVector({ name: "mac-to-iphone-response", sender: mac, recipient: iphone, header: { envelopeId: "envelope_interop_response", entityType: "remote.text.response", entityId: "conversation_interop", operation: "UPSERT", entityVersion: 1, createdAt: "2026-11-21T10:00:01.000Z" }, payload: { status: "ok", reply: "Le Brief est prêt.", items: [{ id: "a/1", done: false }] } }),
    ],
  };
}

module.exports = { VECTORS_VERSION, buildInteropVectors, identityFromSeeds };
