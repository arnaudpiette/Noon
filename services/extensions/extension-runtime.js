"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { isPathInsideRoots } = require("../../lib/path-utils");
const { validateValue } = require("./schema-validator");
const { createExtensionStorage } = require("./extension-storage");

const MUTATING = new Set(["WRITE", "EXECUTE", "DESTRUCTIVE", "EXTERNAL"]);
function extensionError(code, message) { return Object.assign(new Error(message), { code }); }
function createExtensionRuntime({ securityPolicy, transactionalExecutor = null, storage = createExtensionStorage(), credentialBroker = null, networkFetch = null, observability = null, allowedRoots = [], now = () => Date.now() } = {}) {
  let registry = null; const metrics = new Map();
  const emit = (event, metadata = {}) => { try { observability?.(event, metadata); } catch {} };
  function bindRegistry(value) { registry = value; }
  function createActivationContext(record) {
    return Object.freeze({ extensionId: record.manifest.id, permittedCapabilities: Object.freeze([...record.manifest.capabilities]), config: Object.freeze(structuredClone(record.config || {})), isolation: "IN_PROCESS_TRUSTED" });
  }
  function safeLogger(extensionId) { return Object.freeze({ info: (event) => emit("extension_log", { extensionId, level: "info", event: String(event).slice(0, 80) }), warn: (event) => emit("extension_log", { extensionId, level: "warn", event: String(event).slice(0, 80) }) }); }
  function contextFor(record, execution = {}) {
    const manifest = record.manifest;
    return Object.freeze({ extensionId: manifest.id, executionId: execution.executionId || null, workspaceRef: execution.workspaceId || null,
      config: Object.freeze(structuredClone(execution.config || {})), permittedCapabilities: Object.freeze([...manifest.capabilities]), logger: safeLogger(manifest.id), abortSignal: execution.signal || null,
      storage: storage.namespace(manifest.id),
      credentials: Object.freeze({ getHandle: (service) => { if (!manifest.permissions.includes(`credentials.${service}`)) throw extensionError("EXTENSION_PERMISSION_DENIED", "Credential non déclaré."); return credentialBroker?.getHandle?.(manifest.id, service) || null; } }),
      network: Object.freeze({ fetch: async (url, options = {}) => { if (!manifest.permissions.includes("network.external")) throw extensionError("EXTENSION_PERMISSION_DENIED", "Accès réseau non déclaré."); const parsed = new URL(url); if (parsed.protocol !== "https:" || !manifest.allowedDomains.includes(parsed.hostname.toLowerCase())) throw extensionError("EXTENSION_NETWORK_DOMAIN_DENIED", "Domaine non autorisé."); return networkFetch?.(parsed.href, options); } }),
      filesystem: Object.freeze({
        roots: Object.freeze([...allowedRoots]),
        readText(filePath, { maxBytes = 1024 * 1024 } = {}) {
          if (!manifest.permissions.includes("filesystem.read")) throw extensionError("EXTENSION_PERMISSION_DENIED", "Lecture fichier non déclarée.");
          const real = fs.realpathSync(path.resolve(String(filePath)));
          const roots = allowedRoots.map((root) => { try { return fs.realpathSync(root); } catch { return path.resolve(root); } });
          if (!isPathInsideRoots(real, roots)) throw extensionError("EXTENSION_FILESYSTEM_SCOPE_DENIED", "Fichier hors du scope autorisé.");
          const stat = fs.statSync(real); if (!stat.isFile() || stat.size > Math.min(5 * 1024 * 1024, maxBytes)) throw extensionError("EXTENSION_FILE_LIMIT", "Fichier non lisible ou trop volumineux.");
          return fs.readFileSync(real, "utf8");
        },
      }),
    });
  }
  async function invoke(extensionId, skillId, input, execution = {}) {
    const record = registry?.internal(extensionId); if (!record || record.state !== "ENABLED") throw extensionError("EXTENSION_DISABLED", "Extension désactivée.");
    const skill = record.manifest.skills.find((item) => item.id === skillId); if (!skill) throw extensionError("EXTENSION_SKILL_UNKNOWN", "Skill inconnue.");
    validateValue(skill.inputSchema, input, "input");
    const declared = record.manifest.permissions.includes(skill.permissionLevel); if (!declared) { emit("extension_permission_denied", { extensionId, skillId, reason: "UNDECLARED" }); throw extensionError("EXTENSION_UNDECLARED_PERMISSION", "Permission non déclarée."); }
    const actionRequest = securityPolicy?.createActionRequest ? securityPolicy.createActionRequest({
      origin: execution.origin || "model_generated", actor: "extension", skillId, operation: skillId, args: input,
      workspaceId: execution.workspaceId || null, profileScope: execution.profileScope || "arnaud", explicitOrder: execution.explicitOrder === true,
      localOnly: execution.localOnly === true,
    }, { level: skill.permissionLevel.toLowerCase(), networkAccess: record.manifest.permissions.includes("network.external") }) : null;
    const decision = securityPolicy?.evaluate ? securityPolicy.evaluate({ actionRequest, skillPolicy: { level: skill.permissionLevel.toLowerCase(), networkAccess: record.manifest.permissions.includes("network.external") }, pendingApproval: execution.approval || null }) : { outcome: skill.permissionLevel === "READ" ? "ALLOW" : "DENY" };
    if (decision.outcome === "REQUIRE_APPROVAL") return { ok: false, status: "APPROVAL_REQUIRED", approvalRequired: true, decisionId: decision.decisionId };
    if (!["ALLOW", "ALLOW_WITH_CONSTRAINTS"].includes(decision.outcome)) throw extensionError("EXTENSION_SECURITY_DENIED", "Action refusée par la politique de sécurité.");
    if (MUTATING.has(skill.permissionLevel) && typeof transactionalExecutor !== "function") throw extensionError("EXTENSION_TRANSACTIONAL_EXECUTION_REQUIRED", "Toute mutation d’extension doit passer par TransactionalExecutionEngine.");
    const handler = record.activated?.skills?.[skillId]; if (typeof handler !== "function") throw extensionError("EXTENSION_SKILL_HANDLER_MISSING", "Handler indisponible.");
    const started = now(); emit("extension_invocation_started", { extensionId, skillId });
    const controller = new AbortController(); const externalAbort = () => controller.abort(execution.signal?.reason); execution.signal?.addEventListener?.("abort", externalAbort, { once: true });
    const timer = setTimeout(() => controller.abort(extensionError("EXTENSION_TIMEOUT", "Extension expirée.")), skill.timeoutMs);
    try {
      const operation = () => handler(structuredClone(input), contextFor(record, { ...execution, signal: controller.signal }));
      const raw = MUTATING.has(skill.permissionLevel) ? await transactionalExecutor({ extensionId, skill, input, actionRequest, decision, operation, execution }) : await Promise.race([operation(), new Promise((_, reject) => controller.signal.addEventListener("abort", () => reject(controller.signal.reason || extensionError("EXTENSION_CANCELLED", "Extension annulée.")), { once: true }))]);
      validateValue(skill.outputSchema, raw, "output"); const durationMs = now() - started; const samples = metrics.get(extensionId) || []; samples.push(durationMs); metrics.set(extensionId, samples.slice(-200)); emit("extension_invocation_completed", { extensionId, skillId, durationMs });
      registry.recordInvocationSuccess?.(extensionId);
      return { ok: true, capability: skillId, data: raw, provenance: { extensionId, version: record.manifest.version, trust: "extension_data_untrusted" }, warnings: [], partial: false, metrics: { durationMs } };
    } catch (error) { const code = controller.signal.aborted && error.code !== "EXTENSION_CANCELLED" ? "EXTENSION_TIMEOUT" : String(error.code || "EXTENSION_INVOCATION_FAILED"); registry.recordInvocationFailure?.(extensionId, code); emit(code === "EXTENSION_TIMEOUT" ? "extension_timeout" : "extension_invocation_failed", { extensionId, skillId, errorCode: code }); throw extensionError(code, code === "EXTENSION_TIMEOUT" ? "L’extension a dépassé le délai autorisé." : "L’extension a échoué."); }
    finally { clearTimeout(timer); execution.signal?.removeEventListener?.("abort", externalAbort); }
  }
  function statistics(extensionId) { const samples = [...(metrics.get(extensionId) || [])].sort((a, b) => a - b); const percentile = (p) => samples.length ? samples[Math.min(samples.length - 1, Math.floor(samples.length * p))] : null; return { invocations: samples.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95) }; }
  return { bindRegistry, createActivationContext, invoke, statistics, onUninstall: (id, options) => options.removeData && storage.removeData(id), storage };
}
module.exports = { createExtensionRuntime };
