"use strict";

const NUMBER_WORDS = Object.freeze({ une: 1, un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, eleven: 11, twelve: 12, one: 1, two: 2, three: 3, nine: 9 });
function localDateParts(date, timeZone) { return Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])); }
function dateString(date, timeZone) { const parts = localDateParts(date, timeZone); return `${parts.year}-${parts.month}-${parts.day}`; }
function shiftedLocalDate(date, timeZone, days) { const parts = localDateParts(date, timeZone); return dateString(new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + days, 12)), timeZone); }
function numberValue(value) { return Number(value) || NUMBER_WORDS[String(value).toLocaleLowerCase("fr")] || null; }
function parseTemporal(text, { now = new Date(), timeZone = "Europe/Paris" } = {}) {
  const raw = String(text || ""); const normalized = raw.toLocaleLowerCase("fr");
  const temporal = { original: null, date: null, time: null, absolute: null, daypart: null, durationMinutes: null, relativeMinutes: null, timezone: timeZone, precision: null };
  const relative = normalized.match(/dans\s+(\d+|une?|deux|trois|four|one|two|three)\s+(heure|heures|hour|hours|minute|minutes)/i);
  if (relative) { const amount = numberValue(relative[1]); temporal.relativeMinutes = amount * (/heure|hour/.test(relative[2]) ? 60 : 1); temporal.absolute = new Date(now.getTime() + temporal.relativeMinutes * 60_000).toISOString(); temporal.original = relative[0]; temporal.precision = "exact"; }
  const duration = normalized.match(/(?:pendant|durant|bloque(?:-moi)?|for)\s+(\d+|une?|deux|trois)\s*(minutes?|heures?|hours?)/i);
  if (duration) temporal.durationMinutes = numberValue(duration[1]) * (/heure|hour/.test(duration[2]) ? 60 : 1);
  const tomorrow = /\b(demain|tomorrow|mañana)\b/.test(normalized);
  const today = /\b(aujourd'hui|aujourd’hui|today|hoy)\b/.test(normalized);
  const yesterday = /\b(hier|yesterday|ayer)\b/.test(normalized);
  if (tomorrow || today || yesterday) {
    temporal.date = shiftedLocalDate(now, timeZone, tomorrow ? 1 : yesterday ? -1 : 0);
    temporal.original ||= tomorrow ? "demain" : yesterday ? "hier" : "aujourd’hui";
    temporal.precision ||= "day";
  }
  const daypart = normalized.match(/\b(matin|morning|après-midi|apres-midi|afternoon|soir|evening)\b/);
  if (daypart) { temporal.daypart = /matin|morning/.test(daypart[1]) ? "morning" : /soir|evening/.test(daypart[1]) ? "evening" : "afternoon"; temporal.original ||= daypart[0]; temporal.precision = "daypart"; }
  const time = normalized.match(/(?:à\s*|\bat\s*)(\d{1,2}|une?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)(?:\s*(?:h|heure|heures|:|hours?)\s*(\d{1,2})?)?/i);
  if (time) { const hour = numberValue(time[1]); if (hour !== null && hour >= 0 && hour <= 23) { temporal.time = `${String(hour).padStart(2, "0")}:${String(Number(time[2]) || 0).padStart(2, "0")}`; temporal.precision = "exact"; temporal.original = [temporal.original, time[0]].filter(Boolean).join(" "); } }
  return Object.values(temporal).some((value, index) => index < 7 && value !== null) ? temporal : {};
}

module.exports = { parseTemporal };
