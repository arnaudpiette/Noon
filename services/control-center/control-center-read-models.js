"use strict";

const path = require("node:path");

const SECTION_IDS = Object.freeze([
  "overview", "connections", "jobs", "approvals", "reliability",
  "memory", "rules", "workspaces", "goals", "portfolio", "devices",
  "sync", "extensions", "permissions", "notifications", "privacy",
  "offline", "configuration", "backups", "evaluations", "diagnostics",
]);
const VIEW_LEVELS = Object.freeze(["USER", "ADVANCED", "DEVELOPER"]);
const SAFE_STATES = new Set([
  "HEALTHY", "DEGRADED", "UNAVAILABLE", "UNAUTHORIZED", "MISCONFIGURED", "UNKNOWN", "STALE",
]);
const SENSITIVE_KEY = /(?:secret|token|password|private.?key|resume.?token|cipher|payload|raw|content|body|statement|legalName)/i;
const PRIVATE_PATH = /^(?:\/Users\/|\/home\/|[A-Za-z]:\\)/;

function safeState(value, fallback = "UNKNOWN") {
  const state = String(value || "").toUpperCase();
  return SAFE_STATES.has(state) ? state : fallback;
}

function safeLabel(value, fallback = "Indisponible", maximum = 160) {
  return String(value == null ? fallback : value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum) || fallback;
}

function safeIdentifier(value) {
  const text = String(value || "").trim();
  return /^[a-zA-Z0-9._:-]{1,160}$/.test(text) ? text : null;
}

function redactPath(value) {
  const text = String(value || "");
  if (!PRIVATE_PATH.test(text)) return safeLabel(text, "", 240);
  return `${path.sep}[DOSSIER_LOCAL]${path.extname(text)}`;
}

function scrub(value, depth = 0) {
  if (depth > 8) return "[TRONQUÉ]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    if (/sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+/i.test(value)) return "[SECRET]";
    if (PRIVATE_PATH.test(value)) return redactPath(value);
    return safeLabel(value, "", 500);
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => scrub(entry, depth + 1));
  if (typeof value !== "object") return null;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_KEY.test(key))
    .slice(0, 100)
    .map(([key, entry]) => [key, scrub(entry, depth + 1)]));
}

function item({ id, label, state = "UNKNOWN", summary = null, meta = null, actions = [] } = {}) {
  return Object.freeze({
    id: safeIdentifier(id) || `item-${Math.random().toString(36).slice(2, 10)}`,
    label: safeLabel(label),
    state: safeState(state),
    summary: summary == null ? null : safeLabel(summary, "", 240),
    meta: meta ? scrub(meta) : null,
    actions: [...new Set(actions.map(safeIdentifier).filter(Boolean))],
  });
}

function section({ sectionId, status = "UNKNOWN", summary = "", items = [], actionsAvailable = [], counts = {}, updatedAt = null, partial = false } = {}) {
  if (!SECTION_IDS.includes(sectionId)) throw new TypeError("Section Control Center inconnue.");
  return Object.freeze({
    sectionId,
    status: safeState(status),
    summary: safeLabel(summary, "État indisponible.", 280),
    items: items.slice(0, 200).map((entry) => item(entry)),
    actionsAvailable: [...new Set(actionsAvailable.map(safeIdentifier).filter(Boolean))],
    counts: scrub(counts),
    updatedAt: updatedAt || new Date().toISOString(),
    partial: partial === true,
  });
}

function failedSection(sectionId, error) {
  return section({
    sectionId,
    status: "UNKNOWN",
    summary: "Cette section est temporairement indisponible. Les autres fonctions de Noon restent actives.",
    items: [{ id: `${sectionId}-unavailable`, label: "Données indisponibles", state: "UNKNOWN", summary: safeLabel(error?.code || "SECTION_UNAVAILABLE") }],
    partial: true,
  });
}

module.exports = {
  SECTION_IDS,
  VIEW_LEVELS,
  failedSection,
  item,
  redactPath,
  safeIdentifier,
  safeLabel,
  safeState,
  scrub,
  section,
};
