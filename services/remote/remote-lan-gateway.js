"use strict";

// Compagnon iPhone — IP-1 : passerelle réseau local, séparée du serveur local de Noon.
// - Invitation (QR) émise par le Mac : épingle l'empreinte de ses clés et porte un jeton
//   à usage unique ; c'est ce qui authentifie le Mac auprès de l'iPhone.
// - Appairage : identité de l'appareil + jeton → beginPairing ; code de vérification à
//   6 chiffres affiché des deux côtés ; approbation explicite sur le Mac uniquement.
// - Enveloppes : toute requête est une enveloppe sync-crypto signée par l'appareil et
//   chiffrée pour le Mac ; destinataire, fraîcheur et rejeu sont vérifiés ici.
// - Origines : réseau local privé uniquement ; corps bornés ; débit limité.
// Aucune exécution ici : le traitement d'une enveloppe est délégué à `onEnvelope`.
// Voir docs/IPHONE_COMPANION_V1_DESIGN.md §4-§6.

const crypto = require("node:crypto");
const http = require("node:http");
const net = require("node:net");
const { createSyncCrypto } = require("../sync/sync-crypto");
const { SYNC_PROTOCOL_VERSION } = require("../sync/sync-schema");

const MOBILE_TYPES = new Set(["IPHONE", "IPAD"]);
const DEFAULT_INVITATION_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_CLOCK_SKEW_MS = 5 * 60_000;
const QR_PREFIX = "noon-pair:";

function gatewayError(status, code, message) { return Object.assign(new Error(message), { status, code }); }

// Empreinte épinglée par le QR : SHA-256 (hex) des deux clés publiques PEM concaténées.
function macKeyFingerprint(identity) {
  return crypto.createHash("sha256").update(`${identity.publicSigningKey}${identity.publicEncryptionKey}`).digest("hex");
}

