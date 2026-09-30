"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createPersonalDatabase, createSchema, loadSqlite } = require("../services/persistence/database");
const { createExecutionTrackingRepository } = require("../services/persistence/repositories/execution-tracking-repository");
const { createExecutionTrackingEngine, TrackingError } = require("../services/tracking/execution-tracking-engine");

const BASE = new Date("2026-08-28T08:00:00Z");

function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-tracking-"));
  const database = createPersonalDatabase(path.join(directory, "tracking.sqlite"));
  const repository = createExecutionTrackingRepository(database);
  const proactiveCalls = [], replanCalls = [], metricCalls = [];
  const proactiveEngine = options.proactiveEngine || {
    adapters: { local(items) { return items.map((item) => ({ ...item, sourceType: "local", sourceReference: item.id, isAction: true })); } },
    async evaluate(signals, context) { proactiveCalls.push({ signals, context }); return { recommendations: signals, notifications: [], ignored: [] }; },
  };
  const planningEngine = options.planningEngine || {
    async replanDay(input) { replanCalls.push(input); return { planId: "replanned", proposedBlocks: [], plannedBlocks: [] }; },
  };
  const engine = createExecutionTrackingEngine({ repository, proactiveEngine, planningEngine,
    metrics: { record(...args) { metricCalls.push(args); } }, now: () => BASE,
    gracePeriods: { default: 15 } });
  function close() { database.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  return { engine, repository, proactiveCalls, replanCalls, metricCalls, close };
}

function plan(blocks = [], overrides = {}) {
  return { planId: "plan-1", planVersion: 1, generatedAt: "2026-08-28T06:00:00Z",
    plannedBlocks: [], proposedBlocks: blocks, ...overrides };
}
function block(id, start = "2026-08-28T09:00:00Z", end = "2026-08-28T10:00:00Z", extra = {}) {
  return { blockId: `block-${id}`, actionId: id, title: `Action ${id}`, start, end,
    durationMinutes: 60, priorityScore: 80, status: "proposed", ...extra };
}

test("confirmation utilisateur explicite termine une action non ambiguë", () => {
  const f=fixture();try{const [item]=f.engine.ingestPlan(plan([block("A")]));const result=f.engine.interpretUserCommand("j’ai fini",[item]);assert.equal(result.item.status,"completed");assert.equal(result.item.confidence,1);}finally{f.close();}
});

test("un bloc Calendar écoulé devient unknown, jamais completed", () => {
  const f=fixture();try{const [item]=f.engine.ingestPlan(plan([block("A","2026-08-28T06:00:00Z","2026-08-28T07:00:00Z")]));const drifts=f.engine.detectDrift({at:BASE});assert.equal(f.repository.get(item.executionItemId).status,"unknown");assert.equal(drifts[0].type,"UNCONFIRMED_BLOCK");}finally{f.close();}
});

test("un Reminder terminé constitue une preuve forte", () => {
  const f=fixture();try{f.engine.ingestPlan(plan([block("reminder-1")]));const result=f.engine.applyReminder({id:"reminder-1",completed:true,completedAt:BASE});assert.equal(result.item.status,"completed");assert.equal(result.item.completionSource,"reminder_completed");}finally{f.close();}
});

test("un retard dépassant la grace period produit START_DELAY", () => {
  const f=fixture();try{f.engine.ingestPlan(plan([block("A","2026-08-28T07:00:00Z","2026-08-28T09:00:00Z")]));const drifts=f.engine.detectDrift({at:BASE});assert.equal(drifts[0].type,"START_DELAY");assert.equal(drifts[0].delayMinutes,60);}finally{f.close();}
});

test("un petit retard sous la tolérance ne déclenche rien", () => {
  const f=fixture();try{f.engine.ingestPlan(plan([block("A","2026-08-28T07:50:00Z","2026-08-28T09:00:00Z")]));assert.equal(f.engine.detectDrift({at:BASE}).length,0);}finally{f.close();}
});

