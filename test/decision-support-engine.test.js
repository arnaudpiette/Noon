"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createDecisionSupportEngine, filterEvidence } = require("../services/decision/decision-support-engine");
const { createDecisionHistoryService } = require("../services/decision/decision-history-service");
const { fingerprintDecisionContextV2, normalizeDecisionContract, normalizeDecisionRequest, normalizeDecisionRequestV2, normalizeDecisionResultV2 } = require("../services/decision/decision-schema");

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

function v2Request(overrides = {}) {
  return { schemaVersion: 2, decisionId: "decision-v2", question: "A ou B ?", decisionType: "COMPARE", evaluationAt: "2026-10-09T10:00:00.000Z",
    scope: { profileScope: "arnaud", workspaceId: "ws-a", projectId: null, purpose: "LOCAL_ANALYSIS" },
    options: [
      { optionId: "a", label: "Option A", source: "USER_PROVIDED", assumptions: ["Budget stable"], values: { cost: 20, quality: "GOOD" } },
      { optionId: "b", label: "Option B", source: "DISCOVERED", values: { cost: 80, quality: "EXCELLENT" } },
    ],
    criteria: [
      { criterionId: "cost", label: "Coût", type: "COST", importance: "HIGH", direction: "MINIMIZE", requiredEvidence: "VERIFIED", range: { min: 0, max: 100 } },
      { criterionId: "quality", label: "Qualité", type: "QUALITY", importance: "HIGH", direction: "MAXIMIZE", requiredEvidence: "NONE", range: null },
    ],
    constraints: [{ constraintId: "budget", optionId: null, criterionId: "cost", operator: "MAX", expected: 100, strength: "HARD", evidenceRequirement: "VERIFIED" }],
    evidence: [
      { evidenceId: "e-root", claimId: "claim-cost-a", optionId: "a", criterionId: "cost", stance: "SUPPORTS", value: 20, kind: "SYSTEM_OBSERVATION", authority: "SYSTEM", verificationStatus: "VERIFIED", critical: true,
        provenance: { producer: "fixture", sourceType: "test", sourceRef: "local-ref", locatorRef: null, method: "read-after-write", rootEvidenceId: null }, scope: { profileScope: "arnaud", workspaceId: "ws-a", projectId: null, purpose: "LOCAL_ANALYSIS" }, observedAt: "2026-10-09T09:00:00Z", validUntil: null, freshnessRequirement: "CURRENT", claimFingerprint: "sha256:claim-a", independenceKey: "fixture-root", derivedFromEvidenceIds: [], localOnly: true, allowedForRemoteModel: false, untrustedContent: false },
      { evidenceId: "e-child", claimId: "claim-cost-a", optionId: "a", criterionId: "cost", stance: "NEUTRAL", value: null, kind: "INFERENCE", authority: "AGENT", verificationStatus: "UNVERIFIED",
        provenance: { producer: "fixture", sourceType: "derived", method: "inference", rootEvidenceId: "e-root" }, scope: { profileScope: "arnaud", workspaceId: "ws-a", projectId: null, purpose: "LOCAL_ANALYSIS" }, claimFingerprint: "sha256:claim-a", independenceKey: "fixture-root", derivedFromEvidenceIds: ["e-root"] },
    ],
    verificationProposals: [{ verificationId: "verify-cost-a", resolvesClaimIds: ["claim-cost-a"], type: "DETERMINISTIC_CHECK", requiredAuthority: "DETERMINISTIC", priority: "HIGH", estimatedCost: { currency: "USD", amount: null }, estimatedLatencyMs: 10, estimatedModelCalls: 0, estimatedToolRequests: 1, proposedOnly: true, authorizationState: "NOT_REQUESTED" }],
    budget: { authorityRef: "dev", state: "AVAILABLE", remainingCost: null, remainingModelCalls: 4, remainingToolRequests: 8, remainingWallTimeMs: 1000 },
    recommendationRequested: true, outputMode: "DETAILED", contextVersion: "ctx-1", ...overrides };
}