// Code de vérification (SAS) : 6 chiffres dérivés des deux clés de signature et du jeton.
function verificationCode({ macSigningKey, deviceSigningKey, invitationToken }) {
  const digest = crypto.createHash("sha256").update(`${macSigningKey}\n${deviceSigningKey}\n${invitationToken}`).digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

// Réseau local privé : RFC 1918, lien local, ULA et lien local IPv6 (et leurs formes IPv4 mappées).
function isPrivateAddress(address, { allowLoopback = false } = {}) {
  let value = String(address || "").trim().toLowerCase();
  if (value.startsWith("::ffff:")) value = value.slice(7);
  if (net.isIPv4(value)) {
    const [a, b] = value.split(".").map(Number);
    if (a === 127) return allowLoopback;
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (net.isIPv6(value)) {
    if (value === "::1") return allowLoopback;
    return /^f[cd][0-9a-f]{2}:/.test(value) || /^fe[89ab][0-9a-f]:/.test(value);
  }
  return false;
}

function createRemoteLanGateway({
  deviceRegistry, macIdentity, onEnvelope, isEnabled = () => false,
  now = () => Date.now(), invitationTtlMs = DEFAULT_INVITATION_TTL_MS, maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  clockSkewMs = DEFAULT_CLOCK_SKEW_MS, allowLoopback = false, rateLimit = { windowMs: 10_000, max: 30 },
  observability = () => {},
} = {}) {
  if (!deviceRegistry?.beginPairing || !deviceRegistry?.approvePairing || !deviceRegistry?.assertAuthorized) throw new TypeError("DeviceRegistry requis.");
  if (!macIdentity?.privateSigningKey || typeof onEnvelope !== "function") throw new TypeError("Identité du Mac et onEnvelope requis.");
  const syncCrypto = createSyncCrypto({ identity: macIdentity });
  const mac = Object.freeze(syncCrypto.identity());
  const invitations = new Map(); // jeton → { expiresAt, used }
  const pairings = new Map();    // pairingId → { pairingCode, deviceId, displayName, verificationCode, requestedScopes, expiresAt, state }
  const seenEnvelopes = new Map(); // envelopeId → expiration (anti-rejeu)
  const hits = new Map();        // adresse → [horodatages]
  const emit = (event, metadata = {}) => { try { observability(event, metadata); } catch {} };

  function prune() {
    const current = now();
    for (const [token, entry] of invitations) if (entry.expiresAt <= current || entry.used) invitations.delete(token);
    for (const [id, expiresAt] of seenEnvelopes) if (expiresAt <= current) seenEnvelopes.delete(id);
    for (const [id, entry] of pairings) if (entry.state === "PENDING" && entry.expiresAt <= current) entry.state = "EXPIRED";
  }

  // Côté Mac (Control Center, IP-3) : invitation à afficher en QR.
  function createInvitation({ host, port }) {
    if (!net.isIP(String(host || "")) || !isPrivateAddress(host, { allowLoopback })) throw gatewayError(400, "REMOTE_LAN_HOST_INVALID", "Adresse locale invalide.");
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw gatewayError(400, "REMOTE_LAN_PORT_INVALID", "Port invalide.");
    prune();
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = now() + invitationTtlMs;
    invitations.set(token, { expiresAt, used: false });
    const payload = { v: SYNC_PROTOCOL_VERSION, host, port, macDeviceId: mac.deviceId, macKeyFingerprint: macKeyFingerprint(mac), token, expiresAt: new Date(expiresAt).toISOString() };
    emit("remote.lan.invitation_created", {});
    return Object.freeze({ payload, qr: `${QR_PREFIX}${Buffer.from(JSON.stringify(payload)).toString("base64url")}`, expiresAt: payload.expiresAt });
  }

  function pendingPairings() {
    prune();
    return [...pairings.entries()].filter(([, entry]) => entry.state === "PENDING")
      .map(([pairingId, entry]) => Object.freeze({ pairingId, deviceId: entry.deviceId, displayName: entry.displayName, verificationCode: entry.verificationCode, requestedScopes: [...entry.requestedScopes], expiresAt: new Date(entry.expiresAt).toISOString() }));
  }

  // Approbation explicite sur le Mac, après comparaison des codes ; le code d'appairage ne
  // quitte jamais le Mac.
  function approve(pairingId, { grantedScopes = [] } = {}) {
    prune();
    const entry = pairings.get(pairingId);
    if (!entry || entry.state !== "PENDING") throw gatewayError(409, "REMOTE_LAN_PAIRING_UNAVAILABLE", "Appairage absent, expiré ou déjà traité.");
    const device = deviceRegistry.approvePairing({ pairingId, pairingCode: entry.pairingCode, approved: true, grantedScopes });
    entry.state = "APPROVED"; entry.pairingCode = null;
    emit("remote.lan.pairing_approved", { scopeCount: device.syncScopes.length });
    return device;
  }

  function reject(pairingId) {
    const entry = pairings.get(pairingId);
    if (!entry || entry.state !== "PENDING") throw gatewayError(409, "REMOTE_LAN_PAIRING_UNAVAILABLE", "Appairage absent, expiré ou déjà traité.");
    try { deviceRegistry.approvePairing({ pairingId, pairingCode: entry.pairingCode, approved: false }); } catch { /* refus attendu */ }
    entry.state = "REJECTED"; entry.pairingCode = null;
    emit("remote.lan.pairing_rejected", {});
    return true;
  }

  function beginPairing(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw gatewayError(400, "REMOTE_LAN_BODY_INVALID", "Requête invalide.");
    const token = String(body.invitationToken || "");
    prune();
    const invitation = invitations.get(token);
    if (!invitation || invitation.used || invitation.expiresAt <= now()) throw gatewayError(403, "REMOTE_LAN_INVITATION_INVALID", "Invitation invalide ou expirée.");
    invitation.used = true; // usage unique, même si la suite échoue
    const device = body.device || {};
    if (!MOBILE_TYPES.has(device.deviceType)) throw gatewayError(400, "REMOTE_LAN_DEVICE_INVALID", "Type d'appareil non pris en charge.");
    let started;
    try {
      crypto.createPublicKey(device.publicSigningKey); crypto.createPublicKey(device.publicEncryptionKey);
      started = deviceRegistry.beginPairing({
        deviceId: String(device.deviceId || "").slice(0, 120), deviceType: device.deviceType, displayName: device.displayName,
        platform: device.platform, appVersion: device.appVersion, protocolVersion: body.protocolVersion,
        publicSigningKey: device.publicSigningKey, publicEncryptionKey: device.publicEncryptionKey,
        requestedScopes: device.requestedScopes, capabilities: device.capabilities,
      });
    } catch (error) {
      throw gatewayError(400, String(error.code || "REMOTE_LAN_DEVICE_INVALID").slice(0, 60), "Identité d'appareil refusée.");
    }
    const code = verificationCode({ macSigningKey: mac.publicSigningKey, deviceSigningKey: device.publicSigningKey, invitationToken: token });
    pairings.set(started.pairingId, {
      pairingCode: started.pairingCode, deviceId: String(device.deviceId), displayName: String(device.displayName || device.deviceType).slice(0, 100),
      verificationCode: code, requestedScopes: started.requestedScopes, expiresAt: Date.parse(started.expiresAt), state: "PENDING",
    });
    emit("remote.lan.pairing_started", { scopeCount: started.requestedScopes.length });
    return { pairingId: started.pairingId, mac: { deviceId: mac.deviceId, publicSigningKey: mac.publicSigningKey, publicEncryptionKey: mac.publicEncryptionKey }, verificationCode: code, expiresAt: started.expiresAt };
  }

  function pairingStatus(pairingId) {
    prune();
    const entry = pairings.get(String(pairingId || ""));
    return { state: entry ? entry.state : "UNKNOWN" };
  }

  async function handleEnvelope(envelope) {
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw gatewayError(400, "REMOTE_LAN_BODY_INVALID", "Enveloppe invalide.");
    if (envelope.targetDeviceId !== mac.deviceId) throw gatewayError(403, "REMOTE_LAN_WRONG_TARGET", "Enveloppe destinée à un autre appareil.");
    let device;
    try { device = deviceRegistry.assertAuthorized(String(envelope.sourceDeviceId || "")); }
    catch { throw gatewayError(403, "REMOTE_LAN_DEVICE_NOT_ACTIVE", "Appareil non autorisé."); }
    const createdAt = Date.parse(envelope.createdAt);
    if (!Number.isFinite(createdAt) || Math.abs(now() - createdAt) > clockSkewMs) throw gatewayError(403, "REMOTE_LAN_STALE", "Enveloppe trop ancienne ou datée dans le futur.");
    const envelopeId = String(envelope.envelopeId || "");
    prune();
    if (!envelopeId || seenEnvelopes.has(envelopeId)) throw gatewayError(409, "REMOTE_LAN_REPLAY", "Enveloppe déjà reçue.");
    let payload;
    try { payload = syncCrypto.open(envelope, device); }
    catch { throw gatewayError(403, "REMOTE_LAN_ENVELOPE_INVALID", "Enveloppe invalide."); }
    seenEnvelopes.set(envelopeId, now() + 2 * clockSkewMs);
    const header = Object.freeze({ envelopeId, entityType: envelope.entityType, entityId: envelope.entityId, operation: envelope.operation, createdAt: envelope.createdAt });
    const response = await onEnvelope({ device, header, payload });
    return syncCrypto.seal({ targetDevice: device, header: { entityType: `${envelope.entityType}.response`, entityId: envelope.entityId, operation: "UPSERT", entityVersion: 1 }, payload: response ?? { status: "ok" } });
  }

  function limited(address) {
    const current = now();
    const recent = (hits.get(address) || []).filter((time) => current - time < rateLimit.windowMs);
    recent.push(current);
    hits.set(address, recent);
    return recent.length > rateLimit.max;
  }

  async function readJson(req) {
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) throw gatewayError(415, "REMOTE_LAN_CONTENT_TYPE", "JSON requis.");
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBodyBytes) throw gatewayError(413, "REMOTE_LAN_BODY_TOO_LARGE", "Requête trop volumineuse.");
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw gatewayError(400, "REMOTE_LAN_BODY_INVALID", "JSON invalide."); }
  }

  // Écouteur HTTP de la passerelle. Aucune route du serveur local de Noon n'est accessible ici.
  async function handler(req, res) {
    const send = (status, payload) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(payload)); };
    const address = req.socket?.remoteAddress || "";
    try {
      if (!isEnabled()) throw gatewayError(404, "REMOTE_LAN_DISABLED", "Passerelle désactivée.");
      if (!isPrivateAddress(address, { allowLoopback })) throw gatewayError(403, "REMOTE_LAN_ORIGIN_REFUSED", "Origine hors réseau local.");
      if (limited(address)) throw gatewayError(429, "REMOTE_LAN_RATE_LIMITED", "Trop de requêtes.");
      const url = new URL(req.url, "http://gateway.invalid");
      if (req.method === "POST" && url.pathname === "/v1/pair/begin") return send(200, { status: "ok", ...beginPairing(await readJson(req)) });
      if (req.method === "GET" && url.pathname === "/v1/pair/status") return send(200, { status: "ok", ...pairingStatus(url.searchParams.get("pairingId")) });
      if (req.method === "POST" && url.pathname === "/v1/envelopes") return send(200, { status: "ok", envelope: await handleEnvelope(await readJson(req)) });
      throw gatewayError(404, "REMOTE_LAN_ROUTE_UNKNOWN", "Route inconnue.");
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) emit("remote.lan.internal_error", {});
      return send(status, { status: "error", code: error.status ? error.code : "REMOTE_LAN_ERROR" });
    }
  }

  function listen({ port, host = "0.0.0.0" }) {
    const server = http.createServer((req, res) => { void handler(req, res); });
    server.headersTimeout = 10_000; server.requestTimeout = 30_000;
    return new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, () => resolve(server)); });
  }

  return Object.freeze({ mac, createInvitation, pendingPairings, approve, reject, pairingStatus, handler, listen });
}

module.exports = { QR_PREFIX, createRemoteLanGateway, isPrivateAddress, macKeyFingerprint, verificationCode };
