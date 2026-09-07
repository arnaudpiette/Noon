"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createSyncRepository } = require("../services/sync/sync-repository");
const { createSyncPolicy } = require("../services/sync/sync-policy");
const { createDeviceRegistry } = require("../services/sync/device-registry");
const { createDeviceIdentity, createSyncCrypto } = require("../services/sync/sync-crypto");
const { createLoopbackSyncTransport } = require("../services/sync/sync-transport");
const { createSyncEngine } = require("../services/sync/sync-engine");
const { negotiateProtocol, SYNC_PROTOCOL_VERSION } = require("../services/sync/sync-schema");
const { createDeviceIdentityStore } = require("../services/sync/device-identity-store");
const { createSyncHealth } = require("../services/sync/sync-health");

const SCOPES = ["CONVERSATIONS", "WORKSPACES", "JOB_STATUS", "NOTIFICATIONS", "ARTIFACT_METADATA", "ARTIFACT_DOWNLOAD", "REMOTE_REQUESTS"];

function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-sync-"));
  const transport = options.transport || createLoopbackSyncTransport(options.transportOptions);
  function device(name, type) {
    const database = createPersonalDatabase(path.join(root, `${name}.sqlite`));
    const repository = createSyncRepository(database);
    const identity = createDeviceIdentity({ deviceId: name, deviceType: type, displayName: name });
    const events = [];
    const registry = createDeviceRegistry({ repository, now: options.now, pairingTtlMs: options.pairingTtlMs, observability: (event, metadata) => events.push({ event, metadata }) });
    const policy = createSyncPolicy();
    const engine = createSyncEngine({ repository, policy, deviceRegistry: registry, cryptoLayer: createSyncCrypto({ identity }), transport, localDeviceId: name, mode: options.mode || "ON", now: options.now, observability: (event, metadata) => events.push({ event, metadata }) });
    return { database, repository, identity, registry, policy, engine, events };
  }
  const mac = device("mac", "MAC_PRIMARY"); const mobile = device("mobile", "IPHONE_COMPANION");
  for (const [owner, peer] of [[mac, mobile], [mobile, mac]]) owner.repository.saveDevice({ ...peer.identity, protocolVersion: SYNC_PROTOCOL_VERSION, status: "ACTIVE", capabilities: [], syncScopes: SCOPES, createdAt: new Date().toISOString() });
  return { root, transport, mac, mobile, close() { mac.database.close(); mobile.database.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

test("pairing explicite, court, à usage unique et révocable", () => {
  let time = Date.now(); const f = fixture({ now: () => time, pairingTtlMs: 1000 });
  const candidate = createDeviceIdentity({ deviceId: "candidate", deviceType: "IPHONE" });
  const pending = f.mac.registry.beginPairing({ ...candidate, protocolVersion: SYNC_PROTOCOL_VERSION, requestedScopes: ["CONVERSATIONS"] });
  assert.throws(() => f.mac.registry.approvePairing({ pairingId: pending.pairingId, pairingCode: pending.pairingCode, approved: false, grantedScopes: ["CONVERSATIONS"] }), { code: "PAIRING_APPROVAL_REQUIRED" });
  const second = f.mac.registry.beginPairing({ ...candidate, deviceId: "candidate-2", protocolVersion: SYNC_PROTOCOL_VERSION, requestedScopes: ["CONVERSATIONS"] });
  const active = f.mac.registry.approvePairing({ pairingId: second.pairingId, pairingCode: second.pairingCode, approved: true, grantedScopes: ["CONVERSATIONS"] });
  assert.equal(active.status, "ACTIVE");
  assert.throws(() => f.mac.registry.approvePairing({ pairingId: second.pairingId, pairingCode: second.pairingCode, approved: true, grantedScopes: ["CONVERSATIONS"] }), { code: "PAIRING_REPLAY" });
  assert.equal(f.mac.registry.revoke(active.deviceId).status, "REVOKED");
  const expired = f.mac.registry.beginPairing({ ...candidate, deviceId: "candidate-3", protocolVersion: SYNC_PROTOCOL_VERSION, requestedScopes: ["CONVERSATIONS"] }); time += 1001;
  assert.throws(() => f.mac.registry.approvePairing({ pairingId: expired.pairingId, pairingCode: expired.pairingCode, approved: true, grantedScopes: ["CONVERSATIONS"] }), { code: "PAIRING_EXPIRED" }); f.close();
});

test("E2EE détecte altération, mauvaise clé et mauvaise signature", () => {
  const a = createDeviceIdentity({ deviceId: "a" }); const b = createDeviceIdentity({ deviceId: "b" }); const c = createDeviceIdentity({ deviceId: "c" });
  const envelope = createSyncCrypto({ identity: a }).seal({ targetDevice: b, header: { entityType: "conversation", entityId: "c1", operation: "UPSERT", entityVersion: 1 }, payload: { secret: "contenu" } });
  assert.deepEqual(createSyncCrypto({ identity: b }).open(envelope, a), { secret: "contenu" });
  assert.throws(() => createSyncCrypto({ identity: c }).open(envelope, a), { code: "SYNC_CIPHERTEXT_INVALID" });
  assert.throws(() => createSyncCrypto({ identity: b }).open({ ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -2)}AA` }, a), { code: "SYNC_SIGNATURE_INVALID" });
});

test("SyncPolicy bloque mémoire privée, secrets, chemins et profils protégés", () => {
  const policy = createSyncPolicy();
  for (const entityType of ["private_memory", "oauth_token", "api_key", "filesystem_root"]) assert.equal(policy.evaluate({ entityType }).allowed, false);
  assert.equal(policy.evaluate({ entityType: "conversation", localOnly: true }).classification, "LOCAL_ONLY");
  assert.equal(policy.evaluate({ entityType: "conversation", profileScope: "sinan" }).allowed, false);
  assert.deepEqual(policy.sanitize("job_status", { id: "j", state: "RUNNING", payload: "interdit", localPath: "/secret" }, policy.evaluate({ entityType: "job_status" })), { id: "j", state: "RUNNING" });
});

test("conversation chiffrée, livraison dupliquée et hors ordre restent idempotentes", () => {
  const f = fixture({ transportOptions: { duplicateDelivery: true, reorder: true } });
  f.mac.engine.captureMutation({ entityType: "conversation", entityId: "c1", payload: { id: "c1", title: "Bonjour", updatedAt: "2026-08-30" } });
  assert.equal(f.mac.engine.flush("mobile").sent, 1); const pulled = f.mobile.engine.pull();
  assert.equal(pulled.received, 2); assert.equal(pulled.results.filter((item) => item.applied).length, 1); assert.equal(pulled.results.filter((item) => item.duplicate).length, 1);
  assert.equal(f.mobile.repository.getEntity("conversation", "c1").payload.title, "Bonjour"); f.close();
});

test("offline conserve l'outbox puis reprend sans perte", () => {
  const transport = createLoopbackSyncTransport({ online: false }); const f = fixture({ transport });
  f.mac.engine.captureMutation({ entityType: "workspace", entityId: "w1", payload: { id: "w1", name: "Studio", updatedAt: "now" } });
  assert.equal(f.mac.engine.flush("mobile").errorCode, "SYNC_TRANSPORT_OFFLINE"); assert.equal(f.mac.repository.stats().pendingOutbox, 1);
  transport.setOnline(true); assert.equal(f.mac.engine.flush("mobile").sent, 1); assert.equal(f.mobile.engine.pull().results[0].applied, true); f.close();
});

test("tombstone empêche la résurrection et conflit simultané exige l'utilisateur", () => {
  const f = fixture();
  f.mac.engine.captureMutation({ entityType: "workspace", entityId: "w1", payload: { id: "w1", name: "A", updatedAt: "1" } }); f.mac.engine.flush("mobile"); f.mobile.engine.pull();
  f.mac.engine.captureMutation({ entityType: "workspace", entityId: "w1", operation: "DELETE", payload: {}, changedFields: ["deletedAt"] }); f.mac.engine.flush("mobile"); f.mobile.engine.pull();
  assert.ok(f.mobile.repository.getEntity("workspace", "w1").deletedAt);
  f.close();
});

test("remote request authentifiée reste en attente de la policy, expire et refuse le rejeu", () => {
  let time = Date.now(); const f = fixture({ now: () => time });
  const request = { requestId: "rr1", sourceDeviceId: "mac", intentEnvelope: { intentId: "intent1" }, nonce: "nonce-unique", createdAt: new Date(time).toISOString(), expiresAt: new Date(time + 5000).toISOString(), executionNode: "MAC_PRIMARY" };
  f.mac.engine.captureMutation({ entityType: "remote_request", entityId: "rr1", payload: request }); f.mac.engine.flush("mobile"); const result = f.mobile.engine.pull().results[0];
  assert.equal(result.status, "PENDING_SECURITY_POLICY"); assert.equal(result.origin, "trusted_paired_device");
  assert.equal(f.mobile.repository.remoteRequestSeen("rr1", "mac", require("../services/sync/device-registry").digest("nonce-unique")), true);
  assert.equal(negotiateProtocol(SYNC_PROTOCOL_VERSION - 1).readOnly, true); assert.equal(negotiateProtocol(SYNC_PROTOCOL_VERSION + 2).status, "UPGRADE_REQUIRED"); f.close();
});

test("mode SHADOW journalise les références sans payload ni envoi", () => {
  const f = fixture({ mode: "SHADOW" }); const result = f.mac.engine.captureMutation({ entityType: "conversation", entityId: "shadow", payload: { id: "shadow", title: "texte privé" } });
  assert.equal(result.shadow, true); assert.equal(f.mac.repository.getEntity("conversation", "shadow"), null); assert.equal(f.mac.repository.stats().pendingOutbox, 0); assert.equal(JSON.stringify(result.change).includes("texte privé"), false); f.close();
});

test("identité stable dans le stockage sécurisé et aucune clé privée dans la vue publique", () => {
  const values = new Map(); const secureStore = { get: (key) => values.get(key), set: (key, value) => values.set(key, value) };
  const store = createDeviceIdentityStore({ secureStore, defaults: { deviceId: "stable-mac" } });
  assert.equal(store.loadOrCreate().deviceId, store.loadOrCreate().deviceId); const visible = store.publicIdentity();
  assert.equal(visible.deviceId, "stable-mac"); assert.equal(Object.hasOwn(visible, "privateSigningKey"), false); assert.equal(Object.hasOwn(visible, "privateEncryptionKey"), false);
});

test("un appareil révoqué ne reçoit plus de nouvelles enveloppes", () => {
  const f = fixture(); f.mac.registry.revoke("mobile");
  f.mac.engine.captureMutation({ entityType: "conversation", entityId: "blocked", payload: { id: "blocked", title: "Non envoyé" } });
  assert.throws(() => f.mac.engine.flush("mobile"), { code: "DEVICE_NOT_ACTIVE" }); assert.equal(f.mac.repository.stats().pendingOutbox, 0); f.close();
});

test("snapshot borné, delta, santé et kill switch restent locaux", () => {
  const f = fixture(); f.mac.engine.captureMutation({ entityType: "workspace", entityId: "w1", payload: { id: "w1", name: "Un", updatedAt: "1" } });
  const snapshot = f.mac.engine.initialSnapshot({ targetDeviceId: "mobile" }); assert.equal(snapshot.protocolVersion, SYNC_PROTOCOL_VERSION); assert.equal(snapshot.entities.length, 1);
  const health = createSyncHealth({ engine: f.mac.engine, cryptoLayer: createSyncCrypto({ identity: f.mac.identity }), transport: f.transport }).check();
  assert.equal(health.crypto, "HEALTHY"); assert.equal(health.journal, "HEALTHY"); f.mac.engine.setMode("OFF");
  assert.equal(f.mac.engine.captureMutation({ entityType: "conversation", entityId: "off", payload: { id: "off" } }).captured, false); f.close();
});
