"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ACTIVE_STATUSES = new Set(["queued", "in_progress"]);
const ALLOWED_KINDS = new Set(["project_audit", "multi_document_analysis", "long_document", "complex_comparison"]);

function createBackgroundAnalysisService({ client, stateFile, enabled = process.env.ENABLE_BACKGROUND_ANALYSIS === "true", logger = null }) {
  function load() { try { const state=JSON.parse(fs.readFileSync(stateFile,"utf8"));return Array.isArray(state.tasks)?state:{version:1,tasks:[]}; } catch { return {version:1,tasks:[]}; } }
  function save(state) { fs.mkdirSync(path.dirname(stateFile),{recursive:true});const temporary=`${stateFile}.tmp`;fs.writeFileSync(temporary,JSON.stringify(state,null,2),{mode:0o600});fs.renameSync(temporary,stateFile); }
  function publicTask(task) { const { responseId, ...safe }=task;return {...safe,hasRemoteResponse:Boolean(responseId)}; }
  function getTask(id) { return load().tasks.find(task=>task.id===id)||null; }
  function update(id, changes) { const state=load();const task=state.tasks.find(item=>item.id===id);if(!task)throw new Error("Analyse introuvable.");Object.assign(task,changes,{updatedAt:new Date().toISOString()});save(state);return task; }
  async function start({kind,input,model="gpt-5.6-terra",metadata={}}) {
    if(!enabled)throw Object.assign(new Error("Les analyses en arrière-plan sont désactivées."),{code:"BACKGROUND_DISABLED"});
    if(!ALLOWED_KINDS.has(kind))throw new Error("Type d’analyse longue non autorisé.");
    const response=await client.responses.create({model,input,background:true,store:false,metadata:{noon_kind:kind}});
    const now=new Date().toISOString();const task={id:crypto.randomUUID(),kind,status:response.status||"queued",responseId:response.id,createdAt:now,updatedAt:now,metadata,output:null,error:null,explicitlyStarted:true};const state=load();state.tasks.unshift(task);state.tasks=state.tasks.slice(0,20);save(state);return publicTask(task);
  }
  async function poll(id) { const task=getTask(id);if(!task)throw new Error("Analyse introuvable.");if(!ACTIVE_STATUSES.has(task.status))return publicTask(task);try{const response=await client.responses.retrieve(task.responseId);const isActive=ACTIVE_STATUSES.has(response.status);const changes={status:response.status,responseId:isActive?task.responseId:null,output:response.status==="completed"?String(response.output_text||"").slice(0,200_000):null,error:response.error?.message?String(response.error.message).slice(0,500):null};return publicTask(update(id,changes));}catch(error){logger?.("warning","background-analysis-poll-failed",error.code||error.name||"ERROR");throw error;}}
  async function cancel(id) { const task=getTask(id);if(!task)throw new Error("Analyse introuvable.");if(task.responseId&&ACTIVE_STATUSES.has(task.status))await client.responses.cancel(task.responseId);return publicTask(update(id,{status:"cancelled",responseId:null})); }
  function list() { return load().tasks.map(publicTask); }
  function interrupted() { return list().filter(task=>ACTIVE_STATUSES.has(task.status)&&task.explicitlyStarted); }
  function cleanup({olderThanMs=7*86_400_000}={}) { const state=load();const cutoff=Date.now()-olderThanMs;state.tasks=state.tasks.filter(task=>ACTIVE_STATUSES.has(task.status)||new Date(task.updatedAt).getTime()>=cutoff);save(state);return state.tasks.length; }
  return { cancel, cleanup, enabled, interrupted, list, poll, start };
}

module.exports = { ACTIVE_STATUSES, ALLOWED_KINDS, createBackgroundAnalysisService };
