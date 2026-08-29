"use strict";

const crypto = require("crypto");
const path = require("path");

const HEALTH_STATES = Object.freeze({
  HEALTHY: "HEALTHY", DEGRADED: "DEGRADED", UNAVAILABLE: "UNAVAILABLE",
  UNAUTHORIZED: "UNAUTHORIZED", MISCONFIGURED: "MISCONFIGURED",
  STALE: "STALE", UNKNOWN: "UNKNOWN",
});
const FAILURE_CATEGORIES = Object.freeze({
  NO_DATA: "NO_DATA", SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  AUTH_REQUIRED: "AUTH_REQUIRED", PERMISSION_DENIED: "PERMISSION_DENIED",
  TIMEOUT: "TIMEOUT", RATE_LIMITED: "RATE_LIMITED", NETWORK_ERROR: "NETWORK_ERROR",
  INVALID_RESPONSE: "INVALID_RESPONSE", STALE_DATA: "STALE_DATA",
  PARTIAL_FAILURE: "PARTIAL_FAILURE", INTERNAL_ERROR: "INTERNAL_ERROR",
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR", UNKNOWN_OUTCOME: "UNKNOWN_OUTCOME",
});
const READINESS_STATES = Object.freeze({
  CORE_READY: "CORE_READY", FULLY_READY: "FULLY_READY",
  DEGRADED_READY: "DEGRADED_READY", NOT_READY: "NOT_READY",
});
const CIRCUIT_STATES = Object.freeze({ CLOSED: "closed", OPEN: "open", HALF_OPEN: "half-open" });

