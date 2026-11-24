"use strict";

// V3-L7 — assemblage de la progression sorti de server.js : la progression rejoint le flux du
// chat seulement dans le contexte d'une requête, un affichage en échec ne casse jamais
// l'exécution, et la projection publique de l'API DEV reste tolérante.
const assert = require("node:assert/strict");
const test = require("node:test");
const { DEPENDENCIES, createProgressComposition } = require("../services/observability/progress-composition");
const { readServerSource } = require("./helpers/server-source");

const observability = () => ({ recordProgress() {}, recordEvent() {} });

test("dépendance manquante refusée", () => {
  assert.deepEqual([...DEPENDENCIES], ["noonObservability"]);
  assert.throws(() => createProgressComposition({}), /Dépendance manquante : noonObservability$/);
});

test("progression transmise au chat dans le contexte de la requête, et seulement là", () => {
  const { chatProgressRequestContext, userProgressAdapter, publicDevProgress } = createProgressComposition({ noonObservability: observability() });
  const written = [];
  userProgressAdapter.transactional("execution_awaiting_approval", { executionId: "hors-contexte" });
  assert.deepEqual(written, []);
  chatProgressRequestContext.run({ writeProgress: (event) => written.push(event) }, () => {
    userProgressAdapter.transactional("execution_awaiting_approval", { executionId: "execution-1" });
  });
  assert.equal(written.length, 1);
  assert.equal(written[0].state, "WAITING");
  assert.equal(publicDevProgress("execution-1").state, written[0].state);
});

test("un affichage en échec ne casse pas l'exécution ; projection DEV tolérante", () => {
  const { chatProgressRequestContext, userProgressAdapter, publicDevProgress } = createProgressComposition({ noonObservability: observability() });
  assert.doesNotThrow(() => chatProgressRequestContext.run({ writeProgress: () => { throw new Error("flux fermé"); } }, () => {
    userProgressAdapter.transactional("execution_awaiting_approval", { executionId: "execution-2" });
  }));
  assert.doesNotThrow(() => chatProgressRequestContext.run({ writeProgress: "pas une fonction" }, () => {
    userProgressAdapter.transactional("execution_unknown_outcome", { executionId: "execution-2" });
  }));
  assert.equal(publicDevProgress(""), null);
  assert.equal(publicDevProgress(null), null);
  assert.doesNotThrow(() => publicDevProgress("inconnue"));
});

test("server.js assemble la progression avant les moteurs qui la publient", () => {
  const source = readServerSource();
  const call = source.indexOf("\nconst { chatProgressRequestContext, userProgressAdapter, publicDevProgress, orchestratorObservability } = createProgressComposition({ noonObservability });\n");
  assert.notEqual(call, -1);
  assert.ok(source.indexOf("const noonObservability = createNoonObservability(") < call);
  assert.ok(call < source.indexOf("userProgressAdapter.backgroundJob("));
});
