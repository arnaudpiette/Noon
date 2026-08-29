"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createSessionContinuityRepository } = require("../services/persistence/repositories/session-continuity-repository");
const { createSessionContinuityEngine } = require("../services/sessions/session-continuity-engine");

function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-session-"));
  const database = createPersonalDatabase(path.join(directory, "sessions.sqlite"));
  const events = []; let clock = Date.parse("2026-08-28T08:00:00Z");
  const repository = createSessionContinuityRepository(database);
  const engine = createSessionContinuityEngine({ repository, now: () => clock, observability: (event, metadata) => events.push({ event, metadata }), summaryUpdater: (old, messages) => [old, ...messages.map((item) => `${item.role}:${item.content}`)].filter(Boolean).join("\n"), ...options });
  return { database, directory, engine, events, repository, advance(ms) { clock += ms; }, close() { database.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
}

test("une nouvelle conversation crée une session stable et le message suivant la réutilise", () => {
  const f = fixture();
  try { const first = f.engine.resolveSession({ conversationId: "conversation-1", channel: "chat" }); const second = f.engine.resolveSession({ conversationId: "conversation-1", channel: "chat" }); assert.equal(second.id, first.id); assert.notEqual(first.id, first.conversationId); }
  finally { f.close(); }
});

test("chat, voix et reconnexion WebRTC conservent la même session métier", () => {
  const f = fixture();
  try { const chat = f.engine.resolveSession({ conversationId: "conversation-voice", channel: "chat" }); const voice = f.engine.resolveSession({ conversationId: "conversation-voice", channel: "voice" }); const reconnect = f.engine.resolveSession({ conversationId: "conversation-voice", channel: "voice" }); assert.equal(chat.id, voice.id); assert.equal(voice.id, reconnect.id); assert.equal(reconnect.lastChannel, "voice"); }
  finally { f.close(); }
});

test("un changement de workspace et de mode invalide le contexte et crée un segment", () => {
  const invalidations = []; const f = fixture({ contextInvalidator: (...args) => invalidations.push(args) });
  try { const session = f.engine.resolveSession({ conversationId: "conversation-workspace" }); f.engine.applyIntent(session.id, { type: "SWITCH_CONTEXT", workspaceId: "workspace-q", intentId: "i1", target: { name: "Qwenta" }, sourceChannel: "chat" }); f.engine.applyIntent(session.id, { type: "CONTROL", action: "mode", mode: "DEV", intentId: "i2", sourceChannel: "voice" }); const state = f.engine.getSession(session.id); assert.equal(state.workspaceId, "workspace-q"); assert.equal(state.mode, "DEV"); assert.equal(f.engine.segments(session.conversationId).length, 1); assert.ok(invalidations.length >= 2); }
  finally { f.close(); }
});

test("les références récentes expirent et plusieurs candidats restent ambigus", () => {
  const f = fixture();
  try { const session = f.engine.resolveSession({ conversationId: "conversation-refs" }); f.engine.rememberEntity(session.id, { type: "file", id: "file-1", label: "A" }, { ttlMs: 1000 }); assert.equal(f.engine.resolveEntity(session.id, { type: "file" }).entity.entityId, "file-1"); f.engine.rememberEntity(session.id, { type: "file", id: "file-2", label: "B" }, { ttlMs: 1000 }); assert.equal(f.engine.resolveEntity(session.id, { type: "file" }).status, "ambiguous"); f.advance(1001); assert.equal(f.engine.resolveEntity(session.id, { type: "file" }).status, "not_found"); }
  finally { f.close(); }
});

test("la continuité artefact conserve identifiant et version sans relancer le rendu", () => {
  const f = fixture();
  try { const session = f.engine.resolveSession({ conversationId: "conversation-artifact" }); f.engine.recordCompletedTurn(session.id, { artifacts: [{ artifactId: "deck-1", version: 3, title: "Présentation" }] }); const resumed = f.engine.resumeSession(session.id); assert.deepEqual(resumed.currentArtifactRef, { id: "deck-1", type: "artifact", label: "Présentation", version: 3, workspaceId: null, projectId: null, status: null, source: null }); assert.equal(resumed.interruptedExecutions.length, 0); }
  finally { f.close(); }
});

test("les résultats de recherche conservent leur ordre et expirent rapidement", () => {
  const f = fixture();
  try { const session = f.engine.resolveSession({ conversationId: "conversation-search" }); f.engine.recordCompletedTurn(session.id, { search: { id: "search-1", label: "JWT", results: [{ id: "r1", label: "Premier" }, { id: "r2", label: "Deuxième" }] } }); assert.equal(f.engine.resolveEntity(session.id, { type: "search_result", ordinal: 2 }).entity.entityId, "r2"); }
  finally { f.close(); }
});

test("une approbation unique est référencée mais jamais rendue exécutable par la session", () => {
  const f = fixture({ approvalProvider: () => [{ id: "approval-1", executableArgs: { secret: true } }] });
  try { const session = f.engine.resolveSession({ conversationId: "conversation-approval" }); const resumed = f.engine.resumeSession(session.id); assert.deepEqual(resumed.pendingApprovals, ["approval-1"]); assert.equal(JSON.stringify(resumed).includes("executableArgs"), false); }
  finally { f.close(); }
});

test("plusieurs approbations ne sont jamais résolues arbitrairement", () => {
  const f = fixture({ approvalProvider: () => [{ id: "approval-1" }, { id: "approval-2" }] });
  try { const session = f.engine.resolveSession({ conversationId: "conversation-approval-many" }); const resumed = f.engine.resumeSession(session.id); assert.deepEqual(resumed.pendingApprovals, []); }
  finally { f.close(); }
});

test("une tâche terminée reste traçable mais n'est plus la tâche courante", () => {
  const f = fixture();
  try { const session = f.engine.resolveSession({ conversationId: "conversation-task-closed" }); f.engine.recordCompletedTurn(session.id, { task: { id: "task-1", label: "Audit", status: "completed" } }); assert.equal(f.engine.resumeSession(session.id).currentTaskRef, null); assert.equal(f.engine.recentEntities(session.id, "task")[0].entityId, "task-1"); }
  finally { f.close(); }
});

test("le résumé est incrémental, seuilé et compacté", () => {
  const f = fixture({ summaryMessageThreshold: 2, summaryMaxCharacters: 60 });
  try { const session = f.engine.resolveSession({ conversationId: "conversation-summary" }); const first = f.engine.updateSummary(session.id, { messages: [{ role: "user", content: "court" }] }); assert.equal(first.updated, false); const second = f.engine.updateSummary(session.id, { messages: [{ role: "assistant", content: "x".repeat(100) }], lastMessageId: "m2" }); assert.equal(second.updated, true); assert.equal(second.compacted, true); assert.equal(second.summary.lastMessageIdCovered, "m2"); assert.ok(second.summary.text.length <= 60); }
  finally { f.close(); }
});

test("suspend puis reprise restaure le checkpoint et seulement la queue d'historique", () => {
  const messages = new Array(40).fill(null).map((_, index) => ({ role: index % 2 ? "assistant" : "user", content: `m${index}` }));
  const f = fixture({ historyTailProvider: () => messages, historyTailLimit: 6 });
  try { const session = f.engine.resolveSession({ conversationId: "conversation-resume", workspaceId: "workspace-n" }); f.engine.updateSession(session.id, { currentTaskRef: { id: "task-1", label: "Étape 23" } }); f.engine.suspendSession(session.id); const restored = f.engine.restoreContext(session.id); assert.equal(restored.currentTaskRef.id, "task-1"); assert.equal(restored.recentMessages.length, 6); assert.ok(restored.checkpoint); }
  finally { f.close(); }
});

test("un redémarrage marque l'exécution interrompue sans la relancer", () => {
  const f = fixture();
  try { const session = f.engine.resolveSession({ conversationId: "conversation-crash" }); f.engine.updateSession(session.id, { activeExecutionId: "execution-1" }); f.engine.startupRecover(); const recovered = f.engine.getSession(session.id); assert.equal(recovered.status, "suspended"); assert.equal(recovered.activeExecutionId, null); assert.equal(recovered.recoveredFromCrash, true); assert.ok(recovered.recentEntityRefs.some((item) => item.entityId === "execution-1" && item.status === "interrupted")); }
  finally { f.close(); }
});

test("un draft reste retrouvable mais aucune écriture n'est déclenchée au restart", () => {
  let writes = 0; const f = fixture({ artifactProvider: () => { writes += 1; } });
  try { const session = f.engine.resolveSession({ conversationId: "conversation-draft" }); f.engine.updateSession(session.id, { currentArtifactRef: { id: "draft-1", version: 1, status: "draft" } }); f.engine.startupRecover(); const resumed = f.engine.resumeSession(session.id); assert.equal(resumed.currentArtifactRef.status, "draft"); assert.equal(writes, 0); }
  finally { f.close(); }
});

test("une session close n'efface pas la conversation et une nouvelle reprise crée une session", () => {
  const f = fixture();
  try { const session = f.engine.resolveSession({ conversationId: "conversation-close" }); f.engine.closeSession(session.id); const next = f.engine.resolveSession({ conversationId: "conversation-close" }); assert.notEqual(next.id, session.id); assert.equal(next.conversationId, session.conversationId); }
  finally { f.close(); }
});

test("les profils et caches restent strictement isolés", () => {
  const f = fixture();
  try { const arnaud = f.engine.resolveSession({ conversationId: "same-conversation", profileScope: "arnaud" }); const alex = f.engine.resolveSession({ conversationId: "same-conversation", profileScope: "alexandra" }); f.engine.rememberEntity(arnaud.id, { type: "file", id: "private-file" }); assert.notEqual(arnaud.id, alex.id); assert.equal(f.engine.recentEntities(alex.id).length, 0); }
  finally { f.close(); }
});

test("le changement de modèle n'affecte pas l'identité de session", () => {
  const f = fixture();
  try { const session = f.engine.resolveSession({ conversationId: "conversation-model" }); for (const model of ["luna", "terra", "sol"]) f.engine.recordCompletedTurn(session.id, { messages: [{ role: "user", content: model }, { role: "assistant", content: "ok" }] }); assert.equal(f.engine.resolveSession({ conversationId: "conversation-model" }).id, session.id); }
  finally { f.close(); }
});

test("un checkpoint identique est idempotent", () => {
  const f = fixture();
  try { const session = f.engine.resolveSession({ conversationId: "conversation-checkpoint" }); const first = f.engine.checkpoint(session.id); const second = f.engine.checkpoint(session.id); assert.equal(first.checkpointId, second.checkpointId); assert.equal(f.repository.checkpoints(session.id).length, 1); }
  finally { f.close(); }
});

test("des mises à jour proches de mode et workspace produisent un état cohérent", async () => {
  const f = fixture();
  try { const session = f.engine.resolveSession({ conversationId: "conversation-concurrent" }); await Promise.all([Promise.resolve().then(() => f.engine.updateSession(session.id, { mode: "DEV" })), Promise.resolve().then(() => f.engine.updateSession(session.id, { workspaceId: "workspace-final" }))]); const state = f.engine.getSession(session.id); assert.equal(state.mode, "DEV"); assert.equal(state.workspaceId, "workspace-final"); }
  finally { f.close(); }
});

test("les diagnostics et métriques n'exposent aucun contenu de conversation", () => {
  const f = fixture();
  try { const session = f.engine.resolveSession({ conversationId: "conversation-private" }); f.engine.updateSummary(session.id, { force: true, messages: [{ role: "user", content: "SECRET_PERSONNEL" }] }); const output = JSON.stringify({ diagnostics: f.engine.diagnostics(), events: f.events }); assert.equal(output.includes("SECRET_PERSONNEL"), false); assert.ok(f.events.some((item) => item.event === "session_summary_updates")); }
  finally { f.close(); }
});

test("l'ancien historique n'est recherché qu'à la demande", () => {
  let searches = 0; const f = fixture({ historySearchProvider: () => { searches += 1; return [{ id: "old-1" }]; } });
  try { const session = f.engine.resolveSession({ conversationId: "conversation-old" }); assert.equal(f.engine.restoreContext(session.id).oldHistoryResults.length, 0); assert.equal(searches, 0); assert.equal(f.engine.restoreContext(session.id, { query: "décision ancienne", includeOldHistory: true }).oldHistoryResults.length, 1); assert.equal(searches, 1); }
  finally { f.close(); }
});

test("la panne du résumé laisse la session et la queue d'historique utilisables", () => {
  const f = fixture({ summaryMessageThreshold: 1, summaryUpdater: () => { throw new Error("summary unavailable"); }, historyTailProvider: () => [{ role: "user", content: "dernier message" }] });
  try { const session = f.engine.resolveSession({ conversationId: "conversation-fallback" }); assert.throws(() => f.engine.updateSummary(session.id, { messages: [{ role: "user", content: "x" }] })); assert.equal(f.engine.restoreContext(session.id).recentMessages.length, 1); }
  finally { f.close(); }
});

test("une panne de base ne corrompt pas la copie RAM déjà validée", () => {
  const f = fixture();
  try { const session = f.engine.resolveSession({ conversationId: "conversation-db-failure" }); f.repository.save = () => { throw new Error("database unavailable"); }; assert.throws(() => f.engine.updateSession(session.id, { mode: "DEV" })); assert.equal(f.engine.getSession(session.id).mode, "NORMAL"); }
  finally { f.close(); }
});
