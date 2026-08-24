"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
function createAutomationRegistry(filePath) {
  function load() { try { const data = JSON.parse(fs.readFileSync(filePath, "utf8")); return Array.isArray(data.routines) ? data : { version: 1, routines: [] }; } catch { return { version: 1, routines: [] }; } }
  function save(data) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); const tmp = `${filePath}.tmp`; fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 }); fs.renameSync(tmp, filePath); }
  function ensureDefaults() {
    const data = load();
    const legacyBrief = data.routines.find((routine) => routine.dedupeKey === "daily-brief-0800");
    if (legacyBrief) Object.assign(legacyBrief, { schedule: "0 7 * * *", dedupeKey: "daily-brief-0700" });
    if (!data.routines.some((routine) => routine.dedupeKey === "daily-brief-0700")) data.routines.push({
      id: crypto.randomUUID(), name: "Brief Noon quotidien", enabled: true,
      schedule: "0 7 * * *", timezone: "Europe/Paris", lastRunAt: null,
      lastSuccessAt: null, nextRunAt: null, status: "configured", dedupeKey: "daily-brief-0700",
      includesMondayVision: true,
    });
    save(data); return data;
  }
  function shouldRun(routine, occurrenceKey) { return routine.enabled && routine.lastOccurrenceKey !== occurrenceKey; }
  function markRun(id, occurrenceKey, success) { const data = load(); const routine = data.routines.find((item) => item.id === id); if (!routine) return null;
    routine.lastOccurrenceKey = occurrenceKey; routine.lastRunAt = new Date().toISOString();
    if (success) routine.lastSuccessAt = routine.lastRunAt; routine.status = success ? "ok" : "error"; save(data); return routine; }
  return { load, save, ensureDefaults, shouldRun, markRun };
}
module.exports = { createAutomationRegistry };
