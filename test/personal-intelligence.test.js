"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createPersonalIntelligenceRepository } = require("../services/persistence/repositories/personal-intelligence-repository");
const { migrateLegacyPersonalData } = require("../services/persistence/migrations/legacy-personal-data");
const { PERMANENT_RULES, createOperationalProfileService } = require("../services/personal-intelligence/operational-profile");
const { analyzeProject } = require("../services/personal-intelligence/project-intelligence");
const { createInboxService } = require("../services/personal-intelligence/inbox-service");
const { scoreRecommendation } = require("../services/personal-intelligence/priority-engine");
const { createDeduplicationService } = require("../services/personal-intelligence/deduplication-service");
const { createFollowUpService } = require("../services/personal-intelligence/follow-up-service");

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-personal-"));
  const database = createPersonalDatabase(path.join(directory, "personal.sqlite"));
  const repository = createPersonalIntelligenceRepository(database);
  return { directory, database, repository };
}

test("crée un fait confirmé et une hypothèse sans promotion automatique", () => {
  const { database, repository } = fixture();
  const fact = repository.upsertMemory({ type: "objective", subject: "Objectif", value: { text: "Finir Kasa" }, sourceType: "user", status: "confirmed", confidence: 1, explicitConfirmation: true });
  const hypothesis = repository.upsertMemory({ type: "work_preference", subject: "Matin", value: { duration: 90 }, sourceType: "observation", status: "inferred", confidence: 0.6 });
  assert.equal(fact.status, "confirmed"); assert.equal(hypothesis.status, "inferred");
  assert.throws(() => repository.updateMemory(hypothesis.id, { status: "confirmed" }), /confirmation explicite/i);
  assert.equal(repository.confirmMemory(hypothesis.id).status, "confirmed"); database.close();
});

test("corrige, rend temporaire, expire, oublie et bloque un souvenir", () => {
  const { database, repository } = fixture();
  const memory = repository.upsertMemory({ type: "work_preference", subject: "Style", value: { value: "court" }, sourceType: "user", status: "confirmed", confidence: 1, explicitConfirmation: true });
  assert.equal(repository.updateMemory(memory.id, { value: { value: "détaillé" } }).value.value, "détaillé");
  repository.updateMemory(memory.id, { status: "temporary", expiresAt: "2020-01-01T00:00:00.000Z" }); repository.expireMemories();
  assert.equal(repository.getMemory(memory.id).status, "expired");
  const second = repository.upsertMemory({ type: "objective", subject: "Test", value: {}, sourceType: "user", status: "confirmed", confidence: 1, explicitConfirmation: true });
  assert.equal(repository.forgetMemory(second.id).status, "rejected");
  const third = repository.upsertMemory({ type: "objective", subject: "Privé", value: {}, sourceType: "user", status: "confirmed", confidence: 1, explicitConfirmation: true });
  assert.equal(repository.blockMemory(third.id).useAllowed, false); database.close();
});

test("refuse les secrets et permet une recherche exacte locale", () => {
  const { database, repository } = fixture();
  assert.throws(() => repository.upsertMemory({ type: "objective", subject: "Clé", value: { text: "sk-abcdefghijklmnop" }, sourceType: "user", status: "confirmed", explicitConfirmation: true }), /sensible/i);
  repository.upsertMemory({ type: "decision", subject: "Typographie Montserrat", value: { choice: "UltraBold" }, sourceType: "user", status: "confirmed", confidence: 1, explicitConfirmation: true });
  assert.equal(repository.searchMemories("Montserrat").length, 1); database.close();
});

test("initialise toutes les règles permanentes confirmées", () => {
  const { database, repository } = fixture(); const service = createOperationalProfileService(repository);
  assert.equal(service.ensurePermanentRules(), PERMANENT_RULES.length);
  assert.equal(service.portrait().permanentRules.length, PERMANENT_RULES.length); database.close();
});

