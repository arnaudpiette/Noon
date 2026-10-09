"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGoalRegistry, createGoalStrategyEngine, GoalError } = require("../services/goals");
const { createDecisionSupportEngine } = require("../services/decision/decision-support-engine");
const { normalizeDecisionRequestV2 } = require("../services/decision/decision-schema");

function fixture(options = {}) {
  const events = [];
  const engine = createGoalStrategyEngine({
    registry: createGoalRegistry(),
    projectProvider: () => [{ id: "project-qwenta", name: "Qwenta", priority: 80 }],
    workspaceProvider: () => [{ id: "workspace-learning", name: "Formation" }],
    observability: (event, metadata) => events.push({ event, metadata }),
    now: () => new Date("2026-08-31T10:00:00.000Z"), ...options,
  });
  return { engine, events };
}
function goal(engine, overrides = {}) {
  return engine.createGoal({ title: "Terminer la formation web", outcomeDefinition: "Obtenir la validation complète de la formation", category: "LEARNING", linkedProjectIds: ["project-qwenta"], linkedWorkspaceIds: ["workspace-learning"], ...overrides });
}
function goalDecisionRequest(goalRecord, criterion, overrides = {}) {
  const scope = { profileScope: goalRecord.profileScope, workspaceId: goalRecord.linkedWorkspaceIds[0] || null, projectId: goalRecord.linkedProjectIds[0] || null, purpose: "LOCAL_ANALYSIS" };
  const localOnly = goalRecord.sensitivity === "LOCAL_ONLY";
  return { schemaVersion: 2, decisionId: "decision-goal-v2", question: "Quelle option sert le mieux cet objectif ?", decisionType: "COMPARE", evaluationAt: "2026-10-09T12:00:00.000Z", scope,
    options: [{ optionId: "a", label: "Option alignée", source: "USER_PROVIDED", assumptions: [], values: { [criterion.criterionId]: "EXCELLENT" } }, { optionId: "b", label: "Option secondaire", source: "USER_PROVIDED", assumptions: [], values: { [criterion.criterionId]: "GOOD" } }], criteria: [criterion], constraints: [],
    evidence: ["a", "b"].map((optionId, index) => ({ evidenceId: `goal-evidence-${optionId}`, claimId: `goal-claim-${optionId}`, optionId, criterionId: criterion.criterionId, stance: "SUPPORTS", value: index === 0 ? "EXCELLENT" : "GOOD", kind: "HUMAN_CONFIRMATION", authority: "HUMAN", verificationStatus: "VERIFIED", critical: false,
      provenance: { producer: "goal-test", sourceType: "confirmed-goal-link", method: "user-confirmation", rootEvidenceId: null }, scope, observedAt: "2026-10-09T11:00:00.000Z", validUntil: "2026-10-10T11:00:00.000Z", freshnessRequirement: "CURRENT", claimFingerprint: `sha256:goal-${optionId}`, independenceKey: `goal-root-${optionId}`, derivedFromEvidenceIds: [], localOnly, allowedForRemoteModel: !localOnly, untrustedContent: false })),
    verificationProposals: [], recommendationRequested: true, outputMode: "BALANCED", contextVersion: "goal-v2-test", ...overrides };
}

test("crée un objectif explicite distinct d'un projet et conserve les IDs canoniques", () => {
  const { engine } = fixture(); const created = goal(engine);
  assert.equal(created.status, "ACTIVE"); assert.deepEqual(created.linkedProjectIds, ["project-qwenta"]);
  assert.notEqual(created.goalId, "project-qwenta"); assert.equal(created.outcomeDefinition, "Obtenir la validation complète de la formation");
});

test("une inférence reste un GoalCandidate inactif jusqu'à confirmation", () => {
  const { engine } = fixture(); const candidate = engine.proposeGoal({ title: "Apprendre TypeScript", outcomeDefinition: "Être autonome en TypeScript" });
  assert.equal(candidate.status, "PENDING_CONFIRMATION"); assert.equal(engine.registry.list().length, 0);
  const confirmed = engine.confirmCandidate(candidate.candidateId, { category: "LEARNING" });
  assert.equal(confirmed.status, "ACTIVE"); assert.equal(engine.registry.listCandidates().length, 0);
});

