"use strict";

// V3-L7 — découpe de goal-mode-run-state.js : mêmes exports (mêmes valeurs), règles et
// validateurs dans goal-mode-run-state-rules.js, empreintes calculées avec node:crypto.
const assert = require("node:assert/strict");
const test = require("node:test");
const state = require("../services/goals/goal-mode-run-state");
const rules = require("../services/goals/goal-mode-run-state-rules");

test("goal-mode-run-state réexporte les mêmes constantes que le module des règles", () => {
  for (const name of ["EXECUTION_STATUSES", "EXECUTION_UNKNOWN_REASONS", "PLANNING_STATUSES", "PLANNING_UNKNOWN_REASONS", "STATUSES", "TERMINAL_STATUSES", "TRANSITIONS", "VERSION"]) {
    assert.equal(state[name], rules[name], name);
  }
  assert.equal(state.VERSION, "goal-mode-run-state-v1");
  for (const value of Object.values(state)) assert.notEqual(value, undefined);
});

test("constantes figées et statuts terminaux", () => {
  assert.equal(Object.isFrozen(rules.STATUSES), true);
  assert.deepEqual([...rules.TERMINAL_STATUSES].sort(), ["CANCELLED", "FAILED", "SUCCEEDED"]);
  assert.ok(rules.EXECUTION_STATUSES.includes("RELEASED"));
});

test("identifiant de réservation : empreinte stable calculée avec node:crypto", () => {
  assert.equal(typeof rules.executionReservationId, "function");
  const first = rules.executionReservationId({ runId: "run-1", stepId: "step-1", taskId: "task-1", revision: 1 });
  assert.equal(first, rules.executionReservationId({ runId: "run-1", stepId: "step-1", taskId: "task-1", revision: 1 }));
  assert.equal(typeof first, "string");
});