test("une tâche en cours dépassant son bloc produit OVERRUN", () => {
  const f=fixture();try{const [item]=f.engine.ingestPlan(plan([block("A","2026-08-28T06:00:00Z","2026-08-28T07:30:00Z")]));f.engine.transition(item.executionItemId,{status:"in_progress",source:"explicit_user_confirmation",occurredAt:"2026-08-28T06:10:00Z"});const drift=f.engine.detectDrift({at:BASE})[0];assert.equal(drift.type,"OVERRUN");assert.equal(drift.overrunMinutes,30);}finally{f.close();}
});

test("un blocage explicite conserve un blocker structuré", () => {
  const f=fixture();try{const [item]=f.engine.ingestPlan(plan([block("A")]));const result=f.engine.interpretUserCommand("je suis bloqué sur cette tâche",[item]);assert.equal(result.item.status,"blocked");assert.equal(result.item.blocker.type,"user_reported");}finally{f.close();}
});

test("le blocage de A propage uniquement DEPENDENCY_DELAY vers B", () => {
  const f=fixture();try{const items=f.engine.ingestPlan(plan([block("A"),block("B","2026-08-28T10:15:00Z","2026-08-28T11:15:00Z",{dependencies:["A"]})]));f.engine.transition(items[0].executionItemId,{status:"blocked",source:"explicit_user_confirmation",blocker:{reason:"Dépendance"}});const drifts=f.engine.detectDrift({at:BASE});assert.ok(drifts.some((drift)=>drift.type==="DEPENDENCY_DELAY"&&drift.actionId==="B"));}finally{f.close();}
});

test("un déplacement manuel ne devient jamais une dérive", () => {
  const f=fixture();try{f.engine.ingestPlan(plan([block("A","2026-08-28T06:00:00Z","2026-08-28T07:00:00Z",{manualMove:true})]));assert.equal(f.engine.detectDrift({at:BASE}).length,0);}finally{f.close();}
});

test("cancelled est terminal et absent du carry-over", () => {
  const f=fixture();try{const [item]=f.engine.ingestPlan(plan([block("A","2026-08-27T09:00:00Z","2026-08-27T10:00:00Z")]));f.engine.transition(item.executionItemId,{status:"cancelled",source:"explicit_user_confirmation"});assert.equal(f.engine.rollover({fromDate:"2026-08-27",toDate:"2026-08-28",at:BASE}).length,0);}finally{f.close();}
});

test("demain crée un defer distinct du snooze", () => {
  const f=fixture();try{const [item]=f.engine.ingestPlan(plan([block("A")]));const result=f.engine.interpretUserCommand("je le ferai demain",[item],{at:BASE});assert.equal(result.item.status,"deferred");assert.match(result.item.deferredUntil,/2026-08-29/);}finally{f.close();}
});

test("une completion partielle conserve la durée restante fiable", () => {
  const f=fixture();try{const [item]=f.engine.ingestPlan(plan([block("A","2026-08-28T08:00:00Z","2026-08-28T10:00:00Z",{durationMinutes:120})]));f.engine.transition(item.executionItemId,{status:"in_progress",source:"explicit_user_confirmation",progress:50,remainingDurationMinutes:60});const updated=f.repository.get(item.executionItemId);assert.equal(updated.progress,50);assert.equal(updated.remainingDurationMinutes,60);}finally{f.close();}
});

test("une dérive importante alimente le Proactive Engine", async () => {
  const f=fixture();try{f.engine.ingestPlan(plan([block("A","2026-08-28T05:00:00Z","2026-08-28T06:00:00Z",{priorityScore:95,dueAt:"2026-08-28T09:00:00Z"})]));const drifts=f.engine.detectDrift({at:BASE});const result=await f.engine.sendDriftsToProactive(drifts,{at:BASE});assert.ok(result.recommendations.length>=1);assert.equal(f.proactiveCalls.length,1);}finally{f.close();}
});

test("le replan est minimal et protège terminé/en cours", async () => {
  const f=fixture();try{const items=f.engine.ingestPlan(plan([block("A"),block("B","2026-08-28T10:00:00Z","2026-08-28T11:00:00Z")]));f.engine.transition(items[0].executionItemId,{status:"in_progress",source:"explicit_user_confirmation",remainingDurationMinutes:30});const drift={type:"OVERRUN",severity:"high",actionId:"A",affectedActionIds:["B"]};const result=await f.engine.requestMinimalReplan({drifts:[drift],plan:plan([block("A"),block("B")]),actions:[{id:"A",actionId:"A",estimatedDurationMinutes:60},{id:"B",actionId:"B",estimatedDurationMinutes:60}],at:BASE});assert.equal(result.contract.preserveInProgress,true);assert.equal(f.replanCalls[0].actions[0].inProgress,true);assert.equal(f.replanCalls[0].actions[0].estimatedDurationMinutes,30);}finally{f.close();}
});

