"use strict";

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

// Recherche par minute : le résultat respecte les changements DST d'IANA sans
// dépendance et choisit la première occurrence lors de l'heure automnale doublée.
function nextLocalOccurrence({ after = new Date(), hour, minute = 0, timeZone = "Europe/Paris" } = {}) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) throw new TypeError("Horaire local invalide.");
  const start = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
  for (let offset = 0; offset <= 72 * 60; offset += 1) {
    const candidate = new Date(start + offset * 60_000); const parts = localParts(candidate, timeZone);
    if (parts.hour === hour && parts.minute === minute) return candidate;
  }
  throw Object.assign(new Error("Occurrence locale introuvable."), { code: "JOB_SCHEDULE_UNRESOLVED" });
}

function occurrenceKey(scheduleId, date, timeZone) {
  const parts = localParts(date, timeZone);
  return `${scheduleId}:${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function createJobScheduler({ engine, now = () => Date.now(), timeZone = "Europe/Paris", observability = null } = {}) {
  if (!engine?.enqueue) throw new TypeError("BackgroundJobEngine requis.");
  const schedules = new Map();
  function register(schedule) {
    if (!schedule?.scheduleId || schedules.has(schedule.scheduleId)) throw new TypeError("Planification invalide ou dupliquée.");
    const nextRunAt = nextLocalOccurrence({ after: new Date(now() - 60_000), hour: schedule.hour, minute: schedule.minute || 0, timeZone: schedule.timeZone || timeZone });
    schedules.set(schedule.scheduleId, { ...schedule, timeZone: schedule.timeZone || timeZone, missedPolicy: schedule.missedPolicy || "RUN_ONCE", nextRunAt: nextRunAt.toISOString() });
    return schedules.get(schedule.scheduleId);
  }
  function tick(at = new Date(now())) {
    const outcomes = [];
    for (const schedule of schedules.values()) {
      const dueAt = new Date(schedule.nextRunAt); if (dueAt > at) continue;
      const lateMs = at.getTime() - dueAt.getTime();
      if (schedule.missedPolicy !== "SKIP" || lateMs <= (schedule.graceMs || 5 * 60_000)) {
        const result = engine.enqueue({ ...schedule.job, scheduledAt: at.toISOString(), idempotencyKey: occurrenceKey(schedule.scheduleId, dueAt, schedule.timeZone) });
        outcomes.push({ scheduleId: schedule.scheduleId, result });
      }
      schedule.nextRunAt = nextLocalOccurrence({ after: dueAt, hour: schedule.hour, minute: schedule.minute || 0, timeZone: schedule.timeZone }).toISOString();
      observability?.("job_schedule_tick", { scheduleId: schedule.scheduleId, lateMs, missedPolicy: schedule.missedPolicy });
    }
    return outcomes;
  }
  return { list: () => [...schedules.values()].map((value) => ({ ...value })), register, tick };
}

module.exports = { createJobScheduler, localParts, nextLocalOccurrence, occurrenceKey };
