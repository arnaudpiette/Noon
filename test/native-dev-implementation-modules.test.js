"use strict";

// V3-L7 — découpe de native-dev-implementation-engine.js : exports publics inchangés (mêmes
// fonctions), aides pures, et opérations construites avec les dépendances du moteur.
const assert = require("node:assert/strict");
const test = require("node:test");
const engine = require("../services/dev/native-dev-implementation-engine");
const helpers = require("../services/dev/native-dev-implementation-helpers");
const { createNativeDevInspection } = require("../services/dev/native-dev-implementation-inspection");
const { createNativeDevSkillExecution } = require("../services/dev/native-dev-implementation-skills");

test("le moteur réexporte les mêmes fonctions publiques", () => {
  assert.deepEqual(Object.keys(engine).sort(), ["createNativeDevImplementationEngine", "isBlockingValidationFailure", "normalizeReasoning"]);
  assert.equal(engine.normalizeReasoning, helpers.normalizeReasoning);
  assert.equal(engine.isBlockingValidationFailure, helpers.isBlockingValidationFailure);
});

test("aides pures : dédoublonnage, erreur sûre bornée, phases autorisées", () => {
  assert.deepEqual(helpers.unique(["a", "b", "a"]), ["a", "b"]);
  const error = helpers.safeError(Object.assign(new Error("x".repeat(500)), { code: "C".repeat(200) }));
  assert.equal(error.code.length, 80);
  assert.equal(error.message.length, 240);
  assert.deepEqual([...helpers.ALLOWED_PHASES], ["PLAN", "EDIT", "DIAGNOSE", "REPAIR"]);
});

test("opérations construites à partir des dépendances fournies", () => {
  const inspection = createNativeDevInspection({ journal: { start() {} } });
  assert.deepEqual(Object.keys(inspection), ["inspect", "inspectLocalDependencies"]);
  const skills = createNativeDevSkillExecution({ journal: {}, operationalSecurityPolicy: {}, skillRegistry: {}, transactionalExecutionEngine: {}, validationRunner: () => {} });
  assert.deepEqual(Object.keys(skills), ["authorize", "executeSkill", "validate"]);
});

test("le moteur refuse toujours une dépendance manquante avant de construire ses opérations", () => {
  assert.throws(() => engine.createNativeDevImplementationEngine({}), TypeError);
});
