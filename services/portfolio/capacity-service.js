"use strict";

const crypto = require("node:crypto");
const { CAPACITY_HORIZONS, CONFIDENCE_LEVELS, enumValue, id, iso, minutes } = require("./portfolio-schema");

function fingerprint(value) {
  const stable = (item) => Array.isArray(item) ? item.map(stable) : item && typeof item === "object"
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, stable(item[key])])) : item;
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function createCapacityService({ now = () => new Date(), cacheTtlMs = 60_000, audit = null, metrics = null } = {}) {
  const cache = new Map();
  const revisions = new Map();
  function invalidate(reason = "source_changed", scope = "global") {
    revisions.set(scope, (revisions.get(scope) || 0) + 1);
    cache.clear();
    audit?.("capacity_snapshot_invalidated", { reason: String(reason).slice(0, 80), scopeRef: fingerprint(scope).slice(0, 12) });
  }
  function snapshot(raw = {}) {
    const started = performance.now();
    const horizon = enumValue(raw.horizon, CAPACITY_HORIZONS, "WEEK");
    const workspaceRef = raw.workspaceRef ? String(raw.workspaceRef) : null;
    const profileScope = String(raw.profileScope || "owner");
    const sourceStatus = {
      calendar: ["AVAILABLE", "PARTIAL", "UNAVAILABLE"].includes(raw.calendarStatus) ? raw.calendarStatus : "UNAVAILABLE",
      planning: ["AVAILABLE", "PARTIAL", "UNAVAILABLE"].includes(raw.planningStatus) ? raw.planningStatus : "UNAVAILABLE",
      configuration: ["AVAILABLE", "PARTIAL", "UNAVAILABLE"].includes(raw.configurationStatus) ? raw.configurationStatus : "UNAVAILABLE",
    };
    const key = fingerprint({ horizon, startAt: raw.startAt, endAt: raw.endAt, workspaceRef, profileScope,
      calendarRevision: raw.calendarRevision, planningRevision: raw.planningRevision, portfolioRevision: raw.portfolioRevision,
      estimateVersions: raw.estimateVersions, revision: revisions.get(workspaceRef || "global") || 0 });
    const cached = cache.get(key);
    if (cached && Date.now() - cached.savedAt < cacheTtlMs) return structuredClone({ ...cached.value, cacheHit: true });
    const grossCapacity = minutes(raw.grossCapacity);
    const unavailableCapacity = minutes(raw.unavailableCapacity) ?? 0;
    const fixedCommitments = minutes(raw.fixedCommitments) ?? 0;
    const protectedCapacity = minutes(raw.protectedCapacity) ?? 0;
    const plannedCapacity = minutes(raw.plannedCapacity);
    const bufferCapacity = minutes(raw.bufferCapacity) ?? 0;
    const essentialMissing = sourceStatus.configuration === "UNAVAILABLE" || sourceStatus.calendar === "UNAVAILABLE";
    const planningMissing = sourceStatus.planning === "UNAVAILABLE";
    const flexibleCapacity = essentialMissing || grossCapacity === null ? null : Math.max(0, grossCapacity - unavailableCapacity - fixedCommitments - protectedCapacity - bufferCapacity);
    const remainingCapacity = flexibleCapacity === null || planningMissing || plannedCapacity === null ? null : Math.max(0, flexibleCapacity - plannedCapacity);
    const availabilityState = essentialMissing ? "UNKNOWN" : planningMissing || Object.values(sourceStatus).includes("PARTIAL") ? "PARTIAL" : "KNOWN";
    const confidence = enumValue(raw.confidence, CONFIDENCE_LEVELS, availabilityState === "KNOWN" ? "HIGH" : availabilityState === "PARTIAL" ? "LOW" : "UNKNOWN");
    const value = Object.freeze({ capacitySnapshotId: id("capacity", key), horizon, startAt: iso(raw.startAt), endAt: iso(raw.endAt),
      workspaceRef, profileScope, grossCapacity, unavailableCapacity: grossCapacity === null ? null : unavailableCapacity,
      fixedCommitments: sourceStatus.calendar === "UNAVAILABLE" ? null : fixedCommitments,
      protectedCapacity: grossCapacity === null ? null : protectedCapacity, bufferCapacity: grossCapacity === null ? null : bufferCapacity,
      flexibleCapacity, plannedCapacity: planningMissing ? null : plannedCapacity, remainingCapacity, unit: "minutes",
      availabilityState, confidence, sourceStatus, fingerprint: key, generatedAt: now().toISOString(), cacheHit: false,
      assumptions: Array.isArray(raw.assumptions) ? raw.assumptions.map(String).slice(0, 20) : [], productivityScore: null });
    cache.set(key, { value, savedAt: Date.now() });
    audit?.("capacity_snapshot_created", { horizon, availabilityState, confidence, durationMs: performance.now() - started });
    metrics?.record?.("available_minutes", flexibleCapacity);
    metrics?.record?.("planned_minutes", value.plannedCapacity);
    metrics?.record?.("remaining_minutes", remainingCapacity);
    return structuredClone(value);
  }
  return { fingerprint, health: () => ({ status: "ok", cacheEntries: cache.size, executionAuthority: false }), invalidate, snapshot };
}

module.exports = { createCapacityService, fingerprint };
