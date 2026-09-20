"use strict";

const SPECIALIST_AGENT_STATUSES = Object.freeze([
  "PENDING", "RUNNING", "SUCCESS", "FAILED", "CANCELLED", "TIMEOUT", "INTERRUPTED",
]);

const SPECIALIST_FAILURE_CATEGORIES = Object.freeze([
  "PROVIDER_FAILURE", "NETWORK_FAILURE", "RATE_LIMIT", "TIMEOUT", "AUTH_ERROR", "MODEL_UNAVAILABLE",
  "QUALITY_FAILURE", "VALIDATION_FAILURE", "TASK_FAILURE", "AGENT_UNAVAILABLE", "PERMISSION_DENIED",
  "OUT_OF_SCOPE_CHANGE", "BUDGET_EXCEEDED", "CANCELLED", "INTERRUPTED",
]);

function assertSpecialistAgentAdapter(adapter) {
  for (const method of ["isAvailable", "getCapabilities", "executeTask", "cancelTask", "getTaskStatus"]) {
    if (typeof adapter?.[method] !== "function") throw new TypeError(`SpecialistAgentAdapter.${method} requis.`);
  }
  if (!adapter.id || !adapter.name) throw new TypeError("Identité SpecialistAgentAdapter requise.");
  return adapter;
}

function normalizeSpecialistAgentResult(value = {}, fallback = {}) {
  const status = SPECIALIST_AGENT_STATUSES.includes(value.status) ? value.status : "FAILED";
  const failureCategory = value.failureCategory == null
    ? null
    : SPECIALIST_FAILURE_CATEGORIES.includes(value.failureCategory) ? value.failureCategory : "TASK_FAILURE";
  return Object.freeze({
    taskId: String(value.taskId || fallback.taskId || ""),
    agent: String(value.agent || fallback.agent || "unknown"),
    status,
    summary: String(value.summary || "").slice(0, 4000),
    changedFiles: Object.freeze([...(value.changedFiles || [])].map(String).slice(0, 500)),
    commandsRun: Object.freeze([...(value.commandsRun || [])].map((item) => String(item).slice(0, 200)).slice(0, 200)),
    validations: Object.freeze([...(value.validations || [])].slice(0, 100)),
    errors: Object.freeze([...(value.errors || [])].map((item) => String(item).slice(0, 500)).slice(0, 50)),
    iterations: Math.max(0, Number(value.iterations) || 0),
    duration: Math.max(0, Number(value.duration) || 0),
    usage: value.usage && typeof value.usage === "object" ? Object.freeze({ ...value.usage }) : null,
    estimatedCost: value.estimatedCost != null && Number.isFinite(Number(value.estimatedCost)) ? Number(value.estimatedCost) : null,
    actualCost: value.actualCost != null && Number.isFinite(Number(value.actualCost)) ? Number(value.actualCost) : null,
    backend: value.backend && typeof value.backend === "object" ? Object.freeze({
      invoked: value.backend.invoked === true,
      startedAt: Number.isFinite(Number(value.backend.startedAt)) ? Number(value.backend.startedAt) : null,
      endedAt: Number.isFinite(Number(value.backend.endedAt)) ? Number(value.backend.endedAt) : null,
      exitCode: Number.isInteger(value.backend.exitCode) ? value.backend.exitCode : null,
      signal: value.backend.signal ? String(value.backend.signal).slice(0, 40) : null,
      spawnAttempted: value.backend.spawnAttempted === true,
      preSpawnFailure: value.backend.preSpawnFailure ? String(value.backend.preSpawnFailure).slice(0, 80) : null,
    }) : null,
    failureCategory,
  });
}

module.exports = {
  SPECIALIST_AGENT_STATUSES,
  SPECIALIST_FAILURE_CATEGORIES,
  assertSpecialistAgentAdapter,
  normalizeSpecialistAgentResult,
};
