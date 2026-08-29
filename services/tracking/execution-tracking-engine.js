"use strict";

const crypto = require("crypto");

const EXECUTION_STATUSES = Object.freeze([
  "planned", "in_progress", "completed", "missed", "delayed", "blocked",
  "cancelled", "deferred", "unknown",
]);
const DRIFT_TYPES = Object.freeze([
  "START_DELAY", "OVERRUN", "MISSED_BLOCK", "UNCONFIRMED_BLOCK", "BLOCKED",
  "CANCELLED", "DEFERRED", "MANUAL_MOVE", "DEPENDENCY_DELAY", "CAPACITY_LOSS",
]);
const TERMINAL = new Set(["completed", "cancelled"]);
const TRANSITIONS = Object.freeze({
  planned: new Set(["in_progress", "completed", "missed", "delayed", "blocked", "cancelled", "deferred", "unknown"]),
  unknown: new Set(["planned", "in_progress", "completed", "missed", "delayed", "blocked", "cancelled", "deferred"]),
  delayed: new Set(["planned", "in_progress", "completed", "missed", "blocked", "cancelled", "deferred", "unknown"]),
  missed: new Set(["planned", "in_progress", "completed", "cancelled", "deferred"]),
  in_progress: new Set(["completed", "blocked", "cancelled", "deferred"]),
  blocked: new Set(["planned", "in_progress", "completed", "cancelled", "deferred"]),
  deferred: new Set(["planned", "in_progress", "completed", "cancelled"]),
  completed: new Set(), cancelled: new Set(),
});
const SOURCE_CONFIDENCE = Object.freeze({
  explicit_user_confirmation: 1,
  reminder_completed: 0.95,
  tool_result: 0.95,
  project_status: 0.85,
  noon_event_annotation: 0.8,
  focus_session: 0.65,
  temporal_observation: 0.35,
});
const SOURCE_PRIORITY = Object.freeze({
  temporal_observation: 1, focus_session: 2, noon_event_annotation: 3,
  project_status: 4, tool_result: 5, reminder_completed: 6, explicit_user_confirmation: 7,
});

class TrackingError extends Error {
  constructor(code, message) { super(message); this.name = "TrackingError"; this.code = code; }
}

function eventKey(input) {
  return crypto.createHash("sha256").update(JSON.stringify([
    input.executionItemId, input.status, input.source, input.occurredAt,
    input.progress ?? null, input.remainingDurationMinutes ?? null,
  ])).digest("hex");
}

function validDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeProgress(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
}

function severityFor(item, drift, at) {
  const deadline = validDate(item.dueAt);
  const deadlineHours = deadline ? (deadline - at) / 3_600_000 : Infinity;
  let points = item.priorityScore >= 80 ? 2 : item.priorityScore >= 60 ? 1 : 0;
  if (deadlineHours <= 24) points += 2; else if (deadlineHours <= 72) points += 1;
  if (["MISSED_BLOCK", "BLOCKED", "DEPENDENCY_DELAY"].includes(drift.type)) points += 1;
  if (drift.affectedActionIds?.length > 1) points += 1;
  return points >= 5 ? "critical" : points >= 3 ? "high" : points >= 2 ? "medium" : "low";
}

