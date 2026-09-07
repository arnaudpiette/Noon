"use strict";

const crypto = require("node:crypto");
const { DEVICE_SCOPES, DEVICE_STATUSES, DEVICE_TYPES, SYNC_PROTOCOL_VERSION, negotiateProtocol } = require("./sync-schema");

function digest(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function equalDigest(left, right) { const a = Buffer.from(String(left), "hex"); const b = Buffer.from(String(right), "hex"); return a.length === b.length && crypto.timingSafeEqual(a, b); }

function createDeviceRegistry({ repository, now = () => Date.now(), pairingTtlMs = 5 * 60_000, observability = null, onRevoked = null } = {}) {
  if (!repository?.saveDevice) throw new TypeError("SyncRepository requis.");
  const emit = (event, metadata) => observability?.(event, metadata);
  function beginPairing(request = {}) {
    if (!DEVICE_TYPES.includes(request.deviceType)) throw Object.assign(new Error("Type d'appareil invalide."), { code: "DEVICE_TYPE_INVALID" });
    if (!request.deviceId || !request.publicSigningKey || !request.publicEncryptionKey) throw Object.assign(new Error("Identité cryptographique incomplète."), { code: "DEVICE_IDENTITY_INVALID" });
    const compatibility = negotiateProtocol(request.protocolVersion);
    if (compatibility.status === "UPGRADE_REQUIRED") throw Object.assign(new Error("Version du client incompatible."), { code: "SYNC_PROTOCOL_INCOMPATIBLE" });
    const requestedScopes = [...new Set(request.requestedScopes || [])];
    if (requestedScopes.some((scope) => !DEVICE_SCOPES.includes(scope))) throw Object.assign(new Error("Scope de synchronisation invalide."), { code: "DEVICE_SCOPE_INVALID" });
    const pairingCode = crypto.randomBytes(32).toString("base64url"); const createdAt = new Date(now()).toISOString();
    const pairing = repository.savePairing({ pairingId: `pairing_${crypto.randomUUID()}`, deviceId: request.deviceId, codeHash: digest(pairingCode), state: "PENDING", createdAt, expiresAt: new Date(now() + pairingTtlMs).toISOString(), request: { deviceId: request.deviceId, deviceType: request.deviceType, displayName: String(request.displayName || request.deviceType).slice(0, 100), platform: String(request.platform || "").slice(0, 50), appVersion: String(request.appVersion || "").slice(0, 30), protocolVersion: request.protocolVersion, publicSigningKey: request.publicSigningKey, publicEncryptionKey: request.publicEncryptionKey, capabilities: [...new Set(request.capabilities || [])].slice(0, 30), requestedScopes, compatibility } });
    repository.saveDevice({ ...pairing.request, syncScopes: [], status: "PENDING", createdAt });
    emit("device_pairing_started", { pairingId: pairing.pairingId, deviceIdHash: digest(request.deviceId).slice(0, 16), scopeCount: requestedScopes.length });
    return { pairingId: pairing.pairingId, pairingCode, expiresAt: pairing.expiresAt, requestedScopes };
  }
  function approvePairing({ pairingId, pairingCode, approved = false, grantedScopes = [], syncWindow = { mode: "FUTURE_ONLY" } } = {}) {
    const pairing = repository.getPairing(pairingId);
    if (!pairing || pairing.state !== "PENDING") throw Object.assign(new Error("Pairing absent ou déjà consommé."), { code: "PAIRING_REPLAY" });
    if (Date.parse(pairing.expiresAt) <= now()) { repository.consumePairing(pairingId, "EXPIRED"); throw Object.assign(new Error("Pairing expiré."), { code: "PAIRING_EXPIRED" }); }
    if (!equalDigest(pairing.codeHash, digest(pairingCode))) throw Object.assign(new Error("Code de pairing invalide."), { code: "PAIRING_CODE_INVALID" });
    if (approved !== true) { repository.consumePairing(pairingId, "REJECTED"); throw Object.assign(new Error("Approbation explicite requise."), { code: "PAIRING_APPROVAL_REQUIRED" }); }
    const requested = pairing.request.requestedScopes || []; const scopes = [...new Set(grantedScopes)];
    if (!scopes.length || scopes.some((scope) => !requested.includes(scope))) throw Object.assign(new Error("Les scopes accordés doivent être un sous-ensemble explicite."), { code: "PAIRING_SCOPE_ESCALATION" });
    repository.consumePairing(pairingId, "APPROVED"); const pairedAt = new Date(now()).toISOString();
    const device = repository.saveDevice({ ...pairing.request, syncScopes: scopes, syncWindow, status: "ACTIVE", pairedAt, lastSeenAt: pairedAt, createdAt: pairing.createdAt });
    emit("device_paired", { deviceIdHash: digest(device.deviceId).slice(0, 16), scopeCount: scopes.length }); return device;
  }
  function revoke(deviceId) { const current = repository.getDevice(deviceId); if (!current) throw Object.assign(new Error("Appareil introuvable."), { code: "DEVICE_NOT_FOUND" }); const revokedAt = new Date(now()).toISOString(); const device = repository.saveDevice({ ...current, status: "REVOKED", revokedAt, lastSeenAt: current.lastSeenAt }); onRevoked?.(device); emit("device_revoked", { deviceIdHash: digest(deviceId).slice(0, 16) }); return device; }
  function suspend(deviceId) { const current = repository.getDevice(deviceId); if (!current || current.status !== "ACTIVE") throw Object.assign(new Error("Appareil actif introuvable."), { code: "DEVICE_NOT_ACTIVE" }); return repository.saveDevice({ ...current, status: "SUSPENDED" }); }
  function assertAuthorized(deviceId, scope = null) { const device = repository.getDevice(deviceId); if (!device || device.status !== "ACTIVE") throw Object.assign(new Error("Appareil non autorisé."), { code: "DEVICE_NOT_ACTIVE" }); if (scope && !device.syncScopes.includes(scope)) throw Object.assign(new Error("Scope appareil manquant."), { code: "DEVICE_SCOPE_MISSING" }); return device; }
  return { approvePairing, assertAuthorized, beginPairing, get: repository.getDevice, list: repository.listDevices, revoke, statuses: DEVICE_STATUSES, suspend };
}

module.exports = { createDeviceRegistry, digest };
