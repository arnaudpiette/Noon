"use strict";

const crypto = require("crypto");

const BLOCKED_ACTIONS = new Set(["git_push_force", "git_reset_hard", "delete_remote_branch", "rewrite_history"]);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function payloadHash({ provider, action, target, payload }) {
  return crypto.createHash("sha256").update(stableStringify({ provider, action, target, payload })).digest("hex");
}

class ApprovalManager {
  constructor({ ttlMs = 5 * 60 * 1000, auditLog = null, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs; this.auditLog = auditLog; this.now = now; this.approvals = new Map();
  }
  createActionPreview(input) {
    if (BLOCKED_ACTIONS.has(input.action)) throw new Error("Action définitivement bloquée par Noon.");
    const createdAt = this.now();
    const approval = {
      id: crypto.randomUUID(), provider: String(input.provider), action: String(input.action),
      target: String(input.target || "").slice(0, 500), payloadHash: payloadHash(input),
      preview: input.preview || {}, consequences: String(input.consequences || "").slice(0, 1000),
      strengthened: input.strengthened === true, createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(createdAt + this.ttlMs).toISOString(), used: false, confirmed: false,
    };
    this.approvals.set(approval.id, approval);
    this.auditLog?.append("approval.created", { id: approval.id, provider: approval.provider, action: approval.action, target: approval.target });
    return structuredClone(approval);
  }
  requestApproval(input) { return this.createActionPreview(input); }
  confirm(id) {
    const approval = this.approvals.get(id);
    if (!approval || approval.used || Date.parse(approval.expiresAt) <= this.now()) throw new Error("Autorisation absente, utilisée ou expirée.");
    approval.confirmed = true;
    this.auditLog?.append("approval.confirmed", { id, provider: approval.provider, action: approval.action });
    return structuredClone(approval);
  }
  consumeApproval(id, exactInput) {
    const approval = this.approvals.get(id);
    if (!approval?.confirmed || approval.used || Date.parse(approval.expiresAt) <= this.now()) throw new Error("Autorisation invalide ou expirée.");
    if (approval.payloadHash !== payloadHash(exactInput)) throw new Error("Le contenu ou la cible a changé : nouvelle autorisation requise.");
    approval.used = true;
    this.auditLog?.append("approval.consumed", { id, provider: approval.provider, action: approval.action });
    return true;
  }
  rejectApproval(id) { const approval = this.approvals.get(id); if (!approval) return false; approval.used = true; approval.confirmed = false; return true; }
  listPending() { return [...this.approvals.values()].filter((item) => !item.used && Date.parse(item.expiresAt) > this.now()).map(structuredClone); }
}

module.exports = { ApprovalManager, BLOCKED_ACTIONS, payloadHash, stableStringify };
