"use strict";

const PRIORITY_SCORING_VERSION = 1;
const DEFAULT_WEIGHTS = Object.freeze({
  urgency: 0.2, impact: 0.2, deadline: 0.16, projectPriority: 0.12,
  timeFit: 0.09, energyFit: 0.05, blockingRisk: 0.08, confidence: 0.08,
  interruptionCost: -0.08, repetition: -0.1,
});
const REASON_LABELS = Object.freeze({
  urgency: "urgence explicite", impact: "impact élevé", deadline: "échéance proche",
  projectPriority: "projet prioritaire", timeFit: "durée compatible avec le créneau disponible",
  energyFit: "énergie disponible adaptée", blockingRisk: "débloque ou sécurise d’autres actions",
  confidence: "source fiable et explicite", interruptionCost: "coût d’interruption élevé",
  repetition: "déjà signalée sans évolution",
});

function clamp(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
function validDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
function deadlineDetails(deadline, now = new Date()) {
  const date = validDate(deadline);
  if (!date) return { score: 0.2, state: "none", hoursRemaining: null, overdue: false };
  const hoursRemaining = (date - now) / 3_600_000;
  if (hoursRemaining <= 0) return { score: 1, state: "overdue", hoursRemaining, overdue: true };
  if (hoursRemaining <= 24) return { score: 0.95, state: "today", hoursRemaining, overdue: false };
  if (hoursRemaining <= 72) return { score: 0.75, state: "soon", hoursRemaining, overdue: false };
  if (hoursRemaining <= 168) return { score: 0.5, state: "week", hoursRemaining, overdue: false };
  return { score: 0.2, state: "later", hoursRemaining, overdue: false };
}
function deadlineScore(deadline, now = new Date()) { return deadlineDetails(deadline, now).score; }
function priorityLevel(score) { return score >= 80 ? "critique" : score >= 65 ? "haute" : score >= 45 ? "moyenne" : "basse"; }
function scheduleFit(durationMinutes, availableMinutes) {
  const duration = Number(durationMinutes); const available = Number(availableMinutes);
  if (!(duration > 0) || !(available > 0)) return { fits: null, ratio: 0.5, durationMinutes: duration || null, availableMinutes: available || null };
  return { fits: duration <= available, ratio: clamp(available / duration), durationMinutes: duration, availableMinutes: available };
}

function normalizePriorityAction(input = {}) {
  const title = String(input.title || input.action || "Action sans titre").trim().slice(0, 300);
  const dueAt = input.dueAt || input.deadline || null;
  const dependencies = Array.isArray(input.dependencies) ? input.dependencies.slice(0, 20) : [];
  const type = String(input.type || (input.isAction === false ? "information" : "action"));
  const estimatedDurationMinutes = Math.max(5, Math.min(480, Number(input.estimatedDurationMinutes ?? input.estimatedDuration) || 30));
  return {
    ...input,
    id: String(input.id || `${input.sourceType || input.source || "unknown"}:${input.sourceId || title}`).slice(0, 500),
    title, source: String(input.source || input.sourceType || "unknown"),
    sourceType: String(input.sourceType || input.source || "unknown"), sourceId: String(input.sourceId || ""),
    type, isAction: input.isAction !== false && type !== "information" && type !== "info",
    dueAt, deadline: dueAt, estimatedDurationMinutes,
    projectId: input.projectId || input.project || null,
    peopleIds: Array.isArray(input.peopleIds) ? input.peopleIds.map(String) : [],
    importance: clamp(input.importance ?? input.impact), impact: clamp(input.impact ?? input.importance), urgency: clamp(input.urgency),
    projectPriority: Math.max(0, Math.min(100,
      input.projectPriority == null ? 50 : Number(input.projectPriority)
    )),
    blocked: input.blocked === true, dependencies, energyRequired: input.energyRequired || null,
    interruptionCost: clamp(input.interruptionCost), repetition: clamp(input.repetition), confidence: clamp(input.confidence ?? 0.5),
    createdAt: input.createdAt || null, updatedAt: input.updatedAt || null,
    alreadyScheduled: input.alreadyScheduled === true,
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  };
}

function factorValues(action, now) {
  const deadline = deadlineDetails(action.deadline, now);
  const fit = scheduleFit(action.estimatedDurationMinutes, action.availableSlotMinutes);
  return { deadline, fit, factors: {
    urgency: clamp(action.urgency), impact: clamp(action.impact ?? action.importance), deadline: deadline.score,
    projectPriority: clamp((action.projectPriority ?? 50) / 100), timeFit: clamp(action.timeFit ?? fit.ratio),
    energyFit: clamp(action.energyFit ?? 0.5),
    blockingRisk: clamp(action.blockingRisk ?? (action.blocked ? 0.8 : Math.min(1, action.dependencies.length * 0.25))),
    confidence: clamp(action.confidence ?? 0.5), interruptionCost: clamp(action.interruptionCost), repetition: clamp(action.repetition),
  } };
}

function scoreRecommendation(input, weights = DEFAULT_WEIGHTS, now = new Date()) {
  const action = normalizePriorityAction(input);
  const { factors, deadline, fit } = factorValues(action, now);
  const contributions = Object.fromEntries(Object.entries(weights).map(([key, weight]) => [key, factors[key] * weight]));
  const raw = Object.values(contributions).reduce((sum, value) => sum + value, 0);
  const positiveMax = Object.values(weights).filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const score = Math.round(clamp(raw / positiveMax) * 100);
  const ordered = Object.entries(factors).filter(([key]) => weights[key] > 0)
    .sort((left, right) => contributions[right[0]] - contributions[left[0]]);
  const mainReason = ordered[0]?.[0] || "impact";
  return {
    score, priorityLevel: priorityLevel(score),
    urgencyLevel: factors.urgency >= 0.8 || deadline.state === "today" || deadline.overdue ? "urgente" : factors.impact >= 0.7 ? "importante" : "planifiable",
    overdue: deadline.overdue, deadlineState: deadline.state, scheduleFit: fit,
    factors, contributions, mainReason, secondaryReasons: ordered.slice(1, 4).map(([key]) => key),
    reasons: [mainReason, ...ordered.slice(1, 3).map(([key]) => key)].map((key) => REASON_LABELS[key]),
    scoringVersion: PRIORITY_SCORING_VERSION,
  };
}

function actionIdentity(action) {
  return action.sourceId ? `${action.sourceType}:${action.sourceId}` : `${action.sourceType}:${action.title.toLocaleLowerCase("fr")}:${action.dueAt || ""}`;
}
function deduplicatePriorityActions(actions = []) {
  const selected = new Map();
  for (const action of actions.map(normalizePriorityAction)) {
    const key = actionIdentity(action); const previous = selected.get(key);
    if (!previous || action.confidence > previous.confidence || String(action.updatedAt || "") > String(previous.updatedAt || "")) selected.set(key, action);
  }
  return [...selected.values()];
}
function rankActions(actions = [], { limit = actions.length, weights = DEFAULT_WEIGHTS, now = new Date() } = {}) {
  return deduplicatePriorityActions(actions).filter((action) => action.isAction && !action.alreadyScheduled)
    .map((action) => {
      if (action.scoringVersion === PRIORITY_SCORING_VERSION && Number.isFinite(action.score) && action.factors) return action;
      const priority = scoreRecommendation(action, weights, now);
      return { ...action, ...priority, priority: priority.priorityLevel };
    })
    .sort((left, right) => right.score - left.score || Number(right.overdue) - Number(left.overdue) || String(left.dueAt || "9999").localeCompare(String(right.dueAt || "9999")))
    .slice(0, Math.max(0, Number(limit) || 0));
}

function explainRecommendation(item, result) {
  return { ...result, known: item.known || [], detected: item.detected || [item.title], inferred: item.inferred || [],
    proposal: item.action || item.title, validationRequired: item.validationRequired !== false,
    sources: item.sources || [{ type: item.sourceType, reference: item.sourceReference }],
    estimatedDuration: item.estimatedDuration || item.estimatedDurationMinutes || null, possibleSlot: item.possibleSlot || null,
    confidence: clamp(item.confidence ?? 0.5), expiresAt: item.expiresAt || null };
}

function createPriorityEngine({ weights = DEFAULT_WEIGHTS, now = () => new Date(), debug = null } = {}) {
  function score(input) {
    const action = normalizePriorityAction(input); const result = scoreRecommendation(action, weights, now());
    debug?.("priority-engine.scored", { actionId: action.id, score: result.score, level: result.priorityLevel, factors: result.factors, scoringVersion: result.scoringVersion });
    return { ...action, ...result, priority: result.priorityLevel };
  }
  function rank(actions, options = {}) { return rankActions(actions, { ...options, weights, now: options.now || now() }); }
  return { normalize: normalizePriorityAction, rank, score, scoringVersion: PRIORITY_SCORING_VERSION };
}

module.exports = { DEFAULT_WEIGHTS, PRIORITY_SCORING_VERSION, createPriorityEngine, deadlineDetails, deadlineScore,
  deduplicatePriorityActions, explainRecommendation, normalizePriorityAction, priorityLevel, rankActions, scheduleFit, scoreRecommendation };
