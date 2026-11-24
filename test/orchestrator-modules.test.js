"use strict";

// V3-L7 — découpe de noon-orchestrator.js : la décision d'intervention et les résultats sont
// construits avec les dépendances de l'orchestrateur (aucun état global partagé).
const assert = require("node:assert/strict");
const test = require("node:test");
const { createOrchestratorIntervention } = require("../services/orchestration/orchestrator-intervention");
const { createOrchestratorResults } = require("../services/orchestration/orchestrator-results");
const { createNoonOrchestrator } = require("../services/orchestration/noon-orchestrator");

test("fabriques : exactement les opérations attendues", () => {
  assert.deepEqual(Object.keys(createOrchestratorIntervention({ interventionPermissionEngine: null })), ["applyInterventionDecision"]);
  assert.deepEqual(Object.keys(createOrchestratorResults({ now: () => 0, observability: null, trace: () => {} })), ["specialistProposalResult", "finalResult"]);
});

test("deux jeux d'opérations construits séparément n'ont aucune fonction partagée", () => {
  const first = createOrchestratorResults({ now: () => 1, observability: null, trace: () => {} });
  const second = createOrchestratorResults({ now: () => 2, observability: null, trace: () => {} });
  assert.notEqual(first.finalResult, second.finalResult);
});

test("l'orchestrateur refuse toujours une dépendance manquante", () => {
  assert.throws(() => createNoonOrchestrator({}), TypeError);
});