function v2Result(request) {
  return { schemaVersion: 2, engineVersion: "decision-support-v2", decisionId: request.decisionId, verdict: "NEEDS_MORE_EVIDENCE", recommendedOptionId: null, reasonCodes: ["CLAIM_UNVERIFIED"],
    rankedOptions: [{ optionId: "a", rank: 1, supportScore: 3, evidenceCoverage: 0.5, constraintState: "UNKNOWN" }, { optionId: "b", rank: 2, supportScore: null, evidenceCoverage: 0, constraintState: "UNKNOWN" }],
    constraints: [{ constraintId: "budget", optionId: "a", status: "UNKNOWN", reasonCodes: ["EVIDENCE_REQUIRED"] }],
    unknowns: [{ unknownId: "unknown-a", claimId: "claim-cost-a", optionId: "a", criterionId: "cost", reasonCode: "UNVERIFIED" }], conflicts: [], verificationProposals: request.verificationProposals,
    stopReason: "Preuve vérifiée requise", evidenceSummary: { eligible: 1, excluded: 1, stale: 0, duplicate: 0, dependent: 1 },
    supportScore: { scale: "ORDINAL_0_4_WEIGHTED", byOption: { a: 3, b: null }, calibratedProbability: null, calibrationStatus: "NOT_CALIBRATED" }, evidenceCoverage: { byOption: { a: 0.5, b: 0 }, criticalCellsComplete: false },
    recommendationIsAction: false, actionAuthorized: false, verificationAuthorized: false, decisionContextFingerprint: fingerprintDecisionContextV2(request), publicMetadata: { optionCount: 2, hasConflict: false } };
}

test("contrat V2 complet : forme stricte, ordre canonique et NOT_CALIBRATED", () => {
  const request = normalizeDecisionRequestV2(v2Request({ options: [...v2Request().options].reverse(), criteria: [...v2Request().criteria].reverse(), evidence: [...v2Request().evidence].reverse() }));
  assert.deepEqual(request.options.map((item) => item.optionId), ["a", "b"]); assert.deepEqual(request.criteria.map((item) => item.criterionId), ["cost", "quality"]); assert.equal(request.evidence[0].evidenceId, "e-child");
  assert.equal(request.evidence[0].provenance.method, "inference"); assert.equal(request.verificationProposals[0].proposedOnly, true); assert.equal(request.budget.state, "AVAILABLE"); assert.ok(Object.isFrozen(request.evidence[0].provenance));
  const result = normalizeDecisionResultV2(v2Result(request), request); assert.equal(result.supportScore.calibrationStatus, "NOT_CALIBRATED"); assert.equal(result.supportScore.calibratedProbability, null); assert.equal(result.actionAuthorized, false);
});

test("V2 produit un fingerprint stable sans UUID ni horloge cachée", () => {
  const first = v2Request(), second = v2Request({ options: [...v2Request().options].reverse(), criteria: [...v2Request().criteria].reverse(), evidence: [...v2Request().evidence].reverse() });
  assert.equal(fingerprintDecisionContextV2(first), fingerprintDecisionContextV2(second)); assert.equal(normalizeDecisionRequestV2(first).decisionId, "decision-v2");
});

test("V2 refuse champs requis, enums, types, nombres, ranges et champs inconnus", () => {
  const cases = [
    ["requis", (raw) => { delete raw.decisionId; }, "DECISION_V2_STRING_INVALID"],
    ["enum", (raw) => { raw.decisionType = "MAYBE"; }, "DECISION_V2_ENUM_INVALID"],
    ["type", (raw) => { raw.options = {}; }, "DECISION_V2_TYPE_INVALID"],
    ["non fini", (raw) => { raw.criteria[0].range.max = Infinity; }, "DECISION_V2_NUMBER_INVALID"],
    ["range inversé", (raw) => { raw.criteria[0].range = { min: 2, max: 1 }; }, "DECISION_V2_RANGE_INVALID"],
    ["hors limite", (raw) => { raw.options[0].label = "x".repeat(181); }, "DECISION_V2_BOUND_EXCEEDED"],
    ["champ inconnu", (raw) => { raw.options[0].trusted = true; }, "DECISION_V2_FIELD_UNKNOWN"],
    ["date", (raw) => { raw.evaluationAt = "demain"; }, "DECISION_V2_DATE_INVALID"],
  ];
  for (const [name, mutate, code] of cases) { const raw = v2Request(); mutate(raw); assert.throws(() => normalizeDecisionRequestV2(raw), (error) => error.code === code, name); }
});

