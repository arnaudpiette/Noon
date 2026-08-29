"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createPriorityEngine } = require("../services/personal-intelligence/priority-engine");
const { createDeduplicationService } = require("../services/personal-intelligence/deduplication-service");
const { createProactiveEngine } = require("../services/proactive/proactive-engine");
const { createSignalAdapters } = require("../services/proactive/signal-adapters");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createPersonalIntelligenceRepository } = require("../services/persistence/repositories/personal-intelligence-repository");

function fixture(at = new Date("2026-08-28T08:00:00.000Z"), options = {}) {
  const records = new Map();
  const feedbackEvents = [];
  const repository = {
    saveRecommendation(item) {
      const current = records.get(item.hash) || {};
      const value = { ...current, ...item, id: current.id || item.id || `r${records.size + 1}`,
        firstDetectedAt: current.firstDetectedAt || item.firstDetectedAt || at.toISOString(),
        presentationCount: current.presentationCount || 0 };
      records.set(item.hash, value); return value;
    },
    getRecommendationByHash: (hash) => records.get(hash) || null,
    listRecommendations: () => [...records.values()],
    updateRecommendation(hash, changes) { const value = { ...records.get(hash), ...changes }; records.set(hash, value); return value; },
    recordPresentation(hash, presentedAt) { const current = records.get(hash); records.set(hash, { ...current,
      lastPresentedAt: presentedAt, presentationCount: (current.presentationCount || 0) + 1 }); },
    recordFeedback(item) { feedbackEvents.push(item); },
  };
  const metrics = [];
  const engine = createProactiveEngine({
    priorityEngine: createPriorityEngine({ now: () => at }),
    deduplicationService: createDeduplicationService(repository), repository,
    metrics: { record: (...args) => metrics.push(args) }, now: () => at,
    hardRulesRegistry: { isProtectedCalendarTime: options.protectedBreak ? () => true : () => false },
    approvalEngine: options.approvalEngine,
    timeSlotService: options.timeSlotService,
    planningEngine: options.planningEngine,
    maxNotificationsPerDay: options.maxNotificationsPerDay ?? 3,
  });
  return { at, engine, repository, records, feedbackEvents, metrics };
}

function signal(adapters, overrides = {}) {
  return adapters.local([{ id: overrides.id || "task-1", title: "Livrer le dossier", action: "Finaliser le dossier",
    importance: 1, impact: 1, urgency: 1, confidence: 1, ...overrides }], { now: overrides.now })[0];
}

test("un rappel en retard devient une recommandation urgente", async () => {
  const { engine, at } = fixture();
  const item = engine.adapters.reminders([{ id: "late", title: "Dossier", dueAt: "2026-08-27T08:00:00Z",
    importance: 1, urgency: 1, impact: 1, confidence: 1 }], { now: at })[0];
  const result = await engine.evaluate([item], { at });
  assert.equal(result.recommendations[0].interruptionLevel, "URGENT_NOTIFY");
});

test("le même signal est supprimé pendant son cooldown", async () => {
  const { engine, at } = fixture();
  const item = signal(engine.adapters, { now: at });
  assert.equal((await engine.evaluate([item], { at })).recommendations.length, 1);
  assert.equal((await engine.evaluate([item], { at })).recommendations.length, 0);
});

test("une évolution matérielle réactive la recommandation", async () => {
  const { engine, at } = fixture();
  const first = signal(engine.adapters, { now: at, materialKey: "v1" });
  await engine.evaluate([first], { at });
  const changed = signal(engine.adapters, { now: at, materialKey: "v2", urgency: 1 });
  assert.equal((await engine.evaluate([changed], { at })).recommendations.length, 1);
});

test("la pause protégée reporte une suggestion non urgente au brief", async () => {
  const { engine, at } = fixture(undefined, { protectedBreak: true });
  const item = signal(engine.adapters, { now: at, importance: 0.7, impact: 0.7, urgency: 0.5 });
  const result = await engine.evaluate([item], { at });
  assert.equal(result.protectedBreak, true);
  assert.equal(result.recommendations[0].interruptionLevel, "STORE_FOR_BRIEF");
});

test("le Focus masque les interruptions sauf l’urgence", async () => {
  const { engine, at } = fixture();
  const ordinary = signal(engine.adapters, { now: at, importance: 0.75, impact: 0.75, urgency: 0.55 });
  const deferred = await engine.evaluate([ordinary], { at, focusActive: true });
  assert.equal(deferred.notifications.length, 0);
  const urgent = engine.adapters.calendar([{ id: "conflict", title: "Conflit", conflict: true,
    importance: 1, impact: 1, urgency: 1, confidence: 1 }], { now: at })[0];
  const result = await engine.evaluate([urgent], { at, focusActive: true });
  assert.equal(result.recommendations[0].interruptionLevel, "URGENT_NOTIFY");
});

test("une note non actionnable et une newsletter sont ignorées", async () => {
  const { engine, at } = fixture();
  assert.equal(engine.adapters.notes([{ id: "note", title: "Idée", isAction: false }], { now: at }).length, 0);
  const newsletter = engine.adapters.gmail([{ id: "mail", subject: "Newsletter", newsletter: true }], { now: at })[0];
  assert.equal((await engine.evaluate([newsletter], { at })).recommendations.length, 0);
});

test("un e-mail explicitement important est exploitable sans son corps brut", async () => {
  const { engine, at } = fixture();
  const mail = engine.adapters.gmail([{ id: "mail-important", subject: "Validation client", important: true,
    requiresReply: true, body: "contenu privé qui ne doit pas être copié", importance: 0.9, urgency: 0.8 }], { now: at })[0];
  const result = await engine.evaluate([mail], { at });
  assert.equal(result.recommendations.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /contenu privé/);
});