test("le schéma refuse une création non confirmée et un projet inexistant", () => {
  const { engine } = fixture();
  assert.throws(() => engine.registry.create({ title: "T", outcomeDefinition: "Résultat suffisamment clair" }), /confirmé/i);
  assert.throws(() => goal(engine, { linkedProjectIds: ["inventé"] }), /Projet introuvable/);
});

test("un objectif vague est conservé avec clarification sans faux KPI", () => {
  const { engine } = fixture(); const created = engine.createGoal({ title: "Progresser", outcomeDefinition: "Faire mieux", category: "PERSONAL" });
  assert.ok(created.qualityWarnings.includes("GOAL_NEEDS_CLARIFICATION"));
  assert.equal(created.progress.method, "UNKNOWN"); assert.equal(created.progress.value, null);
});

test("jalons et critères restent distincts des tâches", () => {
  const { engine } = fixture(); const created = goal(engine);
  const milestone = engine.addMilestone(created.goalId, { title: "Soutenance validée", completionCriteria: [{ description: "Validation officielle", type: "BOOLEAN" }] }, { userConfirmed: true });
  assert.match(milestone.milestoneId, /^milestone-/); assert.equal(milestone.goalId, created.goalId); assert.equal(milestone.taskId, undefined);
});

test("atteindre un jalon requiert une preuve ou confirmation", () => {
  const { engine } = fixture(); const created = goal(engine); const milestone = engine.addMilestone(created.goalId, { title: "Projet validé" }, { userConfirmed: true });
  assert.throws(() => engine.updateMilestone(created.goalId, milestone.milestoneId, { status: "ACHIEVED" }), /preuve ou confirmation/);
  const updated = engine.updateMilestone(created.goalId, milestone.milestoneId, { status: "ACHIEVED" }, { evidenceRefs: ["project:validation"] });
  assert.equal(updated.status, "ACHIEVED");
});

test("ni temps calendrier ni compteur de tâches n'inventent une progression", () => {
  const { engine } = fixture(); const created = goal(engine, { targetDate: "2026-12-01" });
  const assessment = engine.assessProgress(created.goalId, { calendarMinutes: 900, completedTasks: 42 });
  assert.equal(assessment.progress.method, "UNKNOWN"); assert.equal(assessment.progress.value, null); assert.equal(assessment.trajectory, "UNKNOWN");
});

test("la progression par jalons exige des preuves et rapporte le ratio exact", () => {
  const { engine } = fixture(); const created = goal(engine, { milestones: [
    { title: "A", status: "ACHIEVED", evidenceRefs: ["e:a"] }, { title: "B", status: "NOT_STARTED" },
  ] });
  const assessment = engine.assessProgress(created.goalId);
  assert.equal(assessment.progress.method, "MILESTONE_BASED"); assert.equal(assessment.milestoneSummary.achieved, 1); assert.equal(assessment.milestoneSummary.total, 2); assert.equal(assessment.progress.value, 50);
});

test("un projet terminé ne termine jamais automatiquement l'objectif", () => {
  const { engine } = fixture(); const created = goal(engine);
  assert.throws(() => engine.transition(created.goalId, "ACHIEVED", { userConfirmed: true, evidence: { projectCompleted: true } }), /prouvent pas/);
  assert.equal(engine.registry.get(created.goalId).status, "ACTIVE");
});

test("un objectif atteint exige critères ou jalons et confirmation utilisateur", () => {
  const { engine } = fixture(); const created = goal(engine, { successCriteria: [{ description: "Diplôme reçu", type: "BOOLEAN", status: "MET", evidenceRefs: ["certificate"] }] });
  assert.throws(() => engine.transition(created.goalId, "ACHIEVED", { evidence: { evidenceRefs: ["certificate"] } }), /confirmation/);
  assert.equal(engine.transition(created.goalId, "ACHIEVED", { userConfirmed: true, evidence: { evidenceRefs: ["certificate"] } }).status, "ACHIEVED");
});