test("completed et in_progress restent explicites pour le Planning Engine", async () => {
  const f=fixture();try{const items=f.engine.ingestPlan(plan([block("done"),block("active")]));f.engine.transition(items[0].executionItemId,{status:"completed",source:"explicit_user_confirmation"});f.engine.transition(items[1].executionItemId,{status:"in_progress",source:"explicit_user_confirmation"});await f.engine.requestMinimalReplan({drifts:[{type:"CAPACITY_LOSS",severity:"high",actionId:"active"}],plan:plan([]),actions:[{id:"done",actionId:"done"},{id:"active",actionId:"active"}],at:BASE});assert.equal(f.replanCalls[0].actions[0].completed,true);assert.equal(f.replanCalls[0].actions[1].inProgress,true);}finally{f.close();}
});

test("le rollover conserve le pertinent mais exclut le vieux faible score", () => {
  const f=fixture();try{f.engine.ingestPlan(plan([block("high","2026-08-27T09:00:00Z","2026-08-27T10:00:00Z",{priorityScore:80}),block("low","2026-08-27T10:00:00Z","2026-08-27T11:00:00Z",{priorityScore:20})]));const carry=f.engine.rollover({fromDate:"2026-08-27",toDate:"2026-08-28",at:BASE});assert.deepEqual(carry.map((item)=>item.actionId),["high"]);}finally{f.close();}
});

test("un succès outil exact termine, un échec bloque et ne termine jamais", () => {
  const f=fixture();try{f.engine.ingestPlan(plan([block("success"),block("failure")]));assert.equal(f.engine.applyToolResult({actionId:"success",executionSucceeded:true,exactActionMatch:true,executionId:"1"}).item.status,"completed");assert.equal(f.engine.applyToolResult({actionId:"failure",executionSucceeded:false,executionId:"2"}).item.status,"blocked");}finally{f.close();}
});

test("la même preuve reçue deux fois est idempotente", () => {
  const f=fixture();try{const [item]=f.engine.ingestPlan(plan([block("A")]));const evidence={executionItemId:item.executionItemId,status:"completed",source:"explicit_user_confirmation",occurredAt:BASE,eventKey:"same"};assert.equal(f.engine.synchronizeEvidence(evidence).idempotent,false);assert.equal(f.engine.synchronizeEvidence(evidence).idempotent,true);}finally{f.close();}
});

test("completed ne redevient pas in_progress sans réouverture explicite", () => {
  const f=fixture();try{const [item]=f.engine.ingestPlan(plan([block("A")]));f.engine.transition(item.executionItemId,{status:"completed",source:"explicit_user_confirmation"});assert.throws(()=>f.engine.transition(item.executionItemId,{status:"in_progress",source:"explicit_user_confirmation",occurredAt:new Date(BASE.getTime()+1000)}),(error)=>error instanceof TrackingError&&error.code==="TRACKING_TERMINAL_STATE");}finally{f.close();}
});

test("une commande ambiguë ne termine aucune action", () => {
  const f=fixture();try{const items=f.engine.ingestPlan(plan([block("A"),block("B")]));const result=f.engine.interpretUserCommand("c’est fini",items);assert.equal(result.status,"ambiguous");assert.ok(items.every((item)=>f.repository.get(item.executionItemId).status==="planned"));}finally{f.close();}
});

test("les profils restent strictement isolés", () => {
  const f=fixture();try{f.engine.ingestPlan(plan([block("A")]),{subjectScope:"arnaud"});f.engine.ingestPlan(plan([block("A")]),{subjectScope:"alexandra"});assert.equal(f.engine.list({subjectScope:"arnaud"}).length,1);assert.equal(f.engine.list({subjectScope:"alexandra"}).length,1);}finally{f.close();}
});

