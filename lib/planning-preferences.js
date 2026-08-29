"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DEFAULT_PLANNING_SETTINGS } = require("./morning-brief");

function createPlanningPreferenceStore(filePath) {
  const empty = { version: 1, settings: { ...DEFAULT_PLANNING_SETTINGS }, preferences: [] };
  function load() { try { const saved = JSON.parse(fs.readFileSync(filePath, "utf8")); return { ...empty, ...saved, settings: { ...empty.settings, ...(saved.settings || {}) }, preferences: Array.isArray(saved.preferences) ? saved.preferences : [] }; } catch { return structuredClone(empty); } }
  function save(value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); const temporary = `${filePath}.tmp`; fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(temporary, filePath); return value; }
  function updateSettings(changes = {}) {
    const allowed = ["enabled", "learningEnabled", "createGmailDrafts", "workdayStart", "workdayEnd", "minimumSlotMinutes", "maximumFocusMinutes", "workingDays", "bufferMinutes", "busyCalendarIds", "targetCalendarId"];
    const state = load(); const next = {};
    for (const key of allowed) if (Object.hasOwn(changes, key)) next[key] = changes[key];
    for (const key of ["workdayStart", "workdayEnd"]) if (next[key] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(next[key]))) throw new Error("Horaire de travail invalide.");
    for (const [key, minimum, maximum] of [["minimumSlotMinutes", 15, 120], ["maximumFocusMinutes", 25, 240], ["bufferMinutes", 0, 60]]) if (Object.hasOwn(next, key) && (!Number.isFinite(Number(next[key])) || Number(next[key]) < minimum || Number(next[key]) > maximum)) throw new Error(`Valeur invalide pour ${key}.`);
    if (next.workingDays && (!Array.isArray(next.workingDays) || next.workingDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6))) throw new Error("Jours travaillés invalides.");
    if (next.busyCalendarIds && (!Array.isArray(next.busyCalendarIds) || next.busyCalendarIds.length > 20)) throw new Error("Liste d’agendas invalide.");
    state.settings = { ...state.settings, ...next, protectedBreakStart: "12:30", protectedBreakEnd: "13:30", timeZone: "Europe/Paris" };
    return save(state);
  }
  function addPreference(input) { const state = load(); const preference = { id: crypto.randomUUID(), text: String(input.text || "").trim().slice(0, 1000), source: String(input.source || "correction").slice(0, 100), createdAt: new Date().toISOString(), confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0.5)), locked: input.locked === true, disabledSources: Array.isArray(input.disabledSources) ? input.disabledSources.slice(0, 20) : [] }; if (!preference.text) throw new Error("Préférence vide."); state.preferences.push(preference); save(state); return preference; }
  function updatePreference(id, changes = {}) { const state = load(); const item = state.preferences.find((entry) => entry.id === id); if (!item) throw new Error("Préférence introuvable."); if (typeof changes.text === "string") item.text = changes.text.trim().slice(0, 1000); if (typeof changes.locked === "boolean") item.locked = changes.locked; if (Number.isFinite(Number(changes.confidence))) item.confidence = Math.max(0, Math.min(1, Number(changes.confidence))); save(state); return item; }
  function removePreference(id) { const state = load(); state.preferences = state.preferences.filter((entry) => entry.id !== id); save(state); return state; }
  return { load, updateSettings, addPreference, updatePreference, removePreference };
}

module.exports = { createPlanningPreferenceStore };
