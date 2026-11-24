"use strict";

// V3-L7 — découpe de decision-support-engine.js : mêmes exports (mêmes identités), empreinte
// stable (clés triées) calculée avec node:crypto.
const assert = require("node:assert/strict");
const test = require("node:test");
const engine = require("../services/decision/decision-support-engine");
const evidence = require("../services/decision/decision-evidence-v2");

test("le moteur réexporte les mêmes fonctions de preuves", () => {
  for (const name of ["fingerprint", "evidenceAttested", "evidenceEligibilityV2"]) assert.equal(engine[name], evidence[name], name);
});

test("empreinte : indépendante de l'ordre des clés, sha256 hexadécimal", () => {
  assert.equal(evidence.fingerprint({ b: [1, { d: 1, c: 2 }], a: 1 }), evidence.fingerprint({ a: 1, b: [1, { c: 2, d: 1 }] }));
  assert.match(evidence.fingerprint({ a: 1 }), /^[0-9a-f]{64}$/);
  assert.notEqual(evidence.fingerprint({ a: 1 }), evidence.fingerprint({ a: 2 }));
});
