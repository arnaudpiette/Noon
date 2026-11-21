"use strict";

// Compagnon iPhone — IP-1 : passerelle réseau local. Un client Node imite l'iPhone :
// clés brutes de 32 octets enveloppées en SPKI (comme CryptoKit), enveloppes sync-crypto.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createSyncRepository } = require("../services/sync/sync-repository");
const { createDeviceRegistry } = require("../services/sync/device-registry");
const { createDeviceIdentity, createSyncCrypto } = require("../services/sync/sync-crypto");
const { QR_PREFIX, createRemoteLanGateway, isPrivateAddress, macKeyFingerprint, verificationCode } = require("../services/remote/remote-lan-gateway");

const SPKI_PREFIX = { ed25519: "302a300506032b6570032100", x25519: "302a300506032b656e032100" };

// Ce que ferait l'iPhone : clé brute (CryptoKit rawRepresentation) → SPKI DER → PEM.
function rawToPem(type, raw) {
  const der = Buffer.concat([Buffer.from(SPKI_PREFIX[type], "hex"), raw]);
  return `-----BEGIN PUBLIC KEY-----\n${der.toString("base64")}\n-----END PUBLIC KEY-----\n`;
}
function rawPublic(keyObject) { return Buffer.from(keyObject.export({ format: "jwk" }).x, "base64url"); }

function makePhone(deviceId = `device_${crypto.randomUUID()}`) {
  const signing = crypto.generateKeyPairSync("ed25519");
  const encryption = crypto.generateKeyPairSync("x25519");
  const identity = {
    deviceId, deviceType: "IPHONE", displayName: "iPhone d'essai",
    publicSigningKey: rawToPem("ed25519", rawPublic(signing.publicKey)),
    publicEncryptionKey: rawToPem("x25519", rawPublic(encryption.publicKey)),
    privateSigningKey: signing.privateKey.export({ type: "pkcs8", format: "pem" }),
    privateEncryptionKey: encryption.privateKey.export({ type: "pkcs8", format: "pem" }),
    keyId: "phone-key",
  };
  return { identity, crypto: createSyncCrypto({ identity }) };
}

