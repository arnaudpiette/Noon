"use strict";

const crypto = require("crypto");
const { createSignalAdapters } = require("./signal-adapters");

const INTERRUPTION_LEVELS = Object.freeze([
  "IGNORE", "STORE_FOR_BRIEF", "SURFACE_WHEN_RELEVANT", "SUGGEST", "NOTIFY", "URGENT_NOTIFY",
]);
const FEEDBACK_VALUES = new Set(["useful", "not_useful", "later", "dont_remind"]);

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parisTime(date) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

function isProtectedBreak(date) {
  const time = parisTime(date);
  return time >= "12:30" && time < "13:30";
}

function interruptionLevel(signal, scored) {
  if (!signal.isAction || signal.metadata.newsletter) return "IGNORE";
  if (scored.overdue && signal.urgency >= 0.8) return "URGENT_NOTIFY";
  if (signal.signalType === "calendar_conflict") return "URGENT_NOTIFY";
  if (signal.signalType === "project_blocker" && (signal.importance >= 0.7 || scored.score >= 65)) return "URGENT_NOTIFY";
  if (scored.score >= 60) return "NOTIFY";
  if (scored.score >= 52) return "SUGGEST";
  if (scored.score >= 45) return "SURFACE_WHEN_RELEVANT";
  return "STORE_FOR_BRIEF";
}

function safeRecommendation(signal, scored, level, decision) {
  const recommendationId = `recommendation_${hash([signal.id, signal.materialKey]).slice(0, 24)}`;
  return Object.freeze({
    id: recommendationId,
    hash: decision.hash,
    signalId: signal.id,
    sourceType: signal.sourceType,
    sourceReference: signal.sourceReference,
    signalType: signal.signalType,
    title: signal.title,
    action: signal.action,
    proposal: signal.action || signal.title,
    known: [],
    detected: [signal.title],
    inferred: [],
    projectId: signal.projectId,
    score: scored.score,
    priorityLevel: scored.priorityLevel,
    interruptionLevel: level,
    reasons: scored.reasons,
    dueAt: signal.dueAt,
    estimatedDurationMinutes: signal.estimatedDurationMinutes,
    confidence: signal.confidence,
    validationRequired: true,
    approvalStatus: "not_requested",
    expiresAt: signal.expiresAt,
    stale: signal.stale,
    localOnly: signal.apiPolicy === "local_only",
    materialKey: signal.materialKey,
    createdAt: signal.observedAt,
  });
}

