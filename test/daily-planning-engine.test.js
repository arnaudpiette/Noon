"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createDailyPlanningEngine, normalizePlanningAction, splitAction } = require("../services/planning/daily-planning-engine");
const { createPriorityEngine } = require("../services/personal-intelligence/priority-engine");
const { createTimeSlotService } = require("../services/scheduling/time-slot-service");
const { createHardRulesRegistry } = require("../services/rules/hard-rules-registry");

const AT = new Date("2026-08-28T06:00:00.000Z"); // 08:00 à Paris, vendredi.
const SETTINGS = { workdayStart: "09:00", workdayEnd: "18:00", workingDays: [1,2,3,4,5],
  minimumSlotMinutes: 15, maximumFocusMinutes: 90, bufferMinutes: 0, timeZone: "Europe/Paris" };

function fixture(options = {}) {
  const plans = new Map();
  const store = { get: (date) => plans.get(date) || null, save(plan) { plans.set(plan.date, structuredClone(plan)); return plan; } };
  const approvalCalls = [];
  const engine = createDailyPlanningEngine({
    priorityEngine: createPriorityEngine({ now: () => AT }),
    timeSlotService: createTimeSlotService(null),
    hardRulesRegistry: createHardRulesRegistry(), store,
    settingsProvider: () => ({ ...SETTINGS, ...(options.settings || {}) }),
    learningHintsProvider: () => options.learningHints || {},
    approvalEngine: { prepareAction(input) { approvalCalls.push(input); return { id: "approval-1", status: "pending" }; } },
    utilizationTarget: options.utilizationTarget ?? 0.82,
    now: () => AT,
  });
  return { engine, store, plans, approvalCalls };
}

function action(id, minutes, score, extra = {}) {
  return { id, actionId: id, title: `Action ${id}`, sourceType: "local", sourceReference: id,
    estimatedDurationMinutes: minutes, priorityScore: score, priorityLevel: score >= 65 ? "haute" : "moyenne", confidence: 1, ...extra };
}

function event(id, start, end, extra = {}) { return { id, summary: id, start, end, ...extra }; }

test("journée simple : place les actions après une réunion fixe", async () => {
  const { engine } = fixture();
  const plan = await engine.buildPlan({ at: AT, events: [event("meeting", "2026-08-28T07:00:00Z", "2026-08-28T08:00:00Z")],
    actions: [action("A", 60, 80), action("B", 30, 55)] });
  assert.equal(plan.fixedEvents.length, 1);
  assert.equal(plan.proposedBlocks.length, 2);
  assert.ok(plan.proposedBlocks.every((block) => new Date(block.start) >= new Date("2026-08-28T08:00:00Z")));
});

test("aucun bloc ne traverse la pause protégée", async () => {
  const { engine } = fixture();
  const plan = await engine.buildPlan({ at: new Date("2026-08-28T09:45:00Z"), actions: [action("A", 60, 80)] });
  const block = plan.proposedBlocks[0];
  assert.ok(new Date(block.start) >= new Date("2026-08-28T11:30:00Z"));
});

test("un agenda incomplet ne produit aucune proposition de disponibilité", async () => {
  const { engine } = fixture();
  const plan = await engine.buildPlan({ at: AT, calendarComplete: false, actions: [action("A", 60, 80)] });
  assert.equal(plan.proposedBlocks.length, 0); assert.equal(plan.unscheduledActions[0].reasonCode, "CALENDAR_INCOMPLETE");
});

test("overload : conserve le surplus en non planifié", async () => {
  const { engine } = fixture({ settings: { workdayStart: "09:00", workdayEnd: "14:00" } });
  const plan = await engine.buildPlan({ at: AT, actions: [action("A", 180, 90, { splittable: true }), action("B", 180, 80, { splittable: true }), action("C", 60, 50)] });
  assert.ok(plan.summary.plannedMinutes <= plan.summary.availableMinutes);
  assert.ok(plan.unscheduledActions.length >= 1);
  assert.ok(plan.warnings.some((warning) => warning.code === "OVER_CAPACITY_OR_CONSTRAINTS"));
});

