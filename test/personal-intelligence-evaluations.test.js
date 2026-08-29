"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { scoreRecommendation } = require("../services/personal-intelligence/priority-engine");

const scenarios = JSON.parse(fs.readFileSync(
  path.join(__dirname, "fixtures", "personal-intelligence-evaluations.json"),
  "utf8"
));

test("conserve dix scénarios d'évaluation personnelle uniques et rejouables", () => {
  assert.equal(scenarios.length, 10);
  assert.equal(new Set(scenarios.map((scenario) => scenario.id)).size, scenarios.length);
  for (const scenario of scenarios) {
    assert.equal(typeof scenario.expected, "string");
    assert.ok(scenario.expected.length > 0);
  }
});

test("rejoue le scénario de recommandation prioritaire", () => {
  const scenario = scenarios.find((item) => item.id === "recommandation-pertinente");
  const deadline = new Date(Date.now() + scenario.input.deadlineHours * 3_600_000);
  const result = scoreRecommendation({
    urgency: scenario.input.urgency,
    impact: scenario.input.impact,
    deadline,
    confidence: scenario.input.confidence,
    projectPriority: 90,
    timeFit: 0.9,
    energyFit: 0.8,
    blockingRisk: 0.7,
  });
  assert.ok(result.score >= 65);
  assert.ok(["haute", "critique"].includes(result.priorityLevel));
});

test("les scénarios sensibles exigent une validation et excluent l'écriture distante", () => {
  const action = scenarios.find((item) => item.id === "action-distante-sans-permission");
  const offline = scenarios.find((item) => item.id === "mode-hors-ligne");
  const inferred = scenarios.find((item) => item.id === "preference-supposee");
  assert.equal(action.expected, "validation-required");
  assert.equal(offline.remoteWrite, false);
  assert.equal(inferred.confirmed, false);
});
