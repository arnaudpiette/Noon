"use strict";

// V3-L6 (G.1, G.2, G.6) — bilan local « Santé de Noon ». Agrège ce qui est déjà mesuré :
// traces d'exécution (noon-observability), coût mensuel et coût par jour (usage.json),
// journal d'usage du Brief. Rien n'est envoyé hors du Mac ; aucun contenu de conversation lu.
// Ce qui n'est pas mesuré est dit tel quel (jamais de valeur inventée).

const { parisDate } = require("../daily-brief/brief-usage-log");

const DEFAULT_BUDGETS = Object.freeze({ textResponseMs: 2000, voiceFirstAudioMs: 1000, dailyCostUSD: 1 });
const TEXT_CHANNELS = new Set(["chat"]);
const VOICE_CHANNELS = new Set(["voice", "live_voice"]);
const DAY_MS = 24 * 60 * 60 * 1000;

const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
function percentile(values, ratio) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}
const round = (value, digits = 0) => (value == null ? null : Number(value.toFixed(digits)));
function shiftDate(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// Ajoute à `next.dailyCostUSD` la hausse du coût total entre l'état enregistré et le nouvel état.
// Changement de mois : la ventilation repart de zéro, comme les compteurs mensuels.
function withDailyCost(previous, next, { costOf, today }) {
  const sameMonth = Boolean(previous) && previous.month === next.month;
  const daily = sameMonth ? { ...(next.dailyCostUSD || previous.dailyCostUSD || {}) } : {};
  const delta = costOf(next) - (sameMonth ? costOf(previous) : 0);
  if (Number.isFinite(delta) && delta > 0) daily[today] = Number(((daily[today] || 0) + delta).toFixed(6));
  // Premier jour ventilé : les jours antérieurs sont « non mesurés », pas « 0 $ ».
  const since = (sameMonth && (previous.dailyCostSince || next.dailyCostSince)) || today;
  return { ...next, dailyCostUSD: daily, dailyCostSince: since };
}

function budgetCheck(value, limit, { lowerIsBetter = true } = {}) {
  if (value == null) return { value: null, limit, status: "NO_DATA" };
  const ok = lowerIsBetter ? value <= limit : value >= limit;
  return { value, limit, status: ok ? "OK" : "OVER" };
}

function createNoonHealthReport({ listTraces, usageStatus, briefUsage = null, budgets = {}, now = () => Date.now() } = {}) {
  if (typeof listTraces !== "function" || typeof usageStatus !== "function") throw new TypeError("listTraces et usageStatus requis.");
  const limits = { ...DEFAULT_BUDGETS, ...Object.fromEntries(Object.entries(budgets).filter(([, value]) => Number.isFinite(value) && value > 0)) };

  function report({ days = 7 } = {}) {
    const span = Math.max(1, Math.min(30, Math.trunc(Number(days)) || 7));
    const today = parisDate(new Date(now()));
    const dates = Array.from({ length: span }, (_, index) => shiftDate(today, index - span + 1));
    const first = dates[0];
    const traces = (listTraces({ sinceMs: (span + 1) * DAY_MS }) || []).filter((trace) => trace?.completedAt && parisDate(new Date(trace.startedAt)) >= first);
    const usage = usageStatus() || {};
    const dailyCost = usage.dailyCostUSD || {};

    const textLatency = []; const firstAudio = []; let failures = 0;
    const byDay = new Map(dates.map((date) => [date, { date, exchanges: 0, text: 0, voice: 0, background: 0, failures: 0, textLatency: [], tracedCostUSD: 0 }]));
    const byFunction = {};
    for (const trace of traces) {
      const day = byDay.get(parisDate(new Date(trace.startedAt)));
      if (!day) continue;
      const failed = trace.status === "failed" || (Array.isArray(trace.errors) && trace.errors.length > 0);
      day.exchanges += 1; if (failed) { day.failures += 1; failures += 1; }
      const latency = finite(trace.technicalExecutionMs);
      if (TEXT_CHANNELS.has(trace.channel)) { day.text += 1; if (latency != null && !failed) { day.textLatency.push(latency); textLatency.push(latency); } }
      else if (VOICE_CHANNELS.has(trace.channel)) { day.voice += 1; const audio = finite(trace.voice?.firstAudioMs); if (audio != null) firstAudio.push(audio); }
      else day.background += 1;
      const cost = finite(trace.costs?.total) || 0;
      day.tracedCostUSD += cost;
      const key = String(trace.channel || "autre");
      byFunction[key] = { executions: (byFunction[key]?.executions || 0) + 1, costUSD: (byFunction[key]?.costUSD || 0) + cost };
    }

    const days_ = dates.map((date) => {
      const day = byDay.get(date);
      return {
        date, exchanges: day.exchanges, text: day.text, voice: day.voice, background: day.background, failures: day.failures,
        successRate: day.exchanges ? round(1 - day.failures / day.exchanges, 3) : null,
        textP50Ms: percentile(day.textLatency, 0.5),
        costUSD: usage.dailyCostSince && date >= usage.dailyCostSince ? round(dailyCost[date] || 0, 4) : null,
        tracedCostUSD: round(day.tracedCostUSD, 4),
      };
    });
    const textP50 = percentile(textLatency, 0.5);
    const voiceP50 = percentile(firstAudio, 0.5);
    const todayCost = days_.at(-1).costUSD;
    let brief;
    try { brief = briefUsage ? briefUsage() : null; } catch { brief = null; }

    return {
      generatedAt: new Date(now()).toISOString(), days: span,
      totals: {
        exchanges: traces.length, failures, successRate: traces.length ? round(1 - failures / traces.length, 3) : null,
        textP50Ms: textP50, textP95Ms: percentile(textLatency, 0.95), voiceFirstAudioP50Ms: voiceP50,
      },
      budgets: {
        textResponse: budgetCheck(textP50, limits.textResponseMs),
        voiceFirstAudio: budgetCheck(voiceP50, limits.voiceFirstAudioMs),
        dailyCost: budgetCheck(todayCost, limits.dailyCostUSD),
      },
      month: { month: usage.month || null, costUSD: round(finite(usage.costUSD), 2), budgetUSD: finite(usage.monthlyBudgetUSD), remainingUSD: round(finite(usage.remainingUSD), 2), mode: usage.mode || null, requests: finite(usage.requests) },
      byDay: days_,
      byFunction: Object.fromEntries(Object.entries(byFunction).map(([key, value]) => [key, { executions: value.executions, costUSD: round(value.costUSD, 4) }])),
      brief: brief ? { days: brief.days ?? null, generated: brief.generated ?? null, onTime: brief.onTime ?? null, opened: brief.opened ?? null, openedStreak: brief.openedStreak ?? null } : null,
      // G.1 « taux de correction par toi » : aucun signal fiable pour l'instant.
      notMeasured: ["correctionRate"],
    };
  }

  return Object.freeze({ report, budgets: () => ({ ...limits }) });
}

module.exports = { DEFAULT_BUDGETS, createNoonHealthReport, percentile, withDailyCost };
