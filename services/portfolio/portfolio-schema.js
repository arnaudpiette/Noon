"use strict";

const crypto = require("node:crypto");

const PORTFOLIO_ITEM_TYPES = Object.freeze(["PROJECT", "MAJOR_COMMITMENT", "GOAL_WORKSTREAM", "RECURRING_COMMITMENT", "MAINTENANCE"]);
const PORTFOLIO_STATUSES = Object.freeze(["ACTIVE", "PAUSED", "COMPLETED", "CANCELLED", "ARCHIVED"]);
const CAPACITY_HORIZONS = Object.freeze(["DAY", "WEEK", "TWO_WEEKS", "MONTH", "CUSTOM"]);
const CAPACITY_TYPES = Object.freeze(["USER_TIME", "NOON_BACKGROUND", "EXTERNAL_DEPENDENCY"]);
const ESTIMATE_SOURCES = Object.freeze(["USER_ESTIMATE", "PROJECT_ESTIMATE", "TASK_AGGREGATION", "HISTORICAL", "MILESTONE_ESTIMATE", "UNKNOWN"]);
const CONFIDENCE_LEVELS = Object.freeze(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]);
const OVERLOAD_STATES = Object.freeze(["HEALTHY", "TIGHT", "OVERLOADED", "SEVERELY_OVERLOADED", "UNKNOWN"]);

function id(prefix, value) {
  return `${prefix}_${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 20)}`;
}
function enumValue(value, allowed, fallback) {
  const normalized = String(value || "").trim().toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
}
function minutes(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}
function iso(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
function refs(value, limit = 50) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).filter(Boolean))].slice(0, limit);
}

function normalizeDemand(raw = {}, itemRef = null, horizon = "WEEK") {
  const source = enumValue(raw.estimateSource || raw.source, ESTIMATE_SOURCES, "UNKNOWN");
  let minimumEstimate = minutes(raw.minimumEstimate ?? raw.minimumMinutes);
  let expectedEstimate = minutes(raw.expectedEstimate ?? raw.expectedMinutes);
  let maximumEstimate = minutes(raw.maximumEstimate ?? raw.maximumMinutes);
  if (source === "UNKNOWN") minimumEstimate = expectedEstimate = maximumEstimate = null;
  if (expectedEstimate !== null) {
    minimumEstimate ??= expectedEstimate;
    maximumEstimate ??= expectedEstimate;
    if (minimumEstimate > expectedEstimate || expectedEstimate > maximumEstimate) throw new TypeError("Fourchette de capacité incohérente.");
  }
  return Object.freeze({
    capacityDemandId: String(raw.capacityDemandId || id("demand", [itemRef, horizon, minimumEstimate, expectedEstimate, maximumEstimate, source])),
    itemRef: String(raw.itemRef || itemRef || ""), horizon: enumValue(raw.horizon || horizon, CAPACITY_HORIZONS, "WEEK"),
    capacityType: enumValue(raw.capacityType, CAPACITY_TYPES, "USER_TIME"), minimumEstimate, expectedEstimate, maximumEstimate,
    unit: "minutes", confidence: enumValue(raw.confidence, CONFIDENCE_LEVELS, source === "UNKNOWN" ? "UNKNOWN" : "LOW"),
    estimateSource: source, evidenceRefs: refs(raw.evidenceRefs), buffer: raw.buffer ? {
      minutes: minutes(raw.buffer.minutes), source: String(raw.buffer.source || "explicit").slice(0, 80), evidenceRefs: refs(raw.buffer.evidenceRefs),
    } : null, updatedAt: iso(raw.updatedAt) || new Date().toISOString(),
  });
}

function normalizePortfolioItem(raw = {}) {
  const itemRef = String(raw.itemRef || raw.projectRef || raw.goalRef || raw.portfolioItemId || "").trim();
  if (!itemRef) throw new TypeError("itemRef portfolio requis.");
  return Object.freeze({
    portfolioItemId: String(raw.portfolioItemId || id("portfolio", [raw.itemType, itemRef])),
    itemType: enumValue(raw.itemType, PORTFOLIO_ITEM_TYPES, "PROJECT"), itemRef,
    title: String(raw.title || "Élément du portefeuille").trim().slice(0, 300),
    status: enumValue(raw.status, PORTFOLIO_STATUSES, "ACTIVE"), goalRefs: refs(raw.goalRefs),
    projectRef: raw.projectRef ? String(raw.projectRef) : null, workspaceRef: raw.workspaceRef ? String(raw.workspaceRef) : null,
    profileScope: String(raw.profileScope || "owner"), deadline: iso(raw.deadline), importance: raw.importance ?? null,
    capacityDemand: normalizeDemand(raw.capacityDemand || {}, itemRef, raw.horizon), constraints: refs(raw.constraints),
    dependencies: refs(raw.dependencies), blockedUntil: iso(raw.blockedUntil), source: String(raw.source || "project_service").slice(0, 80),
    localOnly: raw.localOnly === true, intentionalZeroAllocation: raw.intentionalZeroAllocation === true,
  });
}

function normalizeGuardrail(raw = {}) {
  if (!raw.targetRef) throw new TypeError("targetRef requis.");
  return Object.freeze({ targetRef: String(raw.targetRef), minimumCapacity: minutes(raw.minimumCapacity), maximumCapacity: minutes(raw.maximumCapacity),
    horizon: enumValue(raw.horizon, CAPACITY_HORIZONS, "WEEK"), strength: String(raw.strength || "SOFT").toUpperCase() === "HARD" ? "HARD" : "SOFT",
    source: raw.source === "explicit_user" ? "explicit_user" : "unknown" });
}

module.exports = { CAPACITY_HORIZONS, CAPACITY_TYPES, CONFIDENCE_LEVELS, ESTIMATE_SOURCES, OVERLOAD_STATES,
  PORTFOLIO_ITEM_TYPES, PORTFOLIO_STATUSES, enumValue, id, iso, minutes, normalizeDemand, normalizeGuardrail, normalizePortfolioItem, refs };
