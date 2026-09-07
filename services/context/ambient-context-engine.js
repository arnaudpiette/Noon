"use strict";

const crypto = require("node:crypto");
const { AMBIENT_MODES, createContextSignal } = require("./ambient-context-schema");
const { createAmbientContextPolicy } = require("./ambient-context-policy");
const { createContextSignalRegistry } = require("./context-signal-registry");

function createAmbientContextEngine({ policy = createAmbientContextPolicy(), registry = null,
  now = () => new Date(), featureMode = "SHADOW", audit = null, maxSessionMs = 60 * 60_000 } = {}) {
  registry = registry || createContextSignalRegistry({ now });
  let mode = "OFF";
  let session = null;
  const metrics = { accepted: 0, rejected: 0, expired: 0 };

  function expire() {
    if (session && Date.parse(session.expiresAt) <= now().getTime()) {
      registry.clear(); session = null; mode = "OFF"; metrics.expired += 1;
    }
  }
  function start({ requestedMode = "EXPLICIT_SHARE", durationMs = 15 * 60_000, userExplicit = false } = {}) {
    if (!AMBIENT_MODES.includes(requestedMode) || requestedMode === "OFF") throw new TypeError("Mode ambiant invalide.");
    if (!userExplicit) throw Object.assign(new Error("Activation explicite requise."), { code: "AMBIENT_EXPLICIT_CONSENT_REQUIRED" });
    const startedAt = now().toISOString();
    mode = requestedMode;
    session = Object.freeze({ sessionId: `context_${crypto.randomUUID()}`, mode, startedAt,
      expiresAt: new Date(Date.parse(startedAt) + Math.min(maxSessionMs, Math.max(1000, Number(durationMs) || 0))).toISOString(),
      visibleIndicator: true, userExplicit: true });
    audit?.("ambient-context.session-started", { sessionId: session.sessionId, mode, expiresAt: session.expiresAt });
    return structuredClone(session);
  }
  function stop(reason = "user_stop") {
    const cleared = registry.clear();
    const previous = session?.sessionId || null;
    session = null; mode = "OFF";
    audit?.("ambient-context.session-stopped", { sessionId: previous, reason, cleared });
    return { stopped: true, cleared };
  }
  function receive(rawSignal) {
    expire();
    const signal = createContextSignal(rawSignal, { now });
    const decision = policy.evaluate(signal, { mode, shadow: featureMode === "SHADOW" });
    if (!decision.collect) { metrics.rejected += 1; return { accepted: false, decision }; }
    registry.upsert(signal); metrics.accepted += 1;
    audit?.("ambient-context.signal", { signalId: signal.signalId, signalType: signal.signalType, decision: decision.reason });
    return { accepted: true, signal, decision };
  }
  function snapshot({ remote = false } = {}) {
    expire();
    const entries = registry.list().map((signal) => ({ signal, decision: policy.evaluate(signal, { mode, shadow: featureMode === "SHADOW" }) }))
      .filter(({ decision }) => decision.inject && (!remote || decision.remote));
    return { sessionId: session?.sessionId || null, mode, visibleIndicator: Boolean(session), generatedAt: now().toISOString(),
      signals: entries.map(({ signal }) => signal), signalIds: entries.map(({ signal }) => signal.signalId), ephemeral: true };
  }
  function buildContext({ query = "", remote = false, explicitWorkspaceId = null, explicitMode = null } = {}) {
    const current = snapshot({ remote });
    const explicitIntent = Boolean(String(query).trim());
    const signals = current.signals.filter((signal) => signal.userExplicit || !explicitIntent);
    return { ...current, signals, signalIds: signals.map((item) => item.signalId),
      resolvedWorkspaceId: explicitWorkspaceId || signals.find((item) => item.signalType === "ACTIVE_WORKSPACE" && item.userExplicit)?.valueRef?.workspaceId || null,
      resolvedMode: explicitMode || null, ambientAuthority: false };
  }
  function proactiveHints({ focusActive = false } = {}) {
    if (focusActive) return { relevanceBoost: 0, notify: false, reason: "focus_suppression" };
    const explicitCount = snapshot().signals.filter((item) => item.userExplicit).length;
    return { relevanceBoost: Math.min(0.15, explicitCount * 0.05), notify: false, reason: "relevance_only" };
  }
  function currentView() { const current = snapshot(); return { ...current, signals: current.signals.map((item) => ({ signalId: item.signalId, signalType: item.signalType,
    source: item.source, confidence: item.confidence, scope: item.scope, sensitivity: item.sensitivity, expiresAt: item.expiresAt, userExplicit: item.userExplicit })) }; }
  function health() { expire(); return { status: "ok", mode, active: Boolean(session), signalCount: registry.list().length, featureMode, metrics: { ...metrics }, persistentHistory: false }; }
  return { buildContext, currentView, health, proactiveHints, receive, snapshot, start, stop };
}

module.exports = { createAmbientContextEngine };
