"use strict";

const { PRIVACY_LEVELS } = require("./notification-schema");

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}
function timeMinutes(value) { const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || "")); return match ? Number(match[1]) * 60 + Number(match[2]) : null; }
function isQuietAt(date, quiet = {}) {
  if (!quiet.enabled) return false;
  const start = timeMinutes(quiet.startTime); const end = timeMinutes(quiet.endTime); if (start === null || end === null || start === end) return false;
  const parts = localParts(date, quiet.timezone || "Europe/Paris"); const current = Number(parts.hour) * 60 + Number(parts.minute);
  return start < end ? current >= start && current < end : current >= start || current < end;
}
function privacyLevel(request, context, channel) {
  if (request.sensitivity === "LOCAL_ONLY" || request.derivedLocalOnly) {
    if (["MOBILE_PUSH"].includes(channel)) return "HIDDEN";
    return context.deviceLocked ? "GENERIC" : "REDACTED";
  }
  if (request.sensitivity === "PROTECTED") return context.deviceLocked || channel === "VOICE" ? "GENERIC" : "REDACTED";
  if (request.sensitivity === "PRIVATE") return context.deviceLocked ? "GENERIC" : "REDACTED";
  return context.lockScreenDetail && PRIVACY_LEVELS.includes(context.lockScreenDetail) ? context.lockScreenDetail : "FULL";
}
function visiblePayload(request, level) {
  if (level === "HIDDEN") return null;
  if (level === "GENERIC") return { title: "Noon", body: request.genericSummary, privacyLevel: level };
  if (level === "REDACTED") return { title: request.type === "ACTION_REQUIRED" ? "Action requise dans Noon" : "Noon", body: request.genericSummary, privacyLevel: level };
  return { title: request.title, body: request.summary, privacyLevel: level };
}
function createNotificationPolicy({ maxNonCriticalInterruptions = 3, interruptionWindowMs = 3_600_000 } = {}) {
  function evaluate(request, context = {}) {
    const at = new Date(context.currentTime || Date.now()); const expired = request.expiresAt && Date.parse(request.expiresAt) <= at.getTime();
    if (expired || (request.deliverBefore && Date.parse(request.deliverBefore) <= at.getTime())) return { disposition: "EXPIRE", channels: [], reason: "expired" };
    if (request.deliverAfter && Date.parse(request.deliverAfter) > at.getTime()) return { disposition: "DEFER", channels: [], reason: "delivery_window" };
    const quiet = isQuietAt(at, context.quietHours); const focus = context.focusState?.active === true;
    const critical = request.interruptionLevel === "URGENT" || request.importance === "CRITICAL";
    const explicit = request.userRequestedNotification === true;
    const recent = (context.recentDeliveries || []).filter((item) => !item.critical && at.getTime() - Date.parse(item.deliveredAt || item.createdAt) <= interruptionWindowMs);
    if ((quiet || focus) && !critical && !explicit) return { disposition: "DEFER", channels: ["IN_APP", "BADGE"].filter((channel) => request.allowedChannels.includes(channel)), reason: quiet ? "quiet_hours" : "focus" };
    if (request.interruptionLevel === "SILENT") return { disposition: "DELIVER", channels: request.allowedChannels.includes("IN_APP") ? ["IN_APP"] : [], reason: "silent" };
    if (recent.length >= maxNonCriticalInterruptions && !critical && !explicit) return { disposition: "DELIVER", channels: ["IN_APP", "BADGE"].filter((channel) => request.allowedChannels.includes(channel)), reason: "attention_budget" };
    const sameConversation = context.appFocused === true && request.conversationId && context.currentConversation === request.conversationId;
    let candidates = request.preferredChannels.length ? request.preferredChannels : request.interruptionLevel === "PASSIVE" ? ["IN_APP", "BADGE"] : ["IN_APP", "MACOS_NOTIFICATION"];
    if (sameConversation) candidates = candidates.filter((channel) => channel !== "MACOS_NOTIFICATION" && channel !== "MOBILE_PUSH" && channel !== "VOICE");
    if (context.activeDevice?.type === "mobile" && context.activeDevice?.scopes?.includes("NOTIFICATIONS") && !sameConversation && request.allowedChannels.includes("MOBILE_PUSH")) candidates = ["MOBILE_PUSH", "IN_APP"];
    if (request.sensitivity === "LOCAL_ONLY" || request.derivedLocalOnly) candidates = candidates.filter((channel) => channel !== "MOBILE_PUSH");
    if (!context.activeDevice?.scopes?.includes("NOTIFICATIONS")) candidates = candidates.filter((channel) => channel !== "MOBILE_PUSH");
    if (candidates.includes("VOICE") && !(context.voiceSessionActive && context.preferences?.voiceEnabled)) candidates = candidates.filter((channel) => channel !== "VOICE");
    const channels = [...new Set(candidates.filter((channel) => request.allowedChannels.includes(channel)))];
    return { disposition: channels.length ? "DELIVER" : "SUPPRESS", channels, reason: sameConversation ? "active_conversation" : "policy", critical, sound: context.preferences?.soundEnabled === true && request.interruptionLevel === "URGENT" };
  }
  return { evaluate, isQuietAt, privacyLevel, visiblePayload };
}

module.exports = { createNotificationPolicy, isQuietAt, localParts, privacyLevel, visiblePayload };
