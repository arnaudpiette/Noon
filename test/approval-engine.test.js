"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createApprovalEngine } = require("../services/approvals/approval-engine");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createApprovalRepository } = require("../services/persistence/repositories/approval-repository");

function email(overrides = {}) {
  return {
    executionId: "exec_email", toolCallId: "call_email", skillName: "gmail",
    operation: "send_email", permissionLevel: "external",
    normalizedArgs: { to: "personne@example.test", subject: "Sujet fictif", body: "Contenu fictif" },
    ...overrides,
  };
}

test("prépare puis exécute exactement un e-mail une seule fois", async () => {
  const engine = createApprovalEngine();
  const approval = engine.prepareAction(email());
  let sends = 0;
  const request = {
    approvalId: approval.id, resumeToken: approval.resumeToken, decision: "approve",
    exactAction: email(),
    recheckHardRules: () => true, recheckPermission: () => true,
    recheckConnector: () => true, recheckPreconditions: () => ({}),
    execute: async () => { sends += 1; return { sent: true }; },
  };
  const [first, duplicate] = await Promise.all([
    engine.resumeApprovedAction(request), engine.resumeApprovedAction(request),
  ]);
  assert.equal(first.status, "consumed");
  assert.equal(duplicate.status, "consumed");
  assert.equal(sends, 1);
  await assert.rejects(() => engine.resumeApprovedAction(request), { code: "APPROVAL_CONSUMED" });
});

test("un sujet d'e-mail modifié invalide l'approbation", async () => {
  const engine = createApprovalEngine();
  const approval = engine.prepareAction(email());
  await assert.rejects(() => engine.resumeApprovedAction({
    approvalId: approval.id, resumeToken: approval.resumeToken, decision: "approve",
    exactAction: email({ normalizedArgs: { to: "personne@example.test", subject: "Autre sujet", body: "Contenu fictif" } }),
  }), { code: "APPROVAL_ACTION_CHANGED" });
});

test("un refus n'exécute jamais l'action", async () => {
  const engine = createApprovalEngine();
  const approval = engine.prepareAction(email());
  let executions = 0;
  const result = await engine.resumeApprovedAction({
    approvalId: approval.id, resumeToken: approval.resumeToken, decision: "reject",
    execute: () => { executions += 1; },
  });
  assert.equal(result.status, "rejected");
  assert.equal(executions, 0);
});

test("une approbation expirée échoue fermée", async () => {
  let now = 1000;
  const engine = createApprovalEngine({ now: () => now, ttlMs: 50 });
  const approval = engine.prepareAction(email());
  now += 51;
  await assert.rejects(() => engine.resumeApprovedAction({
    approvalId: approval.id, resumeToken: approval.resumeToken, decision: "approve",
  }), { code: "approval_expired" });
});

test("un Calendar modifié entre préparation et reprise devient stale", async () => {
  const engine = createApprovalEngine();
  const approval = engine.prepareAction({
    executionId: "exec_cal", toolCallId: "call_cal", skillName: "google-calendar",
    operation: "update_event", normalizedArgs: { eventId: "evt-1", start: "2026-08-29T09:00:00Z" },
    permissionLevel: "external", preconditions: { etag: "v1" },
  });
  await assert.rejects(() => engine.resumeApprovedAction({
    approvalId: approval.id, resumeToken: approval.resumeToken, decision: "approve",
    recheckHardRules: () => true, recheckPermission: () => true, recheckConnector: () => true,
    recheckPreconditions: () => ({ etag: "v2" }), execute: () => ({ updated: true }),
  }), { code: "approval_stale" });
});

test("un fichier modifié avant validation n'est pas écrasé", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-approval-file-"));
  const file = path.join(directory, "fictif.txt");
  fs.writeFileSync(file, "v1");
  const first = fs.statSync(file);
  const engine = createApprovalEngine();
  const approval = engine.prepareAction({
    executionId: "exec_file", skillName: "files", operation: "overwrite",
    normalizedArgs: { path: file, content: "v3" }, permissionLevel: "destructive",
    preconditions: { size: first.size, mtimeMs: first.mtimeMs },
  });
  fs.writeFileSync(file, "version deux plus longue");
  const current = fs.statSync(file);
  await assert.rejects(() => engine.resumeApprovedAction({
    approvalId: approval.id, resumeToken: approval.resumeToken, decision: "approve",
    recheckHardRules: () => true, recheckPermission: () => true, recheckConnector: () => true,
    recheckPreconditions: () => ({ size: current.size, mtimeMs: current.mtimeMs }),
    execute: () => fs.writeFileSync(file, "v3"),
  }), { code: "approval_stale" });
  assert.equal(fs.readFileSync(file, "utf8"), "version deux plus longue");
});

