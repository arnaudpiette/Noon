"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createDecisionSupportEngine, filterEvidence } = require("../services/decision/decision-support-engine");
const { createDecisionHistoryService } = require("../services/decision/decision-history-service");

const COST = { criterionId: "cost", label: "Coût", type: "COST", importance: "HIGH", direction: "MINIMIZE", source: "explicit_user", range: { min: 0, max: 100 } };
const QUALITY = { criterionId: "quality", label: "Qualité", type: "QUALITY", importance: "HIGH", source: "explicit_user" };
function base(overrides = {}) {
  return { decisionId: "decision-fictive", question: "A ou B ?", decisionType: "COMPARE", workspaceId: "ws-a", profileScope: "arnaud",
    options: [
      { optionId: "a", label: "Option A", evidenceRefs: ["e-a"], values: { cost: 20, quality: "GOOD" } },
      { optionId: "b", label: "Option B", evidenceRefs: ["e-b"], values: { cost: 80, quality: "EXCELLENT" } },
    ], criteria: [COST, QUALITY], evidence: [
      { evidenceId: "e-a", workspaceId: "ws-a", profileScope: "arnaud" },
      { evidenceId: "e-b", workspaceId: "ws-a", profileScope: "arnaud" },
    ], ...overrides };
}

test("COMPARE produit options, critères, trade-offs et aucune action", () => {
  const result = createDecisionSupportEngine().compare(base());
  assert.equal(result.options.length, 2); assert.equal(result.criteria.length, 2); assert.ok(result.keyTradeoffs.length);
  assert.equal(result.recommendationIsAction, false); assert.equal(result.actionAuthorized, false); assert.equal(result.metrics.searchCalls, 0);
});

test("un critère explicite remplace un critère par défaut concurrent", () => {
  const request = base({ criteria: [{ ...COST, importance: "LOW", source: "default" }, { ...COST, importance: "CRITICAL", source: "explicit_user" }] });
  const result = createDecisionSupportEngine().compare(request); assert.equal(result.criteria.length, 1); assert.equal(result.criteria[0].importance, "CRITICAL");
});

test("une Hard Rule prime même sur un critère utilisateur", () => {
  const request = base({ criteria: [{ ...COST, source: "explicit_user" }, { ...COST, source: "hard_rule", hardConstraint: true, constraint: { operator: "MAX", value: 50 } }] });
  const result = createDecisionSupportEngine().compare(request); assert.equal(result.criteria[0].source, "hard_rule");
  assert.equal(result.options.find((item) => item.optionId === "b").status, "INFEASIBLE");
});

test("une contrainte dure rend l'option infeasible au lieu de réduire son score", () => {
  const result = createDecisionSupportEngine().compare(base({ constraints: [{ criterionId: "budget", label: "Budget maximum", type: "COST", importance: "CRITICAL", source: "hard_rule", direction: "MINIMIZE", constraint: { operator: "MAX", value: 50 } }],
    options: [{ optionId: "a", label: "A", values: { budget: 40 } }, { optionId: "b", label: "B", values: { budget: 80 } }], criteria: [] }));
  assert.equal(result.options[1].status, "INFEASIBLE"); assert.ok(result.blockers.some((item) => item.optionId === "b"));
});

test("une valeur inconnue reste UNKNOWN sans note moyenne inventée", () => {
  const result = createDecisionSupportEngine().compare(base({ options: [{ optionId: "a", label: "A", values: { quality: "UNKNOWN" } }, { optionId: "b", label: "B", values: { quality: "GOOD" } }], criteria: [QUALITY], evidence: [] }));
  const unknown = result.evaluations.find((item) => item.optionId === "a"); assert.equal(unknown.assessment, "UNKNOWN"); assert.equal(unknown.normalizedValue, null);
  assert.doesNotMatch(JSON.stringify(result), /\d+\.\d+\s*%/);
});

test("aucune troisième option n'est inventée", () => { const result = createDecisionSupportEngine().compare(base()); assert.deepEqual(result.options.map((item) => item.optionId), ["a", "b"]); });

test("une option découverte explicitement reste identifiée comme DISCOVERED", () => {
  const request = base(); request.options = [...request.options, { optionId: "c", label: "Pilote", source: "DISCOVERED", values: { cost: 40, quality: "GOOD" } }];
  const result = createDecisionSupportEngine().compare(request); assert.equal(result.options.find((item) => item.optionId === "c").source, "DISCOVERED");
});

