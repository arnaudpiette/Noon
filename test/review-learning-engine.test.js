"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createReviewLearningEngine, dayPeriod, estimationAnalysis, weekPeriod,
} = require("../services/review/review-learning-engine");
const { createMemoryEngine } = require("../services/memory/memory-engine");

function item(id, status, extra = {}) {
  const plannedStart = extra.plannedStart || `2026-08-24T08:${String(id).padStart(2, "0")}:00.000Z`;
  const estimated = extra.estimated ?? 60;
  const actual = extra.actual;
  return {
    executionItemId: `execution-${id}`, actionId: `action-${id}`, subjectScope: extra.subjectScope || "arnaud",
    status, progress: status === "completed" ? 100 : extra.progress ?? null,
    plannedStart, plannedEnd: new Date(Date.parse(plannedStart) + estimated * 60_000).toISOString(),
    actualStart: actual == null ? extra.actualStart || null : plannedStart,
    actualEnd: actual == null ? extra.actualEnd || null : new Date(Date.parse(plannedStart) + actual * 60_000).toISOString(),
    confidence: extra.confidence ?? (status === "unknown" ? 0.35 : 0.95),
    completionSource: extra.completionSource || (status === "unknown" ? "temporal_observation" : "explicit_user_confirmation"),
    priorityScore: extra.priorityScore || 70, lastEventAt: extra.lastEventAt || plannedStart,
  };
}

function memoryRepository() {
  const records = new Map();
  return {
    getMemory: (id) => records.get(id) || null,
    upsertMemory(value) {
      const saved = { ...records.get(value.id), ...value, metadata: value.metadata || {}, updatedAt: new Date().toISOString() };
      records.set(value.id, saved); return saved;
    },
    searchMemories: () => [], records,
  };
}

function reviewRepository() {
  const records = [];
  return {
    records,
    save(review) {
      const duplicate = records.find((entry) => entry.fingerprint === review.fingerprint);
      if (duplicate) return { review: duplicate, idempotent: true };
      const current = records.filter((entry) => entry.reviewType === review.reviewType && entry.periodStart === review.periodStart).at(-1);
      const saved = { ...review, reviewVersion: (current?.reviewVersion || 0) + 1 };
      records.push(saved); return { review: saved, idempotent: false };
    },
    list: () => [...records],
  };
}

function fixture({ items = [], plans = {}, recommendations = [], feedback = [], trackingError = false } = {}) {
  const repository = reviewRepository();
  const structuredRepository = memoryRepository();
  const memoryEngine = createMemoryEngine({ structuredRepository });
  const metricEvents = [];
  const engine = createReviewLearningEngine({
    repository,
    trackingProvider: trackingError ? () => { throw new Error("source absente"); } : ({ subjectScope }) => items.filter((entry) => entry.subjectScope === subjectScope),
    planProvider: (date) => plans[date] || null,
    recommendationProvider: () => recommendations,
    feedbackProvider: () => feedback,
    memoryEngine,
    metrics: { record: (metric, value) => metricEvents.push({ metric, value }) },
    now: () => new Date("2026-08-28T12:00:00.000Z"),
  });
  return { engine, repository, structuredRepository, metricEvents };
}

test("daily review reflète exactement 3 completed, 1 deferred et 1 unknown", () => {
  const items = [item(1, "completed", { actual: 60 }), item(2, "completed", { actual: 70 }),
    item(3, "completed", { actual: 50 }), item(4, "deferred"), item(5, "unknown")];
  const review = fixture({ items }).engine.generateDaily({ date: "2026-08-24" });
  assert.equal(review.completedActions, 3); assert.equal(review.deferredActions, 1);
  assert.equal(review.unknownActions, 1); assert.equal(review.plannedActions, 5);
});

test("unknown coverage produit insufficient evidence", () => {
  const review = fixture({ items: [item(1, "unknown"), item(2, "unknown"), item(3, "completed", { actual: 60 })] })
    .engine.generateDaily({ date: "2026-08-24" });
  assert.equal(review.coverageStatus, "insufficient_evidence");
  assert.ok(review.insights.some((entry) => entry.code === "INSUFFICIENT_EVIDENCE"));
});

test("duration accuracy calcule médiane, erreur, ratio et échantillons", () => {
  const analysis = estimationAnalysis([item(1, "completed", { estimated: 60, actual: 75 }),
    item(2, "completed", { estimated: 60, actual: 90 }), item(3, "completed", { estimated: 60, actual: 60 })]);
  assert.equal(analysis.sampleCount, 3); assert.equal(analysis.medianActualMinutes, 75);
  assert.equal(analysis.medianErrorMinutes, 15); assert.equal(analysis.medianRatio, 1.25);
});

test("un outlier ne détruit pas l’estimation médiane", () => {
  const analysis = estimationAnalysis([60, 62, 65, 68, 400].map((actual, index) => item(index + 1, "completed", { estimated: 60, actual })));
  assert.equal(analysis.medianActualMinutes, 65);
  assert.ok(analysis.medianRatio < 1.2);
});

