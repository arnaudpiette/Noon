"use strict";

const crypto = require("node:crypto");

const ATTENTION_SOURCES = Object.freeze(["DAILY_BRIEF", "PROACTIVE", "BACKGROUND_JOB", "APPROVAL", "EXECUTION", "RELIABILITY", "PLANNING", "GOAL", "PORTFOLIO", "REMOTE", "SYSTEM"]);
const ATTENTION_TYPES = Object.freeze(["INFORMATION", "RECOMMENDATION", "ACTION_REQUIRED", "COMPLETION", "WARNING", "FAILURE", "REMINDER", "STATUS_CHANGE"]);
const ATTENTION_LEVELS = Object.freeze(["SILENT", "PASSIVE", "NORMAL", "IMPORTANT", "URGENT"]);
const CHANNELS = Object.freeze(["IN_APP", "MACOS_NOTIFICATION", "MOBILE_PUSH", "BADGE", "VOICE"]);
const SENSITIVITIES = Object.freeze(["NORMAL", "PRIVATE", "PROTECTED", "LOCAL_ONLY"]);
const PRIVACY_LEVELS = Object.freeze(["FULL", "REDACTED", "GENERIC", "HIDDEN"]);
const DELIVERY_STATES = Object.freeze(["CREATED", "QUEUED", "DEFERRED", "DELIVERING", "DELIVERED", "FAILED", "SUPPRESSED", "EXPIRED", "REPLACED", "CANCELLED", "SEEN", "ACTED"]);

function uid(prefix, value) { return `${prefix}_${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 20)}`; }
function pick(value, allowed, fallback) { const normalized = String(value || "").toUpperCase(); return allowed.includes(normalized) ? normalized : fallback; }
function iso(value, fallback = null) { if (!value) return fallback; const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : fallback; }
function refs(value, allowed = null) { return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item).toUpperCase()).filter((item) => !allowed || allowed.includes(item)))]; }

function normalizeAttentionRequest(raw = {}, now = () => new Date()) {
  const source = pick(raw.source, ATTENTION_SOURCES, "SYSTEM"); const type = pick(raw.type, ATTENTION_TYPES, "INFORMATION");
  const subjectRef = String(raw.subjectRef || raw.payloadRef || "").trim();
  const createdAt = iso(raw.createdAt, now().toISOString());
  const attentionId = String(raw.attentionId || uid("attention", [source, type, subjectRef, raw.dedupeKey, createdAt]));
  const allowedChannels = refs(raw.allowedChannels?.length ? raw.allowedChannels : CHANNELS, CHANNELS);
  return Object.freeze({ attentionId, source, type, subjectRef: subjectRef || null, workspaceId: raw.workspaceId ? String(raw.workspaceId) : null,
    conversationId: raw.conversationId ? String(raw.conversationId) : null, profileScope: String(raw.profileScope || "owner"),
    importance: String(raw.importance || "NORMAL").toUpperCase(), interruptionLevel: pick(raw.interruptionLevel, ATTENTION_LEVELS, "NORMAL"),
    urgency: String(raw.urgency || "NORMAL").toUpperCase(), sensitivity: pick(raw.sensitivity, SENSITIVITIES, "NORMAL"),
    derivedLocalOnly: raw.derivedLocalOnly === true, userActionRequired: raw.userActionRequired === true,
    userRequestedNotification: raw.userRequestedNotification === true, expiresAt: iso(raw.expiresAt), deliverAfter: iso(raw.deliverAfter), deliverBefore: iso(raw.deliverBefore),
    preferredChannels: refs(raw.preferredChannels, CHANNELS), allowedChannels, dedupeKey: String(raw.dedupeKey || `${source}:${type}:${subjectRef || attentionId}`).slice(0, 300),
    dedupeMode: raw.dedupeMode === "PERMANENT" ? "PERMANENT" : "WINDOW", dedupeWindowMs: Math.max(0, Math.min(30 * 86_400_000, Number(raw.dedupeWindowMs) || 3_600_000)),
    replaceKey: raw.replaceKey ? String(raw.replaceKey).slice(0, 300) : null, payloadRef: raw.payloadRef ? String(raw.payloadRef).slice(0, 300) : null,
    title: String(raw.title || "Noon").slice(0, 160), summary: String(raw.summary || "Noon a un élément pour toi.").slice(0, 500),
    genericSummary: String(raw.genericSummary || "Noon a un élément pour toi.").slice(0, 240), createdAt,
    metadata: { category: String(raw.metadata?.category || source).slice(0, 80), exactActionRef: raw.metadata?.exactActionRef ? String(raw.metadata.exactActionRef).slice(0, 300) : null,
      sourceFingerprint: raw.metadata?.sourceFingerprint ? String(raw.metadata.sourceFingerprint).slice(0, 128) : null },
  });
}

module.exports = { ATTENTION_LEVELS, ATTENTION_SOURCES, ATTENTION_TYPES, CHANNELS, DELIVERY_STATES, PRIVACY_LEVELS, SENSITIVITIES, iso, normalizeAttentionRequest, pick, uid };