test("le budget journalier limite les notifications non urgentes", async () => {
  const { engine, at } = fixture(undefined, { maxNotificationsPerDay: 1 });
  const items = ["a", "b"].map((id) => signal(engine.adapters, { id, now: at, importance: 1, impact: 1, urgency: 0.8 }));
  const result = await engine.evaluate(items, { at });
  assert.equal(result.notifications.filter((item) => item.interruptionLevel === "NOTIFY").length, 1);
});

test("later suspend puis permet de réévaluer après une évolution", async () => {
  const { engine, at, records } = fixture();
  const item = signal(engine.adapters, { now: at, materialKey: "v1" });
  const recommendation = (await engine.evaluate([item], { at })).recommendations[0];
  const state = engine.feedback(recommendation.hash, "later", { minutes: 30, at });
  assert.equal(state.status, "snoozed");
  assert.equal(records.get(recommendation.hash).status, "snoozed");
  assert.equal((await engine.evaluate([item], { at })).recommendations.length, 0);
});

test("dont_remind bloque le même état mais pas une évolution matérielle", async () => {
  const { engine, at } = fixture();
  const item = signal(engine.adapters, { now: at, materialKey: "v1" });
  const recommendation = (await engine.evaluate([item], { at })).recommendations[0];
  engine.feedback(recommendation.hash, "dont_remind", { at });
  assert.equal((await engine.evaluate([item], { at })).recommendations.length, 0);
  const changed = signal(engine.adapters, { now: at, materialKey: "v2" });
  assert.equal((await engine.evaluate([changed], { at })).recommendations.length, 1);
});

test("une mémoire local_only ne quitte jamais le moteur local", async () => {
  const { engine, at } = fixture();
  const item = engine.adapters.memory([{ id: "private", title: "Privé", action: "Vérifier", apiPolicy: "local_only" }],
    { now: at, local: true })[0];
  const result = await engine.evaluate([item], { at, remoteModel: true });
  assert.equal(result.recommendations.length, 0);
  assert.equal(result.ignored[0].reason, "local_only");
});

test("une action externe prépare une approbation sans l’exécuter", async () => {
  const calls = [];
  const { engine, at } = fixture(undefined, { approvalEngine: { prepareAction(input) { calls.push(input); return { id: "approval-1" }; } } });
  const recommendation = (await engine.evaluate([signal(engine.adapters, { now: at })], { at })).recommendations[0];
  const approval = engine.requestApproval(recommendation.hash, { skillName: "gmail", operation: "send_email", args: { to: "x@example.test" } });
  assert.equal(approval.id, "approval-1");
  assert.equal(calls.length, 1);
});

test("le moteur délègue les créneaux au TimeSlotService", async () => {
  const { engine, at } = fixture(undefined, { timeSlotService: { suggest: async (input) => [{ start: "10:00", duration: input.durationMinutes }] } });
  const recommendation = (await engine.evaluate([signal(engine.adapters, { now: at, estimatedDurationMinutes: 45 })], { at })).recommendations[0];
  const slots = await engine.suggestTimeSlots(recommendation.hash);
  assert.equal(slots[0].duration, 45);
});

test("les recommandations persistées restent lisibles après reconstruction", async () => {
  const shared = fixture();
  const item = signal(shared.engine.adapters, { now: shared.at });
  await shared.engine.evaluate([item], { at: shared.at });
  assert.equal(shared.engine.list().length, 1);
});

test("SQLite conserve feedback, cooldown et recommandation après redémarrage", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-proactive-"));
  const filePath = path.join(directory, "personal.sqlite");
  let database = createPersonalDatabase(filePath);
  let repository = createPersonalIntelligenceRepository(database);
  repository.saveRecommendation({ hash: "stable", score: 72, priorityLevel: "haute",
    payload: { interruptionLevel: "NOTIFY", title: "Action" }, cooldownUntil: "2026-08-29T08:00:00Z", status: "ready" });
  repository.updateRecommendation("stable", { userResponse: "later", status: "snoozed" });
  database.close();
  database = createPersonalDatabase(filePath);
  repository = createPersonalIntelligenceRepository(database);
  const restored = repository.getRecommendationByHash("stable");
  assert.equal(restored.status, "snoozed");
  assert.equal(restored.userResponse, "later");
  assert.equal(restored.payload.title, "Action");
  database.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test("un signal proactif délègue son placement au Planning Engine central", async () => {
  const calls = [];
  const { engine, at } = fixture(undefined, { planningEngine: { async buildPlan(input) { calls.push(input); return { planId: "plan-proactive" }; } } });
  const recommendation = (await engine.evaluate([signal(engine.adapters, { now: at })], { at })).recommendations[0];
  const plan = await engine.proposeDailyPlan({ recommendations: [recommendation], events: [], at });
  assert.equal(plan.planId, "plan-proactive");
  assert.equal(calls[0].trigger, "proactive_signal");
  assert.equal(calls[0].actions[0].hash, recommendation.hash);
});

test("un hint de revue réduit temporairement les interruptions sans modifier les règles", async () => {
  const { engine, at } = fixture(undefined, { maxNotificationsPerDay: 3 });
  const hint = engine.applyReviewHints({ notificationGroupingHint: "increase_grouping" }, {
    expiresAt: new Date(at.getTime() + 86_400_000).toISOString(),
  });
  const items = ["a", "b", "c"].map((id) => signal(engine.adapters, {
    id, now: at, importance: 1, impact: 1, urgency: 0.8,
  }));
  const result = await engine.evaluate(items, { at });
  assert.equal(hint.reversible, true);
  assert.equal(result.notifications.length, 2);
});
