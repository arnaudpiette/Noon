"use strict";

const crypto = require("crypto");

const TIME_ZONE = "Europe/Paris";
const RELIABLE_SOURCES = new Set([
  "explicit_user_confirmation", "reminder_completed", "tool_result", "project_status",
]);

function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function median(values = []) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function mean(values = []) {
  const safe = values.filter(Number.isFinite);
  return safe.length ? safe.reduce((sum, value) => sum + value, 0) / safe.length : null;
}
function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function dateKey(value, timeZone = TIME_ZONE) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(value instanceof Date ? value : new Date(value));
}
function zoneOffsetMs(date, timeZone = TIME_ZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - date.getTime();
}
function localMidnightUtc(day, timeZone = TIME_ZONE) {
  const [year, month, date] = day.split("-").map(Number);
  const guess = new Date(Date.UTC(year, month - 1, date));
  let result = new Date(guess.getTime() - zoneOffsetMs(guess, timeZone));
  result = new Date(guess.getTime() - zoneOffsetMs(result, timeZone));
  return result;
}
function addLocalDays(day, count) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + count)).toISOString().slice(0, 10);
}
function dayPeriod(day, timeZone = TIME_ZONE) {
  return { start: localMidnightUtc(day, timeZone), end: localMidnightUtc(addLocalDays(day, 1), timeZone) };
}
function weekPeriod(value, timeZone = TIME_ZONE) {
  const current = dateKey(value, timeZone);
  const noon = new Date(`${current}T12:00:00Z`);
  const weekday = Number(new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" })
    .formatToParts(noon).find((part) => part.type === "weekday")?.value
    ?.replace(/Mon/, "1").replace(/Tue/, "2").replace(/Wed/, "3")
    .replace(/Thu/, "4").replace(/Fri/, "5").replace(/Sat/, "6").replace(/Sun/, "7")) || 1;
  const startDay = addLocalDays(current, -(weekday - 1));
  return { startDay, endDay: addLocalDays(startDay, 7), ...dayPeriod(startDay, timeZone), end: localMidnightUtc(addLocalDays(startDay, 7), timeZone) };
}
function plannedMinutes(item) {
  const start = Date.parse(item.plannedStart); const end = Date.parse(item.plannedEnd);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, (end - start) / 60_000) : null;
}
function actualMinutes(item) {
  const start = Date.parse(item.actualStart); const end = Date.parse(item.actualEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  if (Number(item.confidence) < 0.8 || !RELIABLE_SOURCES.has(item.completionSource)) return null;
  return (end - start) / 60_000;
}
function reliability(item) {
  if (["unknown", "planned"].includes(item.status)) return "unknown";
  if (Number(item.confidence) >= 0.8 && RELIABLE_SOURCES.has(item.completionSource)) return "confirmed";
  if (Number(item.confidence) >= 0.65) return "observed";
  return "inferred";
}
function timeBucket(iso, timeZone = TIME_ZONE) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));
  return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}
