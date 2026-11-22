"use strict";

// « Tester » sur Gmail / Google Agenda : un jeton présent mais refusé par Google doit mener à la
// reconnexion (adresse d'autorisation), comme un jeton absent.
const assert = require("node:assert/strict");
const test = require("node:test");
const { createCheckConnectionAction } = require("../services/control-center/connection-check-action");

function fixture({ connected = true, state = "HEALTHY" } = {}) {
  const calls = { check: [], authorize: 0 };
  const action = createCheckConnectionAction({
    googleConnectors: [{ id: "gmail", connected }, { id: "google-calendar", connected }],
    reliabilityEngine: { check: async (id, options) => { calls.check.push([id, options]); return { componentId: id, state }; } },
    createGoogleReadAuthorization: async () => { calls.authorize += 1; return { url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x" }; },
  });
  return { action, calls };
}

test("Google sans jeton : autorisation proposée, aucun contrôle réseau", async () => {
  const { action, calls } = fixture({ connected: false });
  const result = await action({ targetId: "gmail" });
  assert.equal(result.status, "AUTH_REQUIRED");
  assert.match(result.authorizationUrl, /^https:\/\/accounts\.google\.com\//);
  assert.deepEqual(calls.check, []);
});

test("Google avec jeton refusé (UNAUTHORIZED) : contrôle forcé puis reconnexion proposée", async () => {
  const { action, calls } = fixture({ state: "UNAUTHORIZED" });
  const result = await action({ targetId: "google-calendar" });
  assert.equal(result.status, "AUTH_REQUIRED");
  assert.equal(result.component.state, "UNAUTHORIZED");
  assert.deepEqual(calls.check, [["google-calendar", { force: true }]]);
  assert.equal(calls.authorize, 1);
});

test("Google sain, ou autre connexion refusée : simple contrôle, aucune autorisation", async () => {
  const healthy = fixture();
  assert.equal((await healthy.action({ targetId: "gmail" })).status, "SUCCEEDED");
  const other = fixture({ state: "UNAUTHORIZED" });
  const result = await other.action({ targetId: "openai-models" });
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(other.calls.authorize, 0);
});

test("dépendances obligatoires", () => {
  assert.throws(() => createCheckConnectionAction({}), TypeError);
  assert.throws(() => createCheckConnectionAction({ reliabilityEngine: { check() {} } }), TypeError);
});
