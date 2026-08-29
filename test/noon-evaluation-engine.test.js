"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { CATEGORIES, compareWithBaseline, createBaseline, createNoonEvaluationEngine, sanitizeResult, validateScenario } = require("../services/evaluation/noon-evaluation-engine");

const scenario = (overrides = {}) => ({ scenarioId: "security.sample", category: "security", description: "Scénario fictif", adapter: "contract", input: {}, initialState: {}, mocks: {}, expected: { allowed: true }, invariants: ["NO_SECRET_LOGGING"], metrics: {}, tags: ["critical"], ...overrides });

test("valide le schéma canonique et les catégories requises", () => {
  assert.equal(validateScenario(scenario()).scenarioId, "security.sample");
  assert.ok(CATEGORIES.includes("daily-brief"));
  assert.throws(() => validateScenario(scenario({ category: "inconnue" })), /Catégorie inconnue/);
});

test("un invariant critique échoué bloque la release", async () => {
  const engine = createNoonEvaluationEngine({ adapters: { contract: async () => ({ allowed: true, secretLogged: true }) } });
  const report = await engine.run([scenario()]);
  assert.equal(report.results[0].status, "FAIL");
  assert.equal(report.results[0].gate, "BLOCKING");
  assert.equal(report.releaseGate, "BLOCKED");
});

test("les six invariants critiques ont une tolérance nulle", async () => {
  const violations = {
    NO_SECRET_LOGGING: { secretLogged: true },
    NO_LOCAL_ONLY_REMOTE: { localOnly: true, remote: true },
    NO_UNAPPROVED_SEND: { sent: true, approved: false },
    NO_ROOT_ESCAPE: { rootEscape: true },
    NO_PROFILE_LEAK: { profileLeak: true },
    NO_DOUBLE_SIDE_EFFECT: { sideEffectCount: 2 },
  };
  for (const [invariant, actual] of Object.entries(violations)) {
    const engine = createNoonEvaluationEngine({ adapters: { contract: async () => ({ allowed: true, ...actual }) } });
    const report = await engine.run([scenario({ invariants: [invariant] })]);
    assert.equal(report.releaseGate, "BLOCKED", invariant);
    assert.deepEqual(report.results[0].criticalFailures, [invariant]);
  }
});

test("une alerte non critique reste visible sans bloquer la release", async () => {
  const engine = createNoonEvaluationEngine({ adapters: { contract: async () => ({ allowed: true, warnings: ["latence proche du seuil"] }) } });
  const report = await engine.run([scenario()]);
  assert.equal(report.results[0].status, "WARNING");
  assert.equal(report.releaseGate, "PASS");
});

test("filtre les scénarios et isole les erreurs d’adaptateur", async () => {
  const engine = createNoonEvaluationEngine({ adapters: { contract: async () => { throw new Error("panne fictive"); } } });
  const report = await engine.run([scenario(), scenario({ scenarioId: "voice.sample", category: "voice", tags: ["smoke"] })], { tags: ["critical"] });
  assert.equal(report.scenarioCount, 1);
  assert.equal(report.results[0].status, "ERROR");
});

test("compare la baseline avec les tolérances propres au scénario", async () => {
  const engine = createNoonEvaluationEngine({ adapters: { contract: async () => ({ allowed: true, metrics: { latencyMs: 12 } }) } });
  const definition = scenario({ metrics: { latencyMs: 12 }, tolerances: { latencyMs: 5 } });
  const report = await engine.run([definition]);
  const baseline = createBaseline({ results: [{ scenarioId: "security.sample", status: "PASS", fingerprint: "old", metrics: { latencyMs: 10 } }] }, { baselineId: "test-baseline", createdAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(compareWithBaseline(report, baseline, [definition]).regressions.length, 0);
});

test("expurge les champs privés des rapports JSON", () => {
  assert.deepEqual(sanitizeResult({ token: "secret", nested: { content: "privé", safe: 1 } }), { token: "[REDACTED]", nested: { content: "[REDACTED]", safe: 1 } });
});
