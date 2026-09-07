"use strict";

const crypto = require("node:crypto");

const AMBIENT_MODES = Object.freeze(["OFF", "PASSIVE_MINIMAL", "EXPLICIT_SHARE", "TEMPORARY_FOCUS"]);
const SIGNAL_TYPES = Object.freeze([
  "ACTIVE_APPLICATION", "ACTIVE_WORKSPACE", "EXPLICIT_FILE", "EXPLICIT_WINDOW",
  "CURRENT_ARTIFACT", "CURRENT_JOB", "CURRENT_TASK", "USER_DECLARED_CONTEXT",
]);
const SENSITIVITIES = Object.freeze(["low", "medium", "high", "restricted"]);

function createContextSignal(input = {}, { now = () => new Date() } = {}) {
  if (!SIGNAL_TYPES.includes(input.signalType)) throw Object.assign(new Error("Type de signal ambiant invalide."), { code: "AMBIENT_SIGNAL_TYPE_INVALID" });
  const observedAt = input.observedAt || now().toISOString();
  const expiresAt = input.expiresAt || new Date(Date.parse(observedAt) + 15 * 60_000).toISOString();
  if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(observedAt)) {
    throw Object.assign(new Error("Expiration du signal ambiant invalide."), { code: "AMBIENT_SIGNAL_TTL_INVALID" });
  }
  const sensitivity = SENSITIVITIES.includes(input.sensitivity) ? input.sensitivity : "medium";
  return Object.freeze({
    signalId: input.signalId || `ambient_${crypto.randomUUID()}`,
    signalType: input.signalType,
    source: String(input.source || "explicit_user").slice(0, 80),
    valueRef: structuredClone(input.valueRef || {}),
    confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0)),
    scope: String(input.scope || "device_local").slice(0, 80),
    sensitivity,
    observedAt,
    expiresAt,
    userExplicit: input.userExplicit === true,
    provenance: Object.freeze({ ...(input.provenance || {}), kind: input.provenance?.kind || "local_context_signal" }),
  });
}

module.exports = { AMBIENT_MODES, SENSITIVITIES, SIGNAL_TYPES, createContextSignal };
