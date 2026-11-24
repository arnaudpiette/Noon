"use strict";

// V3-L7 — assemblage du runtime local, des notifications et des travaux de fond sorti de
// server.js : moteur de jobs seulement avec SQLite, composants Reliability dans le même ordre,
// fonction d'activité de session déclarée plus loin jamais lue à la construction.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DEPENDENCIES, createLocalRuntimeAndJobsComposition } = require("../services/runtime/local-runtime-and-jobs-composition");
const { createCapabilityRegistry } = require("../services/runtime");
const { createPersonalDatabase } = require("../services/persistence/database");
const { readServerSource } = require("./helpers/server-source");

const CONFIG = { "jobs.maxQueued": 10, "jobs.maxRunning": 1, "jobs.leaseMs": 30_000, "notifications.quietHoursEnabled": false, "notifications.quietHoursStart": "22:00", "notifications.quietHoursEnd": "07:00" };

function fixture({ sqlite = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-runtime-jobs-"));
  const database = sqlite ? createPersonalDatabase(path.join(root, "noon.sqlite")) : { kind: "json" };
  const registered = [];
  const deps = {
    featureFlags: { evaluate: () => ({ enabled: true, mode: "ON" }) },
    personalDatabase: database,
    reliabilityEngine: { register: (component) => registered.push(component.componentId), recordSuccess() {}, recordFailure() {}, status: () => ({}) },
    runtimeCapabilityRegistry: createCapabilityRegistry(),
    runtimeConfig: { get: (key) => ({ value: CONFIG[key] }), state: () => ({}) },
    toolAuditLog: { append() {} },
    userProgressAdapter: { backgroundJob() {} },
    get setSessionActivity() { throw new Error("lue trop tôt"); },
  };
  return { deps, database, registered };
}

test("dépendance manquante refusée", () => {
  for (const name of DEPENDENCIES) {
    const { deps, database } = fixture();
    const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(deps));
    delete copy[name];
    assert.throws(() => createLocalRuntimeAndJobsComposition(copy), new RegExp(`Dépendance manquante : ${name}$`));
    database.close();
  }
});

test("SQLite : moteur de jobs créé, composants Reliability dans l'ordre, activité de session non lue", () => {
  const { deps, database, registered } = fixture();
  const result = createLocalRuntimeAndJobsComposition(deps);
  assert.deepEqual(Object.keys(result), ["localIntelligenceRuntime", "notificationAttentionEngine", "jobRegistry", "backgroundJobEngine"]);
  assert.ok(result.backgroundJobEngine);
  assert.equal(typeof result.jobRegistry.registerHandler, "function");
  assert.deepEqual(registered, ["local-intelligence-runtime", "notification-attention", "job-store", "job-queue", "job-worker", "job-scheduler"]);
  database.close();
});

test("repli JSON : aucun moteur de jobs ni composant de jobs", () => {
  const { deps, registered } = fixture({ sqlite: false });
  const result = createLocalRuntimeAndJobsComposition(deps);
  assert.equal(result.backgroundJobEngine, null);
  assert.deepEqual(registered, ["local-intelligence-runtime", "notification-attention"]);
});

test("server.js assemble le runtime et les jobs après la progression, avant le dépôt personnel", () => {
  const source = readServerSource();
  const call = source.indexOf("\nconst { localIntelligenceRuntime, notificationAttentionEngine, jobRegistry, backgroundJobEngine } = createLocalRuntimeAndJobsComposition({\n");
  assert.notEqual(call, -1);
  assert.ok(source.indexOf("} = createProgressComposition({ noonObservability });") < call);
  assert.ok(call < source.indexOf("const personalRepository = createPersonalIntelligenceRepository("));
  const args = source.slice(call, source.indexOf("\n});", call));
  for (const name of DEPENDENCIES) {
    if (name === "setSessionActivity") assert.ok(args.includes("\n  get setSessionActivity() { return setSessionActivity; },"));
    else assert.ok(args.includes(`\n  ${name},`), name);
  }
});