test("les exécutions sont isolées par profil et projet avant la limite", () => {
  const f = fixture();
  try {
    f.engine.ingestPlan(plan([
      block("other-1", "2026-08-28T06:00:00Z", "2026-08-28T07:00:00Z", { projectId: "other" }),
      block("other-2", "2026-08-28T07:00:00Z", "2026-08-28T08:00:00Z", { projectId: "other" }),
      block("target", "2026-08-28T09:00:00Z", "2026-08-28T10:00:00Z", { projectId: "target" }),
      block("legacy", "2026-08-28T10:00:00Z", "2026-08-28T11:00:00Z"),
    ]), { subjectScope: "arnaud" });
    f.engine.ingestPlan(plan([block("target", "2026-08-28T09:00:00Z", "2026-08-28T10:00:00Z", { projectId: "target" })], { planId: "alexandra-plan" }), { subjectScope: "alexandra" });

    const target = f.engine.list({ subjectScope: "arnaud", projectId: "target", limit: 1 });
    assert.equal(target.length, 1);
    assert.equal(target[0].actionId, "target");
    assert.equal(target[0].projectId, "target");
    assert.equal(f.engine.list({ subjectScope: "arnaud", projectId: "other" }).length, 2);
    assert.equal(f.engine.list({ subjectScope: "alexandra", projectId: "target" }).length, 1);
    assert.equal(f.engine.list({ subjectScope: "arnaud", projectId: "missing" }).length, 0);

    const updated = f.repository.update(target[0].executionItemId, target[0].version, { status: "in_progress", projectId: "other" });
    assert.equal(updated.projectId, "target");
    assert.equal(f.engine.list({ subjectScope: "arnaud", projectId: "target" })[0].status, "in_progress");
  } finally { f.close(); }
});

test("la migration ajoute project_id sans modifier les exécutions historiques", { skip: !loadSqlite()?.DatabaseSync }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-tracking-migration-"));
  const filePath = path.join(directory, "legacy.sqlite");
  const database = new (loadSqlite().DatabaseSync)(filePath);
  try {
    database.exec(`CREATE TABLE execution_items (
      id TEXT PRIMARY KEY, action_id TEXT NOT NULL, plan_id TEXT, plan_block_id TEXT,
      subject_scope TEXT NOT NULL DEFAULT 'arnaud', source TEXT NOT NULL, source_ref TEXT,
      planned_start TEXT, planned_end TEXT, actual_start TEXT, actual_end TEXT, status TEXT NOT NULL,
      progress REAL, confidence REAL NOT NULL, completion_source TEXT, blocker_json TEXT,
      notes_encrypted TEXT, remaining_duration_minutes INTEGER, priority_score REAL NOT NULL DEFAULT 0,
      due_at TEXT, dependencies_json TEXT NOT NULL DEFAULT '[]', manual_move INTEGER NOT NULL DEFAULT 0,
      deferred_until TEXT, last_event_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(action_id, plan_block_id, subject_scope)
    )`);
    database.prepare("INSERT INTO execution_items(id,action_id,subject_scope,source,status,confidence,last_event_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run("legacy", "legacy-action", "arnaud", "local", "planned", 0.5, "2026-08-28T08:00:00Z", "2026-08-28T08:00:00Z", "2026-08-28T08:00:00Z");

    createSchema(database);
    const migrated = database.prepare("SELECT action_id, project_id FROM execution_items WHERE id=?").get("legacy");
    assert.equal(migrated.action_id, "legacy-action");
    assert.equal(migrated.project_id, null);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("les statistiques de durée utilisent uniquement des preuves fiables", () => {
  const f=fixture();try{const [item]=f.engine.ingestPlan(plan([block("A","2026-08-28T08:00:00Z","2026-08-28T09:00:00Z")]));f.engine.transition(item.executionItemId,{status:"in_progress",source:"explicit_user_confirmation",occurredAt:"2026-08-28T08:00:00Z"});f.engine.transition(item.executionItemId,{status:"completed",source:"explicit_user_confirmation",occurredAt:"2026-08-28T09:10:00Z"});const stats=f.engine.durationStats("project:general");assert.equal(stats.sampleCount,1);assert.equal(stats.meanActualMinutes,70);assert.equal(stats.confidence,"low");}finally{f.close();}
});
