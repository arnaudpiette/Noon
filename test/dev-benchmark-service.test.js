"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),test=require("node:test");
const {createPersonalDatabase,SCHEMA_VERSION}=require("../services/persistence/database");
const {createBenchmarkRepository}=require("../services/persistence/repositories/benchmark-repository");
const {createBenchmarkArmingRepository}=require("../services/persistence/repositories/benchmark-arming-repository");
const {createBenchmarkArmingService}=require("../services/dev/benchmark/benchmark-arming-service");
const {createDevBenchmarkService,runPlan}=require("../services/dev/dev-benchmark-service");
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),"noon-bench-"));fs.writeFileSync(path.join(root,"package.json"),"{}");fs.mkdirSync(path.join(root,"src"));fs.writeFileSync(path.join(root,"src","index.js"),"module.exports=1;");return root;}
function setup(file){const database=createPersonalDatabase(file||path.join(fs.mkdtempSync(path.join(os.tmpdir(),"noon-bench-db-")),"bench.sqlite"));const repository=createBenchmarkRepository(database);const armingRepository=createBenchmarkArmingRepository(database);const templates=Object.fromEntries(runPlan().map((run)=>[run.task.taskId,fixture()]));const participants={NATIVE_NOON:{run:async()=>({status:"SUCCESS",repairCycles:0,iterations:1,inputTokens:12,outputTokens:7,contextEvaluation:{version:1,plan:{requestedFiles:["src/email.js"]}}}),cancel:async()=>{}},CODEX:{run:async()=>({status:"SUCCESS",repairCycles:0}),cancel:async()=>{}}};const runtimeAuthorization={canExecuteBenchmarkRun:()=>({eligible:true,authorizationId:"test"}),revoke:()=>({state:"REVOKED"})};let sequence=0;const service=createDevBenchmarkService({repository,armingRepository,runtimeAuthorization,templates,participants,featureMode:()=>"LIMITED",createSessionId:()=>`s${++sequence}`,validator:async()=>({finalValid:true,visibleTests:"PASS",hiddenTests:"PASS"})});const armingService=createBenchmarkArmingService({repository:armingRepository,runtimeStateReader:{read:()=>"OFF"},createArmId:()=>`arm-${sequence+1}`});return {database,repository,armingRepository,armingService,service,prepare(){const arm=armingService.armPilot();return service.prepare({armId:arm.armId});}};}
test("le plan pilote persiste exactement huit runs dans l'ordre canonique",()=>{const fx=setup();const result=fx.prepare();assert.equal(result.runs.length,8);assert.deepEqual(result.runs.map((r)=>`${r.task_id}:${r.participant}`),["normalize-email:NATIVE_NOON","normalize-email:CODEX","slugify-title:CODEX","slugify-title:NATIVE_NOON","backend-user-update:NATIVE_NOON","backend-user-update:CODEX","multifile-state-flow:CODEX","multifile-state-flow:NATIVE_NOON"]);fx.database.close();});
test("prepare est idempotent par arm et les transitions impossibles sont refusées",()=>{const fx=setup();const first=fx.prepare(),second=fx.service.prepare({armId:first.arm.armId});assert.equal(second.idempotent,true);assert.equal(second.session.id,first.session.id);assert.equal(fx.repository.listSessionRuns(first.session.id).length,8);assert.throws(()=>fx.service.resumeRemainingRuns(first.session.id),(error)=>error.code==="BENCHMARK_RESUME_INVALID");fx.database.close();});
test("le résultat final est atomique et idempotent",async()=>{const fx=setup();const prepared=fx.prepare();const run=await fx.service.runNext(prepared.session.id);assert.equal(run.state,"PASS");const again=fx.repository.saveNormalizedResult(run.id,{state:"FAIL",finalVerdict:"FAIL"});assert.equal(again.idempotent,true);assert.equal(fx.repository.aggregate(prepared.session.id).rawRunCount,1);fx.database.close();});
test("la reprise après réouverture marque le travail incertain interrompu sans appel participant",()=>{const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),"noon-bench-restart-")),"db.sqlite");let fx=setup(file);const prepared=fx.prepare();fx.repository.updateSessionState(prepared.session.id,"RUNNING");fx.repository.updateRunState(prepared.runs[0].id,"PREPARING");fx.repository.updateRunState(prepared.runs[0].id,"RUNNING");fx.database.close();fx=setup(file);assert.equal(fx.repository.getSession(prepared.session.id).state,"INTERRUPTED");assert.equal(fx.repository.getRun(prepared.runs[0].id).state,"INTERRUPTED");fx.service.resumeRemainingRuns(prepared.session.id);assert.equal(fx.repository.getRun(prepared.runs[0].id).state,"PENDING");fx.database.close();});
test("le schéma benchmark est additif et l'intégrité SQLite reste saine",()=>{const fx=setup();assert.equal(SCHEMA_VERSION,16);assert.ok(fx.database.database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='benchmark_sessions'").get());assert.equal(fx.database.database.prepare("PRAGMA integrity_check").get().integrity_check,"ok");fx.database.close();});


test(
  "Code Context benchmark persiste la telemetry dans les colonnes existantes et validationSummary",
  async () => {
    const fx =
      setup();

    const prepared =
      fx.prepare();

    const run =
      await fx.service.runNext(
        prepared.session.id
      );

    assert.equal(
      run.firstPassSuccess,
      true
    );

    assert.equal(
      run.input_tokens,
      12
    );

    assert.equal(
      run.output_tokens,
      7
    );

    assert.deepEqual(
      run.validationSummary
        .contextEvaluation,
      {
        version: 1,
        plan: {
          requestedFiles: [
            "src/email.js",
          ],
        },
      }
    );

    fx.database.close();
  }
);