test("V2 refuse dépassements de collections sans troncature", () => {
  const raw = v2Request(); raw.options = Array.from({ length: 21 }, (_, i) => ({ optionId: `o-${i}`, label: `Option ${i}`, source: "USER_PROVIDED", values: {} }));
  assert.throws(() => normalizeDecisionRequestV2(raw), (error) => error.code === "DECISION_V2_BOUND_EXCEEDED");
  const assumptions = v2Request(); assumptions.options[0].assumptions = Array(21).fill("a"); assert.throws(() => normalizeDecisionRequestV2(assumptions), (error) => error.code === "DECISION_V2_BOUND_EXCEEDED");
});

test("V2 refuse identifiants dupliqués et références incohérentes", () => {
  const cases = [
    [(raw) => { raw.options[1].optionId = "a"; }, "DECISION_V2_ID_DUPLICATE"],
    [(raw) => { raw.evidence[0].criterionId = "missing"; }, "DECISION_V2_REFERENCE_INVALID"],
    [(raw) => { raw.verificationProposals[0].resolvesClaimIds = ["missing"]; }, "DECISION_V2_REFERENCE_INVALID"],
    [(raw) => { raw.options[0].values.missing = 1; }, "DECISION_V2_REFERENCE_INVALID"],
  ];
  for (const [mutate, code] of cases) { const raw = v2Request(); mutate(raw); assert.throws(() => normalizeDecisionRequestV2(raw), (error) => error.code === code); }
});

test("V2 refuse dépendance absente, self-reference, cycle et profondeur supérieure à 12", () => {
  for (const mutate of [(raw) => { raw.evidence[1].derivedFromEvidenceIds = ["missing"]; }, (raw) => { raw.evidence[0].derivedFromEvidenceIds = ["e-root"]; }, (raw) => { raw.evidence[0].derivedFromEvidenceIds = ["e-child"]; }]) {
    const raw = v2Request(); mutate(raw); assert.throws(() => normalizeDecisionRequestV2(raw), (error) => error.code === "DECISION_EVIDENCE_DEPENDENCY_INVALID");
  }
  const deep = v2Request(); deep.evidence = Array.from({ length: 14 }, (_, i) => ({ ...deep.evidence[0], evidenceId: `e-${i}`, claimId: `c-${i}`, provenance: { ...deep.evidence[0].provenance, rootEvidenceId: null }, derivedFromEvidenceIds: i ? [`e-${i - 1}`] : [] })); deep.verificationProposals = [];
  assert.throws(() => normalizeDecisionRequestV2(deep), (error) => error.code === "DECISION_EVIDENCE_DEPENDENCY_INVALID");
});

test("normalisation V2 ne mute aucune entrée", () => {
  const raw = v2Request(), snapshot = structuredClone(raw); normalizeDecisionRequestV2(raw); assert.deepEqual(raw, snapshot);
});

test("V1 conserve ses fallbacks et ignore ses champs inconnus", () => {
  const raw = base({ schemaVersion: 1, decisionType: "INVALID", extra: true }); const normalized = normalizeDecisionContract(raw); assert.equal(normalized.decisionType, "COMPARE"); assert.equal("extra" in normalized, false);
});

test("une entrée V2 invalide ne retombe jamais dans le normaliseur V1", () => {
  const invalid = v2Request({ decisionType: "INVALID" });
  assert.throws(() => normalizeDecisionRequest(invalid), (error) => error.code === "DECISION_V2_EXPLICIT_NORMALIZER_REQUIRED");
  assert.throws(() => normalizeDecisionContract(invalid), (error) => error.code === "DECISION_V2_ENUM_INVALID");
});

test("résultat V2 refuse fausse calibration, autorité et couverture hors limites", () => {
  const request = normalizeDecisionRequestV2(v2Request());
  const cases = [
    [(raw) => { raw.supportScore.calibratedProbability = 0.9; }, "DECISION_V2_CALIBRATION_INVALID"],
    [(raw) => { raw.actionAuthorized = true; }, "DECISION_V2_AUTHORITY_INVALID"],
    [(raw) => { raw.evidenceCoverage.byOption.a = 1.1; }, "DECISION_V2_NUMBER_INVALID"],
    [(raw) => { raw.supportScore.byOption.a = 4.1; }, "DECISION_V2_NUMBER_INVALID"],
    [(raw) => { raw.recommendedOptionId = "missing"; }, "DECISION_V2_REFERENCE_INVALID"],
  ];
  for (const [mutate, code] of cases) { const raw = v2Result(request); mutate(raw); assert.throws(() => normalizeDecisionResultV2(raw, request), (error) => error.code === code); }
});

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

