"use strict";

const crypto = require("node:crypto");
const { FLAG_MODES } = require("./feature-flag-registry");

function cohort(flagId, scopeId) {
  const digest = crypto.createHash("sha256").update(`${flagId}:${scopeId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

function createFeatureFlagService({ registry, runtimeConfig, observability = null, now = () => Date.now(), promotionGate = () => ({ allowed: true }) } = {}) {
  if (!registry?.get || !runtimeConfig?.state) throw new TypeError("FeatureFlagRegistry et RuntimeConfigService requis.");
  function configured(flagId) { return runtimeConfig.featureState(flagId).configured; }
  function evaluate(flagId, context = {}) {
    const definition = registry.get(flagId);
    const flagState = runtimeConfig.featureState(flagId);
    const stored = flagState.configured;
    const killSwitch = flagState.killSwitch;
    let mode = stored.mode || definition.defaultMode;
    let reason = stored.mode ? "configured_global" : "registry_default";
    if (stored.workspaces?.[context.workspaceId]) { mode = stored.workspaces[context.workspaceId]; reason = "workspace_override"; }
    if (stored.sessions?.[context.sessionId]) { mode = stored.sessions[context.sessionId]; reason = "session_override"; }
    if (killSwitch && definition.killSwitchAllowed) { mode = "OFF"; reason = "kill_switch"; }
    if (mode === "LIMITED") {
      const explicit = stored.allowWorkspaces?.includes(context.workspaceId) || stored.allowSessions?.includes(context.sessionId);
      const percentage = Math.max(0, Math.min(100, Number(stored.percentage) || 0));
      const scopeId = context.workspaceId || context.sessionId || "anonymous";
      if (!explicit && cohort(flagId, scopeId) >= percentage) { mode = "OFF"; reason = "limited_not_selected"; }
      else reason = explicit ? "limited_allowlist" : "limited_stable_cohort";
    }
    for (const required of definition.requires) if (!evaluate(required, context).enabled) { mode = "OFF"; reason = `dependency:${required}`; }
    const result = { flagId, mode, enabled: ["LIMITED", "ON"].includes(mode), shadow: mode === "SHADOW", authority: mode !== "SHADOW", reason, configVersion: flagState.configVersion, featureFlagVersion: registry.schemaVersion, rollbackSafe: definition.rollbackSafe };
    observability?.("feature_flag_evaluated", { flagId, mode, reason, workspaceHash: context.workspaceId ? crypto.createHash("sha256").update(context.workspaceId).digest("hex").slice(0, 12) : null });
    return result;
  }
  function update(flagId, patch, { origin = "developer", gateContext = {} } = {}) {
    const definition = registry.get(flagId);
    if (patch.mode && !definition.allowedModes.includes(patch.mode)) throw Object.assign(new Error("Mode de flag invalide."), { code: "FLAG_MODE_INVALID" });
    const previous = configured(flagId);
    const from = previous.mode || definition.defaultMode;
    const to = patch.mode || from;
    const promoted = FLAG_MODES.indexOf(to) > FLAG_MODES.indexOf(from);
    if (promoted) {
      const gate = promotionGate({ flagId, from, to, ...gateContext });
      if (!gate?.allowed) throw Object.assign(new Error("Promotion refusée par les évaluations."), { code: "FLAG_PROMOTION_BLOCKED", details: gate });
    }
    for (const incompatible of definition.incompatibleWith) if (["LIMITED", "ON"].includes(to) && evaluate(incompatible).enabled) throw Object.assign(new Error(`Flag incompatible : ${incompatible}`), { code: "FLAG_INCOMPATIBLE" });
    const state = runtimeConfig.state();
    state.flags[flagId] = { ...previous, ...patch, updatedAt: new Date(now()).toISOString(), origin };
    state.configVersion += 1;
    // L'écriture passe par la primitive contrôlée du service sans exposer de secret.
    runtimeConfig.replaceState(state, { event: promoted ? "feature_flag_promoted" : "feature_flag_rolled_back", flagId, origin });
    return evaluate(flagId);
  }
  function kill(flagId, enabled = true, origin = "reliability") {
    const definition = registry.get(flagId);
    if (!definition.killSwitchAllowed) throw Object.assign(new Error("Kill switch interdit."), { code: "KILL_SWITCH_FORBIDDEN" });
    const state = runtimeConfig.state(); state.killSwitches[flagId] = enabled === true; state.configVersion += 1;
    runtimeConfig.replaceState(state, { event: "feature_flag_kill_switch", flagId, origin });
    return evaluate(flagId);
  }
  function debt(referenceDate = new Date(now())) { return registry.list().filter((flag) => flag.reviewAfter && new Date(flag.reviewAfter) < referenceDate).map((flag) => ({ flagId: flag.flagId, lifecycle: flag.lifecycle, reviewAfter: flag.reviewAfter, readyForCleanup: flag.lifecycle === "STABLE" && evaluate(flag.flagId).mode === "ON" })); }
  function snapshot(context = {}) { return Object.freeze({ featureFlagVersion: registry.schemaVersion, configVersion: runtimeConfig.state().configVersion, flags: Object.freeze(Object.fromEntries(registry.list().map((flag) => [flag.flagId, evaluate(flag.flagId, context)]))) }); }
  return { debt, evaluate, kill, snapshot, update };
}

module.exports = { cohort, createFeatureFlagService };
