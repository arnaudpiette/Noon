"use strict";

// V3-L7 — assemblage du cycle de vie sorti de server.js : dépendances déclarées, mode
// diagnostic (aucune migration active, aucune écriture de schéma), version de l'application.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DEPENDENCIES, createLifecycleComposition } = require("../services/lifecycle/lifecycle-composition");
const { SCHEMA_VERSION } = require("../services/persistence/database");
const { readServerSource } = require("./helpers/server-source");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-lifecycle-"));
  const audits = [];
  const deps = {
    ARTIFACT_PREVIEW_DIRECTORY: path.join(root, "artifact-previews"),
    CONVERSATION_INDEX_FILE: path.join(root, "conversation-index.json"),
    CONVERSATION_MEMORY_FILE: path.join(root, "conversation-memory.json"),
    CONVERSATION_SUMMARIES_FILE: path.join(root, "conversation-summaries.json"),
    DATA_DIRECTORY: root,
    PROJECTS_REGISTRY_FILE: path.join(root, "projects-registry.json"),
    configRegistry: { schemaVersion: 1 },
    featureFlags: { snapshot: () => ({ featureFlagVersion: "flags-1" }) },
    personalDatabase: { kind: "json", filePath: path.join(root, "personal.json"), load: () => ({ version: SCHEMA_VERSION }) },
    privateMemoryService: { available: true },
    reliabilityEngine: { status: () => ({}) },
    runtimeConfig: { state: () => ({ configVersion: "config-1" }) },
    toolAuditLog: { append: (event) => audits.push(event) },
    transactionalExecutionRepository: { listRecoverable: () => [] },
  };
  return { root, deps, audits };
}

test("dépendance manquante refusée", () => {
  for (const name of DEPENDENCIES) {
    const { deps } = fixture();
    delete deps[name];
    assert.throws(() => createLifecycleComposition(deps), new RegExp(`Dépendance manquante : ${name}$`));
  }
});

test("diagnostic : version de l'application, schéma courant, aucune migration active ni écriture", () => {
  const { root, deps } = fixture();
  const { updateRecoveryEngine } = createLifecycleComposition(deps);
  const plan = updateRecoveryEngine.plan();
  assert.equal(plan.fromVersion, require("../package.json").version);
  assert.equal(plan.currentSchemaVersion, SCHEMA_VERSION);
  const diagnostic = updateRecoveryEngine.startupDiagnostic();
  assert.equal(diagnostic.appVersion, require("../package.json").version);
  assert.equal(diagnostic.migrationState, "CLEAN");
  assert.equal(diagnostic.backupState, "NONE");
  assert.deepEqual(fs.readdirSync(root), []);
});

test("server.js assemble le cycle de vie avant le Control Center", () => {
  const source = readServerSource();
  const call = source.indexOf("\nconst { updateRecoveryEngine } = createLifecycleComposition({\n");
  assert.notEqual(call, -1);
  assert.ok(call < source.indexOf("} = createControlCenterComposition({"));
  const args = source.slice(call, source.indexOf("\n});", call));
  for (const name of DEPENDENCIES) assert.ok(args.includes(`\n  ${name},`), name);
});
