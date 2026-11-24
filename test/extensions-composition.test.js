"use strict";

// V3-L7 — assemblage des extensions et du client MCP sorti de server.js : dépendances
// déclarées, client MCP désactivé par le flag, en validation UI et en smoke, extension de
// démonstration seulement si elle est demandée.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DEPENDENCIES, createExtensionsComposition } = require("../services/extensions/extensions-composition");
const { readServerSource } = require("./helpers/server-source");

function fixture({ flags = {}, uiValidation = false } = {}) {
  const audits = [];
  const deps = {
    DATA_DIRECTORY: fs.mkdtempSync(path.join(os.tmpdir(), "noon-extensions-")),
    UI_VALIDATION_MODE: uiValidation,
    featureFlags: { evaluate: (key) => ({ enabled: flags[key] === true }) },
    getAllowedDirectories: () => [],
    integrationTokenStore: { get: () => null, set() {}, delete() {} },
    localIntelligenceRuntime: { preflight: () => ({ status: "AVAILABLE" }) },
    operationalSecurityPolicy: { evaluate: () => ({ allowed: false }) },
    reliabilityEngine: { register() {}, recordSuccess() {}, recordFailure() {} },
    skillRegistry: { register() {}, unregister() {}, get: () => null, list: () => [] },
    toolAuditLog: { append: (event) => audits.push(event) },
    transactionalExecutionEngine: { executeSingleStep: async () => ({ status: "SUCCEEDED" }) },
  };
  return { deps, audits };
}

function withEnv(values, fn) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  try { return fn(); } finally { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}

test("dépendance manquante refusée", () => {
  for (const name of DEPENDENCIES) {
    const { deps } = fixture();
    delete deps[name];
    assert.throws(() => createExtensionsComposition(deps), new RegExp(`Dépendance manquante : ${name}$`));
  }
});

test("client MCP : actif seulement avec le flag, hors validation UI et hors smoke", () => {
  withEnv({ NOON_SMOKE_TEST: undefined, NOON_ENABLE_EXAMPLE_SEARCH_EXTENSION: undefined }, () => {
    assert.equal(createExtensionsComposition(fixture().deps).mcpService.enabled, false);
    assert.equal(createExtensionsComposition(fixture({ flags: { "connectors.mcp": true } }).deps).mcpService.enabled, true);
    assert.equal(createExtensionsComposition(fixture({ flags: { "connectors.mcp": true }, uiValidation: true }).deps).mcpService.enabled, false);
  });
  withEnv({ NOON_SMOKE_TEST: "1" }, () => {
    assert.equal(createExtensionsComposition(fixture({ flags: { "connectors.mcp": true } }).deps).mcpService.enabled, false);
  });
});

test("extension de démonstration : absente par défaut, découverte seulement sur demande", () => {
  withEnv({ NOON_ENABLE_EXAMPLE_SEARCH_EXTENSION: undefined }, () => {
    assert.deepEqual(createExtensionsComposition(fixture({ flags: { "extensions.sdk": true } }).deps).extensionRegistry.list(), []);
  });
  withEnv({ NOON_ENABLE_EXAMPLE_SEARCH_EXTENSION: "true" }, () => {
    const ids = createExtensionsComposition(fixture({ flags: { "extensions.sdk": true } }).deps).extensionRegistry.list().map((entry) => entry.id);
    assert.deepEqual(ids, ["com.noon.example.search"]);
  });
});

test("server.js assemble les extensions après l'exécution transactionnelle, avant la délégation DEV", () => {
  const source = readServerSource();
  const call = source.indexOf("\nconst { extensionRegistry, mcpService } = createExtensionsComposition({\n");
  assert.notEqual(call, -1);
  assert.ok(source.indexOf("const transactionalExecutionEngine = createTransactionalExecutionEngine(") < call);
  assert.ok(call < source.indexOf("} = createDevDelegationComposition({"));
  const args = source.slice(call, source.indexOf("\n});", call));
  for (const name of DEPENDENCIES) assert.ok(args.includes(`\n  ${name},`), name);
});
