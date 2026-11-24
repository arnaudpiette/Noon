"use strict";

// V3-L7 — découpe de goal-mode-next-step-planner.js : mêmes exports (mêmes valeurs), primitives
// pures, empreinte stable calculée avec node:crypto.
const assert = require("node:assert/strict");
const test = require("node:test");
const planner = require("../services/goals/goal-mode-next-step-planner");
const primitives = require("../services/goals/goal-mode-next-step-primitives");

test("le planificateur réexporte les mêmes constantes", () => {
  for (const name of ["ACTIONABLE_MILESTONE_STATUSES", "PROPOSAL_KEYS", "TERMINAL_MILESTONE_STATUSES", "VERSION"]) assert.equal(planner[name], primitives[name], name);
  assert.equal(typeof planner.createGoalModeNextStepPlanner, "function");
});

test("primitives : forme canonique stable, empreinte déterministe, gel profond", () => {
  // canonical renvoie un objet aux clés triées ; fingerprint le sérialise.
  assert.equal(JSON.stringify(primitives.canonical({ b: 1, a: [2, { d: 3, c: 4 }] })), JSON.stringify(primitives.canonical({ a: [2, { c: 4, d: 3 }], b: 1 })));
  assert.equal(primitives.fingerprint({ b: 1, a: 2 }), primitives.fingerprint({ a: 2, b: 1 }));
  assert.match(primitives.fingerprint({ a: 1 }), /^sha256:[0-9a-f]{64}$/);
  assert.equal(primitives.fingerprint({ a: 1 }), primitives.fingerprint({ a: 1 }));
  assert.notEqual(primitives.fingerprint({ a: 1 }), primitives.fingerprint({ a: 2 }));
  const frozen = primitives.deepFreeze({ a: { b: [1] } });
  assert.equal(Object.isFrozen(frozen.a.b), true);
});
