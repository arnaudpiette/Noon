"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createMemoryCipher } = require("../services/personal-memory/crypto");
const { createPrivateMemoryService } = require("../services/personal-memory/private-memory-service");

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-private-memory-atomic-"));
  const database = createPersonalDatabase(path.join(directory, "memory.sqlite"));
  const cipher = createMemoryCipher(crypto.randomBytes(32));
  const events = [];
  const service = createPrivateMemoryService({ databaseWrapper: database, cipher, audit: (_event, metadata) => events.push(metadata) });
  return { directory, database, cipher, events, service, close() { database.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
}

function faultingDatabase(database, failure) {
  return new Proxy(database, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property === "exec") return target.exec.bind(target);
      if (property === "prepare") return (sql) => {
        const isUpdate = /^UPDATE private_memories SET category=/.test(sql);
        const isAudit = /^INSERT INTO private_memory_audit/.test(sql);
        if ((failure === "update" && isUpdate) || (failure === "audit" && isAudit)) {
          return { run() { throw Object.assign(new Error(`échec ${failure} simulé`), { code: `TEST_${failure.toUpperCase()}_FAILURE` }); } };
        }
        return target.prepare(sql);
      };
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function createService(ctx, options = {}) {
  return createPrivateMemoryService({
    databaseWrapper: { kind: "sqlite", database: options.database || ctx.database.database },
    cipher: ctx.cipher,
    audit: (_event, metadata) => ctx.events.push(metadata),
  });
}

function memoryInput(statement) {
  return { subjectId: "arnaud", category: "preference", statement, status: "confirmed", consentStatus: "granted", sensitivity: "low", tags: ["fixture"] };
}

function rawMemory(ctx, id) {
  return { ...ctx.database.database.prepare("SELECT subject_id,category,status,payload_encrypted,updated_at FROM private_memories WHERE id=?").get(id) };
}

function counts(ctx, id) {
  return {
    versions: ctx.database.database.prepare("SELECT COUNT(*) AS count FROM private_memory_versions WHERE memory_id=?").get(id).count,
    updates: ctx.database.database.prepare("SELECT COUNT(*) AS count FROM private_memory_audit WHERE record_id=? AND event_type='memory.updated'").get(id).count,
  };
}

function updateEvents(ctx, id) {
  return ctx.events.filter((event) => event.eventType === "memory.updated" && event.recordId === id);
}

test("updateMemory enregistre mémoire, version et audit chiffrés ensemble", () => {
  const ctx = fixture();
  try {
    const item = ctx.service.createMemory(memoryInput("Ancienne valeur fictive atomique"));
    const updated = ctx.service.updateMemory(item.id, { statement: "Nouvelle valeur fictive atomique", tags: ["updated"] });
    const raw = rawMemory(ctx, item.id);
    assert.equal(updated.statement, "Nouvelle valeur fictive atomique");
    assert.deepEqual(counts(ctx, item.id), { versions: 1, updates: 1 });
    assert.equal(raw.subject_id, "arnaud");
    assert.doesNotMatch(raw.payload_encrypted, /Ancienne valeur|Nouvelle valeur/);
    assert.equal(updateEvents(ctx, item.id).length, 1);
  } finally { ctx.close(); }
});

test("un échec après la version rollbacke la mise à jour entière et laisse la connexion réutilisable", () => {
  const ctx = fixture();
  try {
    const item = ctx.service.createMemory(memoryInput("Valeur initiale échec update"));
    const before = rawMemory(ctx, item.id);
    const failing = createService(ctx, { database: faultingDatabase(ctx.database.database, "update") });
    assert.throws(() => failing.updateMemory(item.id, { statement: "Valeur non persistée" }), { code: "TEST_UPDATE_FAILURE" });
    assert.deepEqual(rawMemory(ctx, item.id), before);
    assert.deepEqual(counts(ctx, item.id), { versions: 0, updates: 0 });
    assert.equal(updateEvents(ctx, item.id).length, 0);
    assert.equal(ctx.service.updateMemory(item.id, { statement: "Valeur persistée après rollback" }).statement, "Valeur persistée après rollback");
    assert.deepEqual(counts(ctx, item.id), { versions: 1, updates: 1 });
  } finally { ctx.close(); }
});

test("un échec d'audit rollbacke mémoire et version sans notification externe", () => {
  const ctx = fixture();
  try {
    const item = ctx.service.createMemory(memoryInput("Valeur initiale échec audit"));
    const before = rawMemory(ctx, item.id);
    const failing = createService(ctx, { database: faultingDatabase(ctx.database.database, "audit") });
    assert.throws(() => failing.updateMemory(item.id, { statement: "Valeur non auditée" }), { code: "TEST_AUDIT_FAILURE" });
    assert.deepEqual(rawMemory(ctx, item.id), before);
    assert.deepEqual(counts(ctx, item.id), { versions: 0, updates: 0 });
    assert.equal(updateEvents(ctx, item.id).length, 0);
  } finally { ctx.close(); }
});

test("updateMemory respecte commit, rollback et erreurs d'une transaction appelante", () => {
  const ctx = fixture();
  try {
    const committed = ctx.service.createMemory(memoryInput("Valeur externe commit"));
    ctx.database.database.exec("BEGIN IMMEDIATE");
    try {
      ctx.service.updateMemory(committed.id, { statement: "Valeur externe validée" });
      assert.equal(ctx.database.database.isTransaction, true);
      ctx.database.database.exec("COMMIT");
    } catch (error) {
      try { ctx.database.database.exec("ROLLBACK"); } catch {}
      throw error;
    }
    assert.equal(ctx.service.getMemory(committed.id).statement, "Valeur externe validée");
    assert.deepEqual(counts(ctx, committed.id), { versions: 1, updates: 1 });
    assert.equal(updateEvents(ctx, committed.id).length, 0);

    const rolledBack = ctx.service.createMemory(memoryInput("Valeur externe rollback"));
    const rollbackBefore = rawMemory(ctx, rolledBack.id);
    ctx.database.database.exec("BEGIN IMMEDIATE");
    try {
      ctx.service.updateMemory(rolledBack.id, { statement: "Valeur annulée" });
      assert.equal(ctx.database.database.isTransaction, true);
      ctx.database.database.exec("ROLLBACK");
    } catch (error) {
      try { ctx.database.database.exec("ROLLBACK"); } catch {}
      throw error;
    }
    assert.deepEqual(rawMemory(ctx, rolledBack.id), rollbackBefore);
    assert.deepEqual(counts(ctx, rolledBack.id), { versions: 0, updates: 0 });

    const failed = ctx.service.createMemory(memoryInput("Valeur externe erreur"));
    const failedBefore = rawMemory(ctx, failed.id);
    const failing = createService(ctx, { database: faultingDatabase(ctx.database.database, "audit") });
    ctx.database.database.exec("BEGIN IMMEDIATE");
    try {
      assert.throws(() => failing.updateMemory(failed.id, { statement: "Valeur rejetée" }), { code: "TEST_AUDIT_FAILURE" });
      assert.equal(ctx.database.database.isTransaction, true);
      ctx.database.database.prepare("UPDATE private_profiles SET updated_at=updated_at WHERE id=?").run("arnaud");
      ctx.database.database.exec("COMMIT");
    } catch (error) {
      try { ctx.database.database.exec("ROLLBACK"); } catch {}
      throw error;
    }
    assert.deepEqual(rawMemory(ctx, failed.id), failedBefore);
    assert.deepEqual(counts(ctx, failed.id), { versions: 0, updates: 0 });
    assert.equal(ctx.service.updateMemory(failed.id, { statement: "Valeur après transaction externe" }).statement, "Valeur après transaction externe");
  } finally { ctx.close(); }
});