// ===== UNCERTAINTY DECISION V1 — TRANCHE 2 TESTS =====

function v2Evidence(overrides = {}) {
  const template = structuredClone(
    v2Request().evidence[0]
  );

  return {
    ...template,
    evidenceId: "e-quality-a",
    claimId: "claim-quality-a",
    optionId: "a",
    criterionId: "quality",
    stance: "SUPPORTS",
    value: "EXCELLENT",
    kind: "SYSTEM_OBSERVATION",
    authority: "SYSTEM",
    verificationStatus: "VERIFIED",
    critical: false,
    provenance: {
      ...template.provenance,
      producer: "fixture-authority",
      sourceType: "test",
      sourceRef: "fixture-ref",
      locatorRef: null,
      method: "deterministic-fixture",
      rootEvidenceId: null,
    },
    scope: structuredClone(v2Request().scope),
    observedAt: "2026-10-09T09:00:00.000Z",
    validUntil: "2026-10-10T09:00:00.000Z",
    freshnessRequirement: "CURRENT",
    claimFingerprint: "sha256:quality-a",
    independenceKey: "quality-a-root",
    derivedFromEvidenceIds: [],
    localOnly: false,
    allowedForRemoteModel: true,
    untrustedContent: false,
    ...overrides,
  };
}

function v2QualityRequest(overrides = {}) {
  const raw = v2Request();

  raw.criteria = [
    {
      criterionId: "quality",
      label: "Qualité",
      type: "QUALITY",
      importance: "HIGH",
      direction: "MAXIMIZE",
      requiredEvidence: "VERIFIED",
      range: null,
    },
  ];

  raw.constraints = [];

  raw.options = [
    {
      optionId: "a",
      label: "Option A",
      source: "USER_PROVIDED",
      assumptions: [],
      values: { quality: "EXCELLENT" },
    },
    {
      optionId: "b",
      label: "Option B",
      source: "USER_PROVIDED",
      assumptions: [],
      values: { quality: "GOOD" },
    },
  ];

  raw.evidence = [
    v2Evidence(),
    v2Evidence({
      evidenceId: "e-quality-b",
      claimId: "claim-quality-b",
      optionId: "b",
      value: "GOOD",
      claimFingerprint: "sha256:quality-b",
      independenceKey: "quality-b-root",
    }),
  ];

  raw.verificationProposals = [];

  return Object.assign(raw, overrides);
}

function compareV2(
  request,
  attestedEvidenceIds = request.evidence.map(
    (item) => item.evidenceId
  )
) {
  return createDecisionSupportEngine().compare(
    request,
    { attestedEvidenceIds }
  );
}

test(
  "V2 : une assertion LLM seule ne peut jamais produire DECIDED",
  () => {
    const request = v2QualityRequest();

    request.evidence = request.evidence.map(
      (item) => ({
        ...item,
        kind: "LLM_ASSERTION",
        authority: "AGENT",
        verificationStatus: "VERIFIED",
        provenance: {
          ...item.provenance,
          producer: "model-output",
          method: "llm-assertion",
        },
      })
    );

    const result = compareV2(
      request,
      request.evidence.map(
        (item) => item.evidenceId
      )
    );

    assert.notEqual(result.verdict, "DECIDED");
    assert.equal(
      result.evidenceSummary.eligible,
      0
    );
  }
);

test(
  "V2 : VERIFIED déclaratif sans attestation externe reste insuffisant",
  () => {
    const request = v2QualityRequest();

    const result = compareV2(
      request,
      []
    );

    assert.notEqual(result.verdict, "DECIDED");
    assert.equal(
      result.evidenceSummary.eligible,
      0
    );
    assert.ok(
      result.unknowns.some(
        (item) =>
          item.reasonCode ===
          "EVIDENCE_NOT_ATTESTED"
      )
    );
  }
);

test(
  "V2 : preuves admissibles attestées peuvent justifier DECIDED",
  () => {
    const request = v2QualityRequest();

    const result = compareV2(request);

    assert.equal(result.verdict, "DECIDED");
    assert.equal(
      result.recommendedOptionId,
      "a"
    );
    assert.equal(
      result.supportScore.calibrationStatus,
      "NOT_CALIBRATED"
    );
    assert.equal(
      result.supportScore.calibratedProbability,
      null
    );
    assert.equal(
      result.actionAuthorized,
      false
    );
    assert.equal(
      result.verificationAuthorized,
      false
    );
  }
);

