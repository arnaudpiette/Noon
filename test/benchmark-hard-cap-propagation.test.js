"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createDevTaskContract } = require("../services/delegation/dev-task-contract");
const { createBenchmarkArmingService } = require("../services/dev/benchmark/benchmark-arming-service");
const { createBenchmarkControlPlane } = require("../services/dev/benchmark/benchmark-control-plane");
const { createNativeNoonBenchmarkParticipant } = require("../services/dev/benchmark/native-noon-benchmark-participant");
const { benchmarkBudgetContext, createDevBenchmarkService } = require("../services/dev/dev-benchmark-service");
const { createDevCostBudgetService } = require("../services/dev/dev-cost-budget-service");
const { createNativeDevStructuredExecutor } = require("../services/dev/native-dev-reasoner");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createBenchmarkArmingRepository } = require("../services/persistence/repositories/benchmark-arming-repository");
const { createBenchmarkRepository } = require("../services/persistence/repositories/benchmark-repository");

function fixtureDirectory() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-b13-fixture-"));
  fs.mkdirSync(path.join(root, "src")); fs.mkdirSync(path.join(root, "test"));
  fs.writeFileSync(path.join(root, "package.json"), '{"scripts":{"test":"node --test"}}');
  fs.writeFileSync(path.join(root, "src", "value.js"), "module.exports=1;\n");
  fs.writeFileSync(path.join(root, "test", "value.test.js"), "\n");
  return root;
}

function setup({ armingProxy, authorization, nativeParticipant } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-b13-"));
  const database = createPersonalDatabase(path.join(root, "noon.sqlite"));
  const repository = createBenchmarkRepository(database);
  const armingRepository = createBenchmarkArmingRepository(database);
  const arming = createBenchmarkArmingService({ repository: armingRepository, runtimeStateReader: { read: () => ({ mode: "OFF" }) }, createArmId: () => "arm-b13" });
  const templates = Object.fromEntries(["normalize-email", "slugify-title", "backend-user-update", "multifile-state-flow"].map((id) => [id, fixtureDirectory()]));
  let calls = 0; const seen = [];
  const participants = {
    NATIVE_NOON: nativeParticipant || { async run(context) { calls += 1; seen.push(context); return { status: "SUCCESS", repairCycles: 0 }; } },
    CODEX: { async run(context) { calls += 1; seen.push(context); return { status: "SUCCESS", repairCycles: 0 }; } },
  };
  const auth = authorization || { canExecuteBenchmarkRun: () => ({ eligible: true, authorizationId: "auth-b13" }), revoke: () => ({ state: "REVOKED" }) };
  const repoForService = armingProxy ? { ...armingRepository, ...armingProxy(armingRepository) } : armingRepository;
  const service = createDevBenchmarkService({ repository, armingRepository: repoForService, runtimeAuthorization: auth, templates, participants, validator: async () => ({ finalValid: true }), featureMode: () => "LIMITED", createSessionId: () => "session-b13" });
  const prepared = service.prepare({ armId: arming.armPilot().armId });
  return { root, database, repository, armingRepository, service, prepared, seen, calls: () => calls, templates };
}

function budgetFixture(config = () => ({ enabled: true, taskLimit: 10, dailyLimit: 10, monthlyLimit: 10 })) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-b13-budget-"));
  return createDevCostBudgetService({ filePath: path.join(root, "ledger.json"), config });
}