function redact(value) {
  return String(value || "")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[SECRET]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[EMAIL]")
    .replace(/\/(?:Users|home)\/[^\s:'\"]+/g, (match) => `${path.sep}[PRIVATE_PATH]${path.extname(match)}`)
    .replace(/[A-Za-z0-9_-]*(?:token|secret|api[_-]?key)[A-Za-z0-9_-]*\s*[:=]\s*[^\s,;]+/gi, "secret=[REDACTED]")
    .slice(0, 500);
}
function errorStatus(error) { return Number(error?.status || error?.statusCode || error?.response?.status) || 0; }
function classifyFailure(error, context = {}) {
  if (context.noData === true) return normalized("NO_DATA", false, false, "Aucune donnée trouvée.");
  const code = String(error?.code || error?.name || "").toUpperCase();
  const message = String(error?.message || error || "").toLowerCase();
  const status = errorStatus(error);
  if (context.unknownOutcome === true) return normalized("UNKNOWN_OUTCOME", false, true, "Le résultat de l’action n’a pas pu être confirmé.", "VERIFY_STATUS");
  if (status === 401 || /invalid.grant|token.*(?:expired|invalid|revoked)|reconnect|non connect/.test(message)) return normalized("AUTH_REQUIRED", false, true, "La connexion au service doit être renouvelée.", context.recoveryAction || "RECONNECT");
  if (status === 403 || /permission|eacces|eperm|not permitted|accès refusé/.test(message)) return normalized("PERMISSION_DENIED", false, true, "Noon n’a pas l’autorisation nécessaire.", context.recoveryAction || "GRANT_PERMISSION");
  if (status === 429 || /rate.?limit|quota/.test(message)) return normalized("RATE_LIMITED", true, false, "Le service limite temporairement les requêtes.");
  if (code === "ABORTERROR" || code.includes("TIMEOUT") || /timed? ?out|délai/.test(message)) return normalized("TIMEOUT", true, false, "Le service n’a pas répondu à temps.");
  if (["ENOTFOUND", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENETUNREACH"].includes(code) || /network|fetch failed|dns|connexion.*impossible/.test(message)) return normalized("NETWORK_ERROR", true, false, "Le service n’est pas joignable actuellement.");
  if (context.stale === true || /stale|périm|fingerprint mismatch/.test(message)) return normalized("STALE_DATA", true, false, "Les données disponibles sont périmées.", "REFRESH");
  if (context.partial === true) return normalized("PARTIAL_FAILURE", true, false, "Certaines sources n’ont pas pu être vérifiées.");
  if (status >= 500 || /unavailable|indisponible/.test(message)) return normalized("SERVICE_UNAVAILABLE", true, false, "Le service est momentanément indisponible.");
  if (/config|schema|module.*not found|missing key|clé.*absente/.test(message)) return normalized("CONFIGURATION_ERROR", false, true, "La configuration du composant est incomplète.", "OPEN_SETTINGS");
  if (/json|invalid response|réponse.*invalide/.test(message)) return normalized("INVALID_RESPONSE", true, false, "Le service a renvoyé une réponse invalide.");
  return normalized("INTERNAL_ERROR", false, false, "Une erreur interne empêche cette fonctionnalité de répondre.");
}
function normalized(category, retryable, userActionRequired, safeMessage, recoveryAction = null) {
  return { category: FAILURE_CATEGORIES[category], retryable, userActionRequired, safeMessage, recoveryAction };
}
function stateFor(category, failures, criticality) {
  if (category === "NO_DATA") return HEALTH_STATES.HEALTHY;
  if (category === "AUTH_REQUIRED") return HEALTH_STATES.UNAUTHORIZED;
  if (category === "CONFIGURATION_ERROR") return HEALTH_STATES.MISCONFIGURED;
  if (category === "STALE_DATA") return HEALTH_STATES.STALE;
  if (category === "PARTIAL_FAILURE") return HEALTH_STATES.DEGRADED;
  return failures >= 3 || criticality === "critical" ? HEALTH_STATES.UNAVAILABLE : HEALTH_STATES.DEGRADED;
}

function createReliabilityEngine({ observability = null, now = () => Date.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), random = Math.random, historyLimit = 200 } = {}) {
  const components = new Map(); const snapshots = new Map(); const history = []; const notifications = new Map();
  const emit = (event, metadata = {}) => { try { observability?.(event, metadata); } catch {} };
  const time = () => new Date(now()).toISOString();
  function register(definition) {
    if (!definition?.componentId) throw new TypeError("componentId obligatoire.");
    const value = { type: "engine", criticality: "optional", capabilities: [], dependencies: [], ttlMs: 60_000, maxRetries: 2, circuitThreshold: 3, circuitCooldownMs: 30_000, ...definition };
    components.set(value.componentId, value);
    if (!snapshots.has(value.componentId)) snapshots.set(value.componentId, { componentId: value.componentId, state: HEALTH_STATES.UNKNOWN, checkedAt: null, latencyMs: null, reasonCode: null, lastSuccessAt: null, lastFailureAt: null, consecutiveFailures: 0, successCount: 0, failureCount: 0, fallbackAvailable: Boolean(value.fallback), fallbackQuality: value.fallbackQuality || "none", degradedCapabilities: [], authState: value.authState?.() || "unknown", circuitState: CIRCUIT_STATES.CLOSED, circuitOpenedAt: null, recoveryAction: null, userActionRequired: false, errorFingerprint: null });
    return value;
  }
  function component(id) { const value = components.get(id); if (!value) throw Object.assign(new Error("Composant inconnu."), { code: "COMPONENT_UNKNOWN" }); return value; }
  function snapshot(id) { component(id); return structuredClone(snapshots.get(id)); }
  function transition(id, next, reasonCode) {
    const previous = snapshots.get(id); snapshots.set(id, next);
    if (previous.state !== next.state) {
      history.unshift({ componentId: id, fromState: previous.state, toState: next.state, timestamp: next.checkedAt, reasonCode }); history.splice(historyLimit);
      emit("component_state_changed", { componentId: id, fromState: previous.state, toState: next.state, reasonCode });
      if (next.state === HEALTH_STATES.HEALTHY && previous.state !== HEALTH_STATES.UNKNOWN) emit("component_recovered", { componentId: id });
    }
  }
  function recordSuccess(id, { latencyMs = 0, capabilities = null, noData = false } = {}) {
    const current = snapshots.get(id) || (register({ componentId: id }), snapshots.get(id)); const checkedAt = time();
    const next = { ...current, state: HEALTH_STATES.HEALTHY, checkedAt, latencyMs, reasonCode: noData ? "NO_DATA" : "OK", lastSuccessAt: checkedAt, consecutiveFailures: 0, successCount: current.successCount + 1, degradedCapabilities: capabilities || [], circuitState: CIRCUIT_STATES.CLOSED, circuitOpenedAt: null, recoveryAction: null, userActionRequired: false, errorFingerprint: null };
    transition(id, next, next.reasonCode);
    emit("health_check_completed", { componentId: id, state: next.state, latencyMs });
    emit("component_latency_ms", { componentId: id, value: latencyMs });
    emit("component_success_rate", { componentId: id, value: next.successCount / Math.max(1, next.successCount + next.failureCount) });
    if ([CIRCUIT_STATES.OPEN, CIRCUIT_STATES.HALF_OPEN].includes(current.circuitState)) emit("circuit_closed", { componentId: id });
    if (current.state !== HEALTH_STATES.UNKNOWN && current.state !== HEALTH_STATES.HEALTHY) emit("recovery_count", { componentId: id, value: 1 });
    return structuredClone(next);
  }
  function recordFailure(id, error, context = {}) {
    const definition = component(id); const current = snapshots.get(id); const failure = classifyFailure(error, context); const failures = current.consecutiveFailures + 1; const checkedAt = time();
    const fingerprint = crypto.createHash("sha256").update(`${id}:${failure.category}:${String(error?.code || error?.name || "ERROR")}`).digest("hex").slice(0, 20);
    const circuitOpen = failure.retryable && failures >= definition.circuitThreshold;
    const authState = context.authState || (String(error?.code || "").toUpperCase() === "AUTH_MISSING" ? "missing" : String(error?.code || "").toUpperCase() === "AUTH_REVOKED" ? "revoked" : failure.category === "AUTH_REQUIRED" ? "expired" : current.authState);
    const next = { ...current, state: stateFor(failure.category, failures, definition.criticality), checkedAt, latencyMs: context.latencyMs ?? null, reasonCode: failure.category, lastFailureAt: checkedAt, consecutiveFailures: failures, failureCount: current.failureCount + 1, degradedCapabilities: context.degradedCapabilities || definition.capabilities, authState, circuitState: circuitOpen ? CIRCUIT_STATES.OPEN : current.circuitState, circuitOpenedAt: circuitOpen ? checkedAt : current.circuitOpenedAt, recoveryAction: failure.recoveryAction, userActionRequired: failure.userActionRequired, errorFingerprint: fingerprint };
    transition(id, next, failure.category); emit("component_failure", { componentId: id, category: failure.category, consecutiveFailures: failures, retryable: failure.retryable });
    emit("component_failure_count", { componentId: id, value: next.failureCount });
    emit("consecutive_failure_count", { componentId: id, value: failures });
    if (context.latencyMs != null) emit("component_latency_ms", { componentId: id, value: context.latencyMs });
    if (circuitOpen && current.circuitState !== CIRCUIT_STATES.OPEN) emit("circuit_opened", { componentId: id });
    return { errorId: `error-${crypto.randomUUID()}`, componentId: id, code: String(error?.code || error?.name || "ERROR").slice(0, 80), ...failure, technicalMessage: redact(error?.message || error), occurredAt: checkedAt, executionId: context.executionId || null, fingerprint, state: next.state };
  }
  function cached(id) { const definition = component(id); const value = snapshots.get(id); return value.checkedAt && now() - Date.parse(value.checkedAt) < definition.ttlMs ? structuredClone(value) : null; }
  function circuitAllows(id) {
    const definition = component(id); const value = snapshots.get(id);
    if (value.circuitState !== CIRCUIT_STATES.OPEN) return true;
    if (now() - Date.parse(value.circuitOpenedAt) >= definition.circuitCooldownMs) { value.circuitState = CIRCUIT_STATES.HALF_OPEN; snapshots.set(id, value); return true; }
    return false;
  }
  async function check(id, { force = false, deep = false } = {}) {
    const definition = component(id); if (!force && cached(id)) return snapshot(id);
    if (!definition.healthCheck) return snapshot(id);
    emit("health_check_started", { componentId: id, deep }); const started = now();
    try { const result = await definition.healthCheck({ deep }); return recordSuccess(id, { latencyMs: now() - started, capabilities: result?.degradedCapabilities || [] }); }
    catch (error) { recordFailure(id, error, { latencyMs: now() - started }); return snapshot(id); }
  }
  async function execute(id, operation, { idempotent = true, destructive = false, unknownOutcome = false, maxRetries = null, executionId = null } = {}) {
    const definition = component(id);
    if (!circuitAllows(id)) throw Object.assign(new Error("Le composant est temporairement suspendu après plusieurs échecs."), { code: "CIRCUIT_OPEN", normalized: classifyFailure(Object.assign(new Error("unavailable"), { status: 503 })) });
    const retries = destructive || !idempotent ? 0 : Math.max(0, Math.min(5, maxRetries ?? definition.maxRetries)); let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const started = now();
      try { const data = await operation(); recordSuccess(id, { latencyMs: now() - started, noData: Array.isArray(data) && data.length === 0 }); return { ok: true, data, outcome: Array.isArray(data) && data.length === 0 ? "NO_DATA" : "SUCCESS", attempts: attempt + 1 }; }
      catch (error) {
        lastError = error; const normalizedError = recordFailure(id, error, { latencyMs: now() - started, executionId, unknownOutcome: unknownOutcome && (destructive || !idempotent) });
        if (!normalizedError.retryable || attempt >= retries || destructive || !idempotent) { error.normalized = normalizedError; throw error; }
        const delay = Math.round(Math.min(2000, 100 * (2 ** attempt)) * (0.8 + random() * 0.4)); emit("retry_count", { componentId: id, attempt: attempt + 1 }); await sleep(delay);
      }
    }
    throw lastError;
  }
  function report({ includeHistory = false } = {}) {
    const values = [...components.keys()].map((id) => snapshot(id)); const criticalDown = values.some((item) => components.get(item.componentId).criticality === "critical" && ![HEALTH_STATES.HEALTHY, HEALTH_STATES.UNKNOWN].includes(item.state));
    const degraded = values.some((item) => ![HEALTH_STATES.HEALTHY, HEALTH_STATES.UNKNOWN].includes(item.state)); const unknown = values.some((item) => item.state === HEALTH_STATES.UNKNOWN);
    const readiness = criticalDown ? READINESS_STATES.NOT_READY : degraded ? READINESS_STATES.DEGRADED_READY : unknown ? READINESS_STATES.CORE_READY : READINESS_STATES.FULLY_READY;
    const overallState = criticalDown ? HEALTH_STATES.UNAVAILABLE : degraded ? HEALTH_STATES.DEGRADED : HEALTH_STATES.HEALTHY;
    const grouped = {}; for (const value of values) (grouped[components.get(value.componentId).type] ||= []).push(value);
    return { checkedAt: time(), overallState, readiness, liveness: "ALIVE", components: values, groups: grouped, warnings: values.filter((item) => ![HEALTH_STATES.HEALTHY, HEALTH_STATES.UNKNOWN].includes(item.state)).map((item) => ({ componentId: item.componentId, state: item.state, reasonCode: item.reasonCode })), recoveryActions: values.filter((item) => item.userActionRequired).map((item) => ({ componentId: item.componentId, action: item.recoveryAction })), ...(includeHistory ? { history: structuredClone(history) } : {}) };
  }
  async function diagnose({ deep = false } = {}) { await Promise.all([...components.values()].filter((item) => deep || item.criticality === "critical").map((item) => check(item.componentId, { force: true, deep }))); return report({ includeHistory: deep }); }
  function sourceCoverage(expected, attempts) { const byId = new Map(attempts.map((item) => [item.source || item.componentId, item])); const succeeded = [], failed = [], noData = []; for (const id of expected) { const item = byId.get(id); if (item?.status === "ok") { succeeded.push(id); if (!item.results?.length && item.resultCount === 0) noData.push(id); } else failed.push({ componentId: id, reasonCode: item?.reasonCode || item?.status || "NOT_CHECKED" }); } return { expected, succeeded, failed, noData, complete: failed.length === 0, state: failed.length ? (succeeded.length ? "PARTIAL" : "FAILED") : "COMPLETE" }; }
  function explain(ids = null) { const values = (ids || [...components.keys()]).map((id) => snapshot(id)); const working = values.filter((item) => item.state === HEALTH_STATES.HEALTHY).map((item) => item.componentId); const issues = values.filter((item) => ![HEALTH_STATES.HEALTHY, HEALTH_STATES.UNKNOWN].includes(item.state)).map((item) => ({ componentId: item.componentId, state: item.state, reasonCode: item.reasonCode, impact: components.get(item.componentId).impact || "Cette fonctionnalité peut être incomplète.", recoveryAction: item.recoveryAction })); return { working, issues, text: issues.length ? `Le cœur de Noon reste disponible. ${issues.map((item) => `${item.componentId} : ${item.reasonCode}. ${item.impact}`).join(" ")}` : "Les composants vérifiés fonctionnent normalement." };
  }
  function notifyMaterialChanges() { const messages = []; for (const item of history) { const key = `${item.componentId}:${item.toState}:${item.reasonCode}`; if (notifications.has(key)) continue; if ([HEALTH_STATES.UNAVAILABLE, HEALTH_STATES.UNAUTHORIZED, HEALTH_STATES.MISCONFIGURED].includes(item.toState) || item.toState === HEALTH_STATES.HEALTHY) { notifications.set(key, now()); messages.push(item); } } return messages; }
  async function selfHeal(id) { const definition = component(id); if (!definition.safeRepair) return { repaired: false, reason: "NO_SAFE_REPAIR" }; const result = await definition.safeRepair(); emit("component_self_healed", { componentId: id }); return { repaired: true, result }; }
  function recordFallback(id, { from = null, to = null, quality = null, reasonCode = "FALLBACK_ACTIVE" } = {}) {
    component(id);
    emit("fallback_activated", { componentId: id, from, to, quality: quality || components.get(id).fallbackQuality || "degraded", reasonCode });
  }
  return { register, component, snapshot, recordSuccess, recordFailure, recordFallback, classifyFailure, check, execute, report, diagnose, sourceCoverage, explain, notifyMaterialChanges, selfHeal, history: () => structuredClone(history), states: HEALTH_STATES, categories: FAILURE_CATEGORIES, readinessStates: READINESS_STATES };
}

module.exports = { CIRCUIT_STATES, FAILURE_CATEGORIES, HEALTH_STATES, READINESS_STATES, classifyFailure, createReliabilityEngine, redact };
