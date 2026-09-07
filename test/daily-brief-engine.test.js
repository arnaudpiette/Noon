"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createDailyBriefEngine } = require("../services/daily-brief/daily-brief-engine");

function fixture({ compose, collect, creativeProvider, schedule, proactiveEngine, trackingProvider, reviewProvider } = {}) {
  let state = { status: "idle", briefs: [], lastSuccessDate: null };
  const counts = { collect: 0, compose: 0, priority: 0, context: 0 };
  const store = {
    load: () => state,
    markGenerating: () => { state = { ...state, status: "generating" }; },
    markReady: (brief) => { state = { ...state, status: "ready", briefs: [brief], lastSuccessDate: brief.date }; },
    markError: (error) => { state = { ...state, status: "error", error: error.message }; },
  };
  const defaultCollect = async () => ({
    occurrenceKey: "morning-brief:2026-08-28:Europe/Paris",
    sources: [
      { id: "gmail", status: "unavailable" },
      { id: "calendar", status: "ready" },
    ],
    actions: [
      { id: "reminder:1", title: "Préparer le dossier", sourceType: "reminder" },
      { id: "note:1", title: "Préparer le dossier", sourceType: "note" },
    ],
    calendarEvents: [
      { id: "today", start: "2026-08-28T10:00:00Z" },
      { id: "tomorrow", title: "Présentation importante", start: "2026-08-29T08:00:00Z" },
    ],
    emails: [], reminders: [{ id: "1" }], notes: [{ id: "1" }],
    scheduledBlocks: [{ actionId: "reminder:1", title: "Préparer le dossier", status: "proposed", start: "2026-08-28T08:00:00Z", end: "2026-08-28T08:30:00Z" }],
    drafts: [],
  });
  const engine = createDailyBriefEngine({
    store,
    collect: async (...args) => { counts.collect += 1; return (collect || defaultCollect)(...args); },
    contextBuilder: { buildContext(input) { counts.context += 1; return { remoteModelContext: {}, metadata: { purpose: input.purpose } }; } },
    priorityEngine: {
      scoringVersion: 1,
      rank(actions) {
        counts.priority += 1;
        return [{ ...actions[0], score: 81, priorityLevel: "critique", reasons: ["échéance proche"], scoringVersion: 1 }];
      },
    },
    proactiveEngine,
    schedule,
    trackingProvider,
    reviewProvider,
    compose: async (input) => { counts.compose += 1; return compose ? compose(input) : { content: "Brief global", modelCalls: 1, models: ["gpt-5.6-terra"] }; },
    projectProvider: () => [{ id: "project-1", title: "Projet actif" }],
    creativeProvider: creativeProvider || (() => [{ title: "Signal design" }]),
    now: () => Date.parse("2026-08-28T09:00:00Z"),
  });
  return { engine, counts, getState: () => state };
}

test("une journée produit un seul Daily Brief logique", async () => {
  const { engine, counts } = fixture();
  const first = await engine.generate({ at: new Date("2026-08-28T07:00:00Z") });
  const second = await engine.generate({ at: new Date("2026-08-28T09:00:00Z") });
  assert.equal(first.id, "brief_2026-08-28");
  assert.equal(second.id, first.id);
  assert.equal(counts.collect, 1);
  assert.equal(counts.compose, 1);
});

test("deux déclenchements concurrents partagent la même exécution", async () => {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const { engine, counts } = fixture({ collect: async () => { await wait; return { sources: [], actions: [], calendarEvents: [] }; } });
  const first = engine.generate({ at: new Date("2026-08-28T07:00:00Z") });
  const second = engine.generate({ at: new Date("2026-08-28T07:05:00Z") });
  release();
  assert.equal(await first, await second);
  assert.equal(counts.collect, 1);
});

test("une source indisponible n'empêche pas le brief global", async () => {
  const { engine } = fixture();
  const brief = await engine.generate({ at: new Date("2026-08-28T09:00:00Z") });
  assert.equal(brief.sourceStatus.gmail, "unavailable");
  assert.equal(brief.content, "Brief global");
});

test("toutes les actions passent une seule fois par le Priority Engine", async () => {
  const { engine, counts } = fixture();
  const brief = await engine.generate({ at: new Date("2026-08-28T09:00:00Z") });
  assert.equal(counts.priority, 1);
  assert.equal(brief.metadata.priorityVersion, 1);
  assert.deepEqual(brief.metadata.actionIds, ["reminder:1"]);
});