test("B13 propage approvedCapUsd depuis l'arm persistant", async () => { const f = setup(); await f.service.runNext(f.prepared.session.id); assert.equal(f.seen[0].benchmarkBudget.limitUsd, 0.5); f.database.close(); });
test("B13 utilise une identité agrégée stable égale à la session", async () => { const f = setup(); await f.service.runNext(f.prepared.session.id); assert.equal(f.seen[0].benchmarkBudget.id, f.prepared.session.id); f.database.close(); });
test("B13 le participant Native et DevTaskContract préservent l'enveloppe", async () => { let input; const participant=createNativeNoonBenchmarkParticipant({coordinator:{async runTask(value){input=value;const contract=createDevTaskContract({...value,workspaceId:"benchmark",workspaceAuthorized:true,workspaceRoots:[value.repositoryRoot]});assert.deepEqual(contract.benchmark,{id:"session-b13",limitUsd:0.5});return {status:"SUCCESS",metrics:{backendReached:true}};},cancelTask(){}}}); const f=setup({nativeParticipant:participant}); await f.service.runNext(f.prepared.session.id); assert.deepEqual(input.benchmark,{id:"session-b13",limitUsd:0.5}); assert.equal(input.sessionId,"session-b13"); assert.equal(input.taskId,"session-b13-1"); f.database.close(); });
test("B13 refuse un plafond manquant avant participant", async () => { const f=setup({armingProxy:(repo)=>({getArmBySessionId(id){return {...repo.getArmBySessionId(id),approvedCapUsd:null};}})}); await assert.rejects(f.service.runNext(f.prepared.session.id),{code:"BENCHMARK_BUDGET_CONTEXT_INVALID"}); assert.equal(f.calls(),0); f.database.close(); });
test("B13 refuse les plafonds non finis ou non positifs", async () => { for(const value of [NaN,Infinity,0,-1]){const f=setup({armingProxy:(repo)=>({getArmBySessionId(id){return {...repo.getArmBySessionId(id),approvedCapUsd:value};}})});await assert.rejects(f.service.runNext(f.prepared.session.id),{code:"BENCHMARK_BUDGET_CONTEXT_INVALID"});assert.equal(f.calls(),0);f.database.close();} });
test("B13 refuse une identité benchmark absente", () => { assert.throws(()=>benchmarkBudgetContext("",{getArmBySessionId:()=>null},{}),{code:"BENCHMARK_BUDGET_BINDING_INVALID"}); });
test("B13 refuse un arm lié à une autre session", async () => { const f=setup({armingProxy:(repo)=>({getArmBySessionId(id){return {...repo.getArmBySessionId(id),benchmarkSessionId:"other"};}})}); await assert.rejects(f.service.runNext(f.prepared.session.id),{code:"BENCHMARK_BUDGET_BINDING_INVALID"}); assert.equal(f.calls(),0); f.database.close(); });
test("B13 le client ne peut pas remplacer le plafond ou l'identité", async () => { const runtime={service:{runNext(){throw new Error("should-not-run");}},repository:{}};const control=createBenchmarkControlPlane({runtime,featureMode:()=>"LIMITED"});for(const extra of [{approvedCapUsd:50},{benchmarkId:"evil"},{limitUsd:null}])await assert.rejects(control.execute("runNext",{sessionId:"session-b13",...extra}),{code:"BENCHMARK_REQUEST_INVALID"}); });
test("B13 quatre runs Native partagent un plafond total de 0.50 USD", () => { const b=budgetFixture();for(const [index,cost] of [0.1,0.1,0.1,0.1].entries()){const id=`r${index}`;b.reserve({reservationId:id,taskId:id,benchmarkId:"session-b13",benchmarkLimit:0.5,estimatedCost:cost,enforce:true});b.reconcile(id,{actualCost:cost,success:true});}assert.ok(Math.abs(b.benchmarkSpent("session-b13")-0.4)<1e-9); });
test("B13 refuse 0.47 + 0.04 avant provider", () => { const b=budgetFixture();b.reserve({reservationId:"spent",taskId:"a",benchmarkId:"session-b13",benchmarkLimit:0.5,estimatedCost:0.47,enforce:true});b.reconcile("spent",{actualCost:0.47,success:true});let provider=0;assert.throws(()=>b.reserve({taskId:"b",benchmarkId:"session-b13",benchmarkLimit:0.5,estimatedCost:0.04,enforce:true}),{code:"BENCHMARK_BUDGET_EXCEEDED"});assert.equal(provider,0); });
test("B13 autorise exactement 0.50 et refuse tout dépassement", () => { const b=budgetFixture();b.reserve({reservationId:"a",taskId:"a",benchmarkId:"session-b13",benchmarkLimit:0.5,estimatedCost:0.3,enforce:true});b.reconcile("a",{actualCost:0.3,success:true});assert.doesNotThrow(()=>b.reserve({reservationId:"boundary",taskId:"b",benchmarkId:"session-b13",benchmarkLimit:0.5,estimatedCost:0.2,enforce:true}));assert.throws(()=>b.reserve({taskId:"c",benchmarkId:"session-b13",benchmarkLimit:0.5,estimatedCost:0.000001,enforce:true}),{code:"BENCHMARK_BUDGET_EXCEEDED"}); });
test("B13 les réservations synchrones concurrentes ne dépassent pas le cap", () => { const b=budgetFixture();b.reserve({reservationId:"first",taskId:"a",benchmarkId:"session-b13",benchmarkLimit:0.5,estimatedCost:0.3,enforce:true});assert.throws(()=>b.reserve({reservationId:"second",taskId:"b",benchmarkId:"session-b13",benchmarkLimit:0.5,estimatedCost:0.3,enforce:true}),{code:"BENCHMARK_BUDGET_EXCEEDED"});assert.equal(b.entries().filter((e)=>e.status==="RESERVED").length,1); });
test("B13 un run CODEX ne reçoit pas l'enveloppe Native", async () => { const f=setup();await f.service.runNext(f.prepared.session.id);await f.service.runNext(f.prepared.session.id);assert.equal(f.seen[1].benchmarkBudget,null);f.database.close(); });
test("B13 une session terminale et une autorisation révoquée ne réservent rien", async (t) => { await t.test("terminal",async()=>{const f=setup();await f.service.cancelBenchmark(f.prepared.session.id);assert.equal(await f.service.runNext(f.prepared.session.id),null);assert.equal(f.calls(),0);f.database.close();});await t.test("revoked",async()=>{const f=setup({authorization:{canExecuteBenchmarkRun:()=>({eligible:false,reason:"AUTHORIZATION_REVOKED"}),revoke(){}}});await assert.rejects(f.service.runNext(f.prepared.session.id),{code:"BENCHMARK_EXECUTION_DENIED"});assert.equal(f.calls(),0);f.database.close();}); });
test("B13 une panne provider clôt la réservation sans coût réel inventé", async () => { const b=budgetFixture();const executor=createNativeDevStructuredExecutor({featureFlags:{evaluate:()=>({enabled:false})},budgetService:b,selectModelRoute:()=>({provider:"openai",model:"fixture",effort:"low",verbosity:"low",estimatedCost:{status:"available",total:0.1}}),estimateCost:()=>({status:"available",total:0.1}),authorizePrivacy:()=>"token",providerAdapter:{execute:async()=>{throw Object.assign(new Error("offline"),{code:"NETWORK_FAILURE"});}}});await assert.rejects(executor({taskDomain:"DEV",requiredQuality:"NORMAL",maxEstimatedCost:null,schema:{type:"object"},schemaName:"x",system:"x",payload:{taskId:"r1",objective:"x",benchmark:{id:"session-b13",limitUsd:0.5}}}));const e=b.entries()[0];assert.equal(e.status,"UNKNOWN_PENDING_RECONCILIATION");assert.equal(e.actualCost,null);assert.equal(b.snapshot().task.reserved,0); });
test("B13 le mode benchmark ne contourne pas les limites DEV applicables", async () => { const b=budgetFixture(()=>({enabled:true,taskLimit:0.05,dailyLimit:0.05,monthlyLimit:0.05}));let provider=0;const executor=createNativeDevStructuredExecutor({featureFlags:{evaluate:()=>({enabled:false})},budgetService:b,selectModelRoute:()=>({provider:"openai",model:"fixture",estimatedCost:{status:"available",total:0.1}}),estimateCost:()=>({status:"available",total:0.1}),authorizePrivacy:()=>"token",providerAdapter:{execute:async()=>{provider+=1;}}});await assert.rejects(executor({taskDomain:"DEV",requiredQuality:"NORMAL",maxEstimatedCost:null,schema:{type:"object"},schemaName:"x",system:"x",payload:{taskId:"r1",objective:"x",benchmark:{id:"session-b13",limitUsd:0.5}}}),{code:"TASK_BUDGET_EXCEEDED"});assert.equal(provider,0); });
test("B13 le DEV non benchmark conserve sa sémantique normale", () => { const b=budgetFixture(()=>({enabled:true,taskLimit:0.05,dailyLimit:0.05,monthlyLimit:0.05}));assert.doesNotThrow(()=>b.reserve({taskId:"normal",estimatedCost:0.1,enforce:false})); });
