"use strict";

const PASSIVE_ALLOWED = new Set(["ACTIVE_APPLICATION"]);
const EXPLICIT_ALLOWED = new Set([
  "ACTIVE_WORKSPACE", "EXPLICIT_FILE", "EXPLICIT_WINDOW", "CURRENT_ARTIFACT",
  "CURRENT_JOB", "CURRENT_TASK", "USER_DECLARED_CONTEXT",
]);
const FORBIDDEN_PASSIVE_SOURCES = /mail|browser_history|terminal|clipboard|keyboard|screen|accessibility/i;

function createAmbientContextPolicy() {
  function evaluate(signal, context = {}) {
    const mode = String(context.mode || "OFF");
    if (mode === "OFF") return decision(false, "ambient_off");
    if (FORBIDDEN_PASSIVE_SOURCES.test(signal.source) && !signal.userExplicit) return decision(false, "passive_sensitive_source");
    if (signal.signalType === "ACTIVE_APPLICATION") {
      if (!PASSIVE_ALLOWED.has(signal.signalType)) return decision(false, "passive_type_forbidden");
      return { ...decision(true, "minimal_hint"), retain: true, inject: mode !== "PASSIVE_MINIMAL" ? false : context.shadow !== true,
        remote: false, proactive: false, authority: false };
    }
    if (!signal.userExplicit || !EXPLICIT_ALLOWED.has(signal.signalType)) return decision(false, "explicit_consent_required");
    const localOnly = signal.scope === "local_only" || signal.sensitivity === "restricted";
    return { ...decision(true, "explicit_share"), retain: true, inject: true, remote: !localOnly,
      proactive: signal.signalType !== "EXPLICIT_WINDOW", authority: false };
  }
  return { evaluate };
}

function decision(collect, reason) {
  return { collect, retain: false, inject: false, remote: false, proactive: false, authority: false, reason };
}

module.exports = { createAmbientContextPolicy };
