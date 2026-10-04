"use strict";
const crypto = require("node:crypto"); const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path");
const SUITE_VERSION = "benchmark-suite-v1";
const PILOT_TASKS = Object.freeze([
  { taskId:"normalize-email", category:"BUG_FIX", difficulty:"EASY", objective:"Corriger normalizeEmail.", validationCommands:["npm test"] },
  { taskId:"slugify-title", category:"FEATURE_SMALL", difficulty:"EASY", objective:"Corriger slugifyTitle.", validationCommands:["npm test"] },
  { taskId:"backend-user-update", category:"BACKEND_LOGIC", difficulty:"MEDIUM", objective:"Corriger PATCH /users/:id.", validationCommands:["npm test"] },
  { taskId:"multifile-state-flow", category:"MULTI_FILE_CHANGE", difficulty:"HARD", objective:"Corriger controller/service/store.", validationCommands:["npm test"] },
]);
const ORDER = Object.freeze([["normalize-email","NATIVE_NOON"],["normalize-email","CODEX"],["slugify-title","CODEX"],["slugify-title","NATIVE_NOON"],["backend-user-update","NATIVE_NOON"],["backend-user-update","CODEX"],["multifile-state-flow","CODEX"],["multifile-state-flow","NATIVE_NOON"]]);
const CODEX_PROBE_SUITE_VERSION="codex-authenticity-probe-v1";
const CODEX_PROBE_TASK=Object.freeze({taskId:"normalize-email",category:"BUG_FIX",difficulty:"EASY",objective:"Corriger normalizeEmail.",validationCommands:["npm test"]});
const PLANS=Object.freeze({[SUITE_VERSION]:Object.freeze({benchmarkId:"noon-v2.8-pilot",tasks:PILOT_TASKS,order:ORDER,participants:["NATIVE_NOON","CODEX"],approvedCapUsd:0.5}),[CODEX_PROBE_SUITE_VERSION]:Object.freeze({benchmarkId:"noon-v2.8-codex-authenticity-probe",tasks:[CODEX_PROBE_TASK],order:[["normalize-email","CODEX"]],participants:["CODEX"],approvedCapUsd:0.5})});
const SESSION_TRANSITIONS={CREATED:["PREPARING","FAILED"],PREPARING:["READY","FAILED"],READY:["RUNNING","CANCELLING","FAILED"],RUNNING:["COMPLETED","CANCELLING","INTERRUPTED","PARTIAL","FAILED"],CANCELLING:["CANCELLED","FAILED"],INTERRUPTED:["READY","FAILED"],PARTIAL:["READY","FAILED"]};
const RUN_TRANSITIONS={PENDING:["PREPARING","INVALID"],PREPARING:["RUNNING","INFRASTRUCTURE_BLOCKED","CANCELLED","INTERRUPTED"],RUNNING:["VALIDATING","CANCELLED","TIMEOUT","INTERRUPTED","INFRASTRUCTURE_BLOCKED"],VALIDATING:["PASS","FAIL","INTERRUPTED"],INTERRUPTED:["PREPARING"],INFRASTRUCTURE_BLOCKED:[],PASS:[],FAIL:[],CANCELLED:[],TIMEOUT:[],INVALID:[]};
function fingerprint(root){const files=[];const visit=(dir)=>fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).forEach((entry)=>{if([".git","node_modules"].includes(entry.name))return;const absolute=path.join(dir,entry.name);if(entry.isDirectory())visit(absolute);else if(entry.isFile())files.push([path.relative(root,absolute),fs.readFileSync(absolute)]);});visit(root);const hash=crypto.createHash("sha256");for(const [name,content] of files)hash.update(name).update("\0").update(content).update("\0");return hash.digest("hex");}
function copySnapshot(template,prefix="noon-benchmark-"){const target=fs.mkdtempSync(path.join(os.tmpdir(),prefix));fs.cpSync(template,target,{recursive:true,filter:(source)=>!source.includes(`${path.sep}.git`)&&!source.includes(`${path.sep}node_modules`)});return target;}
function planForSuite(suiteVersion){return PLANS[suiteVersion]||null;}
function runPlan(suiteVersion=SUITE_VERSION){const definition=planForSuite(suiteVersion);return definition?definition.order.map(([taskId,participant],index)=>({runIndex:index+1,task:definition.tasks.find((task)=>task.taskId===taskId),participant})):[];}
function transition(map,from,to,kind){if(!(map[from]||[]).includes(to))throw Object.assign(new Error(`Transition ${kind} invalide: ${from} -> ${to}`),{code:"BENCHMARK_INVALID_TRANSITION"});}
function error(message,code){return Object.assign(new Error(message),{code});}
function benchmarkBudgetContext(sessionId, armingRepository, repository){
  if(!armingRepository?.getArmBySessionId)throw error("Contexte budget benchmark indisponible.","BENCHMARK_BUDGET_CONTEXT_INVALID");
  const arm=armingRepository.getArmBySessionId(sessionId);
  if(!arm||arm.state!=="BOUND_TO_SESSION"||arm.benchmarkSessionId!==sessionId)throw error("Liaison budget arm/session invalide.","BENCHMARK_BUDGET_BINDING_INVALID");
  validateBoundPilotSession(arm,repository);
  const limitUsd=Number(arm.approvedCapUsd);
  if(!Number.isFinite(limitUsd)||limitUsd<=0)throw error("Plafond benchmark invalide.","BENCHMARK_BUDGET_CONTEXT_INVALID");
  const id=String(sessionId||"");
  if(!id)throw error("Identité budget benchmark invalide.","BENCHMARK_BUDGET_CONTEXT_INVALID");
  return Object.freeze({id,limitUsd});
}
function preparedWorkspace(template,workspace,peer){
  let expected;let actual;let comparison;
  try{expected=fingerprint(template);actual=fingerprint(workspace);comparison=fingerprint(peer);}
  catch{throw error("Workspace benchmark introuvable ou invalide.","BENCHMARK_WORKSPACE_INVALID");}
  if(actual!==expected||comparison!==expected)throw error("État initial benchmark invalide.","BENCHMARK_INVALID_START_STATE");
  return actual;
}
function validateBoundSession(arm,repository){const definition=planForSuite(arm?.suiteVersion);const existing=arm?.benchmarkSessionId?repository.getSession(arm.benchmarkSessionId):null;const runs=existing?repository.listSessionRuns(existing.id):[];const expected=runPlan(arm?.suiteVersion);const planValid=!!definition&&runs.length===expected.length&&runs.every((item,index)=>item.run_index===index+1&&item.task_id===expected[index].task.taskId&&item.participant===expected[index].participant);if(!arm||arm.state!=="BOUND_TO_SESSION"||!existing||existing.id!==arm.benchmarkSessionId||existing.suite_version!==arm.suiteVersion||existing.idempotency_key!==arm.armId||!planValid)throw error("Liaison arm/session benchmark incohérente.","BENCHMARK_ARM_BOUND_INTEGRITY_ERROR");return {session:existing,runs,definition};}
function validateBoundPilotSession(arm,repository){if(arm?.suiteVersion!==SUITE_VERSION)throw error("Liaison arm/session benchmark incohérente.","BENCHMARK_ARM_BOUND_INTEGRITY_ERROR");return validateBoundSession(arm,repository);}
function createDevBenchmarkService({templates={},participants={},validator,repository,armingRepository=null,runtimeAuthorization=null,featureMode=()=>"OFF",now=()=>Date.now(),createSessionId=()=>crypto.randomUUID(),workspaceFactory=(template)=>({workspace:copySnapshot(template),peer:copySnapshot(template)}),observability=null}={}){
  if(typeof validator!=="function")throw new TypeError("Validator benchmark requis.");if(!repository)throw new TypeError("BenchmarkRepository requis.");repository.recoverInterrupted();
  const changeSession=(id,to,changes={})=>{const current=repository.getSession(id);transition(SESSION_TRANSITIONS,current.state,to,"session");return repository.updateSessionState(id,to,changes);};
  const changeRun=(id,to,changes={})=>{const current=repository.getRun(id);transition(RUN_TRANSITIONS,current.state,to,"run");return repository.updateRunState(id,to,changes);};
  function validPolicy(arm){const definition=planForSuite(arm.suiteVersion);return !!definition&&arm.approvedCapUsd===definition.approvedCapUsd&&JSON.stringify(arm.authorizedParticipants)===JSON.stringify(definition.participants);}
  function assertBoundIntegrity(arm){const validated=validateBoundPilotSession(arm,repository);return {...validated,idempotent:true,arm};}
  function prepare(input={}){
    if(featureMode()!=="LIMITED")throw error("Benchmark désactivé.","FEATURE_DISABLED");
    const armId=String(input.armId||"");if(!armId)throw error("Armement benchmark requis.","BENCHMARK_ARM_REQUIRED");
    if(!armingRepository?.getArm||!armingRepository?.bindSessionMetadataWithinTransaction)throw error("Persistance d'armement indisponible.","BENCHMARK_ARMING_UNAVAILABLE");
    const timestamp=new Date(now()).toISOString();
    const result=repository.transaction(()=>{
      const arm=armingRepository.getArm(armId);if(!arm)throw error("Armement benchmark inconnu.","BENCHMARK_ARM_NOT_FOUND");
      if(arm.state==="BOUND_TO_SESSION")return assertBoundIntegrity(arm);
      if(arm.state!=="ARMED_PENDING_SESSION")throw error("Armement benchmark non éligible.","BENCHMARK_ARM_NOT_ELIGIBLE");
      const expiresAt=Date.parse(arm.expiresAt);if(!Number.isFinite(expiresAt))throw error("Expiration d'armement invalide.","BENCHMARK_ARM_INVALID_EXPIRY");
      if(expiresAt<=Date.parse(timestamp)){armingRepository.transitionArmWithinTransaction(armId,"EXPIRED",{at:timestamp});return {denied:"BENCHMARK_ARM_NOT_ELIGIBLE"};}
      if(!validPolicy(arm))throw error("Politique d'armement benchmark incohérente.","BENCHMARK_ARM_POLICY_MISMATCH");
      const sessionId=String(createSessionId());if(!sessionId)throw error("Identifiant de session benchmark invalide.","BENCHMARK_SESSION_INVALID");
      const definition=planForSuite(arm.suiteVersion);if(!definition)throw error("Suite benchmark invalide.","BENCHMARK_SESSION_SUITE_MISMATCH");
      const record={id:sessionId,benchmarkId:definition.benchmarkId,suiteVersion:arm.suiteVersion,idempotencyKey:armId,state:"CREATED",versionMetadata:{probe:arm.suiteVersion===CODEX_PROBE_SUITE_VERSION},timestamp};
      const plan=runPlan(arm.suiteVersion).map((item)=>({id:`${sessionId}-${item.runIndex}`,runIndex:item.runIndex,taskId:item.task.taskId,participant:item.participant}));
      const created=repository.createSessionWithinTransaction(record,plan);
      if(created.idempotent)throw error("Session préexistante pour un arm non lié.","BENCHMARK_ARM_BOUND_INTEGRITY_ERROR");
      changeSession(sessionId,"PREPARING");changeSession(sessionId,"READY");
      const bound=armingRepository.bindSessionMetadataWithinTransaction(armId,sessionId,timestamp);
      return {session:repository.getSession(created.session.id),runs:repository.listSessionRuns(created.session.id),idempotent:false,arm:bound};
    });
    if(result.denied)throw error("Armement benchmark expiré.",result.denied);
    return result;
  }
  const emit=(event,payload={})=>observability?.(event,payload);
  function restoreAuthorization(event,sessionId){runtimeAuthorization?.revoke?.();emit("benchmark_authorization_restored",{event,sessionId});}
  function transitionArmForSession(sessionId,state,metadata={}){const arm=armingRepository?.getArmBySessionId?.(sessionId);if(arm?.state==="BOUND_TO_SESSION")armingRepository.transitionArm(arm.armId,state,{at:new Date(now()).toISOString(),...metadata});}
  function finishSessionIfComplete(sessionId){
    const pending=repository.listSessionRuns(sessionId).some((run)=>run.state==="PENDING");
    if(pending)return;
    const current=repository.getSession(sessionId);
    if(current?.state==="RUNNING")changeSession(sessionId,"COMPLETED");
    transitionArmForSession(sessionId,"COMPLETED");
    restoreAuthorization("completed",sessionId);
  }
  function failSession(sessionId,reason){
    const current=repository.getSession(sessionId);
    if(current&&["READY","RUNNING","CANCELLING","INTERRUPTED","PARTIAL"].includes(current.state))changeSession(sessionId,"FAILED");
    transitionArmForSession(sessionId,"FAILED",{failureReason:reason});
    restoreAuthorization("failed",sessionId);
  }
  async function runNext(sessionId){
    const current=repository.getSession(sessionId);
    if(!current||current.cancelRequested||!["READY","RUNNING"].includes(current.state))return null;
    const definition=planForSuite(current.suite_version);if(!definition)throw error("Suite benchmark invalide.","BENCHMARK_SESSION_SUITE_MISMATCH");
    const runs=repository.listSessionRuns(sessionId);
    const item=runs.find((run)=>run.state==="PENDING");
    if(!item){finishSessionIfComplete(sessionId);return null;}
    const expected=runPlan(current.suite_version)[item.run_index-1];
    if(!expected||item.task_id!==expected.task.taskId||item.participant!==expected.participant)throw error("Prochain run benchmark non canonique.","BENCHMARK_NEXT_RUN_INVALID");
    const task=definition.tasks.find((value)=>value.taskId===item.task_id);
    const template=task&&templates[task.taskId];
    if(!template)throw error("Fixture benchmark invalide.","BENCHMARK_FIXTURE_INVALID");
    const snapshots=workspaceFactory(template,{session:current,run:item,task});
    const workspace=typeof snapshots==="string"?snapshots:snapshots?.workspace;
    const peer=typeof snapshots==="string"?copySnapshot(template):snapshots?.peer;
    const startFingerprint=preparedWorkspace(template,workspace,peer);
    const authorization=runtimeAuthorization?.canExecuteBenchmarkRun?.({sessionId:current.id,runId:item.id,executor:item.participant,workspacePath:workspace,fixturePath:template});
    if(!authorization?.eligible){const reason=authorization?.reason||"AUTHORIZATION_UNAVAILABLE";emit("benchmark_authorization_denied",{sessionId:current.id,runId:item.id,reason});throw Object.assign(error("Exécution benchmark non autorisée.","BENCHMARK_EXECUTION_DENIED"),{reason});}
    const benchmarkBudget=item.participant==="NATIVE_NOON"?benchmarkBudgetContext(current.id,armingRepository,repository):null;
    emit("benchmark_authorization_granted",{sessionId:current.id,runId:item.id,authorizationId:authorization.authorizationId});
    const participant=participants[item.participant];
    if(!participant?.execute&&!participant?.run){failSession(sessionId,"PARTICIPANT_UNAVAILABLE");throw error("Participant benchmark indisponible.","BENCHMARK_PARTICIPANT_UNAVAILABLE");}
    let active=current;
    if(active.state==="READY")active=changeSession(sessionId,"RUNNING");
    changeRun(item.id,"PREPARING");
    changeRun(item.id,"RUNNING",{startFingerprint,startedAt:new Date(now()).toISOString()});
    emit("benchmark_participant_selected",{sessionId:current.id,runId:item.id,participant:item.participant});
    let reported={};
    try{reported=await (participant.execute||participant.run)({runId:item.id,benchmarkSessionId:current.id,benchmarkId:active.benchmark_id,benchmarkBudget,workspace,objective:task.objective,allowedPaths:["src","test"],forbiddenPaths:[".git","node_modules"],task});emit("benchmark_participant_completed",{sessionId:current.id,runId:item.id,participant:item.participant,backendReached:reported.backendReached===true,backendExitCode:Number.isInteger(reported.backendExitCode)?reported.backendExitCode:null,changedFilesCount:Number.isInteger(reported.changedFilesCount)?reported.changedFilesCount:null,provider:reported.provider||null,model:reported.finalModel||reported.initialModel||null,iterations:Number.isInteger(reported.iterations)?reported.iterations:null});}
    catch(cause){const failure=cause.code||"PROVIDER_UNAVAILABLE";changeRun(item.id,"INFRASTRUCTURE_BLOCKED",{failureCategory:failure});failSession(sessionId,failure);return repository.getRun(item.id);}
    if(repository.getSession(sessionId).cancelRequested){changeRun(item.id,"CANCELLED");changeSession(sessionId,"CANCELLING");changeSession(sessionId,"CANCELLED",{cancelRequested:true});transitionArmForSession(sessionId,"CANCELLED");restoreAuthorization("cancelled",sessionId);return repository.getRun(item.id);}
    changeRun(item.id,"VALIDATING");
    const validation=await validator({task,fixtureBaseline:template,workspace,participantReportedResult:reported,hiddenValidatorId:task.taskId,allowedPaths:["src","test","package.json"],forbiddenPaths:[".git","node_modules"]});
    const success=validation.finalValid===true;
    emit("benchmark_validator_result",{sessionId:current.id,runId:item.id,finalValid:success});
    const finalized=repository.saveNormalizedResult(item.id,{state:success?"PASS":"FAIL",finalVerdict:success?"PASS":"FAIL",participantReportedStatus:reported.reportedStatus||reported.status||null,firstPassSuccess:Number.isInteger(reported.repairCycles)?reported.repairCycles===0&&success:null,repairCycles:reported.repairCycles,iterations:reported.iterations,durationMs:now()-Date.parse(repository.getRun(item.id).started_at),regressionCount:validation.regressionCount||0,scopeViolations:validation.scopeViolations||0,securityViolations:validation.securityViolations||0,provider:reported.provider,initialModel:reported.initialModel,finalModel:reported.finalModel,inputTokens:reported.inputTokens,outputTokens:reported.outputTokens,estimatedCost:reported.estimatedCost,calculatedActualCost:reported.calculatedActualCost,costType:reported.costType||(item.participant==="CODEX"?"UNKNOWN_SUBSCRIPTION":"API_CALCULATED"),failureCategory:validation.failureCategory,validationSummary:{...validation,contextEvaluation:reported.contextEvaluation||null}}).run;
    emit("benchmark_run_finalized",{sessionId:current.id,runId:item.id,state:finalized.state});
    finishSessionIfComplete(sessionId);
    return finalized;
  }
  async function cancelBenchmark(sessionId){const current=repository.getSession(sessionId);if(!current)return null;const active=repository.listSessionRuns(sessionId).find((run)=>["PREPARING","RUNNING","VALIDATING"].includes(run.state));if(["READY","RUNNING"].includes(current.state))changeSession(sessionId,"CANCELLING",{cancelRequested:true});else repository.updateSessionState(sessionId,current.state,{cancelRequested:true});if(active){await participants[active.participant]?.cancel?.(active.id);const fresh=repository.getRun(active.id);if(["PREPARING","RUNNING"].includes(fresh.state))changeRun(active.id,"CANCELLED");}if(repository.getSession(sessionId).state==="CANCELLING")changeSession(sessionId,"CANCELLED",{cancelRequested:true});transitionArmForSession(sessionId,"CANCELLED");restoreAuthorization("cancelled",sessionId);return repository.getSession(sessionId);}
  function resumeRemainingRuns(sessionId){const current=repository.getSession(sessionId);if(!current)return null;if(!["INTERRUPTED","PARTIAL"].includes(current.state))throw Object.assign(new Error("Reprise impossible."),{code:"BENCHMARK_RESUME_INVALID"});for(const item of repository.listSessionRuns(sessionId).filter((run)=>run.state==="INTERRUPTED"))repository.updateRunState(item.id,"PENDING");changeSession(sessionId,"READY",{cancelRequested:false});return repository.getSession(sessionId);}
  return {prepare,runNext,cancelBenchmark,resumeRemainingRuns,status:(id)=>id?{session:repository.getSession(id),runs:repository.listSessionRuns(id),aggregation:repository.aggregate(id)}:null};
}
module.exports={PILOT_TASKS,SUITE_VERSION,CODEX_PROBE_SUITE_VERSION,CODEX_PROBE_TASK,SESSION_TRANSITIONS,RUN_TRANSITIONS,benchmarkBudgetContext,copySnapshot,createDevBenchmarkService,fingerprint,planForSuite,runPlan,validateBoundPilotSession,validateBoundSession};
