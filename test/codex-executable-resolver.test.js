"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { resolveCodexExecutable } = require("../lib/codex-executable-resolver");
const { createCodexSpecialistAgent } = require("../services/delegation/codex-specialist-agent");
const { createDevDelegationRunner } = require("../services/delegation/dev-delegation-runner");
const { createOperationalSecurityPolicy } = require("../services/security/operational-security-policy");
const { execFileSync } = require("node:child_process");

function executable(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "fixture\n"); fs.chmodSync(file, 0o755); return file; }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "noon-b19l-")); }
function extension(home, version, binary = null) { const file=path.join(home, ".vscode", "extensions", `openai.chatgpt-${version}`, "bin", "macos-x86_64", "codex"); return binary === false ? (fs.mkdirSync(path.dirname(file), { recursive:true }), file) : executable(file); }
function fakeChild() { const child=new EventEmitter(); child.stdout=new EventEmitter(); child.stderr=new EventEmitter(); child.kill=()=>{}; queueMicrotask(()=>child.emit("close",0,null)); return child; }

test("B19L préserve un Codex validé par PATH", () => {
  const home=root(), bin=path.join(home,"bin"); const file=executable(path.join(bin,"codex"));
  const value=resolveCodexExecutable({env:{PATH:bin},homeDirectory:home}); assert.equal(value.source,"PATH"); assert.equal(value.executable,fs.realpathSync(file));
});

test("B19L résout l'extension VS Code avec un PATH Electron réduit", () => {
  const home=root(), file=extension(home,"2.0.0"); const value=resolveCodexExecutable({env:{PATH:"/missing"},homeDirectory:home,platform:"darwin",arch:"x64"});
  assert.equal(value.source,"VSCODE_EXTENSION"); assert.equal(value.executable,fs.realpathSync(file));
});

test("B19L sélectionne déterministement la version d'extension la plus récente", () => {
  const home=root(); extension(home,"1.0.0"); const latest=extension(home,"2.0.0"); const value=resolveCodexExecutable({env:{PATH:"/missing"},homeDirectory:home,platform:"darwin",arch:"x64"});
  assert.equal(value.executable,fs.realpathSync(latest));
});

test("B19L refuse les candidats manquants, non exécutables ou hors racine", () => {
  const home=root(); const nonExecutable=extension(home,"2.0.0"); fs.chmodSync(nonExecutable,0o644);
  assert.equal(resolveCodexExecutable({env:{PATH:"/missing"},homeDirectory:home,platform:"darwin",arch:"x64"}).source,"NOT_FOUND");
  const outside=executable(path.join(root(),"codex")), escaped=path.join(home,".vscode","extensions","openai.chatgpt-3.0.0","bin","macos-x86_64","codex"); fs.mkdirSync(path.dirname(escaped),{recursive:true}); fs.symlinkSync(outside,escaped);
  assert.equal(resolveCodexExecutable({env:{PATH:"/missing"},homeDirectory:home,platform:"darwin",arch:"x64"}).source,"NOT_FOUND");
});

test("B19L ignore les injections de chemin, workspace et prompt", () => {
  const home=root(), workspace=root(); executable(path.join(workspace,"codex"));
  const value=resolveCodexExecutable({env:{PATH:"/missing",NOON_CODEX_PATH:path.join(workspace,"codex")},homeDirectory:home,platform:"darwin",arch:"x64"});
  assert.deepEqual(value,{executable:null,source:"NOT_FOUND"});
});

test("B19L transmet le candidat découvert et l'état structuré au seam de spawn", async () => {
  const home=root(), file=extension(home,"2.0.0"), events=[]; let spawned=null; const workspace=root(); fs.mkdirSync(path.join(workspace,"src"));
  const agent=createCodexSpecialistAgent({executableResolver:()=>({executable:fs.realpathSync(file),source:"VSCODE_EXTENSION"}),versionProvider:()=>({status:"VERSION_OK",version:"codex-cli fixture"}),spawnProcess:(command)=>{spawned=command;return fakeChild();},observability:(event,details)=>events.push({event,details})});
  const result=await agent.executeTask({taskId:"run",repositoryRoot:workspace,objective:"x",allowedPaths:[path.join(workspace,"src")],forbiddenPaths:[],constraints:[],maxIterations:1,maxDuration:1000},{preflight:{agentsFiles:[]},benchmarkExecution:{sessionId:"s",runId:"r",taskId:"normalize-email",participant:"CODEX"}});
  assert.equal(spawned,fs.realpathSync(file)); assert.equal(result.backend.invoked,true); assert.deepEqual(events.map((item)=>item.event),["codex_cli_resolution","codex_version_probe","codex_spawn_attempt","codex_spawn_result"]); assert.equal(events[0].details.source,"VSCODE_EXTENSION"); assert.equal(events[1].details.result,"VERSION_OK");
});

test("B19L traverse le runner réel avec PATH réduit, extension validée et faux spawn", async () => {
  const home=root(), file=extension(home,"2.0.0"), workspace=root(), events=[]; fs.mkdirSync(path.join(workspace,"src")); fs.writeFileSync(path.join(workspace,"src","value.js"),"module.exports=1;\n"); fs.writeFileSync(path.join(workspace,"package.json"),JSON.stringify({scripts:{test:"node --test"}}));
  execFileSync("git",["init","-q"],{cwd:workspace}); execFileSync("git",["config","user.email","fixture@example.test"],{cwd:workspace}); execFileSync("git",["config","user.name","Fixture"],{cwd:workspace}); execFileSync("git",["add","."],{cwd:workspace}); execFileSync("git",["commit","-qm","fixture"],{cwd:workspace});
  const agent=createCodexSpecialistAgent({executableResolver:()=>resolveCodexExecutable({env:{PATH:"/missing"},homeDirectory:home,platform:"darwin",arch:"x64"}),versionProvider:()=>({status:"VERSION_OK",version:"codex-cli fixture"}),spawnProcess:()=>fakeChild(),observability:(event,details)=>events.push({event,details})});
  const policy=createOperationalSecurityPolicy({allowedRootsProvider:()=>[],allowedWriteRootsProvider:()=>[]}); const runner=createDevDelegationRunner({specialistAgent:agent,operationalSecurityPolicy:policy,validationExecutor:async(command)=>({command,status:"PASS",durationMs:0})});
  const result=await runner.runDevTask({taskId:"r",workspaceId:"r",workspaceAuthorized:true,workspaceRoots:[workspace],repositoryRoot:workspace,objective:"fixture",allowedPaths:[path.join(workspace,"src")],validationCommands:["npm test"],benchmarkExecution:{sessionId:"s",runId:"r",taskId:"normalize-email",participant:"CODEX"}});
  assert.equal(result.metrics.backend.invoked,true); assert.equal(result.finalVerdict,"PASS"); assert.deepEqual(events.map((item)=>item.event),["codex_cli_resolution","codex_version_probe","codex_spawn_attempt","codex_spawn_result"]); assert.equal(events[0].details.source,"VSCODE_EXTENSION");
});