test(
  "V2 : contrainte HARD violée bloque l'option malgré son score",
  () => {
    const request = v2QualityRequest();

    request.criteria.push({
      criterionId: "cost",
      label: "Coût",
      type: "COST",
      importance: "CRITICAL",
      direction: "MINIMIZE",
      requiredEvidence: "VERIFIED",
      range: { min: 0, max: 100 },
    });

    request.constraints = [
      {
        constraintId: "budget",
        optionId: null,
        criterionId: "cost",
        operator: "MAX",
        expected: 50,
        strength: "HARD",
        evidenceRequirement: "VERIFIED",
      },
    ];

    request.options[0].values.cost = 80;
    request.options[1].values.cost = 40;

    request.evidence.push(
      v2Evidence({
        evidenceId: "e-cost-a",
        claimId: "claim-cost-a",
        optionId: "a",
        criterionId: "cost",
        value: 80,
        critical: true,
        claimFingerprint: "sha256:cost-a",
        independenceKey: "cost-a-root",
      }),
      v2Evidence({
        evidenceId: "e-cost-b",
        claimId: "claim-cost-b",
        optionId: "b",
        criterionId: "cost",
        value: 40,
        critical: true,
        claimFingerprint: "sha256:cost-b",
        independenceKey: "cost-b-root",
      })
    );

    const result = compareV2(request);

    const aBudget = result.constraints.find(
      (item) =>
        item.constraintId === "budget" &&
        item.optionId === "a"
    );

    assert.equal(
      aBudget.status,
      "VIOLATED"
    );
    assert.notEqual(
      result.recommendedOptionId,
      "a"
    );
  }
);

test(
  "V2 : contrainte HARD sans preuve reste UNKNOWN et jamais satisfaite",
  () => {
    const request = v2Request();

    request.evidence = [];
    request.verificationProposals = [];

    const result = compareV2(
      request,
      []
    );

    assert.ok(
      result.constraints.every(
        (item) => item.status === "UNKNOWN"
      )
    );
    assert.notEqual(result.verdict, "DECIDED");
  }
);

test(
  "V2 : contradiction matérielle indépendante produit CONFLICT",
  () => {
    const request = v2QualityRequest();

    request.criteria[0].importance =
      "CRITICAL";

    request.evidence = [
      v2Evidence({
        evidenceId: "e-a-positive",
        claimId: "claim-quality-a",
        optionId: "a",
        value: "EXCELLENT",
        claimFingerprint: "sha256:q-a",
        independenceKey: "root-1",
      }),
      v2Evidence({
        evidenceId: "e-a-negative",
        claimId: "claim-quality-a",
        optionId: "a",
        stance: "OPPOSES",
        value: "POOR",
        claimFingerprint: "sha256:q-a-opposes",
        independenceKey: "root-2",
      }),
      v2Evidence({
        evidenceId: "e-b",
        claimId: "claim-quality-b",
        optionId: "b",
        value: "GOOD",
        claimFingerprint: "sha256:q-b",
        independenceKey: "root-b",
      }),
    ];

    const result = compareV2(request);

    assert.equal(result.verdict, "CONFLICT");
    assert.equal(
      result.stopReason,
      "MATERIAL_CONFLICT"
    );
    assert.ok(
      result.conflicts.some(
        (item) => item.material === true
      )
    );
  }
);

test(
  "V2 : preuves expirée future et hors scope sont exclues",
  () => {
    const request = v2QualityRequest();

    request.evidence = [
      v2Evidence({
        evidenceId: "expired",
        claimId: "claim-expired",
        validUntil:
          "2026-10-08T09:00:00.000Z",
      }),
      v2Evidence({
        evidenceId: "future",
        claimId: "claim-future",
        observedAt:
          "2026-10-10T09:00:00.000Z",
      }),
      v2Evidence({
        evidenceId: "foreign",
        claimId: "claim-foreign",
        scope: {
          ...request.scope,
          workspaceId: "ws-other",
        },
      }),
    ];

    const result = compareV2(request);

    assert.equal(
      result.evidenceSummary.eligible,
      0
    );
    assert.equal(
      result.evidenceSummary.excluded,
      3
    );
    assert.ok(
      result.unknowns.some(
        (item) =>
          item.reasonCode ===
          "EVIDENCE_EXPIRED"
      )
    );
    assert.ok(
      result.unknowns.some(
        (item) =>
          item.reasonCode ===
          "EVIDENCE_FROM_FUTURE"
      )
    );
    assert.ok(
      result.unknowns.some(
        (item) =>
          item.reasonCode ===
          "EVIDENCE_SCOPE_MISMATCH"
      )
    );
  }
);

