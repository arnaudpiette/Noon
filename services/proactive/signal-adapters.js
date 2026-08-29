"use strict";

const crypto = require("crypto");

const SOURCE_TYPES = new Set([
  "calendar", "reminders", "notes", "gmail", "projects", "memory", "daily_brief", "local",
]);

const SIGNAL_TYPES = new Set([
  "deadline", "overdue", "calendar_conflict", "free_slot", "important_message",
  "project_blocker", "project_stale", "next_action", "follow_up", "information",
  "execution_drift",
]);

function clamp(value, fallback = 0.5) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function bounded(value, maximum) {
  return String(value || "").replace(/[\0\r\n]+/g, " ").trim().slice(0, maximum);
}

function fingerprint(parts) {
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function inferSignalType(sourceType, item, now) {
  if (item.signalType && SIGNAL_TYPES.has(item.signalType)) return item.signalType;
  if (item.conflict === true) return "calendar_conflict";
  if (item.blocked === true || item.blocker) return "project_blocker";
  const dueAt = item.dueAt || item.deadline;
  if (dueAt && Date.parse(dueAt) <= now.getTime()) return "overdue";
  if (dueAt) return "deadline";
  if (sourceType === "gmail") return item.important === true || item.requiresReply === true
    ? "important_message" : "information";
  if (sourceType === "projects" && item.nextAction) return "next_action";
  return item.isAction === false ? "information" : "follow_up";
}

function normalizeSignal(sourceType, item = {}, { now = new Date(), stale = false } = {}) {
  if (!SOURCE_TYPES.has(sourceType)) throw new TypeError(`Source proactive inconnue : ${sourceType}`);
  const sourceReference = bounded(item.sourceReference || item.sourceId || item.id || item.path, 300);
  if (!sourceReference) throw new TypeError("Référence de signal proactive obligatoire.");
  const signalType = inferSignalType(sourceType, item, now);
  const isNewsletter = sourceType === "gmail" && (item.newsletter === true || item.category === "newsletter");
  const isAction = item.isAction !== false && signalType !== "information" && !isNewsletter;
  const title = bounded(item.title || item.subject || item.name || "Élément à examiner", 240);
  const action = bounded(item.action || item.nextAction || (isAction ? `Examiner : ${title}` : ""), 500);
  const dueAt = item.dueAt || item.deadline || null;
  const materialKey = bounded(item.materialKey || item.updatedAt || item.sourceUpdatedAt || dueAt || item.status, 300);
  return Object.freeze({
    id: `signal_${fingerprint([sourceType, sourceReference, signalType]).slice(0, 24)}`,
    sourceType, sourceReference, signalType, title, action,
    projectId: item.projectId || null,
    dueAt,
    estimatedDurationMinutes: Math.max(5, Math.min(480, Number(item.estimatedDurationMinutes ?? item.estimatedDuration) || 30)),
    importance: clamp(item.importance ?? item.impact),
    impact: clamp(item.impact ?? item.importance),
    urgency: clamp(item.urgency, dueAt ? 0.65 : 0.3),
    confidence: clamp(item.confidence, stale ? 0.45 : 0.8),
    projectPriority: Math.max(0, Math.min(100, Number(item.projectPriority) || 50)),
    interruptionCost: clamp(item.interruptionCost, 0),
    blocked: signalType === "project_blocker" || item.blocked === true,
    isAction,
    sensitivity: bounded(item.sensitivity || "normal", 30),
    apiPolicy: bounded(item.apiPolicy || "allowed", 30),
    observedAt: item.observedAt || now.toISOString(),
    updatedAt: item.updatedAt || item.sourceUpdatedAt || null,
    expiresAt: item.expiresAt || null,
    stale: stale === true || item.stale === true || item.sourceStale === true,
    materialKey,
    metadata: Object.freeze({
      requiresReply: item.requiresReply === true,
      newsletter: isNewsletter,
      conflict: item.conflict === true,
      localOnly: item.apiPolicy === "local_only",
    }),
  });
}

function createSignalAdapters() {
  const adapt = (sourceType, items, options) => (items || []).flatMap((item) => {
    try { return [normalizeSignal(sourceType, item, options)]; }
    catch { return []; }
  });
  return {
    calendar: (items, options) => adapt("calendar", items, options),
    reminders: (items, options) => adapt("reminders", items, options),
    notes: (items, options) => adapt("notes", items, options)
      .filter((signal) => signal.isAction || signal.dueAt),
    gmail: (items, options) => adapt("gmail", items, options),
    projects: (items, options) => adapt("projects", items, options),
    memory: (items, options) => adapt("memory", items, options)
      .filter((signal) => signal.apiPolicy !== "local_only" || options?.local === true),
    dailyBrief: (items, options) => adapt("daily_brief", items, options),
    local: (items, options) => adapt("local", items, options),
    normalize: normalizeSignal,
  };
}

module.exports = { SIGNAL_TYPES, SOURCE_TYPES, createSignalAdapters, normalizeSignal };