test("égalité : aucun faux gagnant", () => {
  const result = createDecisionSupportEngine().compare(base({ options: [{ optionId: "a", label: "A", values: { quality: "GOOD" } }, { optionId: "b", label: "B", values: { quality: "GOOD" } }], criteria: [QUALITY], evidence: [] }));
  assert.equal(result.recommendationType, "TIE"); assert.equal(result.recommendedOptionId, null);
});

test("trade-offs symétriques : résultat dépendant des valeurs utilisateur", () => {
  const result = createDecisionSupportEngine().compare(base({ options: [
    { optionId: "a", label: "A", evidenceRefs: ["e-a"], values: { cost: 10, quality: "WEAK" } },
    { optionId: "b", label: "B", evidenceRefs: ["e-b"], values: { cost: 75, quality: "EXCELLENT" } },
  ] }));
  assert.equal(result.recommendationType, "USER_VALUE_DEPENDENT"); assert.equal(result.recommendedOptionId, null);
});

test("aucune option faisable est annoncé sans compenser les contraintes", () => {
  const result = createDecisionSupportEngine().compare(base({ criteria: [], constraints: [{ criterionId: "budget", label: "Budget", type: "COST", importance: "CRITICAL", source: "hard_rule", constraint: { operator: "MAX", value: 10 } }],
    options: [{ optionId: "a", label: "A", values: { budget: 20 } }, { optionId: "b", label: "B", values: { budget: 30 } }], evidence: [] }));
  assert.equal(result.recommendationType, "NO_FEASIBLE_OPTION"); assert.equal(result.recommendedOptionId, null);
});

test("risques qualitatifs conservent mitigation et preuves sans faux calcul", () => {
  const request = base(); request.options[0].metadata = { risks: [{ category: "TECHNICAL", likelihood: "MEDIUM", impact: "HIGH", confidence: "LOW", mitigation: "Pilote limité", evidenceRefs: ["e-a"] }] };
  const result = createDecisionSupportEngine().compare(request); assert.equal(result.risks[0].likelihood, "MEDIUM"); assert.equal(result.risks[0].impact, "HIGH"); assert.equal(result.risks[0].mitigation, "Pilote limité");
});

test("rendu vocal condense recommandation, raisons, coût principal et incertitude", () => {
  const engine = createDecisionSupportEngine(); const result = engine.compare(base()); const voice = engine.render(result, { channel: "voice" });
  assert.ok(voice.recommendation); assert.ok(voice.reasons.length <= 3); assert.ok(Object.hasOwn(voice, "mainDownside")); assert.ok(voice.uncertainty);
});

test("preuves insuffisantes : clarification minimale proposée", () => {
  const result = createDecisionSupportEngine().compare(base({ criteria: [], evidence: [] }));
  assert.equal(result.recommendationType, "INSUFFICIENT_EVIDENCE"); assert.equal(result.nextActions.length, 1); assert.equal(result.nextActions[0].type, "VERIFY_FACT");
});

test("COMPARE_ONLY respecte l'autonomie et ne recommande rien", () => {
  const result = createDecisionSupportEngine().compare(base({ outputMode: "COMPARE_ONLY" })); assert.equal(result.recommendationType, "COMPARE_ONLY"); assert.equal(result.recommendedOptionId, null);
});

test("what-if recalcule les poids sans recherche ni appel modèle", () => {
  const engine = createDecisionSupportEngine(); const scenarios = engine.sensitivity(base(), [{ scenarioId: "cost-first", overrides: { COST: "CRITICAL", QUALITY: "LOW" } }, { scenarioId: "quality-first", overrides: { COST: "LOW", QUALITY: "CRITICAL" } }]);
  assert.equal(scenarios.length, 2); assert.equal(engine.health().searchRequests, 0); assert.equal(engine.health().actionsExecuted, 0);
});

test("cache isolé par workspace et invalidé par version de contexte", () => {
  const engine = createDecisionSupportEngine(); const first = engine.compare(base()); engine.compare(base()); assert.equal(engine.health().cacheHits, 1);
  const other = engine.compare(base({ workspaceId: "ws-b", evidence: [] })); assert.notEqual(first.decisionContextFingerprint, other.decisionContextFingerprint);
  const newer = engine.compare(base({ contextVersion: "2" })); assert.notEqual(first.decisionContextFingerprint, newer.decisionContextFingerprint);
});

