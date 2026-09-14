"use strict";

const { performance } = require("node:perf_hooks");
const {
  SECTION_IDS, VIEW_LEVELS, failedSection, safeIdentifier, scrub, section,
} = require("./control-center-read-models");

const DEFAULT_OVERVIEW_SECTIONS = Object.freeze(["reliability", "connections", "jobs", "approvals"]);
const SAFE_ACTIONS = Object.freeze(new Set(["RUN_QUICK_DIAGNOSTIC", "CHECK_CONNECTION", "CHECK_EXTENSION"]));

function withTimeout(work, timeoutMs, sectionId) {
  let timer;
  return Promise.race([
    Promise.resolve().then(work),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("Lecture trop lente."), { code: `${sectionId.toUpperCase()}_TIMEOUT` })), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

function validateView(view, developerAllowed = false) {
  const normalized = String(view || "USER").toUpperCase();
  if (!VIEW_LEVELS.includes(normalized)) throw Object.assign(new Error("Niveau de vue invalide."), { code: "CONTROL_VIEW_INVALID" });
  if (normalized === "DEVELOPER" && !developerAllowed) throw Object.assign(new Error("Vue Developer désactivée."), { code: "CONTROL_DEVELOPER_DISABLED" });
  return normalized;
}

function validateAction(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Object.assign(new Error("Commande invalide."), { code: "CONTROL_ACTION_INVALID" });
  const action = safeIdentifier(input.action);
  if (!action || action !== String(input.action)) throw Object.assign(new Error("Action non déclarée."), { code: "CONTROL_ACTION_UNKNOWN" });
  const targetId = input.targetId == null ? null : safeIdentifier(input.targetId);
  if (input.targetId != null && !targetId) throw Object.assign(new Error("Cible invalide."), { code: "CONTROL_TARGET_INVALID" });
  const params = input.params && typeof input.params === "object" && !Array.isArray(input.params) ? scrub(input.params) : {};
  return Object.freeze({ action, targetId, params });
}

function preserveGoogleAuthorizationUrl(value) {
  if (typeof value !== "string" || value.length > 8 * 1024) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "accounts.google.com" &&
      url.pathname === "/o/oauth2/v2/auth" &&
      !url.username && !url.password
      ? value
      : null;
  } catch {
    return null;
  }
}

function scrubActionResponse(command, result, latencyMs) {
  const response = scrub({ status: result?.status || "SUCCEEDED", action: command.action, result, latencyMs });
  if (command.action === "CHECK_CONNECTION" && result?.status === "AUTH_REQUIRED") {
    const authorizationUrl = preserveGoogleAuthorizationUrl(result.authorizationUrl);
    if (authorizationUrl && response.result) response.result.authorizationUrl = authorizationUrl;
  }
  return response;
}

