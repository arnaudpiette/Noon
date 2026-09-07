"use strict";

const crypto = require("node:crypto");

const GOAL_STATUSES = Object.freeze(["DRAFT", "ACTIVE", "PAUSED", "ACHIEVED", "ABANDONED", "SUPERSEDED"]);
const GOAL_HORIZONS = Object.freeze(["SHORT_TERM", "MEDIUM_TERM", "LONG_TERM", "OPEN_ENDED"]);
const GOAL_CATEGORIES = Object.freeze(["CAREER", "LEARNING", "PROJECT", "BUSINESS", "CREATIVE", "PERSONAL", "FINANCIAL", "SYSTEM", "CUSTOM"]);
const SENSITIVITIES = Object.freeze(["NORMAL", "PRIVATE", "PROTECTED", "LOCAL_ONLY"]);
const CRITERION_TYPES = Object.freeze(["BOOLEAN", "NUMERIC", "DATE", "MILESTONE", "QUALITATIVE", "USER_CONFIRMATION"]);
const CRITERION_STATUSES = Object.freeze(["NOT_MET", "PARTIAL", "MET", "UNKNOWN"]);
const MILESTONE_STATUSES = Object.freeze(["NOT_STARTED", "IN_PROGRESS", "ACHIEVED", "BLOCKED", "DELAYED", "SKIPPED"]);
const PROGRESS_METHODS = Object.freeze(["MEASURED", "ESTIMATED", "MILESTONE_BASED", "USER_REPORTED", "UNKNOWN"]);
const TRAJECTORIES = Object.freeze(["ON_TRACK", "AT_RISK", "OFF_TRACK", "BLOCKED", "UNKNOWN"]);
const ALIGNMENTS = Object.freeze(["DIRECT", "SUPPORTING", "NEUTRAL", "CONFLICTING", "UNKNOWN"]);
const RELATION_TYPES = Object.freeze(["SUPPORTS", "DEPENDS_ON", "CONFLICTS_WITH", "SUPERSEDES"]);
const STRATEGY_STATUSES = Object.freeze(["ACTIVE", "SUPERSEDED", "PAUSED"]);

class GoalError extends Error {
  constructor(code, message) { super(message); this.name = "GoalError"; this.code = code; }
}

