"use strict";

const crypto = require("node:crypto");
function createRemoteMediaService({ repository, multimodalEngine, tempStore, observability = null, maxBytes = 10 * 1024 * 1024 } = {}) {
  async function receive({ requestId, deviceId, transferId, mediaType, filename, expectedHash, bytes, explicitSelection = false, localOnly = false } = {}) {
    if (explicitSelection !== true) throw Object.assign(new Error("Sélection explicite du média requise."), { code: "REMOTE_MEDIA_EXPLICIT_SELECTION_REQUIRED" });
    if (localOnly) throw Object.assign(new Error("Média local-only interdit à distance."), { code: "REMOTE_MEDIA_LOCAL_ONLY" });
    const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []); if (!data.length || data.length > maxBytes) throw Object.assign(new Error("Taille média invalide."), { code: "REMOTE_MEDIA_SIZE_INVALID" });
    const receivedHash = crypto.createHash("sha256").update(data).digest("hex");
    if (receivedHash !== expectedHash) { repository.saveMedia({ transferId, requestId, deviceId, mediaType, filename, expectedHash, receivedHash, sizeBytes: data.length, state: "FAILED" }); throw Object.assign(new Error("Média distant corrompu."), { code: "REMOTE_MEDIA_HASH_MISMATCH" }); }
    const assetRef = await tempStore.write({ transferId, mediaType, filename, bytes: data }); repository.saveMedia({ transferId, requestId, deviceId, mediaType, filename, expectedHash, receivedHash, sizeBytes: data.length, state: "READY", assetRef }); observability?.("remote_media_received", { requestId, mediaType, uploadBytes: data.length });
    const result = await multimodalEngine.analyzeRemote?.({ assetRef, origin: "USER_UPLOAD_REMOTE_DEVICE", trust: "UNTRUSTED_EVIDENCE" }); return { state: "READY", assetRef, result: result || null };
  }
  return { receive };
}

module.exports = { createRemoteMediaService };