test("une tâche divisible de 120 minutes forme deux blocs de 60", async () => {
  const { engine } = fixture();
  const plan = await engine.buildPlan({ at: AT, actions: [action("A", 120, 80, { splittable: true, maximumBlockMinutes: 60, minimumBlockMinutes: 60 })] });
  assert.deepEqual(plan.proposedBlocks.map((block) => block.durationMinutes), [60, 60]);
});

test("une tâche non divisible ne subit aucune fragmentation artificielle", () => {
  assert.deepEqual(splitAction(normalizePlanningAction(action("A", 120, 80, { splittable: false, maximumBlockMinutes: 60 }))),
    [{ minutes: 120, part: 1, total: 1 }]);
});

test("une dépendance est toujours placée après son prérequis", async () => {
  const { engine } = fixture();
  const plan = await engine.buildPlan({ at: AT, actions: [action("B", 30, 90, { dependencies: ["A"] }), action("A", 30, 60)] });
  const a = plan.proposedBlocks.find((block) => block.actionId === "A");
  const b = plan.proposedBlocks.find((block) => block.actionId === "B");
  assert.ok(new Date(b.start) >= new Date(a.end));
});

test("une action bloquée reste visible mais non planifiée", async () => {
  const { engine } = fixture();
  const plan = await engine.buildPlan({ at: AT, actions: [action("A", 30, 90, { blocked: true })] });
  assert.equal(plan.proposedBlocks.length, 0);
  assert.equal(plan.unscheduledActions[0].reasonCode, "BLOCKED");
});

test("un déplacement manuel gagne sur la replanification", async () => {
  const { engine } = fixture();
  const first = await engine.buildPlan({ at: AT, actions: [action("A", 60, 80)] });
  const moved = { ...first, proposedBlocks: [{ ...first.proposedBlocks[0], start: "2026-08-28T14:00:00Z", end: "2026-08-28T15:00:00Z", manualMove: true }] };
  const next = await engine.replanDay({ at: AT, actions: [action("A", 60, 80)], previousPlan: moved, trigger: "manual_move" });
  assert.equal(next.plannedBlocks[0].start, "2026-08-28T14:00:00Z");
  assert.equal(next.plannedBlocks[0].preserved, true);
});

test("une nouvelle réunion ne déplace que le bloc touché", async () => {
  const { engine } = fixture();
  const first = await engine.buildPlan({ at: AT, actions: [action("A", 60, 90), action("B", 60, 80)] });
  const touched = first.proposedBlocks[0];
  const next = await engine.replanDay({ at: AT, previousPlan: first,
    events: [event("new", touched.start, touched.end)], actions: [action("A", 60, 90), action("B", 60, 80)], trigger: "calendar_changed" });
  const untouchedBefore = first.proposedBlocks[1];
  const untouchedAfter = [...next.plannedBlocks, ...next.proposedBlocks].find((block) => block.actionId === untouchedBefore.actionId);
  assert.equal(untouchedAfter.start, untouchedBefore.start);
  assert.notEqual([...next.plannedBlocks, ...next.proposedBlocks].find((block) => block.actionId === touched.actionId).start, touched.start);
});

test("terminée et en cours ne sont jamais replacées", async () => {
  const { engine } = fixture();
  const previous = await engine.buildPlan({ at: AT, actions: [action("done", 30, 80), action("active", 30, 70)] });
  const next = await engine.replanDay({ at: AT, previousPlan: previous,
    actions: [action("done", 30, 80, { completed: true }), action("active", 30, 70, { inProgress: true })] });
  assert.equal(next.plannedBlocks.find((block) => block.actionId === "done").status, "completed");
  assert.equal(next.plannedBlocks.find((block) => block.actionId === "active").status, "in_progress");
});

