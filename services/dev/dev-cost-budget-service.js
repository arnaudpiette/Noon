"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const TIME_ZONE = "Europe/Paris";
const CURRENCY = "USD";
const WARNING_LEVELS = Object.freeze({ WARNING: 0.80, CRITICAL: 0.95 });

function finiteOrNull(value) {
  return value == null || !Number.isFinite(Number(value)) ? null : Math.max(0, Number(value));
}
function periodParts(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(now)).filter((item) => item.type !== "literal").map((item) => [item.type, item.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, month: `${parts.year}-${parts.month}` };
}
function level(spent, reserved, limit) {
  if (limit === null) return "NORMAL";
  const ratio = limit > 0 ? (spent + reserved) / limit : Number.POSITIVE_INFINITY;
  return ratio >= 1 ? "EXHAUSTED" : ratio >= WARNING_LEVELS.CRITICAL ? "CRITICAL" : ratio >= WARNING_LEVELS.WARNING ? "WARNING" : "NORMAL";
}
function emptyState() { return { schemaVersion: 1, currency: CURRENCY, entries: [], updatedAt: null }; }

function createDevCostBudgetService({ filePath = null, config = () => ({}), enforcement = () => false, now = () => Date.now(), staleReservationMs = 30 * 60_000, observability = null } = {}) {
  let state = emptyState();
  let integrity = "VALID";
  if (filePath && fs.existsSync(filePath)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (loaded?.schemaVersion === 1 && loaded.currency === CURRENCY && Array.isArray(loaded.entries)) state = loaded;
      else integrity = "INVALID";
    } catch { integrity = "INVALID"; }
  }
  function emit(event, metadata) { try { observability?.(event, metadata); } catch {} }
  function persist() {
    if (!filePath) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporary = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, filePath);
  }
  function policy() {
    const value = config() || {};
    return {
      enabled: value.enabled !== false,
      taskLimit: finiteOrNull(value.taskLimit),
      dailyLimit: finiteOrNull(value.dailyLimit),
      monthlyLimit: finiteOrNull(value.monthlyLimit),
      currency: CURRENCY,
    };
  }
  function effective(entry) {
    if (["RECONCILED", "UNKNOWN_PENDING_RECONCILIATION"].includes(entry.status)) return entry.actualCost ?? entry.estimatedCost;
    return 0;
  }
  function aggregate(taskId = null, at = now()) {
    const periods = periodParts(at); let dailySpent = 0; let monthlySpent = 0; let taskSpent = 0; let dailyReserved = 0; let monthlyReserved = 0; let taskReserved = 0;
    for (const entry of state.entries) {
      const cost = effective(entry); const reserved = entry.status === "RESERVED" ? entry.estimatedCost : 0;
      if (entry.dayKey === periods.day) { dailySpent += cost; dailyReserved += reserved; }
      if (entry.monthKey === periods.month) { monthlySpent += cost; monthlyReserved += reserved; }
      if (taskId && entry.taskId === taskId) { taskSpent += cost; taskReserved += reserved; }
    }
    return { periods, dailySpent, monthlySpent, taskSpent, dailyReserved, monthlyReserved, taskReserved };
  }
  function snapshot(taskId = null, taskLimitOverride = null, enforcementOverride = null) {
    const limits = policy(); const sums = aggregate(taskId); const taskLimit = finiteOrNull(taskLimitOverride) ?? limits.taskLimit;
    const remaining = (limit, spent, reserved) => limit === null ? null : Math.max(0, limit - spent - reserved);
    return Object.freeze({
      currency: CURRENCY, enabled: limits.enabled, enforcement: enforcementOverride === null ? enforcement() === true : enforcementOverride === true, integrity,
      task: { spent: sums.taskSpent, reserved: sums.taskReserved, limit: taskLimit, remaining: remaining(taskLimit, sums.taskSpent, sums.taskReserved), level: level(sums.taskSpent, sums.taskReserved, taskLimit) },
      daily: { key: sums.periods.day, spent: sums.dailySpent, reserved: sums.dailyReserved, limit: limits.dailyLimit, remaining: remaining(limits.dailyLimit, sums.dailySpent, sums.dailyReserved), level: level(sums.dailySpent, sums.dailyReserved, limits.dailyLimit) },
      monthly: { key: sums.periods.month, spent: sums.monthlySpent, reserved: sums.monthlyReserved, limit: limits.monthlyLimit, remaining: remaining(limits.monthlyLimit, sums.monthlySpent, sums.monthlyReserved), level: level(sums.monthlySpent, sums.monthlyReserved, limits.monthlyLimit) },
    });
  }
  function effectiveRemaining(taskId, taskLimitOverride) {
    const view = snapshot(taskId, taskLimitOverride);
    return [view.task.remaining, view.daily.remaining, view.monthly.remaining].filter((item) => item !== null).reduce((minimum, item) => Math.min(minimum, item), Number.POSITIVE_INFINITY);
  }
  function benchmarkSpent(benchmarkId) {
    return state.entries.filter((entry) => entry.benchmarkId === String(benchmarkId)).reduce((sum, entry) => sum + effective(entry) + (entry.status === "RESERVED" ? entry.estimatedCost : 0), 0);
  }
  function reserve(input = {}) {
    if (integrity !== "VALID" && input.enforce === true) throw Object.assign(new Error("Le ledger DEV est illisible ; réservation refusée."), { code: "LEDGER_INTEGRITY_FAILURE" });
    const estimatedCost = finiteOrNull(input.estimatedCost);
    if (estimatedCost === null) throw Object.assign(new Error("Le coût du modèle est inconnu."), { code: "COST_UNKNOWN" });
    const taskId = String(input.taskId || ""); const reservationId = String(input.reservationId || `dev-cost-${crypto.randomUUID()}`);
    const existing = state.entries.find((entry) => entry.reservationId === reservationId);
    if (existing) return structuredClone(existing);
    const view = snapshot(taskId, input.taskLimit);
    if (input.enforce === true && view.enabled) {
      const checks = [["TASK_BUDGET_EXCEEDED", view.task], ["DAILY_BUDGET_EXCEEDED", view.daily], ["MONTHLY_BUDGET_EXCEEDED", view.monthly]];
      for (const [code, dimension] of checks) if (dimension.remaining !== null && estimatedCost > dimension.remaining + Number.EPSILON) throw Object.assign(new Error("Le budget DEV disponible est insuffisant."), { code, budget: view });
    }
    const benchmarkLimit = finiteOrNull(input.benchmarkLimit);
    if (input.benchmarkId && benchmarkLimit !== null && benchmarkSpent(input.benchmarkId) + estimatedCost > benchmarkLimit + Number.EPSILON) throw Object.assign(new Error("Le budget benchmark disponible est insuffisant."), { code: "BENCHMARK_BUDGET_EXCEEDED" });
    const periods = periodParts(now());
    const entry = { timestamp: new Date(now()).toISOString(), taskId, callId: String(input.callId || reservationId), reservationId, taskDomain: "DEV", executionMode: String(input.executionMode || "NATIVE_NOON"), benchmarkId: input.benchmarkId ? String(input.benchmarkId).slice(0, 160) : null, provider: String(input.provider || "unknown"), model: String(input.model || "unknown"), estimatedCost, actualCost: null, currency: CURRENCY, dayKey: periods.day, monthKey: periods.month, status: "RESERVED", success: null, failureCategory: null, reservation: estimatedCost, reconciliation: null };
    state.entries.push(entry); state.updatedAt = entry.timestamp; persist(); emit("dev_budget_reserved", { provider: entry.provider, model: entry.model, estimatedCost, currency: CURRENCY }); return structuredClone(entry);
  }
  function reconcile(reservationId, { actualCost = null, success = false, failureCategory = null } = {}) {
    const entry = state.entries.find((item) => item.reservationId === String(reservationId));
    if (!entry) throw Object.assign(new Error("Réservation DEV introuvable."), { code: "RESERVATION_NOT_FOUND" });
    if (entry.status !== "RESERVED") return structuredClone(entry);
    entry.actualCost = finiteOrNull(actualCost); entry.status = "RECONCILED"; entry.success = success === true; entry.failureCategory = failureCategory ? String(failureCategory).slice(0, 80) : null; entry.reservation = 0; entry.reconciliation = new Date(now()).toISOString(); state.updatedAt = entry.reconciliation; persist(); emit("dev_budget_reconciled", { provider: entry.provider, model: entry.model, estimatedCost: entry.estimatedCost, actualCost: entry.actualCost, currency: CURRENCY, success: entry.success, failureCategory: entry.failureCategory }); return structuredClone(entry);
  }
  function release(reservationId, failureCategory = "CALL_NOT_EXECUTED") {
    const entry = state.entries.find((item) => item.reservationId === String(reservationId));
    if (!entry || entry.status !== "RESERVED") return entry ? structuredClone(entry) : null;
    entry.status = "RELEASED"; entry.failureCategory = String(failureCategory).slice(0, 80); entry.reservation = 0; entry.reconciliation = new Date(now()).toISOString(); persist(); return structuredClone(entry);
  }
  function markUnknown(reservationId, failureCategory = "UNKNOWN_OUTCOME") {
    const entry = state.entries.find((item) => item.reservationId === String(reservationId));
    if (!entry || entry.status !== "RESERVED") return entry ? structuredClone(entry) : null;
    entry.status = "UNKNOWN_PENDING_RECONCILIATION"; entry.failureCategory = String(failureCategory).slice(0, 80); entry.reservation = 0; entry.reconciliation = new Date(now()).toISOString(); persist(); return structuredClone(entry);
  }
  function recoverStale() {
    const cutoff = now() - staleReservationMs; const recovered = [];
    for (const entry of state.entries) if (entry.status === "RESERVED" && Date.parse(entry.timestamp) <= cutoff) { entry.status = "UNKNOWN_PENDING_RECONCILIATION"; entry.reservation = 0; entry.failureCategory = "STALE_RESERVATION"; entry.reconciliation = new Date(now()).toISOString(); recovered.push(entry.reservationId); }
    if (recovered.length) persist(); return recovered;
  }
  function entries() { return structuredClone(state.entries); }
  return { benchmarkSpent, currency: CURRENCY, effectiveRemaining, entries, markUnknown, policy, reconcile, recoverStale, release, reserve, snapshot };
}

module.exports = { CURRENCY, TIME_ZONE, WARNING_LEVELS, createDevCostBudgetService, periodParts };