test(
  "V2 : doublons et racines dépendantes ne sont jamais double comptés",
  () => {
    const request = v2QualityRequest();

    const root = v2Evidence({
      evidenceId: "root",
      claimId: "claim-quality-a",
      independenceKey: "shared-root",
    });

    request.evidence = [
      root,
      {
        ...structuredClone(root),
        evidenceId: "duplicate",
      },
      {
        ...structuredClone(root),
        evidenceId: "dependent",
        observedAt:
          "2026-10-09T09:01:00.000Z",
        derivedFromEvidenceIds: ["root"],
      },
      v2Evidence({
        evidenceId: "b-root",
        claimId: "claim-quality-b",
        optionId: "b",
        value: "GOOD",
        claimFingerprint: "sha256:q-b",
        independenceKey: "b-root",
      }),
    ];

    const result = compareV2(request);

    assert.equal(
      result.evidenceSummary.duplicate,
      1
    );
    assert.equal(
      result.evidenceSummary.dependent,
      1
    );
    assert.equal(
      result.evidenceSummary.eligible,
      2
    );
  }
);

test(
  "V2 : égalité ne crée aucun faux gagnant et reste stable par permutation",
  () => {
    const request = v2QualityRequest();

    request.options[0].values.quality =
      "GOOD";

    request.evidence[0].value = "GOOD";

    const first = compareV2(request);

    const permuted =
      structuredClone(request);

    permuted.options.reverse();
    permuted.evidence.reverse();

    const second = compareV2(permuted);

    assert.equal(
      first.verdict,
      "INSUFFICIENT_EVIDENCE"
    );
    assert.equal(
      first.stopReason,
      "NO_CLEAR_ADVANTAGE"
    );
    assert.equal(
      first.recommendedOptionId,
      null
    );

    assert.deepEqual(
      second,
      first
    );
  }
);

test(
  "V2 : couverture partielle ne suffit pas à établir un avantage vérifié",
  () => {
    const request = v2QualityRequest();

    request.evidence = [
      request.evidence[0],
    ];

    const result = compareV2(request);

    assert.equal(
      result.evidenceCoverage.byOption.a,
      1
    );
    assert.equal(
      result.evidenceCoverage.byOption.b,
      0
    );
    assert.notEqual(result.verdict, "DECIDED");
  }
);

test(
  "V2 : absence totale de preuve reste insuffisante",
  () => {
    const request = v2QualityRequest();

    request.evidence = [];

    const result = compareV2(
      request,
      []
    );

    assert.equal(
      result.verdict,
      "INSUFFICIENT_EVIDENCE"
    );
    assert.equal(
      result.evidenceSummary.eligible,
      0
    );
  }
);

test(
  "V2 : budget épuisé n'autorise jamais une vérification proposée",
  () => {
    const request = v2QualityRequest();

    request.evidence[1] = {
      ...request.evidence[1],
      kind: "LLM_ASSERTION",
      authority: "AGENT",
      verificationStatus: "UNVERIFIED",
    };

    request.verificationProposals = [
      {
        verificationId: "verify-b",
        resolvesClaimIds: [
          "claim-quality-b",
        ],
        type: "DETERMINISTIC_CHECK",
        requiredAuthority: "DETERMINISTIC",
        priority: "HIGH",
        estimatedCost: {
          currency: "USD",
          amount: null,
        },
        estimatedLatencyMs: 10,
        estimatedModelCalls: 0,
        estimatedToolRequests: 1,
        proposedOnly: true,
        authorizationState: "NOT_REQUESTED",
      },
    ];

    request.budget = {
      authorityRef: "dev",
      state: "EXHAUSTED",
      remainingCost: 0,
      remainingModelCalls: 0,
      remainingToolRequests: 0,
      remainingWallTimeMs: 0,
    };

    const result = compareV2(
      request,
      ["e-quality-a"]
    );

    assert.equal(
      result.verdict,
      "INSUFFICIENT_EVIDENCE"
    );
    assert.equal(
      result.stopReason,
      "BUDGET_EXHAUSTED"
    );
    assert.equal(
      result.verificationAuthorized,
      false
    );

    assert.ok(
      result.verificationProposals.every(
        (item) =>
          item.proposedOnly === true &&
          item.authorizationState ===
            "NOT_REQUESTED"
      )
    );
  }
);