test("les transitions invalides sont refusées et l'historique est conservé", () => {
  const { engine } = fixture(); const created = goal(engine); engine.transition(created.goalId, "PAUSED", { userConfirmed: true });
  assert.equal(engine.registry.history(created.goalId).length, 1);
  assert.throws(() => engine.transition(created.goalId, "ACHIEVED", { userConfirmed: true }), /Transition/);
});

test("la stratégie est versionnée sans devenir HardRule ni plan calendrier", () => {
  const { engine } = fixture(); const created = goal(engine);
  const first = engine.versionStrategy(created.goalId, { title: "Prioriser OpenClassrooms", chosenApproach: "Deux semaines concentrées", decisionRefs: ["decision-1"] }, { userConfirmed: true });
  const second = engine.versionStrategy(created.goalId, { title: "Réduire le scope", chosenApproach: "Valider le minimum", decisionRefs: ["decision-2"] }, { userConfirmed: true });
  assert.equal(first.version, 1); assert.equal(second.version, 2); assert.deepEqual(second.decisionRefs, ["decision-2"]);
  assert.equal(second.hardRuleId, undefined); assert.equal(second.calendarEvents, undefined);
});

test("une référence Decision V2 exige confirmation, puis est conservée et bornée", () => {
  const { engine } = fixture(); const created = goal(engine); const criterion = engine.decisionCriterion(created.goalId);
  const request = goalDecisionRequest(created, criterion); const decision = createDecisionSupportEngine().compare(request, { attestedEvidenceIds: request.evidence.map((item) => item.evidenceId) });
  assert.equal(decision.verdict, "DECIDED"); assert.equal(decision.recommendationIsAction, false); assert.equal(decision.actionAuthorized, false); assert.equal(decision.verificationAuthorized, false);
  assert.throws(() => engine.versionStrategy(created.goalId, { title: "Choix sans confirmation", decisionResult: decision, decisionRecordId: "decision-record-v2" }), /confirmée/);
  assert.equal(engine.registry.strategyHistory(created.goalId).length, 0); assert.equal(engine.registry.get(created.goalId).status, "ACTIVE");
  const decisionRefs = ["decision-record-v2", ...Array.from({ length: 35 }, (_, index) => `legacy-${index}`)];
  const strategy = engine.versionStrategy(created.goalId, { title: "Choix confirmé", decisionRecordId: "decision-record-v2", decisionRefs }, { userConfirmed: true });
  assert.equal(strategy.decisionRefs[0], "decision-record-v2"); assert.equal(strategy.decisionRefs.filter((item) => item === "decision-record-v2").length, 1); assert.equal(strategy.decisionRefs.length, 30);
});

test("decisionRecordId invalide ne crée ni ne remplace une stratégie", () => {
  const { engine } = fixture(); const created = goal(engine);
  const existing = engine.versionStrategy(created.goalId, { title: "Stratégie existante", decisionRefs: ["legacy-ref"] }, { userConfirmed: true });
  assert.throws(() => engine.versionStrategy(created.goalId, { title: "Référence invalide", decisionRecordId: 42 }, { userConfirmed: true }), (error) => error.code === "DECISION_RECORD_ID_INVALID");
  assert.throws(() => engine.versionStrategy(created.goalId, { title: "Référence trop longue", decisionRecordId: "x".repeat(161) }, { userConfirmed: true }), (error) => error.code === "DECISION_RECORD_ID_INVALID");
  assert.equal(engine.registry.strategyHistory(created.goalId).length, 1); assert.equal(engine.registry.get(created.goalId).strategyRef, existing.strategyId);
  const blank = engine.versionStrategy(created.goalId, { title: "Référence vide", decisionRecordId: "   ", decisionRefs: ["legacy-ref"] }, { userConfirmed: true });
  assert.deepEqual(blank.decisionRefs, ["legacy-ref"]);
});

