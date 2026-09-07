"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCapacityService, createPortfolioCapacityEngine, normalizeDemand, normalizePortfolioItem } = require("../services/portfolio");

const at = () => new Date("2026-08-31T08:00:00.000Z");
function capacity(overrides = {}) {
  return { horizon: "WEEK", startAt: "2026-08-31", endAt: "2026-09-07", grossCapacity: 2400,
    unavailableCapacity: 0, fixedCommitments: 300, protectedCapacity: 300, plannedCapacity: 0, bufferCapacity: 120,
    calendarStatus: "AVAILABLE", planningStatus: "AVAILABLE", configurationStatus: "AVAILABLE", ...overrides };
}
function item(ref, expected = 300, overrides = {}) {
  return { itemRef: ref, portfolioItemId: `p-${ref}`, itemType: "PROJECT", title: `Project ${ref}`, status: "ACTIVE",
    workspaceRef: "w1", profileScope: "owner", projectRef: ref, goalRefs: ["g1"], capacityDemand: expected === null
      ? { estimateSource: "UNKNOWN" } : { minimumEstimate: Math.max(0, expected - 60), expectedEstimate: expected, maximumEstimate: expected + 60,
        estimateSource: "USER_ESTIMATE", confidence: "HIGH" }, ...overrides };
}
function engine() { return createPortfolioCapacityEngine({ capacityService: createCapacityService({ now: at }), now: at }); }