test("migration héritée idempotente et récupérable", () => {
  const { directory, database, repository } = fixture();
  fs.writeFileSync(path.join(directory, "long-term-memory.json"), JSON.stringify({ memories: [{ id: "m1", text: "Préférence explicite", tags: [] }] }));
  fs.writeFileSync(path.join(directory, "project-journals.json"), JSON.stringify({ version: 1, projects: { kasa: { projectName: "Kasa", currentStatus: "En cours", nextActions: ["Tester"], blockers: [], decisions: [] } } }));
  const first = migrateLegacyPersonalData({ repository, dataDirectory: directory }); const second = migrateLegacyPersonalData({ repository, dataDirectory: directory });
  assert.equal(first.memories, 1); assert.equal(first.projects, 1); assert.equal(second.reason, "already-applied");
  assert.equal(repository.listMemories().length, 1); assert.equal(repository.listProjects().length, 1);
  assert.equal(fs.existsSync(path.join(directory, "long-term-memory.json")), true); database.close();
});

test("une migration invalide ne touche pas la source et reste relançable", () => {
  const { directory, database, repository } = fixture(); const source=path.join(directory,"long-term-memory.json");fs.writeFileSync(source,"{invalide");
  const result=migrateLegacyPersonalData({repository,dataDirectory:directory});assert.equal(result.reason,"failed");assert.equal(fs.readFileSync(source,"utf8"),"{invalide");assert.equal(repository.hasMigration("legacy-personal-data-v1"),false);database.close();
});

test("détecte les projets actifs incomplets, bloqués, inactifs et proches de l’échéance", () => {
  const signals=analyzeProject({id:"p",status:"in_progress",nextAction:null,blockers:["Réponse client"],deadline:"2026-08-29T08:00:00Z",lastActivityAt:"2026-08-01T00:00:00Z"},new Date("2026-08-27T08:00:00Z"));
  assert.deepEqual(new Set(signals.map(x=>x.code)),new Set(["missing-next-action","inactive-project","deadline-near","blocked"]));
});

test("normalise, déduplique, met à jour et associe la boîte d’entrée", () => {
  const { database, repository }=fixture();const inbox=createInboxService(repository);
  const first=inbox.ingest("gmail",[{id:"mail-1",subject:"Réponse",action:"Répondre"}])[0];const second=inbox.ingest("gmail",[{id:"mail-1",subject:"Réponse urgente",action:"Répondre aujourd’hui"}])[0];
  assert.equal(first.id,second.id);assert.equal(inbox.list().length,1);assert.equal(inbox.associate(first.id,"p-1").projectId,"p-1");database.close();
});

test("le score tient compte de l’urgence, du risque et du coût d’interruption", () => {
  const high=scoreRecommendation({urgency:1,impact:1,deadline:"2026-08-27T09:00:00Z",blockingRisk:1,confidence:1,interruptionCost:0},undefined,new Date("2026-08-27T08:00:00Z"));
  const low=scoreRecommendation({urgency:.2,impact:.2,confidence:.4,interruptionCost:1},undefined,new Date("2026-08-27T08:00:00Z"));assert.ok(high.score>low.score);assert.ok(high.score<=100);
});

test("anti-répétition bloque puis réactive après changement réel", () => {
  const { database, repository }=fixture();const service=createDeduplicationService(repository);const recommendation={sourceType:"project",sourceReference:"p",action:"Tester",score:60,priorityLevel:"moyenne",reactivationKey:"v1"};
  assert.equal(service.evaluate(recommendation).allowed,true);assert.equal(service.evaluate(recommendation).allowed,false);assert.equal(service.evaluate({...recommendation,reactivationKey:"v2"}).allowed,true);database.close();
});

test("le suivi met à jour la prochaine action sans relance automatique", () => {
  const { database, repository }=fixture();repository.upsertProject({id:"p",name:"Kasa",status:"in_progress",nextAction:"Coder"});const followups=createFollowUpService(repository);followups.complete({id:"f",projectId:"p",outcome:"continue",nextAction:"Tester"});assert.equal(repository.getProject("p").nextAction,"Tester");assert.equal(followups.due().length,0);database.close();
});