test("une action snoozée jusqu’à demain n’est pas placée aujourd’hui", async () => {
  const { engine } = fixture();
  const plan = await engine.buildPlan({ at: AT, actions: [action("A", 30, 80, { snoozedUntil: "2026-08-29T08:00:00Z" })] });
  assert.equal(plan.unscheduledActions[0].reasonCode, "SNOOZED");
});

test("la priorité fournie reste inchangée entre moteur proactif et planning", async () => {
  const { engine } = fixture();
  const plan = await engine.buildPlan({ at: AT, actions: [action("A", 30, 73)] });
  assert.equal(plan.proposedBlocks[0].priorityScore, 73);
});

test("la preview Calendar contient Myrtille, signature Noon et batch exact", async () => {
  const { engine, approvalCalls } = fixture();
  const plan = await engine.buildPlan({ at: AT, actions: [action("A", 30, 80), action("B", 30, 70)] });
  const approval = await engine.previewApproval(plan, { executionId: "exec-test" });
  assert.equal(approval.id, "approval-1");
  assert.equal(approvalCalls[0].normalizedArgs.blocks.length, 2);
  assert.ok(approvalCalls[0].normalizedArgs.blocks.every((block) => block.event.colorId === "9" && block.event.extendedProperties.private.managedBy === "noon"));
});

test("un plan modifié devient stale avant écriture", async () => {
  const { engine } = fixture();
  const actions = [action("A", 30, 80)];
  const plan = await engine.buildPlan({ at: AT, actions });
  assert.equal(engine.isPlanStale(plan, { actions }).stale, false);
  assert.equal(engine.isPlanStale(plan, { actions, events: [event("new", "2026-08-28T10:00:00Z", "2026-08-28T11:00:00Z")] }).status, "plan_stale");
});

test("le résultat est déterministe à contraintes identiques et versionné après changement", async () => {
  const { engine } = fixture();
  const actions = [action("A", 30, 80)];
  const first = await engine.buildPlan({ at: AT, actions });
  const second = await engine.buildPlan({ at: AT, actions, previousPlan: first });
  assert.equal(second.planVersion, first.planVersion);
  assert.equal(second.proposedBlocks[0].start, first.proposedBlocks[0].start);
  const changed = await engine.replanDay({ at: AT, actions: [action("A", 60, 80)], previousPlan: first });
  assert.equal(changed.planVersion, first.planVersion + 1);
});

test("les dates autour du changement d’heure gardent le fuseau Paris", async () => {
  const { engine } = fixture({ settings: { workingDays: [0,1,2,3,4,5,6] } });
  const plan = await engine.buildPlan({ at: new Date("2026-10-25T07:00:00Z"), actions: [action("A", 30, 80)] });
  assert.equal(plan.timeZone, "Europe/Paris");
  assert.equal(plan.date, "2026-10-25");
  assert.equal(plan.proposedBlocks.length, 1);
});

test("les hints de revue ajustent prudemment durée et utilisation sans devenir des règles", async () => {
  const { engine } = fixture({ learningHints: { bufferMultiplierHint: 1.2, maxPlannedUtilizationHint: 0.75 } });
  const plan = await engine.buildPlan({ at: AT, actions: [action("A", 60, 80)] });
  assert.equal(plan.proposedBlocks[0].durationMinutes, 75);
  assert.deepEqual(plan.learningHintsApplied, {
    bufferMultiplierHint: 1.2, maxPlannedUtilizationHint: 0.75, avoidFragmentationHint: false,
  });
});

test('Calendar indisponible ne confirme jamais un créneau libre', async () => {
  const { engine } = fixture();
  const unknown = await engine.buildPlan({ at: AT, actions: [], events: [], calendarStatus: 'unavailable' });
  assert.equal(unknown.calendarAvailability, 'theoretical');
  const verified = await engine.buildPlan({ at: AT, actions: [], events: [], calendarStatus: 'ready' });
  assert.equal(verified.calendarAvailability, 'confirmed');
});