test("le créatif et demain sont des sections du même objet", async () => {
  const { engine } = fixture();
  const brief = await engine.generate({ at: new Date("2026-08-28T07:00:00Z") });
  assert.equal(brief.creative[0].title, "Signal design");
  assert.equal(brief.tomorrow[0].id, "tomorrow");
  assert.equal(brief.title, "Brief Noon — 2026-08-28");
});

test("un échec du modèle produit un brief déterministe dégradé", async () => {
  const { engine, getState } = fixture({ compose: async () => { throw Object.assign(new Error("Réseau absent"), { code: "NETWORK" }); } });
  const brief = await engine.generate({ at: new Date("2026-08-28T09:00:00Z") });
  assert.equal(brief.metadata.degraded, true);
  assert.match(brief.content, /ACTIONS PRIORITAIRES/);
  assert.equal(getState().status, "ready");
});

test("le moteur expose les métriques sans contenu privé", async () => {
  const { engine, counts } = fixture();
  const brief = await engine.generate({ at: new Date("2026-08-28T09:00:00Z") });
  assert.equal(brief.metrics.modelCalls, 1);
  assert.equal(brief.metrics.actions_extracted, 2);
  assert.equal(brief.metrics.slots_proposed, 1);
  assert.equal(counts.context, 1);
  assert.equal(brief.metadata.context.purpose, "daily_brief");
});

test("le Daily Brief expose exactement le Daily Plan central", async () => {
  const centralPlan = {
    planId: "plan-central", planVersion: 2,
    plannedBlocks: [], proposedBlocks: [{ actionId: "reminder:1", title: "Préparer", status: "proposed", start: "2026-08-28T08:00:00Z", end: "2026-08-28T08:30:00Z" }],
    unscheduledActions: [{ actionId: "later", reasonCode: "LOWER_PRIORITY" }],
    summary: { availableMinutes: 300, plannedMinutes: 30, bufferMinutes: 270 },
  };
  const { engine } = fixture({
    schedule: async () => ({ plan: centralPlan, blocks: centralPlan.proposedBlocks }),
  });
  const brief = await engine.generate({ at: new Date("2026-08-28T07:00:00Z") });
  assert.equal(brief.dailyPlan.planId, "plan-central");
  assert.deepEqual(brief.scheduledBlocks, centralPlan.proposedBlocks);
  assert.equal(brief.dailyPlan.unscheduledActions[0].reasonCode, "LOWER_PRIORITY");
});

test("le Daily Brief intègre carry-over, blockers et deferred sans les inventer", async () => {
  const { engine } = fixture({
    trackingProvider: () => ({
      carryOver: [{ actionId: "carry-1", dueAt: "2026-08-28T18:00:00Z", remainingDurationMinutes: 30, priorityScore: 70, confidence: 1, status: "unknown" }],
      blockers: [{ actionId: "blocked-1" }],
      deferred: [{ actionId: "deferred-1" }],
    }),
  });
  const brief = await engine.generate({ at: new Date("2026-08-28T07:00:00Z") });
  assert.deepEqual(brief.executionTracking, { carryOverCount: 1, blockerCount: 1, deferredCount: 1 });
  assert.equal(brief.metrics.actions_extracted, 3);
});

test("le Daily Brief consomme la revue centrale sans créer un second pipeline", async () => {
  const { engine } = fixture({ reviewProvider: () => ({
    reviewType: "weekly", summary: "Marge utile détectée.", coverageStatus: "high",
    planningHints: { bufferMultiplierHint: 1.2 }, insights: [{ code: "ESTIMATION_OVERRUN" }],
  }) });
  const brief = await engine.generate({ at: new Date("2026-08-31T07:00:00Z") });
  assert.equal(brief.reviewLearning.reviewType, "weekly");
  assert.equal(brief.reviewLearning.planningHints.bufferMultiplierHint, 1.2);
});

test("startup catch-up after 07:00 preserves same-day brief across engine restart", async () => {
  const { engine, getState, counts } = fixture();
  const at = new Date('2026-08-28T09:28:54.785Z');
  const brief = await engine.generate({ at });
  const generatedAt = brief.generatedAt;
  const restarted = createDailyBriefEngine({
    store: { load: getState, markReady() { assert.fail('duplicate brief'); } },
    collect() { assert.fail('same-day collection must not restart'); },
    contextBuilder: { buildContext() { assert.fail('duplicate context'); } },
    priorityEngine: { rank() { assert.fail('duplicate ranking'); } },
  });
  assert.equal(await restarted.generate({ at: new Date('2026-08-28T12:00:00Z') }), brief);
  assert.equal(getState().briefs.length, 1);
  assert.equal(getState().briefs[0].generatedAt, generatedAt);
  assert.equal(counts.compose, 1);
});
