"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createContextManifestAbExperiment } = require("../services/dev/benchmark/context-manifest-ab-experiment");
const { createGlobalBenchmarkValidator } = require("../services/dev/benchmark/global-benchmark-validator");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-context-ab-"));
  const source = path.join(root, "fixture"); const workspace = path.join(root, "workspace");
  fs.mkdirSync(path.join(source, "src"), { recursive: true }); fs.mkdirSync(path.join(source, "test"));
  fs.writeFileSync(path.join(source, "package.json"), '{"scripts":{"test":"node --test"}}'); fs.writeFileSync(path.join(source, "src", "state.js"), "module.exports={};\n"); fs.writeFileSync(path.join(source, "test", "state.test.js"), "");
  const order = ["normalize-email:NATIVE_NOON", "normalize-email:CODEX", "slugify-title:CODEX", "slugify-title:NATIVE_NOON", "backend-user-update:NATIVE_NOON", "backend-user-update:CODEX", "multifile-state-flow:CODEX", "multifile-state-flow:NATIVE_NOON"];
  const runs = order.map((entry, index) => { const [task_id, participant] = entry.split(":"); return { id: `r${index + 1}`, state: "PENDING", version: 1, run_index: index + 1, task_id, participant }; });
  const session = { id: "session-ab", suite_version: "benchmark-suite-v1", state: "READY", benchmark_id: "pilot", idempotency_key: "arm" };
  const repository = { getSession: () => session, listSessionRuns: () => runs };
  const arm = { suiteVersion: "benchmark-suite-v1", state: "BOUND_TO_SESSION", benchmarkSessionId: session.id, approvedCapUsd: 0.5, armId: "arm", authorizedParticipants: ["NATIVE_NOON", "CODEX"] };
  const armingRepository = { getArmBySessionId: () => arm };
  const calls = []; const hidden = [];
  let claimed = false;
  const runtimeAuthorization = { current: () => ({ workspacePath: workspace }), claimContextManifestAb: () => claimed ? { eligible: false, reason: "CONTEXT_MANIFEST_AB_ALREADY_CLAIMED" } : (claimed = true, { eligible: true, claimed: true, authorizationId: "auth" }), completeContextManifestAb: () => {} };
  const participant = { execute: async (input) => { calls.push(input); fs.writeFileSync(path.join(input.workspace, "src", `${input.contextManifestMode}.js`), "module.exports=true;\n"); return { reportedStatus: "SUCCESS", iterations: 1, repairCycles: 0, contextEvaluation: { manifest: { mode: input.contextManifestMode }, plan: { requestedFiles: ["src/state.js"] } } }; } };
  const validator = async ({ workspace }) => { hidden.push(workspace); return { finalValid: true, visibleTests: "PASS", hiddenTests: "PASS", changedFilesCount: 1, regressionCount: 0, scopeViolations: 0, securityViolations: 0 }; };
  const materializeWorkspace = (from, target) => { fs.rmSync(target, { recursive: true, force: true }); fs.mkdirSync(target, { recursive: true }); fs.cpSync(from, target, { recursive: true }); };
  return { root, source, workspace, repository, armingRepository, runtimeAuthorization, participant, validator, materializeWorkspace, calls, hidden, runs, session };
}
function make(f) { return createContextManifestAbExperiment({ repository: f.repository, armingRepository: f.armingRepository, runtimeAuthorization: f.runtimeAuthorization, templates: { "multifile-state-flow": f.source }, participant: f.participant, validator: f.validator, materializeWorkspace: f.materializeWorkspace }); }