test("plusieurs approvals empêchent une confirmation vocale ambiguë", () => {
  const engine = createApprovalEngine();
  engine.prepareAction(email({ executionId: "voice-session" }));
  engine.prepareAction(email({ executionId: "voice-session", toolCallId: "call-2", normalizedArgs: { to: "autre@example.test", subject: "Deux", body: "X" } }));
  assert.equal(engine.activeApprovalId("voice-session"), null);
});

test("une seule approval vocale est reliée explicitement à sa session", () => {
  const engine = createApprovalEngine();
  const approval = engine.prepareAction(email({ executionId: "voice-unique" }));
  assert.equal(engine.activeApprovalId("voice-unique"), approval.id);
  assert.equal(engine.activeApprovalId("autre-session"), null);
});

test("les Hard Rules sont réévaluées avant l'exécution", async () => {
  const engine = createApprovalEngine();
  const approval = engine.prepareAction(email());
  await assert.rejects(() => engine.resumeApprovedAction({
    approvalId: approval.id, resumeToken: approval.resumeToken, decision: "approve",
    recheckHardRules: () => false,
  }), { code: "HARD_RULE_RECHECK_FAILED" });
});

test("une permission révoquée bloque la reprise", async () => {
  const engine = createApprovalEngine();
  const approval = engine.prepareAction(email());
  await assert.rejects(() => engine.resumeApprovedAction({
    approvalId: approval.id, resumeToken: approval.resumeToken, decision: "approve",
    recheckHardRules: () => true, recheckPermission: () => false,
  }), { code: "PERMISSION_RECHECK_FAILED" });
});

test("un connecteur déconnecté bloque la reprise", async () => {
  const engine = createApprovalEngine();
  const approval = engine.prepareAction(email());
  await assert.rejects(() => engine.resumeApprovedAction({
    approvalId: approval.id, resumeToken: approval.resumeToken, decision: "approve",
    recheckHardRules: () => true, recheckPermission: () => true, recheckConnector: () => false,
  }), { code: "CONNECTOR_RECHECK_FAILED" });
});

test("une panne d'audit ne rend pas l'action moins sûre", async () => {
  const engine = createApprovalEngine({ auditLog: { append() { throw new Error("audit down"); } } });
  const approval = engine.prepareAction(email());
  const result = await engine.resumeApprovedAction({
    approvalId: approval.id, resumeToken: approval.resumeToken, decision: "reject",
  });
  assert.equal(result.status, "rejected");
});

test("une panne de persistence empêche de créer une fausse approval", () => {
  const engine = createApprovalEngine({ repository: { list: () => [], cleanup() {}, save() { throw new Error("disk full"); } } });
  assert.throws(() => engine.prepareAction(email()), { code: "APPROVAL_STORAGE_ERROR" });
  assert.deepEqual(engine.listPending(), []);
});

test("SQLite ne stocke ni arguments bruts ni résumé sensible", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-approval-db-"));
  const database = createPersonalDatabase(path.join(directory, "noon.sqlite"));
  const repository = createApprovalRepository(database);
  const engine = createApprovalEngine({ repository });
  const approval = engine.prepareAction(email());
  const row = repository.get(approval.id);
  assert.equal(JSON.stringify(row).includes("personne@example.test"), false);
  assert.equal(JSON.stringify(row).includes("Contenu fictif"), false);
  database.close();
});

test("après redémarrage une pending approval est annulée et jamais auto-exécutée", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-approval-restart-"));
  const database = createPersonalDatabase(path.join(directory, "noon.sqlite"));
  const repository = createApprovalRepository(database);
  const first = createApprovalEngine({ repository });
  const approval = first.prepareAction(email());
  createApprovalEngine({ repository });
  assert.equal(repository.get(approval.id).status, "cancelled");
  database.close();
});