function id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function clean(value, max = 500) { return String(value || "").replace(/[\0\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }
function list(value, max = 50) { return [...new Set((Array.isArray(value) ? value : []).map((item) => clean(item, 200)).filter(Boolean))].slice(0, max); }
function enumValue(value, values, fallback) { return values.includes(value) ? value : fallback; }
function validDate(value) { if (!value) return null; const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : null; }
function confidence(value, fallback = 0.5) { const number = Number(value); return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback; }

function normalizeCriterion(raw = {}) {
  const type = enumValue(raw.type, CRITERION_TYPES, "QUALITATIVE");
  return Object.freeze({
    criterionId: clean(raw.criterionId, 120) || id("criterion"),
    description: clean(raw.description, 800),
    type,
    targetValue: raw.targetValue ?? null,
    currentValue: raw.currentValue ?? null,
    unit: clean(raw.unit, 80) || null,
    status: enumValue(raw.status, CRITERION_STATUSES, "UNKNOWN"),
    evidenceRefs: list(raw.evidenceRefs),
  });
}

function normalizeMilestone(raw = {}, goalId = null) {
  return Object.freeze({
    milestoneId: clean(raw.milestoneId, 120) || id("milestone"),
    goalId: clean(goalId || raw.goalId, 120),
    title: clean(raw.title, 300),
    description: clean(raw.description, 1200),
    targetDate: validDate(raw.targetDate),
    status: enumValue(raw.status, MILESTONE_STATUSES, "NOT_STARTED"),
    completionCriteria: (raw.completionCriteria || []).map(normalizeCriterion).slice(0, 20),
    dependencies: list(raw.dependencies),
    linkedProjectIds: list(raw.linkedProjectIds),
    evidenceRefs: list(raw.evidenceRefs),
  });
}

function normalizeProgress(raw = {}) {
  const method = enumValue(raw.method, PROGRESS_METHODS, "UNKNOWN");
  const value = method === "UNKNOWN" || raw.value == null ? null : Number(raw.value);
  return Object.freeze({
    status: enumValue(raw.status, ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "UNKNOWN"], "UNKNOWN"),
    value: Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null,
    method,
    confidence: confidence(raw.confidence, method === "UNKNOWN" ? 0 : 0.5),
    measuredAt: validDate(raw.measuredAt),
    evidenceRefs: list(raw.evidenceRefs),
  });
}

function normalizeConstraint(raw = {}) {
  return Object.freeze({
    constraintId: clean(raw.constraintId, 120) || id("constraint"),
    description: clean(raw.description, 800),
    strength: enumValue(raw.strength, ["HARD", "SOFT"], "SOFT"),
    source: clean(raw.source, 80) || "explicit_user",
    evidenceRefs: list(raw.evidenceRefs),
  });
}

function qualityWarnings(goal) {
  const warnings = [];
  if (goal.title.length < 5 || goal.outcomeDefinition.length < 12) warnings.push("GOAL_NEEDS_CLARIFICATION");
  if (!goal.successCriteria.length) warnings.push("SUCCESS_CRITERIA_MISSING");
  if (/^(faire|travailler|coder|lire|appeler|envoyer)\b/i.test(goal.outcomeDefinition)) warnings.push("OUTCOME_LOOKS_LIKE_ACTIVITY");
  return warnings;
}

function normalizeGoal(raw = {}, { now = new Date(), requireExplicit = true } = {}) {
  if (requireExplicit && raw.userConfirmed !== true) throw new GoalError("GOAL_CONFIRMATION_REQUIRED", "Un objectif stratégique doit être confirmé explicitement.");
  const goalId = clean(raw.goalId, 120) || id("goal");
  const title = clean(raw.title, 300);
  const outcomeDefinition = clean(raw.outcomeDefinition, 1600);
  if (!title) throw new GoalError("GOAL_TITLE_REQUIRED", "Le titre de l’objectif est requis.");
  if (!outcomeDefinition) throw new GoalError("GOAL_OUTCOME_REQUIRED", "Le résultat attendu est requis.");
  const createdAt = validDate(raw.createdAt) || new Date(now).toISOString();
  const goal = {
    goalId, title, description: clean(raw.description, 2000),
    status: enumValue(raw.status, GOAL_STATUSES, raw.userConfirmed === true ? "ACTIVE" : "DRAFT"),
    horizon: enumValue(raw.horizon, GOAL_HORIZONS, "OPEN_ENDED"),
    category: enumValue(raw.category, GOAL_CATEGORIES, "CUSTOM"),
    outcomeDefinition,
    successCriteria: (raw.successCriteria || []).map(normalizeCriterion).slice(0, 30),
    milestones: (raw.milestones || []).map((item) => normalizeMilestone(item, goalId)).slice(0, 50),
    linkedProjectIds: list(raw.linkedProjectIds), linkedWorkspaceIds: list(raw.linkedWorkspaceIds),
    strategyRef: clean(raw.strategyRef, 120) || null,
    constraints: (raw.constraints || []).map(normalizeConstraint).slice(0, 30),
    progress: normalizeProgress(raw.progress), confidence: confidence(raw.confidence, 1),
    targetDate: validDate(raw.targetDate), reviewCadence: clean(raw.reviewCadence, 80) || null,
    importance: raw.importance == null ? null : confidence(raw.importance),
    profileScope: clean(raw.profileScope, 80) || "arnaud",
    sensitivity: enumValue(raw.sensitivity, SENSITIVITIES, "NORMAL"),
    createdAt, updatedAt: validDate(raw.updatedAt) || createdAt,
    source: clean(raw.source, 100) || "explicit_user", userConfirmed: raw.userConfirmed === true,
    version: Math.max(1, Number(raw.version) || 1),
  };
  return Object.freeze({ ...goal, qualityWarnings: qualityWarnings(goal) });
}

module.exports = {
  ALIGNMENTS, CRITERION_STATUSES, CRITERION_TYPES, GOAL_CATEGORIES, GOAL_HORIZONS, GOAL_STATUSES,
  GoalError, MILESTONE_STATUSES, PROGRESS_METHODS, RELATION_TYPES, SENSITIVITIES, STRATEGY_STATUSES,
  TRAJECTORIES, clean, confidence, id, list, normalizeConstraint, normalizeCriterion, normalizeGoal,
  normalizeMilestone, normalizeProgress, qualityWarnings, validDate,
};