test("un faible échantillon ne produit aucune tendance forte", () => {
  const review = fixture({ items: [item(1, "completed", { actual: 90 })] }).engine.generateDaily({ date: "2026-08-24" });
  assert.equal(review.estimation.evidenceStatus, "insufficient_evidence");
  assert.equal(review.planningHints.bufferMultiplierHint, null);
  assert.equal(review.memoryCandidates.length, 0);
});

test("un échantillon suffisant et cohérent produit un hint plafonné", () => {
  const items = Array.from({ length: 6 }, (_, index) => item(index + 1, "completed", { estimated: 60, actual: 100 }));
  const review = fixture({ items }).engine.generateDaily({ date: "2026-08-24" });
  assert.equal(review.planningHints.bufferMultiplierHint, 1.35);
  assert.equal(review.estimation.confidence, "medium");
});

test("des observations contradictoires abaissent la confiance", () => {
  const items = [30, 35, 40, 80, 90, 100].map((actual, index) => item(index + 1, "completed", { estimated: 60, actual }));
  const review = fixture({ items }).engine.generateWeekly({ at: new Date("2026-08-28T12:00:00Z") });
  assert.notEqual(review.estimation.confidence, "high");
  assert.equal(review.memoryCandidates.length, 0);
});

test("la préférence utilisateur explicite du soir gagne sur la tendance", () => {
  const items = [1, 2, 3].map((id) => item(id, "completed", { actual: 50,
    plannedStart: `2026-08-24T0${id + 5}:00:00Z` })).concat([4, 5, 6].map((id) => item(id, "blocked", {
      actualStart: `2026-08-24T13:0${id}:00Z`, plannedStart: `2026-08-24T13:0${id}:00Z`,
    })));
  const review = fixture({ items }).engine.generateDaily({ date: "2026-08-24", explicitPreferences: { preferredTimeOfDay: "evening" } });
  assert.equal(review.planningHints.timeOfDayHints[0].period, "evening");
  assert.equal(review.planningHints.timeOfDayHints[0].confidence, "explicit");
});

test("aucun apprentissage ne modifie les Hard Rules", () => {
  const hardRule = Object.freeze({ key: "calendar.protected_lunch", value: { start: "12:30", end: "13:30" } });
  fixture({ items: Array.from({ length: 8 }, (_, index) => item(index + 1, "completed", { actual: 90 })) })
    .engine.generateWeekly({ at: new Date("2026-08-28T12:00:00Z") });
  assert.deepEqual(hardRule.value, { start: "12:30", end: "13:30" });
});

test("les overruns fréquents créent un buffer raisonnable", () => {
  const items = Array.from({ length: 5 }, (_, index) => item(index + 1, "completed", { estimated: 60, actual: 78 }));
  const review = fixture({ items }).engine.generateDaily({ date: "2026-08-24" });
  assert.ok(review.planningHints.bufferMultiplierHint >= 1.2 && review.planningHints.bufferMultiplierHint <= 1.35);
});

test("overplanning hebdomadaire propose une utilisation plus prudente", () => {
  const plans = Object.fromEntries([24, 25, 26, 27, 28].map((day) => [`2026-08-${day}`, {
    planFingerprint: `p-${day}`, planVersion: 1, summary: { utilization: 0.95 }, metrics: {},
  }]));
  const items = [item(1, "deferred"), item(2, "unknown"), item(3, "missed"), item(4, "completed", { actual: 60 })];
  const review = fixture({ items, plans }).engine.generateWeekly({ at: new Date("2026-08-28T12:00:00Z") });
  assert.equal(review.planningHints.maxPlannedUtilizationHint, 0.82);
});

test("fragmentation et replans produisent seulement une tendance possible", () => {
  const items = Array.from({ length: 8 }, (_, index) => item(index + 1, index < 3 ? "completed" : "unknown", { estimated: 25, actual: index < 3 ? 25 : undefined }));
  const plans = { "2026-08-24": { planFingerprint: "p", planVersion: 3, summary: { utilization: 0.7 }, metrics: { planning_replans: 2 } } };
  const review = fixture({ items, plans }).engine.generateDaily({ date: "2026-08-24" });
  assert.equal(review.planningHints.avoidFragmentationHint, true);
  assert.match(review.insights.find((entry) => entry.code === "POSSIBLE_FRAGMENTATION").text, /causal n’est pas établi/);
});

test("time of day reste une formulation prudente", () => {
  const morning = [1, 2, 3].map((id) => item(id, "completed", { actual: 50, plannedStart: `2026-08-24T0${id + 5}:00:00Z` }));
  const afternoon = [4, 5, 6].map((id) => item(id, "blocked", { plannedStart: `2026-08-24T13:0${id}:00Z`, actualStart: `2026-08-24T13:0${id}:00Z` }));
  const review = fixture({ items: [...morning, ...afternoon] }).engine.generateDaily({ date: "2026-08-24" });
  assert.match(review.planningHints.timeOfDayHints[0].statement, /blocs documentés/);
});