test("local_only, workspace et profil sont filtrés du contexte distant", () => {
  const request = base({ evidence: [
    { evidenceId: "ok", workspaceId: "ws-a", profileScope: "arnaud" },
    { evidenceId: "local", workspaceId: "ws-a", profileScope: "arnaud", localOnly: true },
    { evidenceId: "workspace-leak", workspaceId: "ws-b", profileScope: "arnaud" },
    { evidenceId: "profile-leak", workspaceId: "ws-a", profileScope: "alexandra" },
  ] });
  assert.deepEqual(filterEvidence(require("../services/decision/decision-schema").normalizeDecisionRequest(request), { remote: true }).map((item) => item.evidenceId), ["ok"]);
});

test("preuves obsolètes et conflits restent visibles", () => {
  const result = createDecisionSupportEngine().compare(base({ evidence: [{ evidenceId: "e-a", workspaceId: "ws-a", profileScope: "arnaud", stale: true }, { evidenceId: "e-b", workspaceId: "ws-a", profileScope: "arnaud", conflict: true }] }));
  assert.equal(result.status, "STALE"); assert.deepEqual(result.uncertainties.staleEvidenceRefs, ["e-a"]); assert.deepEqual(result.uncertainties.conflicts, ["e-b"]);
});

test("panne partielle d'un critère ne supprime aucune option", () => {
  const result = createDecisionSupportEngine().compare(base({ options: [{ optionId: "a", label: "A", values: { cost: 20 } }, { optionId: "b", label: "B", values: { quality: "GOOD" } }], evidence: [] }));
  assert.equal(result.options.length, 2); assert.equal(result.uncertainties.state, "PARTIAL");
});

test("un choix exige confirmation explicite et ne crée aucune préférence", () => {
  const engine = createDecisionSupportEngine(); assert.throws(() => engine.recordChoice({ decisionId: "d", chosenOptionId: "a" }), { code: "DECISION_CONFIRMATION_REQUIRED" });
  const record = engine.recordChoice({ decisionId: "d", chosenOptionId: "b", userConfirmed: true, workspaceId: "ws-a" });
  assert.equal(record.memoryPreferenceCreated, false); assert.equal(record.userConfirmed, true);
});

test("un changement de choix conserve l'ancien comme SUPERSEDED", () => {
  const history = createDecisionHistoryService(); const first = history.recordChoice({ decisionId: "d", chosenOptionId: "a", userConfirmed: true, workspaceId: "ws-a" });
  const second = history.recordChoice({ decisionId: "d", chosenOptionId: "b", userConfirmed: true, workspaceId: "ws-a", supersedesDecisionRecordId: first.decisionRecordId });
  assert.equal(history.get(first.decisionRecordId).status, "SUPERSEDED"); assert.equal(second.supersedesDecisionRecordId, first.decisionRecordId);
});

test("historique isolé par workspace et profil", () => {
  const history = createDecisionHistoryService(); history.recordChoice({ decisionId: "d", chosenOptionId: "a", userConfirmed: true, workspaceId: "ws-a", profileScope: "arnaud" });
  assert.equal(history.list({ workspaceId: "ws-b" }).length, 0); assert.equal(history.list({ profileScope: "alexandra" }).length, 0);
});

test("une décision peut être marquée REVIEW_NEEDED sans inversion automatique", () => {
  const history = createDecisionHistoryService(); const record = history.recordChoice({ decisionId: "d", chosenOptionId: "a", userConfirmed: true });
  const stale = history.markStale(record.decisionRecordId, "PRICE_CHANGED"); assert.equal(stale.status, "REVIEW_NEEDED"); assert.equal(stale.chosenOptionId, "a");
});

test("l'observabilité ne reçoit ni question, ni critères privés, ni preuves", () => {
  const events = []; createDecisionSupportEngine({ audit: (event, metadata) => events.push({ event, metadata }) }).compare(base({ question: "secret privé fictif" }));
  const serialized = JSON.stringify(events); assert.doesNotMatch(serialized, /secret privé|Option A|Coût|e-a/); assert.match(serialized, /optionsCount/);
});

test("le résultat ne contient ni urgence manipulatrice ni persuasion", () => {
  const serialized = JSON.stringify(createDecisionSupportEngine().compare(base())).toLowerCase();
  assert.doesNotMatch(serialized, /tu regretteras|seule bonne décision|urgent/i); assert.equal(createDecisionSupportEngine().health().persistentPreferenceInference, false);
});