async function setup({ now = () => Date.now(), enabled = true, onEnvelope = async ({ payload }) => ({ echo: payload }) } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-lan-"));
  const repository = createSyncRepository(createPersonalDatabase(path.join(root, "mac.sqlite")));
  const registry = createDeviceRegistry({ repository, now });
  const macIdentity = createDeviceIdentity({ deviceId: "mac-primary", deviceType: "MAC_PRIMARY", displayName: "Mac" });
  let flag = enabled;
  const gateway = createRemoteLanGateway({ deviceRegistry: registry, macIdentity, onEnvelope, isEnabled: () => flag, now, allowLoopback: true });
  const server = await gateway.listen({ port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (route, body, headers = { "Content-Type": "application/json" }) => {
    const response = await fetch(`${base}${route}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const get = async (route) => { const response = await fetch(`${base}${route}`); return { status: response.status, body: await response.json() }; };
  const close = () => new Promise((resolve) => server.close(resolve));
  return { gateway, registry, macIdentity, post, get, close, setFlag: (value) => { flag = value; } };
}

// Parcours complet côté iPhone jusqu'à l'approbation sur le Mac.
async function pairPhone(h, phone = makePhone(), scopes = ["REMOTE_TEXT", "JOB_STATUS"]) {
  const invitation = h.gateway.createInvitation({ host: "127.0.0.1", port: 50_123 });
  const scanned = JSON.parse(Buffer.from(invitation.qr.slice(QR_PREFIX.length), "base64url").toString("utf8"));
  const begin = await h.post("/v1/pair/begin", { protocolVersion: 1, invitationToken: scanned.token, device: { ...phone.identity, privateSigningKey: undefined, privateEncryptionKey: undefined, requestedScopes: scopes } });
  assert.equal(begin.status, 200, JSON.stringify(begin.body));
  return { phone, scanned, begin: begin.body };
}

test("appairage : le QR épingle le Mac, code de vérification identique des deux côtés, approbation sur le Mac", async () => {
  const h = await setup();
  try {
    const { phone, scanned, begin } = await pairPhone(h);
    assert.equal(macKeyFingerprint(begin.mac), scanned.macKeyFingerprint, "l'iPhone vérifie les clés du Mac contre l'empreinte du QR");
    const phoneSide = verificationCode({ macSigningKey: begin.mac.publicSigningKey, deviceSigningKey: phone.identity.publicSigningKey, invitationToken: scanned.token });
    assert.match(phoneSide, /^\d{6}$/);
    const [pending] = h.gateway.pendingPairings();
    assert.equal(pending.verificationCode, phoneSide, "même code sur le Mac et sur l'iPhone");
    assert.equal(JSON.stringify(begin).includes("pairingCode"), false, "le code d'appairage ne quitte pas le Mac");
    assert.equal((await h.get(`/v1/pair/status?pairingId=${begin.pairingId}`)).body.state, "PENDING");
    assert.throws(() => h.gateway.approve(begin.pairingId, { grantedScopes: ["REMOTE_APPROVALS"] }), { code: "PAIRING_SCOPE_ESCALATION" });
    const device = h.gateway.approve(begin.pairingId, { grantedScopes: ["REMOTE_TEXT"] });
    assert.deepEqual(device.syncScopes, ["REMOTE_TEXT"]);
    assert.equal((await h.get(`/v1/pair/status?pairingId=${begin.pairingId}`)).body.state, "APPROVED");
  } finally { await h.close(); }
});

test("enveloppes : requête signée et chiffrée par l'iPhone, réponse chiffrée pour lui seul", async () => {
  const seen = [];
  const h = await setup({ onEnvelope: async ({ device, header, payload }) => { seen.push({ device: device.deviceId, header, payload }); return { brief: "Bonjour" }; } });
  try {
    const { phone, begin } = await pairPhone(h);
    h.gateway.approve(begin.pairingId, { grantedScopes: ["REMOTE_TEXT"] });
    const macDevice = { deviceId: begin.mac.deviceId, ...begin.mac };
    const envelope = phone.crypto.seal({ targetDevice: macDevice, header: { entityType: "brief", entityId: "today", operation: "UPSERT", entityVersion: 1 }, payload: { want: "brief" } });
    const response = await h.post("/v1/envelopes", envelope);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(seen[0].payload, { want: "brief" });
    assert.equal(seen[0].device, phone.identity.deviceId);
    assert.deepEqual(phone.crypto.open(response.body.envelope, macDevice), { brief: "Bonjour" }, "l'iPhone vérifie la signature du Mac et déchiffre");
    assert.equal(response.body.envelope.targetDeviceId, phone.identity.deviceId);
    assert.equal(JSON.stringify(response.body).includes("Bonjour"), false, "réponse chiffrée sur le réseau");
    // Rejeu, destinataire, altération, fraîcheur, révocation.
    assert.equal((await h.post("/v1/envelopes", envelope)).body.code, "REMOTE_LAN_REPLAY");
    const wrongTarget = phone.crypto.seal({ targetDevice: { ...macDevice, deviceId: "autre-mac" }, header: { entityType: "brief", entityId: "x", operation: "UPSERT", entityVersion: 1 }, payload: {} });
    assert.equal((await h.post("/v1/envelopes", wrongTarget)).body.code, "REMOTE_LAN_WRONG_TARGET");
    const tampered = { ...phone.crypto.seal({ targetDevice: macDevice, header: { entityType: "brief", entityId: "y", operation: "UPSERT", entityVersion: 1 }, payload: { a: 1 } }), entityId: "z" };
    assert.equal((await h.post("/v1/envelopes", tampered)).body.code, "REMOTE_LAN_ENVELOPE_INVALID");
    const stale = phone.crypto.seal({ targetDevice: macDevice, header: { entityType: "brief", entityId: "old", operation: "UPSERT", entityVersion: 1, createdAt: new Date(Date.now() - 3_600_000).toISOString() }, payload: {} });
    assert.equal((await h.post("/v1/envelopes", stale)).body.code, "REMOTE_LAN_STALE");
    h.registry.revoke(phone.identity.deviceId);
    const afterRevoke = phone.crypto.seal({ targetDevice: macDevice, header: { entityType: "brief", entityId: "r", operation: "UPSERT", entityVersion: 1 }, payload: {} });
    assert.equal((await h.post("/v1/envelopes", afterRevoke)).body.code, "REMOTE_LAN_DEVICE_NOT_ACTIVE");
    assert.equal(seen.length, 1, "aucune enveloppe refusée n'atteint le traitement");
  } finally { await h.close(); }
});

test("appareil non appairé ou en attente : enveloppe refusée", async () => {
  const h = await setup();
  try {
    const stranger = makePhone();
    const macDevice = { deviceId: h.gateway.mac.deviceId, ...h.gateway.mac };
    const envelope = stranger.crypto.seal({ targetDevice: macDevice, header: { entityType: "brief", entityId: "x", operation: "UPSERT", entityVersion: 1 }, payload: {} });
    assert.equal((await h.post("/v1/envelopes", envelope)).body.code, "REMOTE_LAN_DEVICE_NOT_ACTIVE");
    const { phone } = await pairPhone(h);
    const pending = phone.crypto.seal({ targetDevice: macDevice, header: { entityType: "brief", entityId: "y", operation: "UPSERT", entityVersion: 1 }, payload: {} });
    assert.equal((await h.post("/v1/envelopes", pending)).body.code, "REMOTE_LAN_DEVICE_NOT_ACTIVE", "en attente d'approbation : refusé");
  } finally { await h.close(); }
});

test("invitation : usage unique, expiration, jeton inconnu ; appareil non mobile et clé invalide refusés sans trace", async () => {
  let clock = Date.now();
  const h = await setup({ now: () => clock });
  try {
    const phone = makePhone();
    const device = { ...phone.identity, privateSigningKey: undefined, privateEncryptionKey: undefined, requestedScopes: ["REMOTE_TEXT"] };
    const first = h.gateway.createInvitation({ host: "127.0.0.1", port: 50_123 });
    assert.equal((await h.post("/v1/pair/begin", { protocolVersion: 1, invitationToken: first.payload.token, device })).status, 200);
    assert.equal((await h.post("/v1/pair/begin", { protocolVersion: 1, invitationToken: first.payload.token, device: { ...device, deviceId: "autre" } })).body.code, "REMOTE_LAN_INVITATION_INVALID");
    assert.equal((await h.post("/v1/pair/begin", { protocolVersion: 1, invitationToken: "inconnu", device })).body.code, "REMOTE_LAN_INVITATION_INVALID");
    const late = h.gateway.createInvitation({ host: "127.0.0.1", port: 50_123 });
    clock += 6 * 60_000;
    assert.equal((await h.post("/v1/pair/begin", { protocolVersion: 1, invitationToken: late.payload.token, device: { ...device, deviceId: "tard" } })).body.code, "REMOTE_LAN_INVITATION_INVALID");
    const mac = h.gateway.createInvitation({ host: "127.0.0.1", port: 50_123 });
    assert.equal((await h.post("/v1/pair/begin", { protocolVersion: 1, invitationToken: mac.payload.token, device: { ...device, deviceId: "mac-2", deviceType: "MAC_SECONDARY" } })).body.code, "REMOTE_LAN_DEVICE_INVALID");
    const before = h.registry.list().length;
    const broken = h.gateway.createInvitation({ host: "127.0.0.1", port: 50_123 });
    const refused = await h.post("/v1/pair/begin", { protocolVersion: 1, invitationToken: broken.payload.token, device: { ...device, deviceId: "cle-invalide", publicSigningKey: "pas une clé" } });
    assert.equal(refused.status, 400);
    assert.equal(h.registry.list().length, before, "aucun appareil en attente créé pour une clé invalide");
    assert.throws(() => h.gateway.createInvitation({ host: "8.8.8.8", port: 50_123 }), { code: "REMOTE_LAN_HOST_INVALID" });
  } finally { await h.close(); }
});

test("refus d'un appairage sur le Mac : état REJECTED, plus d'approbation possible", async () => {
  const h = await setup();
  try {
    const { begin } = await pairPhone(h);
    assert.equal(h.gateway.reject(begin.pairingId), true);
    assert.equal(h.gateway.pairingStatus(begin.pairingId).state, "REJECTED");
    assert.throws(() => h.gateway.approve(begin.pairingId, { grantedScopes: ["REMOTE_TEXT"] }), { code: "REMOTE_LAN_PAIRING_UNAVAILABLE" });
    assert.deepEqual(h.gateway.pendingPairings(), []);
  } finally { await h.close(); }
});

test("transport : passerelle désactivée → 404 ; JSON requis ; corps borné ; route inconnue", async () => {
  const h = await setup();
  try {
    assert.equal((await h.post("/v1/pair/begin", "x=1", { "Content-Type": "text/plain" })).body.code, "REMOTE_LAN_CONTENT_TYPE");
    assert.equal((await h.post("/v1/pair/begin", { pad: "x".repeat(70 * 1024) })).body.code, "REMOTE_LAN_BODY_TOO_LARGE");
    assert.equal((await h.get("/api/settings")).body.code, "REMOTE_LAN_ROUTE_UNKNOWN", "aucune route du serveur local de Noon");
    h.setFlag(false);
    assert.equal((await h.get("/v1/pair/status?pairingId=x")).status, 404);
  } finally { await h.close(); }
});

test("origines : réseau local privé seulement ; boucle locale refusée par défaut ; limitation de débit", async () => {
  for (const address of ["192.168.1.20", "10.0.0.5", "172.16.3.4", "172.31.255.1", "169.254.10.1", "::ffff:192.168.1.20", "fd12:3456::1", "fe80::1"]) assert.equal(isPrivateAddress(address), true, address);
  for (const address of ["8.8.8.8", "172.32.0.1", "100.64.0.1", "2001:4860::8888", "127.0.0.1", "::1", "", "nimporte"]) assert.equal(isPrivateAddress(address), false, address);
  assert.equal(isPrivateAddress("127.0.0.1", { allowLoopback: true }), true);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-lan-"));
  const registry = createDeviceRegistry({ repository: createSyncRepository(createPersonalDatabase(path.join(root, "m.sqlite"))) });
  const gateway = createRemoteLanGateway({ deviceRegistry: registry, macIdentity: createDeviceIdentity({ deviceId: "mac" }), onEnvelope: async () => ({}), isEnabled: () => true, rateLimit: { windowMs: 10_000, max: 2 } });
  const call = async (remoteAddress) => {
    let status = 0; let payload = "";
    const req = { method: "GET", url: "/v1/pair/status?pairingId=x", headers: {}, socket: { remoteAddress }, async *[Symbol.asyncIterator]() {} };
    await gateway.handler(req, { writeHead: (code) => { status = code; }, end: (text) => { payload = text; } });
    return { status, code: JSON.parse(payload).code };
  };
  assert.equal((await call("203.0.113.9")).code, "REMOTE_LAN_ORIGIN_REFUSED");
  assert.equal((await call("127.0.0.1")).code, "REMOTE_LAN_ORIGIN_REFUSED", "boucle locale refusée hors tests");
  assert.equal((await call("192.168.1.30")).status, 200);
  assert.equal((await call("192.168.1.30")).status, 200);
  assert.equal((await call("192.168.1.30")).code, "REMOTE_LAN_RATE_LIMITED");
});

test("interopérabilité : préfixes SPKI conformes aux clés générées par Node", () => {
  for (const type of ["ed25519", "x25519"]) {
    const { publicKey } = crypto.generateKeyPairSync(type);
    const der = publicKey.export({ type: "spki", format: "der" });
    assert.equal(der.subarray(0, 12).toString("hex"), SPKI_PREFIX[type], type);
    assert.deepEqual(der.subarray(12), rawPublic(publicKey));
  }
});