test("les dépendances cycliques sont refusées et les conflits ne sont pas auto-résolus", () => {
  const { engine } = fixture(); const a = goal(engine); const b = engine.createGoal({ title: "Lancer une activité", outcomeDefinition: "Signer un premier client", category: "BUSINESS" });
  engine.relation(a.goalId, b.goalId, "DEPENDS_ON", { userConfirmed: true });
  assert.throws(() => engine.relation(b.goalId, a.goalId, "DEPENDS_ON", { userConfirmed: true }), /Cycle/);
  const conflict = engine.relation(a.goalId, b.goalId, "CONFLICTS_WITH", { userConfirmed: true }); assert.equal(conflict.type, "CONFLICTS_WITH"); assert.equal(engine.registry.get(a.goalId).status, "ACTIVE");
});

test("l'alignement produit un unique signal stratégique sans score de priorité concurrent", () => {
  const { engine } = fixture(); goal(engine);
  const signal = engine.evaluateAlignment({ projectId: "project-qwenta", subjectRef: "task-1" });
  assert.equal(signal.singleSignal, true); assert.equal(signal.alignments[0].alignment, "DIRECT"); assert.equal(signal.alignments[0].confidence, 1); assert.equal(signal.priorityScore, undefined);
});

test("un alignement inconnu reste UNKNOWN et un multi-goal reste explicite", () => {
  const { engine } = fixture(); goal(engine); engine.createGoal({ title: "Créer un portfolio", outcomeDefinition: "Publier un portfolio professionnel", linkedProjectIds: ["project-qwenta"] });
  const known = engine.evaluateAlignment({ projectId: "project-qwenta" }); assert.equal(known.alignments.length, 2);
  const unknown = engine.evaluateAlignment({ subjectRef: "unrelated" }); assert.ok(unknown.alignments.every((item) => item.alignment === "UNKNOWN")); assert.equal(unknown.value, null);
});

test("local_only, workspace et profil restent isolés du contexte distant", () => {
  const { engine } = fixture(); const localGoal = goal(engine, { sensitivity: "LOCAL_ONLY" });
  engine.createGoal({ title: "Objectif autre profil", outcomeDefinition: "Résultat réservé à un autre profil", profileScope: "alexandra", linkedWorkspaceIds: [] });
  assert.equal(engine.relevantGoals({ query: "formation", profileScope: "arnaud", remote: true }).length, 0);
  assert.equal(engine.relevantGoals({ query: "formation", profileScope: "arnaud", remote: false }).length, 1);
  assert.equal(engine.relevantGoals({ query: "autre profil", profileScope: "arnaud", remote: false }).length, 0);
  const request = normalizeDecisionRequestV2(goalDecisionRequest(localGoal, engine.decisionCriterion(localGoal.goalId)));
  assert.equal(request.scope.profileScope, "arnaud"); assert.equal(request.scope.workspaceId, "workspace-learning"); assert.equal(request.evidence.every((item) => item.localOnly && item.allowedForRemoteModel === false), true);
  const remote = createDecisionSupportEngine().compare(request, { attestedEvidenceIds: request.evidence.map((item) => item.evidenceId), remote: true });
  assert.notEqual(remote.verdict, "DECIDED"); assert.equal(remote.evidenceSummary.eligible, 0);
  const outsideScope = structuredClone(request); outsideScope.evidence = outsideScope.evidence.map((item) => ({ ...item, scope: { ...item.scope, workspaceId: "other-workspace" } }));
  const outside = createDecisionSupportEngine().compare(outsideScope, { attestedEvidenceIds: outsideScope.evidence.map((item) => item.evidenceId) });
  assert.notEqual(outside.verdict, "DECIDED"); assert.equal(outside.evidenceSummary.eligible, 0); assert.ok(outside.unknowns.some((item) => item.reasonCode === "EVIDENCE_SCOPE_MISMATCH"));
});

test("le GoalEngine n'accorde aucune autorité d'action, calendrier, email ou fichier", () => {
  const { engine } = fixture(); goal(engine);
  const health = engine.health(); assert.equal(health.executionAuthority, false); assert.equal(health.priorityAuthority, false); assert.equal(health.planningAuthority, false);
  assert.equal(engine.sendEmail, undefined); assert.equal(engine.createCalendarEvent, undefined); assert.equal(engine.writeFile, undefined);
});

