"use strict";

const crypto = require("crypto");
const { BLUEBERRY_COLOR_ID, buildManagedEvent, dateKey, isNoonManagedEvent } = require("../../lib/morning-brief");

const PLAN_SCHEMA_VERSION = 1;
const REASON_CODES = Object.freeze([
  "NO_AVAILABLE_SLOT", "DEADLINE_CONFLICT", "BLOCKED", "INSUFFICIENT_DURATION",
  "LOWER_PRIORITY", "DEPENDENCY", "PROTECTED_PERIOD", "SNOOZED", "COMPLETED",
]);

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function stableHash(value) {
  const stringify = (item) => Array.isArray(item) ? `[${item.map(stringify).join(",")}]`
    : item && typeof item === "object" ? `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${stringify(item[key])}`).join(",")}}`
      : JSON.stringify(item);
  return crypto.createHash("sha256").update(stringify(value)).digest("hex");
}

function validDate(value) {
  const result = value instanceof Date ? value : new Date(value);
  return Number.isFinite(result.getTime()) ? result : null;
}

function overlaps(left, right) {
  const leftStart = validDate(left.start?.dateTime || left.start);
  const leftEnd = validDate(left.end?.dateTime || left.end);
  const rightStart = validDate(right.start?.dateTime || right.start);
  const rightEnd = validDate(right.end?.dateTime || right.end);
  return leftStart && leftEnd && rightStart && rightEnd && leftStart < rightEnd && rightStart < leftEnd;
}

function estimateDuration(input = {}) {
  const explicit = Number(input.estimatedDurationMinutes ?? input.estimatedDuration);
  if (explicit > 0) return { minutes: Math.max(5, Math.min(480, explicit)), confidence: input.durationConfidence || "high", source: "explicit" };
  const historical = Number(input.historicalDurationMinutes);
  if (historical > 0) return { minutes: Math.max(5, Math.min(480, historical)), confidence: "medium", source: "history" };
  const type = String(input.taskType || input.signalType || "").toLowerCase();
  const minutes = /appel|call|message|email/.test(type) ? 20 : /réunion|meeting|soutenance/.test(type) ? 60 : /audit|analyse|design|code|develop/.test(type) ? 90 : 30;
  return { minutes, confidence: "low", source: "heuristic" };
}

function normalizePlanningAction(input = {}) {
  const duration = estimateDuration(input);
  const maximumBlockMinutes = Math.max(15, Math.min(240, Number(input.maximumBlockMinutes) || 90));
  const minimumBlockMinutes = Math.max(10, Math.min(maximumBlockMinutes, Number(input.minimumBlockMinutes) || 25));
  return Object.freeze({
    actionId: String(input.actionId || input.id || input.signalId || "").slice(0, 300),
    title: String(input.title || input.action || input.proposal || "Action sans titre").trim().slice(0, 300),
    source: String(input.source || input.sourceType || "local").slice(0, 80),
    sourceRef: String(input.sourceRef || input.sourceReference || input.sourceId || input.id || "").slice(0, 300),
    priorityScore: Math.max(0, Math.min(100, Number(input.priorityScore ?? input.score) || 0)),
    priorityLevel: input.priorityLevel || input.priority || "basse",
    dueAt: input.dueAt || input.deadline || null,
    estimatedDurationMinutes: duration.minutes,
    durationConfidence: duration.confidence,
    durationSource: duration.source,
    minimumBlockMinutes, maximumBlockMinutes,
    splittable: input.splittable === true,
    projectId: input.projectId || null,
    dependencies: Array.isArray(input.dependencies) ? input.dependencies.map(String).slice(0, 20) : [],
    preferredTimeOfDay: ["morning", "afternoon", "evening"].includes(input.preferredTimeOfDay) ? input.preferredTimeOfDay : null,
    energyDemand: ["low", "medium", "high"].includes(input.energyDemand || input.energyRequired) ? (input.energyDemand || input.energyRequired) : null,
    locationConstraint: input.locationConstraint || null,
    requiresOnline: input.requiresOnline === true,
    fixed: input.fixed === true,
    blocked: input.blocked === true,
    completed: input.completed === true || input.status === "completed",
    inProgress: input.inProgress === true || input.status === "in_progress",
    snoozedUntil: input.snoozedUntil || null,
    confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0.5)),
  });
}

function splitAction(action) {
  if (!action.splittable || action.estimatedDurationMinutes <= action.maximumBlockMinutes) {
    return action.estimatedDurationMinutes >= action.minimumBlockMinutes
      ? [{ minutes: action.estimatedDurationMinutes, part: 1, total: 1 }] : [];
  }
  const parts = [];
  let remaining = action.estimatedDurationMinutes;
  while (remaining > 0) {
    let minutes = Math.min(action.maximumBlockMinutes, remaining);
    if (remaining - minutes > 0 && remaining - minutes < action.minimumBlockMinutes) {
      minutes -= action.minimumBlockMinutes - (remaining - minutes);
    }
    if (minutes < action.minimumBlockMinutes) return [];
    parts.push({ minutes, part: parts.length + 1 });
    remaining -= minutes;
  }
  return parts.map((part) => ({ ...part, total: parts.length }));
}

function fixedEvent(event) {
  return {
    id: event.id || null,
    title: String(event.summary || event.title || "Événement").slice(0, 240),
    start: event.start?.dateTime || event.start?.date || event.start,
    end: event.end?.dateTime || event.end?.date || event.end,
    noonManaged: isNoonManagedEvent(event),
    manualMove: event.manualMoved === true || event.extendedProperties?.private?.manualMoved === "true",
    status: event.status || "confirmed",
  };
}

function createDailyPlanningEngine({
  priorityEngine,
  timeSlotService,
  hardRulesRegistry,
  store,
  settingsProvider = () => ({}),
  learningHintsProvider = () => ({}),
  approvalEngine = null,
  calendarReader = null,
  metrics = null,
  audit = null,
  now = () => new Date(),
  utilizationTarget = 0.82,
} = {}) {
  if (!priorityEngine?.rank) throw new TypeError("Priority Engine requis.");
  if (!timeSlotService?.suggest) throw new TypeError("TimeSlotService requis.");
  if (!store?.get || !store?.save) throw new TypeError("Stockage Daily Plan requis.");

  async function buildPlan({ actions = [], events = [], at = now(), previousPlan = null, trigger = "manual", preservePast = true } = {}) {
    const startedAt = Date.now();
    const day = dateKey(at);
    const settings = settingsProvider() || {};
    const learningHints = learningHintsProvider({ at, actions }) || {};
    const protectedRule = hardRulesRegistry?.getRule?.("calendar.protected_lunch");
    const planningSettings = {
      ...settings,
      protectedBreakStart: protectedRule?.value?.start || settings.protectedBreakStart || "12:30",
      protectedBreakEnd: protectedRule?.value?.end || settings.protectedBreakEnd || "13:30",
      timeZone: protectedRule?.value?.timezone || settings.timeZone || "Europe/Paris",
    };
    const previous = previousPlan || store.get(day);
    const durationMultiplier = clampNumber(learningHints.bufferMultiplierHint, 1, 1.35, 1);
    const normalized = actions.map(normalizePlanningAction).filter((action) => action.actionId)
      .map((action) => durationMultiplier > 1 ? {
        ...action,
        estimatedDurationMinutes: Math.min(480, Math.ceil(action.estimatedDurationMinutes * durationMultiplier / 5) * 5),
        learningAdjustment: { type: "duration_buffer", multiplier: durationMultiplier },
      } : action);
    const missingPriority = normalized.filter((action) => !Number.isFinite(action.priorityScore) || action.priorityScore <= 0);
    const rankedFallback = new Map(priorityEngine.rank(missingPriority.map((action) => ({
      ...action, id: action.actionId, sourceType: action.source, sourceId: action.sourceRef,
      estimatedDurationMinutes: action.estimatedDurationMinutes,
    })), { limit: missingPriority.length, now: at }).map((action) => [action.id, action]));
    const ranked = normalized.map((action) => {
      const fallback = rankedFallback.get(action.actionId);
      return fallback ? { ...action, priorityScore: fallback.score, priorityLevel: fallback.priorityLevel } : action;
    }).sort((left, right) => right.priorityScore - left.priorityScore || String(left.dueAt || "9999").localeCompare(String(right.dueAt || "9999")) || left.actionId.localeCompare(right.actionId));

    const fixedEvents = events.map(fixedEvent);
    const busy = events.map((event) => ({ ...event }));
    const plannedBlocks = [];
    const proposedBlocks = [];
    const unscheduledActions = [];
    const warnings = [];
    const nowMs = at.getTime();
    const previousByAction = new Map((previous?.proposedBlocks || previous?.plannedBlocks || []).map((block) => [block.actionId, block]));
    const completed = new Set();
    let scheduledMinutes = 0;
    let timeslotLookupMs = 0;

    // Les événements passés, terminés, en cours ou déplacés manuellement sont immuables.
    for (const action of ranked) {
      const existing = previousByAction.get(action.actionId);
      const existingStart = validDate(existing?.start);
      if (!existing) continue;
      if (action.completed || existing.status === "completed") {
        completed.add(action.actionId);
        plannedBlocks.push({ ...existing, status: "completed", preserved: true });
      } else if (action.inProgress || existing.status === "in_progress" || existing.manualMove === true || (preservePast && existingStart && existingStart.getTime() <= nowMs)) {
        plannedBlocks.push({ ...existing, status: action.inProgress ? "in_progress" : existing.status || "planned", preserved: true });
        busy.push({ start: existing.start, end: existing.end });
        scheduledMinutes += Number(existing.durationMinutes) || action.estimatedDurationMinutes;
        completed.add(action.actionId);
      } else if (existingStart && !events.some((event) => overlaps(existing, event))) {
        // La stabilité gagne lorsqu’aucune nouvelle contrainte ne touche le bloc.
        proposedBlocks.push({ ...existing, preserved: true });
        busy.push({ start: existing.start, end: existing.end });
        scheduledMinutes += Number(existing.durationMinutes) || action.estimatedDurationMinutes;
        completed.add(action.actionId);
      }
    }

    const workdayMinutes = Math.max(0,
      (Number(String(planningSettings.workdayEnd || "18:30").split(":")[0]) * 60 + Number(String(planningSettings.workdayEnd || "18:30").split(":")[1])) -
      (Number(String(planningSettings.workdayStart || "09:00").split(":")[0]) * 60 + Number(String(planningSettings.workdayStart || "09:00").split(":")[1])) - 60
    );
    const fixedMinutes = fixedEvents.reduce((sum, event) => {
      const start = validDate(event.start); const end = validDate(event.end);
      return sum + (start && end ? Math.max(0, (end - start) / 60_000) : 0);
    }, 0);
    const rawCapacity = Math.max(0, workdayMinutes - fixedMinutes);
    const hintedUtilization = clampNumber(learningHints.maxPlannedUtilizationHint, 0.5, 0.95, utilizationTarget);
    const schedulableCapacity = Math.floor(rawCapacity * Math.max(0.5, Math.min(0.95, hintedUtilization)));

    const pending = ranked.filter((action) => !completed.has(action.actionId));
    let progress = true;
    while (pending.length && progress) {
      progress = false;
      for (let index = 0; index < pending.length;) {
        const action = pending[index];
        if (action.completed) {
          unscheduledActions.push({ actionId: action.actionId, title: action.title, reasonCode: "COMPLETED" }); pending.splice(index, 1); progress = true; continue;
        }
        if (action.blocked) {
          unscheduledActions.push({ actionId: action.actionId, title: action.title, reasonCode: "BLOCKED" }); pending.splice(index, 1); progress = true; continue;
        }
        if (action.snoozedUntil && validDate(action.snoozedUntil) > at) {
          unscheduledActions.push({ actionId: action.actionId, title: action.title, reasonCode: "SNOOZED" }); pending.splice(index, 1); progress = true; continue;
        }
        const unresolved = action.dependencies.filter((dependency) => !completed.has(dependency));
        if (unresolved.some((dependency) => pending.some((candidate) => candidate.actionId === dependency))) { index += 1; continue; }
        if (unresolved.length) {
          unscheduledActions.push({ actionId: action.actionId, title: action.title, reasonCode: "DEPENDENCY", dependencies: unresolved }); pending.splice(index, 1); progress = true; continue;
        }
        const chunks = splitAction(action);
        if (!chunks.length) {
          unscheduledActions.push({ actionId: action.actionId, title: action.title, reasonCode: "INSUFFICIENT_DURATION" }); pending.splice(index, 1); progress = true; continue;
        }
        if (scheduledMinutes + action.estimatedDurationMinutes > schedulableCapacity) {
          unscheduledActions.push({ actionId: action.actionId, title: action.title, reasonCode: "LOWER_PRIORITY" }); pending.splice(index, 1); progress = true; continue;
        }
        const staged = [];
        let failed = null;
        for (const chunk of chunks) {
          const lookupStarted = Date.now();
          const slots = await timeSlotService.suggest({
            durationMinutes: chunk.minutes, events: [...busy, ...staged.map((block) => ({ start: block.start, end: block.end }))],
            settings: planningSettings, now: at, days: 1, maximumResults: 20,
            dueAt: action.dueAt, preferredTimeOfDay: action.preferredTimeOfDay,
          });
          timeslotLookupMs += Date.now() - lookupStarted;
          const slot = slots[0];
          if (!slot) { failed = action.dueAt ? "DEADLINE_CONFLICT" : "NO_AVAILABLE_SLOT"; break; }
          staged.push({
            blockId: `block_${stableHash([action.actionId, chunk.part, slot.start, slot.end]).slice(0, 20)}`,
            actionId: action.actionId,
            title: chunks.length > 1 ? `${action.title} (${chunk.part}/${chunk.total})` : action.title,
            start: slot.start, end: slot.end, durationMinutes: chunk.minutes,
            projectId: action.projectId, priorityScore: action.priorityScore,
            status: action.fixed ? "planned" : "proposed",
            validationRequired: !action.fixed,
            reason: `Placement déterministe selon la priorité ${action.priorityLevel} et la disponibilité Calendar.`,
            preparedEvent: buildManagedEvent({ ...action, id: action.actionId, sourceType: action.source,
              sourceId: action.sourceRef, priority: action.priorityLevel, suggestedAction: action.title }, slot, BLUEBERRY_COLOR_ID),
          });
        }
        if (failed) {
          unscheduledActions.push({ actionId: action.actionId, title: action.title, reasonCode: failed });
        } else {
          proposedBlocks.push(...staged);
          busy.push(...staged.map((block) => ({ start: block.start, end: block.end })));
          scheduledMinutes += action.estimatedDurationMinutes;
          completed.add(action.actionId);
        }
        pending.splice(index, 1); progress = true;
      }
    }
    for (const action of pending) unscheduledActions.push({ actionId: action.actionId, title: action.title, reasonCode: "DEPENDENCY" });
    if (unscheduledActions.length) warnings.push({ code: "OVER_CAPACITY_OR_CONSTRAINTS", count: unscheduledActions.length });

    const allBlocks = [...plannedBlocks, ...proposedBlocks];
    const previousFuture = (previous?.proposedBlocks || []).filter((block) => validDate(block.start)?.getTime() > nowMs);
    const unchanged = previousFuture.filter((block) => allBlocks.some((next) => next.actionId === block.actionId && next.start === block.start)).length;
    const actionConstraints = ranked.map(({ actionId, priorityScore, dueAt, estimatedDurationMinutes, blocked, completed, snoozedUntil }) => ({ actionId, priorityScore, dueAt, estimatedDurationMinutes, blocked, completed, snoozedUntil }));
    const constraintsFingerprint = stableHash({ day, events: fixedEvents.map(({ id, start, end, manualMove }) => ({ id, start, end, manualMove })),
      actions: actionConstraints });
    const planVersion = previous?.constraintsFingerprint === constraintsFingerprint ? previous.planVersion : (Number(previous?.planVersion) || 0) + 1;
    const bufferMinutes = Math.max(0, rawCapacity - scheduledMinutes);
    const plan = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      planId: previous?.planId || `plan_${day}_${crypto.randomUUID()}`,
      planVersion, date: day, timeZone: planningSettings.timeZone,
      constraintsFingerprint,
      actionConstraints,
      planFingerprint: stableHash({ day, planVersion, blocks: allBlocks.map(({ actionId, start, end }) => ({ actionId, start, end })) }),
      status: "proposal", trigger,
      fixedEvents, plannedBlocks, proposedBlocks, unscheduledActions, warnings,
      summary: { availableMinutes: rawCapacity, plannedMinutes: scheduledMinutes,
        bufferMinutes, freeMinutes: Math.max(0, rawCapacity - scheduledMinutes),
        utilization: rawCapacity ? scheduledMinutes / rawCapacity : 0 },
      explanations: proposedBlocks.map((block) => ({ actionId: block.actionId, code: "PLACED", text: block.reason })),
      learningHintsApplied: {
        bufferMultiplierHint: durationMultiplier > 1 ? durationMultiplier : null,
        maxPlannedUtilizationHint: hintedUtilization !== utilizationTarget ? hintedUtilization : null,
        avoidFragmentationHint: learningHints.avoidFragmentationHint === true,
      },
      metrics: { planning_build_ms: Date.now() - startedAt, timeslot_lookup_ms: timeslotLookupMs,
        planning_actions_total: ranked.length, planning_actions_scheduled: completed.size,
        planning_actions_unscheduled: unscheduledActions.length, planning_capacity_minutes: rawCapacity,
        planning_utilization: rawCapacity ? scheduledMinutes / rawCapacity : 0,
        planning_replans: previous ? 1 : 0,
        planning_moved_blocks: previousFuture.length - unchanged,
        planning_stability_rate: previousFuture.length ? unchanged / previousFuture.length : 1 },
      generatedAt: new Date().toISOString(),
    };
    store.save(plan);
    for (const [metric, value] of Object.entries(plan.metrics)) metrics?.record(metric, value);
    audit?.("planning.built", { planId: plan.planId, planVersion, trigger,
      actionCount: ranked.length, scheduledCount: completed.size, unscheduledCount: unscheduledActions.length,
      reasonCodes: [...new Set(unscheduledActions.map((item) => item.reasonCode))], durationMs: plan.metrics.planning_build_ms });
    return plan;
  }

  async function replanDay(input = {}) {
    const startedAt = Date.now();
    const plan = await buildPlan({ ...input, previousPlan: input.previousPlan || store.get(dateKey(input.at || now())), trigger: input.trigger || "replan" });
    plan.metrics.replan_ms = Date.now() - startedAt;
    store.save(plan);
    metrics?.record("replan_ms", plan.metrics.replan_ms);
    return plan;
  }

  async function previewApproval(plan, input = {}) {
    if (!approvalEngine?.prepareAction) throw new Error("Approval Engine indisponible.");
    if (!plan?.proposedBlocks?.length) throw new Error("Aucun bloc à créer.");
    if (typeof calendarReader === "function") {
      const currentEvents = await calendarReader(plan.date, input.calendarId || "primary");
      const freshness = currentEvents === null ? { stale: false } : isPlanStale(plan, { events: currentEvents });
      if (freshness.stale) {
        const error = new Error("Le Calendar a changé : le planning doit être recalculé.");
        error.code = "PLAN_STALE";
        throw error;
      }
    }
    const exactBatch = plan.proposedBlocks.map((block) => ({
      blockId: block.blockId, actionId: block.actionId, start: block.start, end: block.end,
      event: block.preparedEvent,
    }));
    return approvalEngine.prepareAction({
      executionId: input.executionId,
      skillName: "google-calendar",
      operation: "create_planning_batch",
      normalizedArgs: { planId: plan.planId, planVersion: plan.planVersion, planFingerprint: plan.planFingerprint, blocks: exactBatch },
      target: input.calendarId || "primary",
      sanitizedSummary: `${exactBatch.length} événement(s) Noon seront créés dans Calendar.`,
      permissionLevel: "external",
      preconditions: { constraintsFingerprint: plan.constraintsFingerprint, planFingerprint: plan.planFingerprint },
      contextRef: { planId: plan.planId, planVersion: plan.planVersion },
    });
  }

  function isPlanStale(plan, { events = [], actions = null } = {}) {
    const actionConstraints = actions === null
      ? (plan.actionConstraints || [])
      : actions.map(normalizePlanningAction).map(({ actionId, priorityScore, dueAt, estimatedDurationMinutes, blocked, completed, snoozedUntil }) => ({ actionId, priorityScore, dueAt, estimatedDurationMinutes, blocked, completed, snoozedUntil }));
    const current = stableHash({
      day: plan.date,
      events: events.map(fixedEvent).map(({ id, start, end, manualMove }) => ({ id, start, end, manualMove })),
      actions: actionConstraints,
    });
    return { stale: current !== plan.constraintsFingerprint, status: current !== plan.constraintsFingerprint ? "plan_stale" : "current", currentFingerprint: current };
  }

  return { buildPlan, estimateDuration, isPlanStale, normalizeAction: normalizePlanningAction,
    previewApproval, replanDay, splitAction };
}

module.exports = { PLAN_SCHEMA_VERSION, REASON_CODES, createDailyPlanningEngine, estimateDuration,
  normalizePlanningAction, overlaps, splitAction, stableHash };
