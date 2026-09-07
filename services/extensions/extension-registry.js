"use strict";

const crypto = require("node:crypto");
const { validateManifest } = require("./extension-manifest-schema");
const { validateValue } = require("./schema-validator");

const STATES = Object.freeze(["DISCOVERED", "INSTALLED", "DISABLED", "ENABLING", "ENABLED", "DEGRADED", "FAILED", "INCOMPATIBLE", "QUARANTINED"]);
const SAFE_AUTO_PROVENANCE = new Set(["CORE", "BUNDLED"]);
function sanitize(record) {
  return { id: record.manifest.id, name: record.manifest.name, version: record.manifest.version, apiVersion: record.manifest.apiVersion,
    type: record.manifest.type, state: record.state, compatibility: record.compatibility, provenance: record.provenance, trust: record.trust,
    signed: record.signed, fingerprint: record.fingerprint, capabilities: [...record.manifest.capabilities], permissions: [...record.manifest.permissions],
    permissionReviewRequired: record.permissionReviewRequired, health: structuredClone(record.health), isolation: "IN_PROCESS_TRUSTED" };
}
function createExtensionRegistry({ noonVersion = "1.0.0", apiVersion = "1", skillRegistry = null, runtime = null, reliability = null, observability = null, developerMode = false, enabled = true, now = () => Date.now() } = {}) {
  const records = new Map();
  const emit = (event, metadata = {}) => { try { observability?.(event, metadata); } catch {} };
  function discover({ manifest: raw, module, provenance = "UNKNOWN", trust = "UNTRUSTED", signed = false, fingerprint = null } = {}) {
    const validated = validateManifest(raw, { noonVersion, apiVersion }); const manifest = validated.manifest;
    if (records.has(manifest.id)) throw Object.assign(new Error("Extension dupliquée."), { code: "EXTENSION_DUPLICATE_ID" });
    const unsafeProvenance = provenance === "UNKNOWN" || (provenance === "LOCAL_DEVELOPMENT" && !developerMode) || (provenance === "SIGNED_EXTERNAL" && !signed);
    const state = validated.compatibility === "INCOMPATIBLE" ? "INCOMPATIBLE" : unsafeProvenance ? "QUARANTINED" : "DISCOVERED";
    const record = { manifest, module, provenance, trust, signed, fingerprint: fingerprint || crypto.createHash("sha256").update(JSON.stringify(raw)).digest("hex"),
      compatibility: validated.compatibility, state, permissionReviewRequired: !SAFE_AUTO_PROVENANCE.has(provenance) || manifest.permissions.some((item) => !["READ", "PREPARE"].includes(item)),
      approvedPermissions: [], config: {}, activated: null, health: { extensionId: manifest.id, state: "UNKNOWN", lastCheckAt: null, lastSuccessAt: null, lastFailureAt: null, consecutiveFailures: 0, degradedCapabilities: [] } };
    records.set(manifest.id, record); emit("extension_discovered", { extensionId: manifest.id, provenance, state }); emit("extension_manifest_validated", { extensionId: manifest.id, compatibility: validated.compatibility });
    try { reliability?.register?.({ componentId: `extension:${manifest.id}`, type: "extension", criticality: manifest.critical ? "important" : "optional", capabilities: [...manifest.capabilities], ttlMs: 60_000, healthCheck: async () => ({ ok: (await checkHealth(manifest.id)).state === "HEALTHY" }), impact: `${manifest.name} est temporairement indisponible ; le cœur de Noon reste actif.` }); } catch { /* Un registre de santé déjà déclaré reste canonique. */ }
    return sanitize(record);
  }
  function install(id, { approvedPermissions = [] } = {}) {
    const record = requireRecord(id); if (["QUARANTINED", "INCOMPATIBLE"].includes(record.state)) throw Object.assign(new Error("Extension non installable."), { code: "EXTENSION_INSTALL_BLOCKED" });
    record.approvedPermissions = [...new Set(approvedPermissions)]; record.permissionReviewRequired = record.manifest.permissions.some((item) => !record.approvedPermissions.includes(item)); record.state = "DISABLED";
    emit("extension_installed", { extensionId: id, permissionReviewRequired: record.permissionReviewRequired }); return sanitize(record);
  }
  function requireRecord(id) { const value = records.get(id); if (!value) throw Object.assign(new Error("Extension inconnue."), { code: "EXTENSION_UNKNOWN" }); return value; }
  async function enable(id) {
    if (!enabled) throw Object.assign(new Error("SDK extensions désactivé."), { code: "EXTENSION_FEATURE_DISABLED" });
    const record = requireRecord(id); if (record.permissionReviewRequired) throw Object.assign(new Error("Permissions non validées."), { code: "EXTENSION_PERMISSION_REVIEW_REQUIRED" });
    if (!["DISABLED", "INSTALLED", "DEGRADED", "FAILED"].includes(record.state)) throw Object.assign(new Error("État incompatible avec l’activation."), { code: "EXTENSION_STATE_INVALID" });
    record.state = "ENABLING";
    try {
      if (typeof record.module?.activate !== "function") throw Object.assign(new Error("Module sans activate."), { code: "EXTENSION_ACTIVATE_MISSING" });
      const context = runtime?.createActivationContext(record) || Object.freeze({ extensionId: id, permittedCapabilities: Object.freeze([...record.manifest.capabilities]) });
      const activated = await record.module.activate(context); record.activated = activated || {};
      for (const skill of record.manifest.skills) {
        const handler = record.activated.skills?.[skill.id]; if (typeof handler !== "function") throw Object.assign(new Error(`Handler absent : ${skill.id}`), { code: "EXTENSION_SKILL_HANDLER_MISSING" });
        skillRegistry?.registerExtensionSkill?.(id, skill, (args, context) => runtime.invoke(id, skill.id, args, context));
      }
      record.state = "ENABLED"; emit("extension_enabled", { extensionId: id, capabilityCount: record.manifest.capabilities.length }); return sanitize(record);
    } catch (error) { skillRegistry?.unregisterExtensionSkills?.(id); record.state = "FAILED"; record.health.consecutiveFailures += 1; emit("extension_failed", { extensionId: id, errorCode: String(error.code || "ACTIVATION_FAILED") }); throw error; }
  }
  async function disable(id) { const record = requireRecord(id); skillRegistry?.unregisterExtensionSkills?.(id); await record.module?.deactivate?.(); record.activated = null; record.state = "DISABLED"; emit("extension_disabled", { extensionId: id }); return sanitize(record); }
  async function uninstall(id, { removeData = false } = {}) { const record = requireRecord(id); if (record.state === "ENABLED") await disable(id); runtime?.onUninstall?.(id, { removeData }); records.delete(id); emit("extension_uninstalled", { extensionId: id, dataRemoved: removeData }); return { removed: true, dataRemoved: removeData }; }
  async function update(id, next, { approvedPermissions = [] } = {}) {
    const record = requireRecord(id); const validated = validateManifest(next.manifest, { noonVersion, apiVersion });
    if (validated.manifest.id !== id) throw Object.assign(new Error("ID immuable."), { code: "EXTENSION_ID_IMMUTABLE" });
    const addedPermissions = validated.manifest.permissions.filter((item) => !record.manifest.permissions.includes(item));
    if (addedPermissions.some((item) => !approvedPermissions.includes(item))) { record.permissionReviewRequired = true; record.state = "DISABLED"; return { ...sanitize(record), updateBlocked: true, addedPermissions }; }
    if (record.state === "ENABLED") await disable(id); record.manifest = validated.manifest; record.module = next.module; record.compatibility = validated.compatibility; record.approvedPermissions = [...new Set([...record.approvedPermissions, ...approvedPermissions])]; record.permissionReviewRequired = false; return { ...sanitize(record), updateBlocked: false, addedPermissions };
  }
  function configure(id, value) {
    const record = requireRecord(id); if (!record.manifest.configSchema) throw Object.assign(new Error("Cette extension n’a pas de configuration."), { code: "EXTENSION_CONFIG_UNSUPPORTED" });
    if (Object.keys(value || {}).some((key) => /(?:skip|bypass|approval|hard.?rule|security|feature.?flag)/i.test(key))) throw Object.assign(new Error("Réglage de sécurité interdit."), { code: "EXTENSION_SECURITY_CONFIG_DENIED" });
    validateValue(record.manifest.configSchema, value, "config"); record.config = structuredClone(value); emit("extension_config_updated", { extensionId: id }); return { updated: true };
  }
  async function checkHealth(id) {
    const record = requireRecord(id); const stamp = new Date(now()).toISOString(); record.health.lastCheckAt = stamp;
    try { const result = await record.module?.healthCheck?.() || { ok: true }; if (!result.ok) throw Object.assign(new Error("Health dégradé."), { code: "EXTENSION_HEALTH_FAILED" }); record.health = { ...record.health, state: "HEALTHY", lastCheckAt: stamp, lastSuccessAt: stamp, consecutiveFailures: 0, degradedCapabilities: result.degradedCapabilities || [] }; }
    catch (error) { record.health = { ...record.health, state: "DEGRADED", lastCheckAt: stamp, lastFailureAt: stamp, consecutiveFailures: record.health.consecutiveFailures + 1 }; if (record.health.consecutiveFailures >= 3) { record.state = "QUARANTINED"; skillRegistry?.unregisterExtensionSkills?.(id); emit("extension_quarantined", { extensionId: id, reason: "REPEATED_FAILURE" }); } }
    emit("extension_health_changed", { extensionId: id, state: record.health.state }); return structuredClone(record.health);
  }
  function recordInvocationFailure(id, code = "EXTENSION_INVOCATION_FAILED") {
    const record = requireRecord(id); record.health.consecutiveFailures += 1; record.health.lastFailureAt = new Date(now()).toISOString(); record.health.state = "DEGRADED";
    if (record.health.consecutiveFailures >= 3) { record.state = "QUARANTINED"; skillRegistry?.unregisterExtensionSkills?.(id); emit("extension_quarantined", { extensionId: id, reason: code }); }
  }
  function recordInvocationSuccess(id) { const record = requireRecord(id); record.health.consecutiveFailures = 0; record.health.lastSuccessAt = new Date(now()).toISOString(); record.health.state = "HEALTHY"; }
  return { states: STATES, discover, install, enable, disable, uninstall, update, configure, checkHealth, recordInvocationFailure, recordInvocationSuccess, get: (id) => sanitize(requireRecord(id)), list: () => [...records.values()].map(sanitize), internal: (id) => requireRecord(id) };
}
module.exports = { STATES, createExtensionRegistry };