test(
  "V2 : calcul pur ne mute pas l'entrée et observabilité exclut le contenu privé brut",
  () => {
    const request = v2QualityRequest({
      question:
        "PRIVATE_RAW_SECRET_92741",
    });

    request.evidence[0].provenance.sourceRef =
      "PRIVATE_SOURCE_SECRET_92741";

    const before =
      structuredClone(request);

    const events = [];

    const result =
      createDecisionSupportEngine({
        audit: (event, metadata) =>
          events.push({
            event,
            metadata,
          }),
      }).compare(
        request,
        {
          attestedEvidenceIds:
            request.evidence.map(
              (item) => item.evidenceId
            ),
        }
      );

    assert.deepEqual(request, before);

    const serialized =
      JSON.stringify({
        result,
        events,
      });

    assert.doesNotMatch(
      serialized,
      /PRIVATE_RAW_SECRET_92741/
    );

    assert.doesNotMatch(
      serialized,
      /PRIVATE_SOURCE_SECRET_92741/
    );

    assert.equal(
      result.actionAuthorized,
      false
    );
    assert.equal(
      result.verificationAuthorized,
      false
    );
  }
);

// ===== TRANCHE 2 — REVIEW SEMANTIQUE FINAL =====

test(
  "V2 : deux preuves descendant de la même racine ne sont pas double comptées même avec independenceKey différent",
  () => {
    const request = v2QualityRequest();

    const root = v2Evidence({
      evidenceId: "shared-root",
      claimId: "claim-quality-a",
      optionId: "a",
      independenceKey: "root-key",
      claimFingerprint: "sha256:shared-root",
    });

    const derived = v2Evidence({
      evidenceId: "derived-observation",
      claimId: "claim-quality-a",
      optionId: "a",
      independenceKey: "different-key",
      claimFingerprint: "sha256:derived",
      derivedFromEvidenceIds: ["shared-root"],
      provenance: {
        ...root.provenance,
        rootEvidenceId: "shared-root",
      },
    });

    request.evidence = [
      root,
      derived,
      v2Evidence({
        evidenceId: "b-root",
        claimId: "claim-quality-b",
        optionId: "b",
        value: "GOOD",
        claimFingerprint: "sha256:b-root",
        independenceKey: "b-root",
      }),
    ];

    const result = compareV2(request);

    assert.equal(
      result.evidenceSummary.eligible,
      2
    );

    assert.equal(
      result.evidenceSummary.dependent,
      1
    );
  }
);

test(
  "V2 : un conflit non CRITICAL pouvant changer le gagnant ne doit pas être absorbé par le score",
  () => {
    const request = v2QualityRequest();

    request.criteria[0].importance = "HIGH";

    request.evidence = [
      v2Evidence({
        evidenceId: "a-positive",
        claimId: "claim-quality-a",
        optionId: "a",
        value: "EXCELLENT",
        stance: "SUPPORTS",
        independenceKey: "source-a-1",
        claimFingerprint: "sha256:a-positive",
      }),
      v2Evidence({
        evidenceId: "a-negative",
        claimId: "claim-quality-a",
        optionId: "a",
        value: "POOR",
        stance: "OPPOSES",
        independenceKey: "source-a-2",
        claimFingerprint: "sha256:a-negative",
      }),
      v2Evidence({
        evidenceId: "b-stable",
        claimId: "claim-quality-b",
        optionId: "b",
        value: "GOOD",
        stance: "SUPPORTS",
        independenceKey: "source-b",
        claimFingerprint: "sha256:b-stable",
      }),
    ];

    const result = compareV2(request);

    assert.equal(
      result.verdict,
      "CONFLICT"
    );

    assert.equal(
      result.stopReason,
      "MATERIAL_CONFLICT"
    );

    assert.ok(
      result.conflicts.some(
        (item) =>
          item.claimId === "claim-quality-a" &&
          item.material === true
      )
    );
  }
);

