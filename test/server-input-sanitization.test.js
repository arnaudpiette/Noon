"use strict";

// Vérifie que les sorties d’outils réinjectées dans l’API ne contiennent aucun champ interdit.

const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeResponseOutputForInput } = require("../server");

test("retire parsed_arguments avant de réinjecter un appel d’outil", () => {
  const sanitized = sanitizeResponseOutputForInput({
    type: "function_call",
    call_id: "call_1",
    name: "browse_directory",
    arguments: '{"path":"/tmp/project"}',
    parsed_arguments: { path: "/tmp/project" },
    nested: { parsed_arguments: { unexpected: true }, status: "ok" },
  });

  assert.equal(sanitized.parsed_arguments, undefined);
  assert.equal(sanitized.nested.parsed_arguments, undefined);
  assert.equal(sanitized.arguments, '{"path":"/tmp/project"}');
  assert.equal(sanitized.nested.status, "ok");
});