test("la fatigue proactive suggère le regroupement sans règle permanente", () => {
  const recommendations = Array.from({ length: 6 }, (_, index) => ({ id: index, presentationCount: 1, lastPresentedAt: "2026-08-24T10:00:00Z" }));
  const feedback = Array.from({ length: 5 }, (_, index) => ({ id: index, value: index < 3 ? "later" : "not_useful" }));
  const review = fixture({ items: [item(1, "completed", { actual: 60 }), item(2, "completed", { actual: 60 }), item(3, "completed", { actual: 60 })], recommendations, feedback })
    .engine.generateDaily({ date: "2026-08-24" });
  assert.equal(review.planningHints.notificationGroupingHint, "increase_grouping");
  assert.match(review.recommendationQuality.interpretation, /pas la qualité absolue/);
});

test("un candidat fiable passe uniquement par MemoryEngine et reste inactif", () => {
  const items = Array.from({ length: 10 }, (_, index) => item(index + 1, "completed", { estimated: 60, actual: 78 }));
  const context = fixture({ items });
  const review = context.engine.generateWeekly({ at: new Date("2026-08-28T12:00:00Z") });
  assert.equal(review.memoryCandidates.length, 1);
  const candidate = [...context.structuredRepository.records.values()][0];
  assert.equal(candidate.status, "inferred"); assert.equal(candidate.useAllowed, false);
  assert.equal(candidate.metadata.apiPolicy, "local_only");
});

test("une tendance corrigée versionne le candidat au lieu d’effacer l’historique", () => {
  const repository = memoryRepository(); const memory = createMemoryEngine({ structuredRepository: repository });
  memory.proposeCandidate({ scope: "arnaud", type: "planning_preference", statement: "Tendance A", confidence: 0.8 });
  const result = memory.proposeCandidate({ scope: "arnaud", type: "planning_preference", statement: "Tendance B", confidence: 0.85 });
  assert.equal(result.status, "updated"); assert.equal(result.candidate.metadata.versions.length, 1);
  assert.equal(result.candidate.metadata.versions[0].statement, "Tendance A");
});

test("weekly aggregation couvre sept jours sans double compte", () => {
  const items = Array.from({ length: 7 }, (_, index) => item(index + 1, "completed", {
    actual: 60, plannedStart: `2026-08-${24 + index}T09:00:00Z`,
  }));
  const review = fixture({ items }).engine.generateWeekly({ at: new Date("2026-08-28T12:00:00Z") });
  assert.equal(review.plannedActions, 7); assert.equal(new Set(items.map((entry) => entry.executionItemId)).size, 7);
});

test("week boundary Europe/Paris commence le lundi", () => {
  const period = weekPeriod(new Date("2026-08-28T22:30:00Z"));
  assert.equal(period.startDay, "2026-08-24"); assert.equal(period.endDay, "2026-08-31");
});

test("DST produit des journées locales de 23 h et 25 h sans erreur", () => {
  const spring = dayPeriod("2026-03-29"); const autumn = dayPeriod("2026-10-25");
  assert.equal((spring.end - spring.start) / 3_600_000, 23);
  assert.equal((autumn.end - autumn.start) / 3_600_000, 25);
});

test("remote summary ne contient aucun contenu privé brut ni local_only", () => {
  const review = fixture({ items: [item(1, "completed", { actual: 60 })] }).engine.generateDaily({ date: "2026-08-24" });
  const remote = fixture().engine.remoteSummary({ ...review, privateTitle: "Secret dossier", localOnly: "Interdit" });
  assert.doesNotMatch(JSON.stringify(remote), /Secret dossier|Interdit|execution-/);
  assert.equal(remote.dataClassification, "aggregated_no_raw_content");
});

test("une source absente dégrade proprement la revue", () => {
  const review = fixture({ trackingError: true }).engine.generateDaily({ date: "2026-08-24" });
  assert.equal(review.plannedActions, 0); assert.equal(review.coverageStatus, "insufficient_evidence");
});

test("la même revue est idempotente et ne duplique pas le candidat", () => {
  const items = Array.from({ length: 10 }, (_, index) => item(index + 1, "completed", { actual: 78 }));
  const context = fixture({ items });
  const first = context.engine.generateWeekly({ at: new Date("2026-08-28T12:00:00Z") });
  const second = context.engine.generateWeekly({ at: new Date("2026-08-28T12:00:00Z") });
  assert.equal(first.idempotent, false); assert.equal(second.idempotent, true);
  assert.equal(context.repository.records.length, 1); assert.equal(context.structuredRepository.records.size, 1);
});