function estimationAnalysis(items) {
  const samples = items.map((item) => {
    const estimated = plannedMinutes(item); const actual = actualMinutes(item);
    return estimated > 0 && actual != null ? {
      estimated, actual, absoluteError: Math.abs(actual - estimated),
      relativeError: Math.abs(actual - estimated) / estimated, ratio: actual / estimated,
    } : null;
  }).filter(Boolean);
  const ratios = samples.map((sample) => sample.ratio);
  const errors = samples.map((sample) => sample.actual - sample.estimated);
  const sameDirection = ratios.length
    ? Math.max(ratios.filter((ratio) => ratio > 1.1).length, ratios.filter((ratio) => ratio < 0.9).length) / ratios.length : 0;
  return {
    sampleCount: samples.length,
    estimatedMinutes: samples.reduce((sum, sample) => sum + sample.estimated, 0),
    actualMinutes: samples.reduce((sum, sample) => sum + sample.actual, 0),
    medianEstimatedMinutes: median(samples.map((sample) => sample.estimated)),
    medianActualMinutes: median(samples.map((sample) => sample.actual)),
    medianErrorMinutes: median(errors), meanErrorMinutes: mean(errors),
    medianAbsoluteErrorMinutes: median(samples.map((sample) => sample.absoluteError)),
    medianRelativeError: median(samples.map((sample) => sample.relativeError)),
    medianRatio: median(ratios), consistency: sameDirection,
    confidence: samples.length >= 8 && sameDirection >= 0.75 ? "high" : samples.length >= 5 ? "medium" : "low",
    evidenceStatus: samples.length >= 5 ? "sufficient" : "insufficient_evidence",
  };
}
function recommendationAnalysis(entries = [], feedback = []) {
  const surfaced = entries.filter((item) => Number(item.presentationCount) > 0 || item.lastPresentedAt).length;
  const counts = { accepted: 0, rejected: 0, snoozed: 0, ignored: 0 };
  for (const item of feedback) {
    if (item.value === "useful") counts.accepted += 1;
    else if (item.value === "later") counts.snoozed += 1;
    else if (["not_useful", "dont_remind"].includes(item.value)) counts.rejected += 1;
    else counts.ignored += 1;
  }
  return { surfaced, ...counts,
    acceptanceRate: surfaced ? counts.accepted / surfaced : null,
    negativeOrSnoozedRate: surfaced ? (counts.rejected + counts.snoozed + counts.ignored) / surfaced : null,
    interpretation: "L’acceptation mesure une réaction, pas la qualité absolue de la recommandation." };
}

