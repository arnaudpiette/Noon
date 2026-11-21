"use strict";

// Compagnon iPhone — IP-3 : composition de la passerelle LAN dans Noon et commandes
// d'administration de la section « Appareils » du Control Center.
// - Rien n'écoute tant que l'utilisateur n'a pas cliqué « Démarrer » (flag remote.lan actif) ;
//   l'écoute n'est jamais relancée automatiquement au redémarrage de Noon.
// - L'écouteur se lie à l'adresse IPv4 privée du Mac, jamais à 0.0.0.0.
// - L'identité du Mac (clés privées) vit dans le coffre safeStorage ; sans coffre persistant,
//   la passerelle refuse de démarrer (une identité éphémère casserait tout appairage).
// - Les enveloppes acceptées en V1 se limitent à `remote.ping` ; Brief et conversations
//   arrivent avec IP-4/IP-5 et repasseront par le pipeline canonique.

const os = require("node:os");
const { createDeviceIdentityStore } = require("../sync/device-identity-store");
const { createDeviceRegistry } = require("../sync/device-registry");
const { createSyncRepository } = require("../sync/sync-repository");
const { createRemoteLanGateway, isPrivateAddress, macKeyFingerprint } = require("./remote-lan-gateway");

const DEFAULT_PORT = 47830;
const IDENTITY_KEY = "noon-remote-lan-mac-identity";
const DEVICE_SCOPE_LABELS = Object.freeze({
  CONVERSATIONS: "Conversations", WORKSPACES: "Espaces de travail", JOB_STATUS: "État des tâches", NOTIFICATIONS: "Notifications",
  ARTIFACT_METADATA: "Métadonnées des documents", ARTIFACT_DOWNLOAD: "Téléchargement de documents", REMOTE_REQUESTS: "Demandes distantes",
  REMOTE_TEXT: "Messages texte", REMOTE_JOBS: "Contrôle des tâches", REMOTE_MEDIA: "Médias", REMOTE_APPROVALS: "Validations à distance", REMOTE_VOICE: "Voix",
});

function serviceError(status, code, message) { return Object.assign(new Error(message), { status, code }); }

// Adresse IPv4 privée du Mac (en0 en priorité), ou null.
function pickLanAddress(interfaces = os.networkInterfaces()) {
  const candidates = [];
  for (const [name, entries] of Object.entries(interfaces || {})) {
    for (const entry of entries || []) {
      if (entry.internal || (entry.family !== "IPv4" && entry.family !== 4)) continue;
      if (isPrivateAddress(entry.address) && !entry.address.startsWith("169.254.")) candidates.push({ name, address: entry.address });
    }
  }
  candidates.sort((a, b) => (a.name === "en0" ? -1 : b.name === "en0" ? 1 : a.name.localeCompare(b.name)));
  return candidates[0]?.address || null;
}