function createProactiveEngine({
  priorityEngine,
  deduplicationService,
  repository,
  metrics = null,
  approvalEngine = null,
  hardRulesRegistry = null,
  timeSlotService = null,
  planningEngine = null,
  now = () => new Date(),
  maxNotificationsPerDay = 3,
  adapters = createSignalAdapters(),
  audit = null,
} = {}) {
  if (!priorityEngine?.score) throw new TypeError("Priority Engine requis.");
  if (!deduplicationService?.evaluate) throw new TypeError("Service de déduplication requis.");
  if (!repository?.listRecommendations) throw new TypeError("Dépôt proactif requis.");
  let reviewRuntimeHints = null;

  function applyReviewHints(hints = {}, options = {}) {
    reviewRuntimeHints = {
      notificationGroupingHint: hints.notificationGroupingHint || null,
      expiresAt: options.expiresAt || new Date(now().getTime() + 7 * 86_400_000).toISOString(),
    };
    return { ...reviewRuntimeHints, reversible: true };
  }

  function notificationCount(date) {
    const day = date.toISOString().slice(0, 10);
    return repository.listRecommendations({ limit: 500 }).filter((item) =>
      item.lastPresentedAt?.startsWith(day) && ["NOTIFY", "URGENT_NOTIFY"].includes(item.payload?.interruptionLevel)
    ).length;
  }

  async function evaluate(rawSignals = [], context = {}) {
    const at = context.at instanceof Date ? context.at : now();
    const protectedBreak = hardRulesRegistry?.isProtectedCalendarTime
      ? hardRulesRegistry.isProtectedCalendarTime(at) : isProtectedBreak(at);
    const activeReviewHints = reviewRuntimeHints && Date.parse(reviewRuntimeHints.expiresAt) > at.getTime()
      ? reviewRuntimeHints : null;
    const notificationLimit = activeReviewHints?.notificationGroupingHint === "increase_grouping"
      ? Math.min(Number(maxNotificationsPerDay), 2) : Number(maxNotificationsPerDay);
    let notificationsRemaining = Math.max(0, notificationLimit - notificationCount(at));
    const signals = rawSignals.filter(Boolean).filter((signal) => !signal.expiresAt || Date.parse(signal.expiresAt) > at.getTime());
    const recommendations = [];
    const ignored = [];

    for (const signal of signals) {
      if (signal.apiPolicy === "local_only" && context.remoteModel === true) {
        ignored.push({ signalId: signal.id, reason: "local_only" });
        continue;
      }
      const scored = priorityEngine.score({
        ...signal,
        sourceId: signal.sourceReference,
        deadline: signal.dueAt,
        repetition: 0,
        interruptionCost: protectedBreak || context.focusActive ? 1 : signal.interruptionCost,
      });
      let level = interruptionLevel(signal, scored);
      const urgent = level === "URGENT_NOTIFY";
      if ((protectedBreak || context.focusActive) && !urgent && ["SUGGEST", "NOTIFY"].includes(level)) {
        level = "STORE_FOR_BRIEF";
      }
      if (level === "NOTIFY" && notificationsRemaining <= 0) level = "STORE_FOR_BRIEF";
      const draft = { ...signal, ...scored, action: signal.action, sourceReference: signal.sourceReference,
        reactivationKey: signal.materialKey, interruptionLevel: level };
      const decision = deduplicationService.evaluate(draft, at);
      if (!decision.allowed) {
        if (context.channel === "brief") {
          const existing = repository.getRecommendationByHash(decision.hash);
          if (existing?.payload && !["dismissed", "expired", "ignored"].includes(existing.status)) {
            recommendations.push(existing.payload);
          }
        }
        ignored.push({ signalId: signal.id, reason: decision.reason });
        metrics?.record("proactive_duplicates_suppressed", 1, { category: decision.reason });
        continue;
      }
      const recommendation = safeRecommendation(signal, scored, level, decision);
      repository.saveRecommendation({
        hash: decision.hash, score: scored.score, priorityLevel: scored.priorityLevel,
        payload: recommendation, reactivationKey: signal.materialKey,
        expiresAt: signal.expiresAt, status: level === "IGNORE" ? "ignored" : "ready",
      });
      if (level === "IGNORE") {
        ignored.push({ signalId: signal.id, reason: "not_actionable" });
        continue;
      }
      if (["NOTIFY", "URGENT_NOTIFY"].includes(level)) {
        deduplicationService.recordPresented(decision.hash, at.toISOString());
        if (!urgent) notificationsRemaining -= 1;
      }
      recommendations.push(recommendation);
    }

    recommendations.sort((left, right) => right.score - left.score);
    metrics?.record("proactive_signals_evaluated", signals.length);
    metrics?.record("proactive_recommendations_generated", recommendations.length);
    audit?.("proactive.cycle", {
      signalCount: signals.length, recommendationCount: recommendations.length,
      ignoredCount: ignored.length, protectedBreak, focusActive: context.focusActive === true,
    });
    return { generatedAt: at.toISOString(), protectedBreak, focusActive: context.focusActive === true,
      recommendations, notifications: recommendations.filter((item) => ["NOTIFY", "URGENT_NOTIFY"].includes(item.interruptionLevel)), ignored };
  }

  function feedback(recommendationHash, value, options = {}) {
    if (!FEEDBACK_VALUES.has(value)) throw new TypeError("Feedback proactif invalide.");
    const existing = repository.getRecommendationByHash(recommendationHash);
    if (!existing) throw new Error("Recommandation proactive introuvable.");
    const snoozeUntil = value === "later"
      ? new Date((options.at instanceof Date ? options.at : now()).getTime() + Math.max(5, Number(options.minutes) || 60) * 60_000).toISOString()
      : null;
    const status = value === "dont_remind" ? "dismissed" : value === "later" ? "snoozed" : "ready";
    repository.updateRecommendation(recommendationHash, { userResponse: value, status, cooldownUntil: snoozeUntil });
    repository.recordFeedback({ recommendationHash, value, category: existing.payload?.signalType || null,
      metadata: { snoozeMinutes: value === "later" ? Math.max(5, Number(options.minutes) || 60) : null } });
    metrics?.record(value === "useful" ? "proactive_feedback_useful" : "proactive_feedback_negative", 1,
      { category: existing.payload?.signalType || null });
    return { status, snoozeUntil };
  }

  async function suggestTimeSlots(recommendationHash, options = {}) {
    const recommendation = repository.getRecommendationByHash(recommendationHash)?.payload;
    if (!recommendation) throw new Error("Recommandation proactive introuvable.");
    if (!timeSlotService?.suggest) return [];
    return timeSlotService.suggest({ durationMinutes: recommendation.estimatedDurationMinutes,
      mode: options.mode || "Focus", events: options.events, offline: options.offline === true, now: options.at || now() });
  }

  async function proposeDailyPlan(options = {}) {
    if (!planningEngine?.buildPlan) throw new Error("Planning Engine indisponible.");
    const recommendations = options.recommendations || list({ activeOnly: true, limit: 100 });
    return planningEngine.buildPlan({
      actions: recommendations,
      events: options.events || [],
      at: options.at || now(),
      trigger: options.trigger || "proactive_signal",
    });
  }

  function requestApproval(recommendationHash, input = {}) {
    const recommendation = repository.getRecommendationByHash(recommendationHash)?.payload;
    if (!recommendation) throw new Error("Recommandation proactive introuvable.");
    if (!approvalEngine?.prepareAction) throw new Error("Moteur d’approbation indisponible.");
    return approvalEngine.prepareAction({
      executionId: input.executionId,
      skillName: input.skillName,
      operation: input.operation,
      normalizedArgs: input.args || {},
      target: input.target,
      sanitizedSummary: recommendation.action,
      permissionLevel: input.permissionLevel || "external",
      contextRef: { recommendationHash, signalId: recommendation.signalId },
      preconditions: input.preconditions || {},
    });
  }

  function list(filters = {}) {
    return repository.listRecommendations(filters).map((entry) => entry.payload).filter(Boolean);
  }

  return { adapters, applyReviewHints, evaluate, feedback, interruptionLevel, list, proposeDailyPlan, requestApproval, suggestTimeSlots };
}

module.exports = { FEEDBACK_VALUES, INTERRUPTION_LEVELS, createProactiveEngine, interruptionLevel, isProtectedBreak };