test(
  "V2 : une preuve dérivée d'une racine exclue reste elle-même exclue",
  () => {
    const request =
      v2QualityRequest();

    const excludedRoot =
      v2Evidence({
        evidenceId: "excluded-root",
        claimId: "claim-quality-a",
        optionId: "a",
        kind: "LLM_ASSERTION",
        authority: "AGENT",
        verificationStatus:
          "UNVERIFIED",
        independenceKey:
          "excluded-root",
        claimFingerprint:
          "sha256:excluded-root",
      });

    const derived =
      v2Evidence({
        evidenceId:
          "derived-from-excluded",
        claimId: "claim-quality-a",
        optionId: "a",
        independenceKey:
          "derived-key",
        claimFingerprint:
          "sha256:derived-excluded",
        derivedFromEvidenceIds: [
          "excluded-root",
        ],
        provenance: {
          ...v2Evidence().provenance,
          rootEvidenceId:
            "excluded-root",
        },
      });

    request.evidence = [
      excludedRoot,
      derived,
      v2Evidence({
        evidenceId: "b-valid",
        claimId: "claim-quality-b",
        optionId: "b",
        value: "GOOD",
        independenceKey: "b-valid",
        claimFingerprint:
          "sha256:b-valid",
      }),
    ];

    const result = compareV2(
      request,
      [
        "derived-from-excluded",
        "b-valid",
      ]
    );

    assert.equal(
      result.evidenceSummary.eligible,
      1
    );

    assert.ok(
      result.unknowns.some(
        (item) =>
          item.reasonCode ===
          "EVIDENCE_DEPENDENCY_EXCLUDED"
      )
    );

    assert.notEqual(
      result.verdict,
      "DECIDED"
    );
  }
);

// ===== TRANCHE 2 — FINAL REGRESSION GUARDS =====

test(
  "V2 : un même independenceKey ne fusionne pas deux claims distincts",
  () => {
    const request = v2QualityRequest();

    request.evidence = [
      v2Evidence({
        evidenceId: "a-proof",
        claimId: "claim-quality-a",
        optionId: "a",
        value: "EXCELLENT",
        claimFingerprint: "sha256:a-proof",
        independenceKey: "shared-source",
      }),
      v2Evidence({
        evidenceId: "b-proof",
        claimId: "claim-quality-b",
        optionId: "b",
        value: "GOOD",
        claimFingerprint: "sha256:b-proof",
        independenceKey: "shared-source",
      }),
    ];

    const result = compareV2(request);

    assert.equal(
      result.evidenceSummary.eligible,
      2
    );

    assert.equal(
      result.evidenceSummary.dependent,
      0
    );

    assert.equal(
      result.evidenceCoverage.byOption.a,
      1
    );

    assert.equal(
      result.evidenceCoverage.byOption.b,
      1
    );
  }
);

test(
  "V2 : DECIDED exige une preuve pour chaque critère qui crée l'avantage",
  () => {
    const request = v2QualityRequest();

    request.criteria = [
      {
        criterionId: "quality",
        label: "Qualité",
        type: "QUALITY",
        importance: "HIGH",
        direction: "MAXIMIZE",
        requiredEvidence: "NONE",
        range: null,
      },
      {
        criterionId: "fit",
        label: "Fit",
        type: "STRATEGIC_FIT",
        importance: "HIGH",
        direction: "MAXIMIZE",
        requiredEvidence: "NONE",
        range: null,
      },
    ];

    request.options[0].values = {
      quality: "GOOD",
      fit: "EXCELLENT",
    };

    request.options[1].values = {
      quality: "NEUTRAL",
      fit: "POOR",
    };

    request.evidence = [
      v2Evidence({
        evidenceId: "quality-a",
        claimId: "claim-quality-a",
        optionId: "a",
        criterionId: "quality",
        value: "GOOD",
        claimFingerprint: "sha256:quality-a",
        independenceKey: "quality-a",
      }),
      v2Evidence({
        evidenceId: "quality-b",
        claimId: "claim-quality-b",
        optionId: "b",
        criterionId: "quality",
        value: "NEUTRAL",
        claimFingerprint: "sha256:quality-b",
        independenceKey: "quality-b",
      }),
    ];

    const result = compareV2(request);

    assert.ok(
      result.supportScore.byOption.a >
      result.supportScore.byOption.b
    );

    assert.notEqual(
      result.verdict,
      "DECIDED"
    );

    assert.equal(
      result.recommendedOptionId,
      null
    );
  }
);