function createRemoteLanService({
  isEnabled, databaseWrapper, secureStore, now = () => Date.now(),
  port = DEFAULT_PORT, lanAddress = () => pickLanAddress(), displayName = "Mac (Noon)",
  allowLoopback = false, observability = () => {},
} = {}) {
  if (typeof isEnabled !== "function") throw new TypeError("isEnabled requis.");
  const emit = (event, metadata = {}) => { try { observability(event, metadata); } catch {} };
  let composed = null;
  let server = null;
  let listening = null; // { host, port, startedAt }

  function compose() {
    if (composed) return composed;
    if (!secureStore?.persistent) throw serviceError(409, "REMOTE_LAN_KEYSTORE_UNAVAILABLE", "Coffre sécurisé indisponible : impossible de conserver l'identité du Mac.");
    const repository = createSyncRepository(databaseWrapper, { now });
    const deviceRegistry = createDeviceRegistry({ repository, now, observability: (event, metadata) => emit(`remote.lan.${event}`, metadata) });
    const identityStore = createDeviceIdentityStore({
      secureStore: { get: (key) => secureStore.get(key), set: (key, value) => { secureStore.set(key, value); } },
      storageKey: IDENTITY_KEY, defaults: { deviceType: "MAC_PRIMARY", displayName },
    });
    const macIdentity = identityStore.loadOrCreate();
    const gateway = createRemoteLanGateway({
      deviceRegistry, macIdentity, now, allowLoopback,
      isEnabled: () => isEnabled() && listening !== null,
      onEnvelope: ({ device, header }) => {
        try { repository.saveDevice({ ...device, lastSeenAt: new Date(now()).toISOString() }); } catch { /* horodatage facultatif */ }
        if (header.entityType === "remote.ping") return { status: "ok", pong: true, mac: macIdentity.displayName, serverTime: new Date(now()).toISOString() };
        return { status: "error", code: "REMOTE_LAN_NOT_SUPPORTED", entityType: String(header.entityType || "").slice(0, 60) };
      },
      observability: emit,
    });
    composed = { repository, deviceRegistry, gateway, macIdentity };
    return composed;
  }

  function requireEnabled() {
    if (!isEnabled()) throw serviceError(404, "REMOTE_LAN_DISABLED", "Passerelle désactivée.");
  }

  async function start() {
    requireEnabled();
    if (listening) return status();
    const host = lanAddress();
    if (!host) throw serviceError(409, "REMOTE_LAN_NO_NETWORK", "Aucun réseau local privé détecté (Wi-Fi ou Ethernet).");
    const { gateway } = compose();
    try {
      server = await gateway.listen({ port, host });
    } catch (error) {
      server = null;
      throw serviceError(409, error?.code === "EADDRINUSE" ? "REMOTE_LAN_PORT_IN_USE" : "REMOTE_LAN_LISTEN_FAILED", error?.code === "EADDRINUSE" ? `Le port ${port} est déjà utilisé.` : "Impossible d'ouvrir l'écoute réseau.");
    }
    listening = { host, port: server.address().port, startedAt: new Date(now()).toISOString() };
    emit("remote.lan.started", {});
    return status();
  }

  async function stop() {
    const current = server;
    server = null; listening = null;
    if (current) {
      await new Promise((resolve) => current.close(() => resolve()));
      current.closeAllConnections?.();
      emit("remote.lan.stopped", {});
    }
    return status();
  }

  function devices() {
    if (!composed) return [];
    return composed.repository.listDevices()
      .filter((device) => device.deviceType === "IPHONE" || device.deviceType === "IPAD")
      .filter((device) => device.status !== "PENDING")
      .map((device) => ({ deviceId: device.deviceId, displayName: device.displayName, deviceType: device.deviceType, status: device.status, scopes: device.syncScopes || [], pairedAt: device.pairedAt || null, lastSeenAt: device.lastSeenAt || null, revokedAt: device.revokedAt || null }));
  }

  function status() {
    const enabled = isEnabled();
    if (!enabled && listening) void stop(); // kill switch : arrêt immédiat
    let fingerprint = null; let keystore = Boolean(secureStore?.persistent);
    try { if (enabled && keystore) fingerprint = macKeyFingerprint(compose().macIdentity).slice(0, 16); } catch { keystore = false; }
    return {
      enabled, keystore, listening: Boolean(enabled && listening), host: listening?.host || null, port: listening?.port || null,
      startedAt: listening?.startedAt || null, macFingerprint: fingerprint, scopeLabels: DEVICE_SCOPE_LABELS,
      pendingPairings: enabled && composed ? composed.gateway.pendingPairings() : [], devices: enabled ? devices() : [],
    };
  }

  function createInvitation() {
    requireEnabled();
    if (!listening) throw serviceError(409, "REMOTE_LAN_NOT_LISTENING", "Démarre d'abord la passerelle.");
    const invitation = compose().gateway.createInvitation({ host: listening.host, port: listening.port });
    return { qr: invitation.qr, expiresAt: invitation.expiresAt, host: listening.host, port: listening.port };
  }

  function approve(pairingId, grantedScopes) {
    requireEnabled();
    try {
      const device = compose().gateway.approve(pairingId, { grantedScopes });
      return { deviceId: device.deviceId, scopes: device.syncScopes };
    } catch (error) {
      if (error.status) throw error;
      throw serviceError(400, String(error.code || "REMOTE_LAN_APPROVAL_FAILED").slice(0, 60), "Approbation refusée.");
    }
  }

  function reject(pairingId) { requireEnabled(); compose().gateway.reject(pairingId); return { rejected: true }; }

  function revoke(deviceId) {
    requireEnabled();
    const { repository, deviceRegistry } = compose();
    const device = repository.getDevice(deviceId);
    if (!device || (device.deviceType !== "IPHONE" && device.deviceType !== "IPAD")) throw serviceError(404, "REMOTE_LAN_DEVICE_UNKNOWN", "Appareil inconnu.");
    if (device.status === "REVOKED") return { revoked: true };
    deviceRegistry.revoke(deviceId);
    return { revoked: true };
  }

  return Object.freeze({ start, stop, status, createInvitation, approve, reject, revoke, isListening: () => listening !== null });
}

module.exports = { DEFAULT_PORT, createRemoteLanService, pickLanAddress };
