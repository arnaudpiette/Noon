"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { applyCompactionOptions, createWithCompactionFallback } = require("../services/openai/compaction-service");
const { appendTurn } = require("../services/openai/conversation-context");
const { createBackgroundAnalysisService } = require("../services/openai/background-analysis");

test("active la compaction en tokens et conserve store false", () => {
  const options=applyCompactionOptions({model:"gpt-5.6-terra",store:false},{ENABLE_RESPONSE_COMPACTION:"true",RESPONSE_COMPACTION_THRESHOLD_TOKENS:"80000"});
  assert.equal(options.store,false);assert.deepEqual(options.context_management,[{type:"compaction",compact_threshold:80000}]);
});

test("retombe sur la requête stateless sans compaction si le modèle la refuse", async () => {
  const calls=[];const client={responses:{create:async(options)=>{calls.push(options);if(calls.length===1)throw Object.assign(new Error("Unknown parameter context_management"),{status:400});return{output_text:"ok"};}}};
  const result=await createWithCompactionFallback(client,{model:"gpt-5.6-luna",store:false},undefined,{ENABLE_RESPONSE_COMPACTION:"true"});assert.equal(result.output_text,"ok");assert.equal(calls[1].context_management,undefined);assert.equal(result.noonCompactionFallback,true);
});

test("préserve les call_id et les items opaques de compaction", () => {
  const next=appendTurn([],{output:[{type:"function_call",call_id:"call-1",name:"x",arguments:"{}"},{type:"compaction",encrypted_content:"opaque"}]},"suite");assert.equal(next[0].call_id,"call-1");assert.equal(next[1].encrypted_content,"opaque");
});

test("lance, poll et annule uniquement une analyse explicitement créée", async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"noon-bg-"));let status="in_progress";let cancelled=false;
  const client={responses:{create:async(options)=>{assert.equal(options.background,true);assert.equal(options.store,false);return{id:"resp-1",status:"queued"};},retrieve:async()=>({id:"resp-1",status,output_text:status==="completed"?"Résultat":null}),cancel:async()=>{cancelled=true;}}};
  const service=createBackgroundAnalysisService({client,stateFile:path.join(directory,"tasks.json"),enabled:true});const task=await service.start({kind:"project_audit",input:"Audit"});assert.equal(task.hasRemoteResponse,true);assert.equal(service.interrupted().length,1);status="completed";assert.equal((await service.poll(task.id)).output,"Résultat");
  const second=await service.start({kind:"complex_comparison",input:"Comparer"});await service.cancel(second.id);assert.equal(cancelled,true);assert.equal(service.list().find(x=>x.id===second.id).status,"cancelled");
});

test("le mode background désactivé n’appelle jamais l’API", async () => {
  let called=false;const service=createBackgroundAnalysisService({client:{responses:{create:async()=>{called=true;}}},stateFile:path.join(os.tmpdir(),"unused-noon-bg.json"),enabled:false});await assert.rejects(()=>service.start({kind:"project_audit",input:"x"}),error=>error.code==="BACKGROUND_DISABLED");assert.equal(called,false);
});