function createExecutionTrackingEngine({
  repository,
  proactiveEngine = null,
  planningEngine = null,
  metrics = null,
  memoryEngine = null,
  audit = null,
  now = () => new Date(),
  gracePeriods = {},
  retentionDays = 90,
} = {}) {
  if (!repository?.insert || !repository?.update) throw new TypeError("Dépôt de suivi requis.");
  const grace = { default: 15, meeting: 5, deep_work: 20, ...gracePeriods };

  function ingestPlan(plan, { subjectScope = "arnaud" } = {}) {
    const blocks = [...(plan.plannedBlocks || []), ...(plan.proposedBlocks || [])];
    const created = [];
    for (const block of blocks) {
      const existing = repository.findByAction(block.actionId, subjectScope)
        .find((item) => item.planBlockId === block.blockId);
      if (existing) { created.push(existing); continue; }
      const timestamp = plan.generatedAt || now().toISOString();
      created.push(repository.insert({
        executionItemId: `execution_${crypto.randomUUID()}`,
        actionId: block.actionId, planId: plan.planId, planBlockId: block.blockId,
        subjectScope, source: block.source || "daily_plan", sourceRef: block.blockId,
        plannedStart: block.start, plannedEnd: block.end,
        status: block.status === "completed" ? "completed" : block.status === "in_progress" ? "in_progress" : "planned",
        progress: block.status === "completed" ? 100 : null,
        confidence: block.status === "completed" ? 1 : 0.5,
        completionSource: block.status === "completed" ? "explicit_user_confirmation" : null,
        remainingDurationMinutes: block.durationMinutes || null,
        priorityScore: block.priorityScore || 0, dueAt: block.dueAt || null,
        dependencies: block.dependencies || [], manualMove: block.manualMove === true,
        lastEventAt: timestamp, lastUpdatedAt: timestamp,
      }));
    }
    metrics?.record("tracking_items_total", created.length);
    return created;
  }

  function transition(executionItemId, input = {}) {
    const current = repository.get(executionItemId);
    if (!current) throw new TrackingError("TRACKING_ITEM_NOT_FOUND", "Élément de suivi introuvable.");
    const target = String(input.status || "");
    if (!EXECUTION_STATUSES.includes(target)) throw new TrackingError("TRACKING_STATUS_INVALID", "Statut de suivi invalide.");
    const occurredAt = validDate(input.occurredAt || now())?.toISOString();
    if (!occurredAt) throw new TrackingError("TRACKING_DATE_INVALID", "Date de preuve invalide.");
    const source = SOURCE_CONFIDENCE[input.source] ? input.source : "temporal_observation";
    const confidence = Math.max(0, Math.min(1, Number(input.confidence ?? SOURCE_CONFIDENCE[source])));
    const key = input.eventKey || eventKey({ executionItemId, status: target, source, occurredAt,
      progress: input.progress, remainingDurationMinutes: input.remainingDurationMinutes });
    if (repository.getEvent(key)) return { item: current, idempotent: true };
    if (Date.parse(occurredAt) < Date.parse(current.lastEventAt) &&
      (SOURCE_PRIORITY[source] || 0) <= (SOURCE_PRIORITY[current.completionSource] || 0)) {
      return { item: current, ignored: true, reason: "older_evidence" };
    }
    const sameStateWithNewFacts = current.status === target && (
      input.progress != null || input.remainingDurationMinutes != null || input.actualStart || input.actualEnd || input.blocker
    );
    if (current.status === target && !sameStateWithNewFacts) {
      repository.appendEvent({ executionItemId, eventKey: key, eventType: "duplicate_state",
        fromStatus: current.status, toStatus: target, source, confidence, occurredAt });
      return { item: current, idempotent: true };
    }
    if (TERMINAL.has(current.status) && input.reopen !== true) {
      throw new TrackingError("TRACKING_TERMINAL_STATE", `Le statut ${current.status} exige une réouverture explicite.`);
    }
    if (current.status !== target && !TRANSITIONS[current.status]?.has(target) && input.reopen !== true) {
      throw new TrackingError("TRACKING_INVALID_TRANSITION", `Transition ${current.status} → ${target} interdite.`);
    }
    const progress = target === "completed" ? 100 : normalizeProgress(input.progress ?? current.progress);
    let remainingDurationMinutes = input.remainingDurationMinutes == null
      ? current.remainingDurationMinutes : Math.max(0, Number(input.remainingDurationMinutes) || 0);
    if (target === "completed") remainingDurationMinutes = 0;
    const blocker = target === "blocked" ? {
      type: String(input.blocker?.type || "unknown").slice(0, 80),
      reason: String(input.blocker?.reason || "Blocage signalé").slice(0, 500),
      dependencyRef: input.blocker?.dependencyRef || null,
      detectedAt: occurredAt, confidence,
    } : target === "planned" || target === "in_progress" || target === "completed" ? null : current.blocker;
    const next = repository.update(executionItemId, current.version, {
      status: target, progress, confidence,
      completionSource: source,
      actualStart: input.actualStart || (target === "in_progress" ? occurredAt : current.actualStart),
      actualEnd: input.actualEnd || (target === "completed" ? occurredAt : current.actualEnd),
      remainingDurationMinutes, blocker,
      deferredUntil: target === "deferred" ? input.deferredUntil || null : current.deferredUntil,
      manualMove: input.manualMove === true || current.manualMove,
      plannedStart: input.plannedStart || current.plannedStart,
      plannedEnd: input.plannedEnd || current.plannedEnd,
      lastEventAt: occurredAt, lastUpdatedAt: now().toISOString(),
    });
    repository.appendEvent({ executionItemId, eventKey: key, eventType: input.eventType || "status_change",
      fromStatus: current.status, toStatus: target, source, confidence, occurredAt,
      reasonCode: input.reasonCode || null });
    if (target === "completed" && next.actualStart && next.actualEnd && confidence >= 0.8) {
      const actual = Math.max(0, (Date.parse(next.actualEnd) - Date.parse(next.actualStart)) / 60_000);
      const estimated = current.remainingDurationMinutes || actual;
      if (actual > 0) {
        repository.recordDuration(`project:${input.projectId || "general"}`, estimated, actual);
        metrics?.record("duration_estimate_error", Math.abs(actual - estimated));
        metrics?.record("duration_estimate_samples", 1);
      }
    }
    metrics?.record("tracking_status_changes", 1, { category: `${current.status}_to_${target}` });
    metrics?.record(`tracking_${target}`, 1);
    audit?.("tracking.transition", { executionItemId, actionId: current.actionId,
      fromStatus: current.status, toStatus: target, source, confidence, version: next.version });
    return { item: next, idempotent: false };
  }

  function synchronizeEvidence(evidence = {}) {
    const matches = evidence.executionItemId ? [repository.get(evidence.executionItemId)].filter(Boolean)
      : repository.findByAction(String(evidence.actionId || ""), evidence.subjectScope || "arnaud");
    if (matches.length !== 1) return { status: "ambiguous", candidates: matches.map((item) => item.executionItemId) };
    return { status: "updated", ...transition(matches[0].executionItemId, evidence) };
  }

  function applyReminder(reminder, options = {}) {
    if (!reminder?.completed) return { status: "ignored" };
    return synchronizeEvidence({ actionId: options.actionId || reminder.actionId || reminder.id,
      subjectScope: options.subjectScope, status: "completed", source: "reminder_completed",
      occurredAt: reminder.completedAt || options.occurredAt || now(), eventKey: `reminder:${reminder.id}:completed` });
  }

  function applyToolResult(result = {}) {
    if (!result.actionId) return { status: "ignored" };
    if (result.executionSucceeded === true && result.exactActionMatch === true) {
      return synchronizeEvidence({ actionId: result.actionId, status: "completed", source: "tool_result",
        occurredAt: result.completedAt || now(), eventKey: result.eventKey || `tool:${result.executionId || result.actionId}:success` });
    }
    if (result.executionSucceeded === false) {
      return synchronizeEvidence({ actionId: result.actionId, status: "blocked", source: "tool_result",
        occurredAt: result.completedAt || now(), blocker: { type: "tool_failure", reason: "Exécution technique échouée" },
        eventKey: result.eventKey || `tool:${result.executionId || result.actionId}:failure` });
    }
    return { status: "ignored" };
  }

  function interpretUserCommand(text, candidates = [], { at = now() } = {}) {
    const value = String(text || "").toLocaleLowerCase("fr");
    let status = null;
    if (/\b(j.?ai fini|termin[eé]e?|c.?est fini|c.?est fait)\b/.test(value)) status = "completed";
    else if (/\b(je suis dessus|j.?ai commenc[eé]|en cours)\b/.test(value)) status = "in_progress";
    else if (/\b(je suis bloqu[eé]|bloqu[eé] sur|ça bloque)\b/.test(value)) status = "blocked";
    else if (/\b(annule|abandonn[eé])\b/.test(value)) status = "cancelled";
    else if (/\b(demain|semaine prochaine|plus tard|reporte)\b/.test(value)) status = "deferred";
    if (!status) return { status: "unrecognized" };
    if (candidates.length !== 1) return { status: "ambiguous", requestedStatus: status,
      candidates: candidates.map((item) => item.executionItemId) };
    let deferredUntil = null;
    if (status === "deferred" && /\bdemain\b/.test(value)) deferredUntil = new Date(at.getTime() + 24 * 60 * 60 * 1000).toISOString();
    return synchronizeEvidence({ executionItemId: candidates[0].executionItemId, status,
      source: "explicit_user_confirmation", occurredAt: at, deferredUntil,
      blocker: status === "blocked" ? { type: "user_reported", reason: "Blocage signalé par l’utilisateur" } : null });
  }

  function detectDrift({ at = now(), subjectScope = "arnaud" } = {}) {
    const drifts = [];
    const items = repository.list({ subjectScope });
    const byAction = new Map(items.map((item) => [item.actionId, item]));
    for (const item of items) {
      if (TERMINAL.has(item.status) || item.status === "deferred" || item.manualMove) continue;
      const start = validDate(item.plannedStart); const end = validDate(item.plannedEnd);
      const graceMinutes = grace[item.source] ?? grace.default;
      let drift = null;
      if (item.status === "blocked") drift = { type: "BLOCKED" };
      else if (item.status === "in_progress" && end && at > new Date(end.getTime() + graceMinutes * 60_000)) {
        drift = { type: "OVERRUN", overrunMinutes: Math.round((at - end) / 60_000) };
      } else if (["planned", "unknown", "delayed"].includes(item.status) && end && at > end) {
        if (item.status === "planned") {
          transition(item.executionItemId, { status: "unknown", source: "temporal_observation",
            occurredAt: at, eventKey: `elapsed:${item.planBlockId || item.executionItemId}:${end.toISOString()}` });
        }
        drift = { type: "UNCONFIRMED_BLOCK" };
      } else if (item.status === "planned" && start && at > new Date(start.getTime() + graceMinutes * 60_000)) {
        const delayMinutes = Math.round((at - start) / 60_000);
        if (delayMinutes >= graceMinutes) drift = { type: "START_DELAY", delayMinutes };
      }
      if (drift) {
        const affectedActionIds = items.filter((candidate) => candidate.dependencies.includes(item.actionId) &&
          !TERMINAL.has(candidate.status)).map((candidate) => candidate.actionId);
        const value = { id: `drift_${crypto.randomUUID()}`, executionItemId: item.executionItemId,
          actionId: item.actionId, ...drift, affectedActionIds, detectedAt: at.toISOString() };
        value.severity = severityFor(item, value, at);
        drifts.push(value);
        for (const dependentId of affectedActionIds) {
          const dependent = byAction.get(dependentId);
          drifts.push({ id: `drift_${crypto.randomUUID()}`, executionItemId: dependent.executionItemId,
            actionId: dependentId, type: "DEPENDENCY_DELAY", affectedActionIds: [item.actionId],
            severity: severityFor(dependent, { type: "DEPENDENCY_DELAY", affectedActionIds: [item.actionId] }, at), detectedAt: at.toISOString() });
        }
      }
    }
    metrics?.record("tracking_drift_detected", drifts.length);
    for (const drift of drifts) metrics?.record("drift_by_type", 1, { category: drift.type });
    audit?.("tracking.drift-scan", { itemCount: items.length, driftCount: drifts.length,
      types: [...new Set(drifts.map((drift) => drift.type))] });
    return drifts;
  }

  async function sendDriftsToProactive(drifts, { at = now(), subjectScope = "arnaud" } = {}) {
    if (!proactiveEngine?.evaluate) return { recommendations: [], notifications: [], ignored: [] };
    const items = new Map(repository.list({ subjectScope }).map((item) => [item.executionItemId, item]));
    const signals = drifts.filter((drift) => ["high", "critical"].includes(drift.severity)).map((drift) => {
      const item = items.get(drift.executionItemId);
      return proactiveEngine.adapters.local([{
        id: drift.id, title: "Ajustement de planning à examiner",
        action: "Vérifier l’état de l’action et proposer un ajustement minimal",
        signalType: "execution_drift", importance: item?.priorityScore ? item.priorityScore / 100 : 0.7,
        impact: drift.severity === "critical" ? 1 : 0.8, urgency: drift.severity === "critical" ? 1 : 0.8,
        confidence: item?.confidence || 0.5, projectId: null,
        materialKey: `${drift.type}:${item?.lastEventAt || drift.detectedAt}`,
        apiPolicy: "local_only",
      }], { now: at, local: true })[0];
    }).filter(Boolean);
    const result = await proactiveEngine.evaluate(signals, { at, channel: "tracking", remoteModel: false });
    metrics?.record("tracking_replan_requested", result.recommendations.length);
    return result;
  }

  async function requestMinimalReplan({ drifts = [], plan, actions = [], events = [], at = now() } = {}) {
    const material = drifts.filter((drift) => ["medium", "high", "critical"].includes(drift.severity));
    if (!material.length || !planningEngine?.replanDay) {
      metrics?.record("tracking_replan_suppressed", 1);
      return { status: "suppressed", reason: "no_material_drift" };
    }
    const items = repository.list({ planId: plan?.planId });
    const tracked = new Map(items.map((item) => [item.actionId, item]));
    const adjustedActions = actions.map((action) => {
      const item = tracked.get(action.actionId || action.id);
      if (!item) return action;
      return { ...action, completed: item.status === "completed", inProgress: item.status === "in_progress",
        blocked: item.status === "blocked", snoozedUntil: item.deferredUntil,
        estimatedDurationMinutes: item.remainingDurationMinutes ?? action.estimatedDurationMinutes };
    });
    const replanned = await planningEngine.replanDay({ actions: adjustedActions, events, at,
      previousPlan: plan, trigger: `tracking:${material.map((drift) => drift.type).join(",")}` });
    metrics?.record("tracking_replan_requested", 1);
    return { status: "proposed", plan: replanned, contract: {
      reason: material[0].type,
      affectedActionIds: [...new Set(material.flatMap((drift) => [drift.actionId, ...(drift.affectedActionIds || [])]))],
      preserveCompleted: true, preserveInProgress: true, preserveManualMoves: true, preserveFixedEvents: true,
    } };
  }

  function rollover({ fromDate, toDate, subjectScope = "arnaud", at = now() } = {}) {
    const candidates = repository.list({ subjectScope }).filter((item) =>
      item.plannedStart?.startsWith(fromDate) && !TERMINAL.has(item.status) && item.status !== "deferred");
    return candidates.filter((item) => item.priorityScore >= 45 && (!item.dueAt || Date.parse(item.dueAt) >= at.getTime()))
      .map((item) => ({ ...item, carryOverDate: toDate, carryOver: true }));
  }

  function durationStats(scopeKey) { return repository.getDurationStats(scopeKey); }
  function cleanup() { return repository.cleanup(new Date(now().getTime() - retentionDays * 86_400_000).toISOString()); }

  return { applyReminder, applyToolResult, cleanup, detectDrift, durationStats, ingestPlan,
    interpretUserCommand, requestMinimalReplan, rollover, sendDriftsToProactive,
    synchronizeEvidence, transition, list: repository.list };
}

module.exports = { DRIFT_TYPES, EXECUTION_STATUSES, SOURCE_CONFIDENCE, SOURCE_PRIORITY,
  TRANSITIONS, TrackingError, createExecutionTrackingEngine, eventKey, severityFor };
