"use strict";

const crypto = require("node:crypto");
const { canonical } = require("../sync/sync-crypto");
function bytes(value) { return Buffer.from(JSON.stringify(canonical(value))); }
function createRemoteApprovalService({ repository, deviceRegistry, approvalEngine, now = () => Date.now(), observability = null } = {}) {
  function verify(response = {}) {
    const device = deviceRegistry.assertAuthorized(response.deviceId, "REMOTE_APPROVALS"); const nonceHash = crypto.createHash("sha256").update(String(response.nonce || "")).digest("hex");
    if (repository.approvalSeen(response.deviceId, nonceHash)) throw Object.assign(new Error("Réponse d'approbation rejouée."), { code: "REMOTE_APPROVAL_REPLAY" });
    const approval = approvalEngine.get?.(response.approvalId); if (!approval) throw Object.assign(new Error("Approbation introuvable."), { code: "APPROVAL_NOT_FOUND" });
    if (Date.parse(approval.expiresAt || approval.expires_at) <= now()) throw Object.assign(new Error("Approbation expirée."), { code: "APPROVAL_EXPIRED" });
    const unsigned = { approvalId: response.approvalId, decision: response.decision, deviceId: response.deviceId, respondedAt: response.respondedAt, nonce: response.nonce, fingerprint: response.fingerprint };
    let valid = false; try { valid = crypto.verify(null, bytes(unsigned), crypto.createPublicKey(device.publicSigningKey), Buffer.from(String(response.signature || ""), "base64")); } catch {}
    if (!valid || response.fingerprint !== (approval.fingerprint || approval.payloadFingerprint)) throw Object.assign(new Error("Signature ou empreinte d'approbation invalide."), { code: "REMOTE_APPROVAL_SIGNATURE_INVALID" });
    repository.saveApprovalResponse({ approvalId: response.approvalId, deviceId: response.deviceId, nonceHash, decision: response.decision, respondedAt: response.respondedAt, state: "VERIFIED" }); observability?.("remote_approval_received", { approvalId: response.approvalId, deviceId: response.deviceId });
    return response.decision === "APPROVE" ? approvalEngine.approve?.(response.approvalId, { origin: "EXPLICIT_USER_REMOTE_DEVICE", deviceId: response.deviceId, fingerprint: response.fingerprint }) : approvalEngine.reject?.(response.approvalId, { origin: "EXPLICIT_USER_REMOTE_DEVICE", deviceId: response.deviceId });
  }
  return { verify };
}

module.exports = { createRemoteApprovalService };