function createReviewLearningEngine({
  repository, trackingProvider, planProvider = () => null,
  recommendationProvider = () => [], feedbackProvider = () => [],
  memoryEngine = null, proactiveEngine = null, metrics = null, audit = null,
  now = () => new Date(), timeZone = TIME_ZONE,
} = {}) {
  if (!repository?.save) throw new TypeError("Dépôt Review requis.");
  if (typeof trackingProvider !== "function") throw new TypeError("Source Execution Tracking requise.");

  function build({ reviewType, periodStart, periodEnd, subjectScope, items, plans, recommendations, feedback, explicitPreferences = {} }) {
    const known = items.filter((item) => ["confirmed", "observed"].includes(reliability(item)));
    const counts = Object.fromEntries(["planned", "in_progress", "completed", "missed", "delayed", "blocked", "cancelled", "deferred", "unknown"]
      .map((status) => [status, items.filter((item) => item.status === status).length]));
    const partialActions = items.filter((item) => item.status === "in_progress" || (item.progress > 0 && item.progress < 100)).length;
    const coverage = items.length ? known.length / items.length : 0;
    const estimation = estimationAnalysis(items);
    const replans = plans.reduce((sum, plan) => sum + Number(plan?.metrics?.planning_replans || 0), 0);
    const moved = plans.reduce((sum, plan) => sum + Number(plan?.metrics?.planning_moved_blocks || 0), 0);
    const stabilityValues = plans.map((plan) => Number(plan?.metrics?.planning_stability_rate)).filter(Number.isFinite);
    const carryOver = items.filter((item) => ["deferred", "missed", "unknown"].includes(item.status)).length;
    const smallBlocks = items.filter((item) => (plannedMinutes(item) || Infinity) <= 30).length;
    const incomplete = items.filter((item) => !["completed", "cancelled"].includes(item.status)).length;
    const recommendationQuality = recommendationAnalysis(recommendations, feedback);
    const utilization = plans.map((plan) => Number(plan?.summary?.utilization)).filter(Number.isFinite);
    const saturatedDays = utilization.filter((value) => value >= 0.9).length;
    const hints = {
      bufferMultiplierHint: null, preferredBlockMinutesHint: null,
      avoidFragmentationHint: false, maxPlannedUtilizationHint: null,
      timeOfDayHints: [], notificationGroupingHint: null,
    };
    const insights = [];
    const runtimeAdjustments = [];
    const memoryCandidates = [];
    if (coverage < 0.6 || items.length < 3) {
      insights.push({ code: "INSUFFICIENT_EVIDENCE", confidence: "low",
        text: "Les états connus sont insuffisants pour tirer une tendance fiable." });
    }
    if (estimation.sampleCount >= 3 && estimation.medianRatio > 1.1) {
      hints.bufferMultiplierHint = Number(clamp(estimation.medianRatio, 1.05, 1.35).toFixed(2));
      hints.preferredBlockMinutesHint = Math.round(clamp(estimation.medianActualMinutes, 30, 120) / 5) * 5;
      runtimeAdjustments.push({ type: "temporary_buffer", value: hints.bufferMultiplierHint,
        reversible: true, expiresAt: new Date(Date.parse(periodEnd) + 7 * 86_400_000).toISOString() });
      insights.push({ code: "ESTIMATION_OVERRUN", confidence: estimation.confidence,
        text: `${estimation.sampleCount} durées fiables suggèrent une marge légèrement supérieure.` });
    }
    if (items.length >= 6 && smallBlocks / items.length >= 0.6 && incomplete / items.length >= 0.3 && replans >= 2) {
      hints.avoidFragmentationHint = true;
      insights.push({ code: "POSSIBLE_FRAGMENTATION", confidence: "medium",
        text: "La fragmentation et les reprises apparaissent ensemble ; un lien causal n’est pas établi." });
    }
    if (reviewType === "weekly" && saturatedDays >= 3 && carryOver >= 3) {
      hints.maxPlannedUtilizationHint = 0.82;
      insights.push({ code: "POSSIBLE_OVERPLANNING", confidence: "medium",
        text: "Plusieurs journées très chargées ont aussi produit du report ; une charge plus prudente peut être testée." });
    }
    if (recommendationQuality.surfaced >= 5 && recommendationQuality.negativeOrSnoozedRate >= 0.6) {
      hints.notificationGroupingHint = "increase_grouping";
      insights.push({ code: "POSSIBLE_NOTIFICATION_FATIGUE", confidence: "medium",
        text: "Plusieurs recommandations ont été ignorées, refusées ou reportées ; leur regroupement peut être testé." });
    }
    const buckets = new Map();
    for (const item of items.filter((entry) => entry.actualStart && ["confirmed", "observed"].includes(reliability(entry)))) {
      const bucket = timeBucket(item.actualStart, timeZone);
      const values = buckets.get(bucket) || { total: 0, completed: 0, overruns: 0 };
      values.total += 1; values.completed += item.status === "completed" ? 1 : 0;
      values.overruns += actualMinutes(item) > plannedMinutes(item) ? 1 : 0; buckets.set(bucket, values);
    }
    const reliableBuckets = [...buckets.entries()].filter(([, value]) => value.total >= 3);
    if (reliableBuckets.length >= 2) {
      reliableBuckets.sort((left, right) => (right[1].completed / right[1].total) - (left[1].completed / left[1].total));
      const best = reliableBuckets[0]; const worst = reliableBuckets.at(-1);
      if (best[1].completed / best[1].total - worst[1].completed / worst[1].total >= 0.2) {
        hints.timeOfDayHints.push({ period: best[0], confidence: "medium",
          statement: `Les blocs documentés en période ${best[0]} ont été moins souvent déplacés ou laissés incomplets.` });
      }
    }
    if (explicitPreferences.preferredTimeOfDay) {
      hints.timeOfDayHints = [{ period: explicitPreferences.preferredTimeOfDay,
        confidence: "explicit", statement: "Préférence explicitement donnée par l’utilisateur." }];
    }
    if (reviewType === "weekly" && estimation.sampleCount >= 8 && estimation.consistency >= 0.75 && estimation.medianRatio > 1.1) {
      memoryCandidates.push({ type: "planning_preference", scope: subjectScope,
        statement: `Tendance observée : les durées réelles fiables dépassent l’estimation médiane d’un facteur ${estimation.medianRatio.toFixed(2)}.`,
        evidenceSummary: `${estimation.sampleCount} échantillons agrégés, sans contenu de tâche.`,
        sampleCount: estimation.sampleCount, confidence: Math.min(0.9, 0.55 + estimation.sampleCount / 50),
        observedFrom: periodStart, proposedAt: now().toISOString(), status: "candidate" });
    }
    const summary = coverage < 0.6
      ? `${items.length} bloc(s) examinés, mais seulement ${Math.round(coverage * 100)} % ont un état suffisamment fiable.`
      : `${counts.completed} action(s) terminée(s), ${counts.deferred} reportée(s) et ${counts.unknown} sans état fiable.`;
    const safeBasis = items.map((item) => [item.executionItemId, item.status, item.progress,
      item.confidence, item.completionSource, item.plannedStart, item.plannedEnd, item.actualStart, item.actualEnd]);
    return {
      reviewId: `review_${reviewType}_${fingerprint([subjectScope, periodStart, periodEnd]).slice(0, 20)}`,
      reviewType, subjectScope, periodStart, periodEnd, reviewVersion: 1,
      fingerprint: fingerprint({ reviewType, subjectScope, periodStart, periodEnd, safeBasis,
        plans: plans.map((plan) => [plan?.planFingerprint, plan?.planVersion]),
        feedback: feedback.map((item) => [item.id, item.value]) }),
      summary, plannedActions: items.length, completedActions: counts.completed,
      partialActions, deferredActions: counts.deferred, blockedActions: counts.blocked,
      unknownActions: counts.unknown, statusCounts: counts,
      knownExecutionCoverage: Number(coverage.toFixed(3)), coverageStatus: coverage >= 0.75 ? "high" : coverage >= 0.6 ? "medium" : "insufficient_evidence",
      estimatedMinutes: items.reduce((sum, item) => sum + (plannedMinutes(item) || 0), 0),
      actualMinutesKnown: estimation.actualMinutes, estimation,
      planningQuality: { replans, movedBlocks: moved, carryOver,
        stabilityRate: stabilityValues.length ? mean(stabilityValues) : null,
        saturatedDays, smallBlockRate: items.length ? smallBlocks / items.length : 0 },
      recommendationQuality, runtimeAdjustments, planningHints: hints,
      recommendations: insights.slice(0, 4), insights: insights.slice(0, 6), memoryCandidates,
      dataClassification: "local_aggregate", generatedAt: now().toISOString(),
    };
  }

  function itemsInPeriod(start, end, subjectScope) {
    let sourceItems = [];
    try { sourceItems = trackingProvider({ subjectScope }) || []; }
    catch (error) {
      audit?.("review.source-error", { source: "execution_tracking", code: String(error?.code || error?.name || "ERROR").slice(0, 80) });
    }
    return sourceItems.filter((item) => {
      const reference = Date.parse(item.plannedStart || item.actualStart || item.lastEventAt);
      return Number.isFinite(reference) && reference >= start.getTime() && reference < end.getTime();
    });
  }
  function persistAndLearn(review) {
    const saved = repository.save(review);
    if (!saved.idempotent) {
      if (review.planningHints.notificationGroupingHint) {
        proactiveEngine?.applyReviewHints?.(review.planningHints, {
          expiresAt: new Date(Date.parse(review.periodEnd) + 7 * 86_400_000).toISOString(),
        });
      }
      for (const candidate of review.memoryCandidates) memoryEngine?.proposeCandidate?.({
        ...candidate, sourceReference: review.reviewId,
        expiresAt: new Date(Date.parse(review.periodEnd) + 90 * 86_400_000).toISOString(),
      });
      metrics?.record(review.reviewType === "daily" ? "daily_reviews_generated" : "weekly_reviews_generated", 1);
      metrics?.record("review_data_coverage", review.knownExecutionCoverage);
      metrics?.record("review_insights_generated", review.insights.length);
      metrics?.record("review_memory_candidates", review.memoryCandidates.length);
      metrics?.record("review_adjustments_applied", review.runtimeAdjustments.length);
      metrics?.record("estimation_sample_count", review.estimation.sampleCount);
      if (review.estimation.medianErrorMinutes != null) metrics?.record("estimation_median_error", review.estimation.medianErrorMinutes);
      if (review.estimation.medianRatio != null) metrics?.record("estimation_median_ratio", review.estimation.medianRatio);
      metrics?.record("recommendations_surfaced", review.recommendationQuality.surfaced);
      metrics?.record("recommendations_accepted", review.recommendationQuality.accepted);
      metrics?.record("recommendations_rejected", review.recommendationQuality.rejected);
      metrics?.record("recommendations_snoozed", review.recommendationQuality.snoozed);
      if (review.reviewType === "weekly") {
        metrics?.record("weekly_planning_stability", review.planningQuality.stabilityRate || 0);
        metrics?.record("weekly_replans", review.planningQuality.replans);
        metrics?.record("weekly_carry_over", review.planningQuality.carryOver);
        metrics?.record("weekly_known_completion_rate", review.plannedActions ? review.completedActions / review.plannedActions : 0);
      }
      audit?.("review.generated", { reviewId: review.reviewId, reviewType: review.reviewType,
        subjectScope: review.subjectScope, coverage: review.knownExecutionCoverage,
        sampleCount: review.estimation.sampleCount, insightCount: review.insights.length });
    }
    return { ...saved.review, idempotent: saved.idempotent };
  }
  function generateDaily({ date = dateKey(now(), timeZone), subjectScope = "arnaud", explicitPreferences = {} } = {}) {
    const period = dayPeriod(date, timeZone);
    let plan = null; let recommendations = []; let feedback = [];
    try { plan = planProvider(date); } catch {}
    try { recommendations = recommendationProvider({ start: period.start, end: period.end, subjectScope }) || []; } catch {}
    try { feedback = feedbackProvider({ start: period.start, end: period.end, subjectScope }) || []; } catch {}
    const plans = [plan].filter(Boolean);
    return persistAndLearn(build({ reviewType: "daily", periodStart: period.start.toISOString(), periodEnd: period.end.toISOString(),
      subjectScope, items: itemsInPeriod(period.start, period.end, subjectScope), plans,
      recommendations, feedback, explicitPreferences }));
  }
  function generateWeekly({ at = now(), subjectScope = "arnaud", explicitPreferences = {} } = {}) {
    const period = weekPeriod(at, timeZone); const plans = [];
    for (let day = period.startDay; day < period.endDay; day = addLocalDays(day, 1)) {
      try { const plan = planProvider(day); if (plan) plans.push(plan); } catch {}
    }
    let recommendations = []; let feedback = [];
    try { recommendations = recommendationProvider({ start: period.start, end: period.end, subjectScope }) || []; } catch {}
    try { feedback = feedbackProvider({ start: period.start, end: period.end, subjectScope }) || []; } catch {}
    return persistAndLearn(build({ reviewType: "weekly", periodStart: period.start.toISOString(), periodEnd: period.end.toISOString(),
      subjectScope, items: itemsInPeriod(period.start, period.end, subjectScope), plans,
      recommendations, feedback, explicitPreferences }));
  }
  function remoteSummary(review) {
    return { reviewType: review.reviewType, periodStart: review.periodStart, periodEnd: review.periodEnd,
      summary: review.summary, knownExecutionCoverage: review.knownExecutionCoverage,
      statusCounts: review.statusCounts, estimation: review.estimation,
      planningQuality: review.planningQuality, planningHints: review.planningHints,
      insights: review.insights, dataClassification: "aggregated_no_raw_content" };
  }
  return { generateDaily, generateWeekly, list: repository.list, remoteSummary };
}

module.exports = { TIME_ZONE, actualMinutes, createReviewLearningEngine, dateKey, dayPeriod,
  estimationAnalysis, localMidnightUtc, median, recommendationAnalysis, reliability, weekPeriod };
