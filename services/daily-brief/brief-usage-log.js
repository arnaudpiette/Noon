"use strict";

// V3-L2d — journal local d'usage du Brief (critère de sortie de L2 : utilisé chaque jour pendant
// deux semaines). Une ligne par jour (date Europe/Paris) : heure prévue, génération (à l'heure ou
// non, déclencheur), échec éventuel, première ouverture et nombre d'ouvertures.
// Aucun contenu du Brief n'est stocké : seulement des horodatages, des codes et des compteurs.

const fs = require("node:fs");
const path = require("node:path");

const TIME_ZONE = "Europe/Paris";
const KEEP_DAYS = 120;
const ON_TIME_GRACE_MINUTES = 15;
const TRIGGERS = new Set(["scheduled", "manual"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function parisParts(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(date).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
const parisDate = (date) => parisParts(date).date;

function shiftDate(isoDate, days) {
  const base = new Date(`${isoDate}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

// À l'heure : généré le jour même, au plus tard 15 minutes après l'heure prévue.
function isOnTime(day) {
  if (!day?.generatedAt || !TIME_RE.test(day.scheduledTime || "")) return false;
  const generated = parisParts(new Date(day.generatedAt));
  if (generated.date !== day.date) return false;
  const [hours, minutes] = day.scheduledTime.split(":").map(Number);
  return generated.minutes <= hours * 60 + minutes + ON_TIME_GRACE_MINUTES;
}

function createBriefUsageLog({ filePath, now = () => new Date() } = {}) {
  if (!filePath) throw new TypeError("filePath requis.");

  function load() {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return data && typeof data.days === "object" && !Array.isArray(data.days) ? data : { version: 1, days: {} };
    } catch { return { version: 1, days: {} }; }
  }
  function persist(data) {
    const cutoff = shiftDate(parisDate(now()), -KEEP_DAYS);
    for (const date of Object.keys(data.days)) if (date < cutoff) delete data.days[date];
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, filePath);
  }
  function update(date, change) {
    if (!DATE_RE.test(String(date || ""))) return null;
    const data = load();
    const day = { date, ...(data.days[date] || {}) };
    change(day);
    data.days[date] = day;
    persist(data);
    return day;
  }

  function recordGenerated({ date, generatedAt, trigger, scheduledTime }) {
    const at = new Date(generatedAt || now());
    return update(date || parisDate(at), (day) => {
      if (TIME_RE.test(String(scheduledTime || ""))) day.scheduledTime = scheduledTime;
      // On garde la première génération réussie du jour : c'est elle qui dit si le Brief était prêt à temps.
      if (!day.generatedAt) {
        day.generatedAt = at.toISOString();
        day.trigger = TRIGGERS.has(trigger) ? trigger : "manual";
      }
      day.regenerations = (day.regenerations || 0) + (day.generatedAt === at.toISOString() ? 0 : 1);
      delete day.failure;
    });
  }

  function recordFailure({ code, scheduledTime }) {
    const at = now();
    return update(parisDate(at), (day) => {
      if (TIME_RE.test(String(scheduledTime || ""))) day.scheduledTime = scheduledTime;
      if (!day.generatedAt) day.failure = { at: at.toISOString(), code: String(code || "BRIEF_FAILED").replace(/[^A-Z0-9_]/gi, "").slice(0, 60) || "BRIEF_FAILED" };
    });
  }

  // Seule l'ouverture du Brief du jour compte ; une date passée ou future est refusée.
  function recordOpened({ date }) {
    const at = now();
    if (date !== parisDate(at)) return null;
    return update(date, (day) => {
      if (!day.openedAt) day.openedAt = at.toISOString();
      day.opens = (day.opens || 0) + 1;
    });
  }

  function summary({ days = 14 } = {}) {
    const count = Math.max(1, Math.min(KEEP_DAYS, Math.trunc(Number(days)) || 14));
    const today = parisDate(now());
    const data = load();
    const rows = [];
    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const date = shiftDate(today, -offset);
      const day = data.days[date] || { date };
      rows.push({
        date,
        scheduledTime: day.scheduledTime || null,
        generatedAt: day.generatedAt || null,
        trigger: day.trigger || null,
        onTime: isOnTime(day),
        failureCode: day.failure?.code || null,
        openedAt: day.openedAt || null,
        opens: day.opens || 0,
      });
    }
    let openedStreak = 0;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (rows[index].openedAt) openedStreak += 1;
      else if (index === rows.length - 1) continue; // aujourd'hui pas encore ouvert : la série n'est pas rompue
      else break;
    }
    return {
      days: count,
      generated: rows.filter((row) => row.generatedAt).length,
      onTime: rows.filter((row) => row.onTime).length,
      opened: rows.filter((row) => row.openedAt).length,
      failed: rows.filter((row) => row.failureCode && !row.generatedAt).length,
      openedStreak,
      rows,
    };
  }

  return Object.freeze({ recordGenerated, recordFailure, recordOpened, summary });
}

module.exports = { createBriefUsageLog, isOnTime, parisDate };
