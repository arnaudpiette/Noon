"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const registrySource = fs.readFileSync(path.join(__dirname, "..", "skills", "registry.js"), "utf8");
const orchestratorSource = fs.readFileSync(
  path.join(__dirname, "..", "services", "orchestration", "noon-orchestrator.js"),
  "utf8"
);
const providerSource = fs.readFileSync(
  path.join(__dirname, "..", "services", "models", "providers", "openai-provider.js"),
  "utf8"
);
const applicationSource = `${serverSource}\n${orchestratorSource}\n${providerSource}`;

test("tous les appels Responses sont stateless avec store false", () => {
  const calls = [...applicationSource.matchAll(/responses\.(?:create|stream)\s*\(/g)];
  assert.ok(calls.length >= 4);
  assert.equal((applicationSource.match(/store:\s*false/g) || []).length >= 3, true);
  assert.doesNotMatch(applicationSource, /previous_response_id|assistants\.(?:create|retrieve)/);
});

test("Tool Search possède un feature flag et un fallback contrôlé", () => {
  assert.match(serverSource, /ENABLE_TOOL_SEARCH/);
  assert.match(serverSource, /type:\s*"tool_search"/);
  assert.match(registrySource, /defer_loading/);
  assert.match(orchestratorSource, /tool_search\.fallback/);
  assert.match(orchestratorSource, /providerAdapter\.createToolResult\(toolCall, result\)/);
  assert.match(providerSource, /type:\s*"function_call_output"[\s\S]*call_id:\s*toolCall\.call_id/);
});
