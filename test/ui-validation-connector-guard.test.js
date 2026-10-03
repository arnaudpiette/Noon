"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createConnector } = require("../services/connectors/base-connector");

test("un connecteur UI isolé est bloqué avant son opération", async () => {
  let invoked = false;
  const connector = createConnector({ id: "fixture", displayName: "Fixture", capabilities: [], readCapabilities: [], writeCapabilities: [], scopes: [] }, {
    disabledReason: "Cette capacité externe est désactivée pendant la validation UI isolée.",
  });
  await assert.rejects(() => connector.run(async () => { invoked = true; }), { code: "UI_VALIDATION_EXTERNAL_DISABLED" });
  assert.equal(invoked, false);
  assert.equal(connector.status.authState, "DISABLED");
  assert.equal(connector.status.reasonCode, "UI_VALIDATION_EXTERNAL_DISABLED");
});

test("le garde partagé ne change pas un connecteur normal", async () => {
  const connector = createConnector({ id: "fixture", displayName: "Fixture", capabilities: [], readCapabilities: [], writeCapabilities: [], scopes: [] });
  assert.equal(await connector.run(async () => "ok"), "ok");
  assert.equal(connector.status.authState, "AUTH_REQUIRED");
});
