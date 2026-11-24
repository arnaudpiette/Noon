"use strict";

// V3-L7 — assemblage des services d'intelligence personnelle sorti de server.js : dépendances
// déclarées, effets du démarrage conservés (migration, règles permanentes, gestionnaires de
// jobs) et fonction de Focus déclarée plus loin relue à chaque appel.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DEPENDENCIES, createPersonalIntelligenceComposition } = require("../services/personal-intelligence/personal-intelligence-composition");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createPersonalIntelligenceRepository } = require("../services/persistence/repositories/personal-intelligence-repository");
const { readServerSource } = require("./helpers/server-source");

function fixture({ jobs = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-pi-composition-"));
  const database = createPersonalDatabase(path.join(root, "noon.sqlite"));
  const handlers = [];
  const focusCalls = [];
  const state = { resolveFocus: (...args) => { focusCalls.push(["initial", ...args]); return null; } };
  const deps = {
    DATA_DIRECTORY: root,
    approvalManager: {},
    authorizeOpenAIPrivacy: () => {},
    backgroundJobEngine: jobs ? {} : null,
    calendarConnector: { connected: false },
    dailyPlanStore: { get: () => null, save() {} },
    executionTrackingRepository: { list: () => [], insert() {}, update() {} },
    getBudgetStatus: () => ({ mode: "NORMAL" }),
    getOpenAIClient: () => { throw new Error("aucun appel modèle attendu"); },
    hardRulesRegistry: { legacyOperationalRules: () => [] },
    jobRegistry: { registerHandler: (type) => handlers.push(type) },
    localIntelligenceRuntime: { snapshot: () => ({ state: "LOCAL_ONLY" }) },
    memoryEngine: {},
    personalRepository: createPersonalIntelligenceRepository(database),
    planningPreferenceStore: { load: () => ({ settings: {} }) },
    priorityEngine: { rank: () => [], score: () => 0 },
    publicResearchEngine: {},
    reviewLearningRepository: { list: () => [], save() {} },
    sessionContinuityEngine: { getActiveSession: () => null },
    toolAuditLog: { append() {} },
    trackUsage: () => {},
    get resolveFocusCatalogSelection() { return state.resolveFocus; },
  };
  return { root, database, deps, handlers, focusCalls, state };
}

test("dépendance manquante refusée", () => {
  const { deps, database } = fixture();
  for (const name of DEPENDENCIES) {
    const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(deps));
    delete copy[name];
    assert.throws(() => createPersonalIntelligenceComposition(copy), new RegExp(`Dépendance manquante : ${name}$`));
  }
  database.close();
});

test("démarrage : services renvoyés, règles permanentes écrites, migration et gestionnaires de jobs", () => {
  const { deps, database, handlers } = fixture();
  const services = createPersonalIntelligenceComposition(deps);
  assert.deepEqual(Object.keys(services), [
    "operationalProfileService", "projectIntelligenceService", "personalInboxService", "quickCaptureService",
    "resumeBriefingService", "FIRST_STEP_MODEL", "firstStepService", "followUpService", "metricsService",
    "timeSlotService", "dailyPlanningEngine", "proactiveEngine", "executionTrackingEngine", "reviewLearningEngine",
    "personalMigration", "backgroundAnalysisService",
  ]);
  assert.equal(services.FIRST_STEP_MODEL, "gpt-5.6-luna");
  assert.ok(services.operationalProfileService.portrait().permanentRules.length > 0);
  assert.equal(typeof services.personalMigration, "object");
  assert.deepEqual(handlers, ["PUBLIC_RESEARCH", "MAINTENANCE"]);
  database.close();
  const withoutJobs = fixture({ jobs: false });
  createPersonalIntelligenceComposition(withoutJobs.deps);
  assert.deepEqual(withoutJobs.handlers, []);
  withoutJobs.database.close();
});

test("« Où j'en étais ? » relit la fonction de Focus courante ; premier pas refusé en mode local", async () => {
  const { deps, database, focusCalls, state } = fixture();
  const { resumeBriefingService, firstStepService } = createPersonalIntelligenceComposition(deps);
  state.resolveFocus = (...args) => { focusCalls.push(["remplacée", ...args]); return null; };
  await resumeBriefingService.build({ focusId: "focus-1", focusPath: "/projet" });
  assert.ok(focusCalls.some(([which]) => which === "remplacée"));
  assert.equal(focusCalls.some(([which]) => which === "initial"), false);
  await assert.rejects(() => firstStepService.suggest({ task: "écrire le rapport" }), { code: "FIRST_STEP_REMOTE_FORBIDDEN", statusCode: 409 });
  database.close();
});

test("server.js assemble ces services avant le Brief quotidien", () => {
  const source = readServerSource();
  const call = source.indexOf("} = createPersonalIntelligenceComposition({\n");
  assert.notEqual(call, -1);
  assert.ok(call < source.indexOf("} = createDailyBriefComposition({"));
  const args = source.slice(call, source.indexOf("\n});", call));
  for (const name of DEPENDENCIES) {
    if (name === "resolveFocusCatalogSelection") assert.ok(args.includes("\n  get resolveFocusCatalogSelection() { return resolveFocusCatalogSelection; },"));
    else assert.ok(args.includes(`\n  ${name},`), name);
  }
});