test("A/B impose ON puis OFF, rematérialise, valide deux snapshots et ne mute aucun run", async () => {
  const f = fixture(); const result = await make(f).run(f.session.id);
  assert.deepEqual(f.calls.map((call) => call.contextManifestMode), ["ON", "OFF"]); assert.equal(result.variants.ON.startFingerprint, result.variants.OFF.startFingerprint); assert.equal(f.hidden.length, 2); assert.equal(result.canonicalRunsMutated, false);
  assert.equal(result.variants.ON.contextEvaluation.manifest.mode, "ON"); assert.equal(result.variants.OFF.contextEvaluation.manifest.mode, "OFF"); assert.deepEqual(f.runs.map((run) => run.state), Array(8).fill("PENDING")); fs.rmSync(f.root, { recursive: true, force: true });
});
test("A/B refuse session, runs, autorisation et snapshot invalides avant participant", async () => {
  for (const mutate of [(f) => { f.session.state = "RUNNING"; }, (f) => { f.runs[0].state = "PASS"; }, (f) => { f.runtimeAuthorization.claimContextManifestAb = () => ({ eligible: false, reason: "REVOKED" }); fs.mkdirSync(f.workspace); fs.writeFileSync(path.join(f.workspace, "sentinel"), "unchanged"); }, (f) => { f.materializeWorkspace = (_from, target) => { fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, "wrong"), "x"); }; }]) { const f = fixture(); mutate(f); await assert.rejects(make(f).run(f.session.id)); assert.equal(f.calls.length, 0); if (fs.existsSync(path.join(f.workspace, "sentinel"))) assert.equal(fs.readFileSync(path.join(f.workspace, "sentinel"), "utf8"), "unchanged"); fs.rmSync(f.root, { recursive: true, force: true }); }
});
test("A/B ne restitue jamais de contenu source, prompt, secret ou payload", async () => { const f = fixture(); f.participant.execute = async (input) => ({ contextEvaluation: { manifest: { mode: input.contextManifestMode }, source: "private source", prompt: "private prompt", secret: "private secret", payload: { body: "private payload" } } }); const result = await make(f).run(f.session.id); const output = JSON.stringify(result); for (const value of ["private source", "private prompt", "private secret", "private payload"]) assert.equal(output.includes(value), false); fs.rmSync(f.root, { recursive: true, force: true }); });
test("A/B appelle le validateur global et son hidden synthétique pour ON et OFF", async () => {
  const f = fixture(); let hiddenCalls = 0;
  f.validator = createGlobalBenchmarkValidator({ resolveHiddenValidator: () => async () => { hiddenCalls += 1; return { status: "PASS" }; }, runCommand: () => "PASS" });
  const result = await make(f).run(f.session.id); assert.equal(hiddenCalls, 2); assert.equal(result.variants.ON.finalValid, true); assert.equal(result.variants.OFF.finalValid, true); fs.rmSync(f.root, { recursive: true, force: true });
});
test("A/B refuse les appels concurrents et tout rappel après succès ou échec", async () => {
  const f = fixture(); let release; const gate = new Promise((resolve) => { release = resolve; }); let first = true;
  f.participant.execute = async (input) => { if (first) { first = false; await gate; } return { reportedStatus: "SUCCESS", contextEvaluation: { manifest: { mode: input.contextManifestMode } } }; };
  const experiment = make(f); const running = experiment.run(f.session.id); await assert.rejects(experiment.run(f.session.id), (error) => error.reason === "CONTEXT_MANIFEST_AB_ALREADY_CLAIMED"); release(); await running; await assert.rejects(experiment.run(f.session.id), (error) => error.reason === "CONTEXT_MANIFEST_AB_ALREADY_CLAIMED"); assert.equal(f.calls.length, 0); fs.rmSync(f.root, { recursive: true, force: true });
  const partial = fixture(); partial.participant.execute = async () => { throw new Error("synthetic failure"); }; const failed = make(partial); await assert.rejects(failed.run(partial.session.id)); await assert.rejects(failed.run(partial.session.id), (error) => error.reason === "CONTEXT_MANIFEST_AB_ALREADY_CLAIMED"); fs.rmSync(partial.root, { recursive: true, force: true });
});