function createControlCenterService({
  readers = {}, actions = {}, reliability = null, featureAccess = () => ({ enabled: true, advanced: true, developer: false }),
  observability = null, now = () => Date.now(), cacheTtlMs = 2_000, sectionTimeoutMs = 1_500,
} = {}) {
  const cache = new Map();
  const metrics = { overviewLoads: 0, sectionLoads: 0, actionRequests: 0, overviewLoadMs: 0, sectionLoadMs: 0, actionLatencyMs: 0, ipcVolume: 0 };
  const emit = (event, metadata = {}) => { try { observability?.(event, metadata); } catch {} };
  const access = () => ({ enabled: true, advanced: true, developer: false, ...featureAccess() });

  function assertEnabled() {
    if (!access().enabled) throw Object.assign(new Error("Control Center désactivé."), { code: "CONTROL_CENTER_DISABLED" });
  }

  async function getSection(sectionId, { view = "USER", force = false } = {}) {
    assertEnabled();
    if (!SECTION_IDS.includes(sectionId) || sectionId === "overview") throw Object.assign(new Error("Section inconnue."), { code: "CONTROL_SECTION_UNKNOWN" });
    const permissions = access();
    const level = validateView(view, permissions.developer);
    if (level === "ADVANCED" && !permissions.advanced) throw Object.assign(new Error("Vue avancée désactivée."), { code: "CONTROL_ADVANCED_DISABLED" });
    const key = `${sectionId}:${level}`;
    const cached = cache.get(key);
    if (!force && cached && now() - cached.storedAt < cacheTtlMs) return structuredClone({ ...cached.value, cached: true });
    const started = performance.now();
    let value;
    try {
      const reader = readers[sectionId];
      if (typeof reader !== "function") throw Object.assign(new Error("Source canonique indisponible."), { code: "CANONICAL_SOURCE_UNAVAILABLE" });
      const raw = await withTimeout(() => reader({ view: level }), sectionTimeoutMs, sectionId);
      value = section({ sectionId, ...raw });
    } catch (error) {
      value = failedSection(sectionId, error);
    }
    const latencyMs = Math.round((performance.now() - started) * 100) / 100;
    const finalValue = Object.freeze({ ...value, cached: false, latencyMs });
    cache.set(key, { storedAt: now(), value: finalValue });
    metrics.sectionLoads += 1; metrics.sectionLoadMs += latencyMs;
    emit("control_center_section_loaded", { sectionId, view: level, latencyMs, partial: finalValue.partial });
    return structuredClone(finalValue);
  }

  async function getOverview({ view = "USER", force = false } = {}) {
    assertEnabled();
    const level = validateView(view, access().developer);
    const started = performance.now();
    const results = await Promise.all(DEFAULT_OVERVIEW_SECTIONS.map((id) => getSection(id, { view: level, force })));
    const reliabilitySection = results.find((entry) => entry.sectionId === "reliability");
    const attention = results.flatMap((entry) => entry.items.filter((entryItem) =>
      ["UNAVAILABLE", "UNAUTHORIZED", "MISCONFIGURED"].includes(entryItem.state)))
      .slice(0, 12);
    const latencyMs = Math.round((performance.now() - started) * 100) / 100;
    metrics.overviewLoads += 1; metrics.overviewLoadMs += latencyMs;
    const snapshot = Object.freeze({
      generatedAt: new Date(now()).toISOString(),
      view: level,
      overallStatus: reliabilitySection?.status || "UNKNOWN",
      readiness: reliabilitySection?.counts?.readiness || "UNKNOWN",
      needsAttention: attention,
      sections: Object.fromEntries(results.map((entry) => [entry.sectionId, entry])),
      availableSections: SECTION_IDS.filter((id) => id !== "overview"),
      latencyMs,
      partial: results.some((entry) => entry.partial),
    });
    emit("control_center_opened", { view: level, latencyMs, partial: snapshot.partial });
    return structuredClone(snapshot);
  }

  async function requestAction(input, context = {}) {
    assertEnabled();
    const command = validateAction(input);
    const handler = actions[command.action];
    if (typeof handler !== "function") throw Object.assign(new Error("Action indisponible."), { code: "CONTROL_ACTION_UNAVAILABLE" });
    const started = performance.now(); metrics.actionRequests += 1;
    emit("control_center_action_requested", { action: command.action, hasTarget: Boolean(command.targetId) });
    try {
      let result;
      if (SAFE_ACTIONS.has(command.action)) {
        result = await handler(command, { ...context, origin: "trusted_ui" });
      } else {
        if (typeof actions.authorize !== "function") throw Object.assign(new Error("Pipeline de sécurité indisponible."), { code: "CONTROL_SECURITY_PIPELINE_UNAVAILABLE" });
        result = await actions.authorize(command, {
          ...context,
          origin: "trusted_ui",
          execute: () => handler(command, { ...context, origin: "trusted_ui" }),
        });
      }
      const latencyMs = Math.round((performance.now() - started) * 100) / 100;
      metrics.actionLatencyMs += latencyMs; cache.clear();
      emit("control_center_action_completed", { action: command.action, latencyMs, status: result?.status || "SUCCEEDED" });
      return scrubActionResponse(command, result, latencyMs);
    } catch (error) {
      emit("control_center_action_failed", { action: command.action, code: String(error.code || error.name || "ACTION_FAILED").slice(0, 80) });
      throw error;
    }
  }

  function invalidate(sectionId = null) {
    if (!sectionId) cache.clear();
    else for (const key of cache.keys()) if (key.startsWith(`${sectionId}:`)) cache.delete(key);
  }

  function diagnostics() {
    return Object.freeze({
      status: "HEALTHY",
      cacheEntries: cache.size,
      overviewLoadMs: metrics.overviewLoads ? Math.round((metrics.overviewLoadMs / metrics.overviewLoads) * 100) / 100 : 0,
      sectionLoadMs: metrics.sectionLoads ? Math.round((metrics.sectionLoadMs / metrics.sectionLoads) * 100) / 100 : 0,
      actionLatencyMs: metrics.actionRequests ? Math.round((metrics.actionLatencyMs / metrics.actionRequests) * 100) / 100 : 0,
      ipcVolume: metrics.ipcVolume,
      duplicateStore: false,
      secretAccess: false,
      directDatabaseAccess: false,
      directFilesystemAccess: false,
    });
  }

  return Object.freeze({ diagnostics, getOverview, getSection, invalidate, requestAction, sections: SECTION_IDS });
}

module.exports = { DEFAULT_OVERVIEW_SECTIONS, SAFE_ACTIONS, createControlCenterService, validateAction, validateView };