test("Priority et Planning ne reçoivent qu'un signal stratégique et aucune propriété de slots", () => {
  const { engine } = fixture(); goal(engine, { milestones: [{ title: "Valider Qwenta", linkedProjectIds: ["project-qwenta"] }] });
  const signal = engine.evaluateAlignment({ projectId: "project-qwenta" });
  const planning = engine.planningContext({ profileScope: "arnaud" });
  assert.equal(signal.singleSignal, true); assert.equal(signal.priorityScore, undefined);
  assert.equal(planning.ownsCalendarSlots, false); assert.equal(planning.ownsPriorities, false); assert.equal(planning.candidateAllocations[0].estimatedMinutes, null);
});

test("Goal produit un critère V2 strict et Decision V2 reste consultatif", () => {
  const { engine } = fixture(); const created = goal(engine); const criterion = engine.decisionCriterion(created.goalId);
  assert.deepEqual(Object.keys(criterion).sort(), ["criterionId", "direction", "importance", "label", "range", "requiredEvidence", "type"]);
  assert.equal(criterion.type, "STRATEGIC_FIT"); assert.equal(criterion.direction, "MAXIMIZE"); assert.equal(criterion.importance, "HIGH"); assert.equal(criterion.requiredEvidence, "VERIFIED"); assert.equal(criterion.range, null);
  const direct = engine.evaluateAlignment({ projectId: "project-qwenta" }); assert.equal(direct.alignments[0].alignment, "DIRECT");
  const request = normalizeDecisionRequestV2(goalDecisionRequest(created, criterion)); const decision = createDecisionSupportEngine().compare(request, { attestedEvidenceIds: [] });
  assert.equal(decision.schemaVersion, 2); assert.notEqual(decision.verdict, "DECIDED"); assert.equal(decision.evidenceSummary.eligible, 0); assert.ok(decision.unknowns.some((item) => item.reasonCode === "EVIDENCE_NOT_ATTESTED")); assert.equal(createDecisionSupportEngine().health().executionAuthority, false); assert.equal(decision.actionAuthorized, false); assert.equal(decision.verificationAuthorized, false);
});

test("les contraintes Goal textuelles ne deviennent jamais des Hard Rules V2", () => {
  const { engine } = fixture(); const created = goal(engine, { constraints: [{ description: "Rester sous le budget", strength: "HARD", evidenceRefs: ["budget-note"] }] });
  assert.deepEqual(engine.decisionConstraints(created.goalId), []);
});

test("Daily Brief reste compact et Weekly Review expose la dernière revue", () => {
  const { engine } = fixture(); const created = goal(engine, { milestones: [{ title: "Soutenance" }] });
  engine.reviewGoal(created.goalId, { strategyFit: "FIT" });
  const daily = engine.briefContext({ profileScope: "arnaud" }); const weekly = engine.briefContext({ profileScope: "arnaud" }, { weekly: true });
  assert.equal(daily.length, 1); assert.equal(daily[0].review, undefined); assert.equal(weekly[0].review.strategyFit, "FIT");
});

test("le roadmap est dérivé et ne possède aucune autorité d'exécution", () => {
  const { engine } = fixture(); const created = goal(engine, { milestones: [{ title: "Soutenance" }] }); const roadmap = engine.roadmap(created.goalId);
  assert.equal(roadmap.derived, true); assert.equal(roadmap.executionAuthority, false); assert.equal(roadmap.milestones.length, 1);
});

test("les reviews conservent preuves, trajectoire et stratégie sans inventer", () => {
  const { engine } = fixture(); const created = goal(engine); const review = engine.reviewGoal(created.goalId, { strategyFit: "REVIEW_NEEDED" });
  assert.equal(review.trajectory, "UNKNOWN"); assert.equal(review.strategyFit, "REVIEW_NEEDED"); assert.deepEqual(review.evidenceRefs, []);
});

test("la télémétrie ne contient ni titre, ni outcome, ni stratégie", () => {
  const { engine, events } = fixture(); goal(engine);
  const serialized = JSON.stringify(events); assert.doesNotMatch(serialized, /Terminer la formation|validation complète/); assert.match(serialized, /goal_created/);
});