test("capacity snapshot déduit engagements fixes, pause protégée, buffer et travail planifié", () => {
  const value = createCapacityService({ now: at }).snapshot(capacity({ plannedCapacity: 600 }));
  assert.equal(value.flexibleCapacity, 1680); assert.equal(value.remainingCapacity, 1080); assert.equal(value.productivityScore, null);
});
test("Calendar indisponible ne devient jamais du temps libre", () => {
  const value = createCapacityService({ now: at }).snapshot(capacity({ calendarStatus: "UNAVAILABLE" }));
  assert.equal(value.availabilityState, "UNKNOWN"); assert.equal(value.flexibleCapacity, null); assert.equal(value.remainingCapacity, null);
});
test("Planning indisponible produit une capacité partielle et aucun remaining inventé", () => {
  const value = createCapacityService({ now: at }).snapshot(capacity({ planningStatus: "UNAVAILABLE" }));
  assert.equal(value.availabilityState, "PARTIAL"); assert.equal(value.remainingCapacity, null);
});
test("aucune journée de huit heures n'est inventée sans configuration", () => {
  const value = createCapacityService({ now: at }).snapshot({ calendarStatus: "AVAILABLE", planningStatus: "AVAILABLE", configurationStatus: "UNAVAILABLE" });
  assert.equal(value.grossCapacity, null); assert.equal(value.availabilityState, "UNKNOWN");
});
test("une estimation inconnue reste null et ne vaut pas zéro", () => {
  const value = normalizeDemand({ estimateSource: "UNKNOWN", expectedEstimate: 0 }, "p1");
  assert.equal(value.minimumEstimate, null); assert.equal(value.expectedEstimate, null); assert.equal(value.maximumEstimate, null);
});
test("une fourchette incohérente est refusée", () => assert.throws(() => normalizeDemand({ estimateSource: "USER_ESTIMATE", minimumEstimate: 10, expectedEstimate: 5, maximumEstimate: 20 }), /incohérente/));
test("l'estimation utilisateur est conservée comme source prioritaire explicite", () => assert.equal(normalizeDemand({ estimateSource: "USER_ESTIMATE", expectedEstimate: 120 }).estimateSource, "USER_ESTIMATE"));
test("un historique n'est accepté que comme source marquée et avec confiance fournie", () => {
  const value = normalizeDemand({ estimateSource: "HISTORICAL", expectedEstimate: 100, confidence: "MEDIUM", evidenceRefs: ["execution-stat-1"] });
  assert.equal(value.confidence, "MEDIUM"); assert.deepEqual(value.evidenceRefs, ["execution-stat-1"]);
});
test("aucune estimation LLM primaire n'existe dans le contrat", () => assert.equal(normalizeDemand({ estimateSource: "LLM", expectedEstimate: 120 }).estimateSource, "UNKNOWN"));
test("le snapshot détecte une surcharge attendue connue", () => {
  const value = engine().createSnapshot({ workspaceRef: "w1", capacity: capacity(), items: [item("a", 1000), item("b", 900)] });
  assert.equal(value.overloads[0].state, "OVERLOADED"); assert.equal(value.planningAuthority, false);
});
test("la surcharge minimale suffit même avec un autre projet inconnu", () => {
  const value = engine().createSnapshot({ workspaceRef: "w1", capacity: capacity(), items: [item("a", 2000), item("b", null)] });
  assert.equal(value.overloads[0].state, "OVERLOADED"); assert.equal(value.overloads[0].expectedDemand, null);
});
test("une demande inconnue empêche de déclarer le portefeuille sain", () => {
  const value = engine().createSnapshot({ workspaceRef: "w1", capacity: capacity(), items: [item("a", 100), item("b", null)] });
  assert.equal(value.overloads[0].state, "UNKNOWN"); assert.equal(value.overloads[0].utilization, null);
});
test("l'état tight est déterministe sans objectif universel de 100 %", () => {
  const value = engine().createSnapshot({ workspaceRef: "w1", capacity: capacity(), items: [item("a", 1500)] });
  assert.equal(value.overloads[0].state, "TIGHT");
});
test("les échéances rapprochées sont regroupées sans créer seules une surcharge", () => {
  const value = engine().createSnapshot({ workspaceRef: "w1", capacity: capacity(), items: [item("a", null, { deadline: "2026-09-03" }), item("b", null, { deadline: "2026-09-05" })] });
  assert.equal(value.deadlineClusters.length, 1); assert.equal(value.deadlineClusters[0].overloadClaimed, false); assert.equal(value.overloads[0].state, "UNKNOWN");
});
test("les dépendances restent des références et signalent une compression future", () => {
  const value = engine().createSnapshot({ workspaceRef: "w1", capacity: capacity(), items: [item("b", 200, { dependencies: ["a"], blockedUntil: "2026-09-04", deadline: "2026-09-05" })] });
  assert.deepEqual(value.blockers[0].dependencyRefs, ["a"]); assert.equal(value.blockers[0].futureCompression, true);
});
test("un objectif important sans allocation produit un gap sans reprioritisation", () => {
  const value = engine().createSnapshot({ workspaceRef: "w1", capacity: capacity(), items: [], goals: [{ goalId: "g1", importance: "HIGH" }] });
  assert.equal(value.allocationGaps[0].type, "STRATEGIC_ALLOCATION_GAP"); assert.equal(value.allocationGaps[0].automaticReprioritization, false);
});
test("un zéro intentionnel n'est pas signalé comme gap stratégique", () => {
  const value = engine().createSnapshot({ workspaceRef: "w1", capacity: capacity(), items: [item("a", 0, { intentionalZeroAllocation: true })], goals: [{ goalId: "g1", importance: "HIGH" }] });
  assert.equal(value.allocationGaps.some((gap) => gap.type === "STRATEGIC_ALLOCATION_GAP"), false);
});
test("les guardrails minimum et maximum restent des écarts, pas des créneaux", () => {
  const value = engine().createSnapshot({ workspaceRef: "w1", capacity: capacity(), items: [item("a", 120)], goals: [{ goalId: "g1" }], guardrails: [{ targetRef: "g1", minimumCapacity: 300, maximumCapacity: 600, source: "explicit_user" }] });
  assert.equal(value.allocationGaps[0].type, "MINIMUM_GUARDRAIL_GAP"); assert.equal(value.planningAuthority, false);
});
test("WIP compte les projets et engagements sans imposer de limite universelle", () => {
  const value = engine().createSnapshot({ workspaceRef: "w1", capacity: capacity(), items: [item("a"), item("b", 100, { itemType: "MAJOR_COMMITMENT" })] });
  assert.deepEqual(value.wip, { activeProjects: 1, activeMajorCommitments: 1 });
});
test("la fragmentation exige plusieurs estimations factuelles petites", () => {
  const value = engine().createSnapshot({ workspaceRef: "w1", capacity: capacity(), items: ["a", "b", "c", "d"].map((ref) => item(ref, 45)) });
  assert.equal(value.fragmentation.detected, true); assert.equal(value.fragmentation.evidenceBased, true);
});
test("contexte ambiant et application active n'affectent pas la capacité", () => {
  const a = engine().createSnapshot({ workspaceRef: "w1", capacity: capacity(), items: [item("a", 300)], activeApp: "VS Code" });
  const b = engine().createSnapshot({ workspaceRef: "w1", capacity: capacity(), items: [item("a", 300)], activeApp: "Safari", ambientContext: { focused: true } });
  assert.equal(a.availableCapacity.flexibleCapacity, b.availableCapacity.flexibleCapacity);
});
test("temps humain et temps machine restent distincts et jamais additionnés", () => {
  const value = engine().createSnapshot({ workspaceRef: "w1", capacity: capacity(), items: [item("human", 180), item("machine", 45, { capacityDemand: { minimumEstimate: 45, expectedEstimate: 45, maximumEstimate: 45, estimateSource: "PROJECT_ESTIMATE", confidence: "HIGH", capacityType: "NOON_BACKGROUND" } })] });
  assert.equal(value.capacityByType.userExpectedMinutes, 180); assert.equal(value.capacityByType.noonBackgroundExpectedMinutes, 45); assert.equal(value.capacityByType.combined, null);
});
test("un scénario est une simulation pure sans écriture Calendar, projet ou objectif", () => {
  const base = engine().createSnapshot({ workspaceRef: "w1", capacity: capacity(), items: [item("a", 1000)] });
  const scenario = engine().simulate({ baseSnapshot: base, changes: [{ type: "PAUSE_ITEM", itemRef: "a" }] });
  assert.equal(scenario.simulationOnly, true); assert.equal(scenario.calendarWrites, 0); assert.equal(scenario.projectWrites, 0); assert.equal(scenario.goalWrites, 0);
  assert.equal(base.items[0].status, "ACTIVE");
});
test("les what-if de scope et deadline modifient seulement la copie", () => {
  const e = engine(); const base = e.createSnapshot({ workspaceRef: "w1", capacity: capacity(), items: [item("a", 1000, { deadline: "2026-09-03" })] });
  const scenario = e.simulate({ baseSnapshot: base, changes: [{ type: "REDUCE_DEMAND", itemRef: "a", expectedEstimate: 500 }, { type: "MOVE_DEADLINE", itemRef: "a", deadline: "2026-09-10" }] });
  assert.equal(scenario.demandDeltaMinutes, 500); assert.equal(base.items[0].deadline, "2026-09-03T00:00:00.000Z");
});
test("la demande d'arbitrage exige DecisionSupport et n'autorise aucune action", () => {
  const e = engine(); const base = e.createSnapshot({ workspaceRef: "w1", capacity: capacity(), items: [item("a", 1000)] });
  const result = e.decisionRequest(base, [{ optionId: "reduce", label: "Réduire le scope" }]);
  assert.equal(result.requiresDecisionSupport, true); assert.equal(result.actionAuthorized, false);
});
test("la projection devient plus grossière et moins confiante avec le temps", () => {
  const periods = Array.from({ length: 6 }, (_, index) => ({ label: `w${index}`, workspaceRef: "w1", capacity: capacity(), items: [item("a", 300)] }));
  const result = engine().forecast({ periods }); assert.equal(result[0].granularity, "DETAILED"); assert.equal(result[5].granularity, "COARSE"); assert.equal(result[5].confidence, "MEDIUM");
});
test("l'isolation workspace et profil est stricte", () => {
  const value = engine().createSnapshot({ workspaceRef: "w1", profileScope: "owner", capacity: capacity(), items: [item("a"), item("b", 300, { workspaceRef: "w2" }), item("c", 300, { profileScope: "other" })] });
  assert.deepEqual(value.items.map((entry) => entry.itemRef), ["a"]);
});
test("le résumé distant retire local_only, titres et profil", () => {
  const e = engine(); const value = e.createSnapshot({ workspaceRef: "w1", capacity: capacity(), items: [item("a", 100, { localOnly: true }), item("b", 100)] });
  const remote = e.remoteSummary(value); assert.equal(remote.activeItemCount, 1); assert.equal(remote.localOnlyExcluded, 1); assert.deepEqual(remote.titles, []); assert.equal(remote.profileScope, null);
});
test("la télémétrie ne contient aucun nom de projet", () => {
  const events = []; const e = createPortfolioCapacityEngine({ capacityService: createCapacityService({ now: at }), now: at, audit: (name, data) => events.push([name, data]) });
  e.createSnapshot({ workspaceRef: "secret-workspace", capacity: capacity(), items: [item("secret-project", 200, { title: "Client très privé" })] });
  const serialized = JSON.stringify(events); assert.equal(serialized.includes("Client très privé"), false); assert.equal(serialized.includes("secret-project"), false);
});
test("le moteur expose explicitement zéro autorité opérationnelle", () => assert.deepEqual(engine().health(), {
  status: "ok", featureMode: "SHADOW", snapshots: 0, scenarios: 0, readOnly: true, executionAuthority: false,
  calendarWriteAuthority: false, projectWriteAuthority: false, goalWriteAuthority: false,
}));
test("normaliser un item ne copie pas un projet complet", () => {
  const value = normalizePortfolioItem(item("a", 100, { arbitraryProjectPayload: { secret: "x" } }));
  assert.equal(value.arbitraryProjectPayload, undefined); assert.equal(value.projectRef, "a");
});
