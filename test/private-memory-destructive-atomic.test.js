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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-private-memory-destructive-"));
  const database = createPersonalDatabase(path.join(directory, "memory.sqlite"));
  const cipher = createMemoryCipher(crypto.randomBytes(32));
  const events = [];
  const service = createPrivateMemoryService({ databaseWrapper: database, cipher, audit: (_event, entry) => events.push(entry) });
  return { directory, database, cipher, events, service, close() { database.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
}

function faultingDatabase(database, stage) {
  return new Proxy(database, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property === "exec") return target.exec.bind(target);
      if (property === "prepare") return (sql) => {
        const matches = (stage === "forget" && /^UPDATE private_memories SET status='deleted'/.test(sql))
          || (stage === "purge" && /^DELETE FROM private_memories WHERE id IN/.test(sql))
          || (stage === "migration" && /^DELETE FROM private_memories WHERE id=\?/.test(sql))
          || (stage === "audit" && /^INSERT INTO private_memory_audit/.test(sql));
        if (matches) return { run() { throw Object.assign(new Error(`échec ${stage} simulé`), { code: `TEST_${stage.toUpperCase()}_FAILURE` }); } };
        return target.prepare(sql);
      };
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function serviceFor(ctx, stage) {
  return createPrivateMemoryService({ databaseWrapper: { kind: "sqlite", database: faultingDatabase(ctx.database.database, stage) }, cipher: ctx.cipher, audit: (_event, entry) => ctx.events.push(entry) });
}

function input(subjectId, suffix) {
  return { subjectId, category: "preference", statement: `Mémoire synthétique ${suffix}`, status: "confirmed", consentStatus: "granted", sensitivity: "low" };
}

function rawMemory(ctx, id) {
  return { ...ctx.database.database.prepare("SELECT id,subject_id,status,payload_encrypted,source_encrypted,deleted_at FROM private_memories WHERE id=?").get(id) };
}

function count(ctx, sql, ...values) { return ctx.database.database.prepare(sql).get(...values).count; }
function notifications(ctx, type, id = null) { return ctx.events.filter((entry) => entry.eventType === type && (id == null || entry.recordId === id)); }

function seedMigration(ctx, id) {
  ctx.service.beginMigration({ id });
  const target = ctx.service.createMemory(input("arnaud", `${id}-target`));
  ctx.service.updateMemory(target.id, { statement: `Mémoire synthétique ${id}-target-version` });
  const unrelated = ctx.service.createMemory(input("alexandra", `${id}-other`));
  ctx.service.recordMigration({ migrationId: id, sourceType: "legacy", sourceIdHash: `source-${id}`, fingerprint: `fingerprint-${id}`, targetId: target.id, disposition: "migrated" });
  return { target, unrelated };
}

test("forgetMemory est atomique, silencieux avant commit externe et réutilisable", () => {
  const ctx = fixture();
  try {
    const success = ctx.service.createMemory(input("arnaud", "forget-success"));
    assert.equal(ctx.service.forgetMemory(success.id), true);
    assert.equal(rawMemory(ctx, success.id).status, "deleted");
    assert.equal(count(ctx, "SELECT COUNT(*) AS count FROM private_memory_audit WHERE event_type='memory.deleted' AND record_id=?", success.id), 1);
    assert.equal(notifications(ctx, "memory.deleted", success.id).length, 1);

    const failed = ctx.service.createMemory(input("arnaud", "forget-failed"));
    const before = rawMemory(ctx, failed.id);
    assert.throws(() => serviceFor(ctx, "forget").forgetMemory(failed.id), { code: "TEST_FORGET_FAILURE" });
    assert.deepEqual(rawMemory(ctx, failed.id), before);
    assert.equal(count(ctx, "SELECT COUNT(*) AS count FROM private_memory_audit WHERE event_type='memory.deleted' AND record_id=?", failed.id), 0);
    assert.equal(notifications(ctx, "memory.deleted", failed.id).length, 0);

    const auditFailed = ctx.service.createMemory(input("arnaud", "forget-audit"));
    const auditBefore = rawMemory(ctx, auditFailed.id);
    assert.throws(() => serviceFor(ctx, "audit").forgetMemory(auditFailed.id), { code: "TEST_AUDIT_FAILURE" });
    assert.deepEqual(rawMemory(ctx, auditFailed.id), auditBefore);
    assert.equal(count(ctx, "SELECT COUNT(*) AS count FROM private_memory_audit WHERE event_type='memory.deleted' AND record_id=?", auditFailed.id), 0);

    const external = ctx.service.createMemory(input("arnaud", "forget-external"));
    const externalBefore = rawMemory(ctx, external.id);
    ctx.database.database.exec("BEGIN IMMEDIATE");
    try {
      ctx.service.forgetMemory(external.id);
      assert.equal(ctx.database.database.isTransaction, true);
      assert.equal(notifications(ctx, "memory.deleted", external.id).length, 0);
      ctx.database.database.exec("ROLLBACK");
    } catch (error) { try { ctx.database.database.exec("ROLLBACK"); } catch {} throw error; }
    assert.deepEqual(rawMemory(ctx, external.id), externalBefore);
    assert.equal(count(ctx, "SELECT COUNT(*) AS count FROM private_memory_audit WHERE event_type='memory.deleted' AND record_id=?", external.id), 0);

    ctx.database.database.exec("BEGIN IMMEDIATE");
    try {
      assert.throws(() => serviceFor(ctx, "audit").forgetMemory(auditFailed.id), { code: "TEST_AUDIT_FAILURE" });
      assert.equal(ctx.database.database.isTransaction, true);
      ctx.database.database.prepare("UPDATE private_profiles SET updated_at=updated_at WHERE id=?").run("arnaud");
      ctx.database.database.exec("COMMIT");
    } catch (error) { try { ctx.database.database.exec("ROLLBACK"); } catch {} throw error; }
    assert.deepEqual(rawMemory(ctx, auditFailed.id), auditBefore);

    const notificationFailed = ctx.service.createMemory(input("arnaud", "forget-notification"));
    const throwingAudit = createPrivateMemoryService({
      databaseWrapper: ctx.database,
      cipher: ctx.cipher,
      audit: () => { throw Object.assign(new Error("notification indisponible"), { code: "TEST_NOTIFY_FAILURE" }); },
    });
    assert.throws(() => throwingAudit.forgetMemory(notificationFailed.id), { code: "TEST_NOTIFY_FAILURE" });
    assert.equal(rawMemory(ctx, notificationFailed.id).status, "deleted");
    assert.equal(count(ctx, "SELECT COUNT(*) AS count FROM private_memory_audit WHERE event_type='memory.deleted' AND record_id=?", notificationFailed.id), 1);
    assert.equal(ctx.service.forgetMemory(failed.id), true);
  } finally { ctx.close(); }
});

test("purgeSubject isole le profil et rollbacke suppressions, audit et savepoint", () => {
  const ctx = fixture();
  try {
    const first = ctx.service.createMemory(input("arnaud", "purge-first"));
    ctx.service.updateMemory(first.id, { statement: "Mémoire synthétique purge-first-version" });
    const second = ctx.service.createMemory(input("arnaud", "purge-second"));
    const other = ctx.service.createMemory(input("alexandra", "purge-other"));
    assert.equal(ctx.service.purgeSubject("arnaud"), 2);
    assert.equal(ctx.service.getMemory(first.id), null);
    assert.equal(ctx.service.getMemory(second.id), null);
    assert.ok(ctx.service.getMemory(other.id));
    assert.equal(count(ctx, "SELECT COUNT(*) AS count FROM private_memory_versions WHERE memory_id=?", first.id), 0);
    assert.equal(count(ctx, "SELECT COUNT(*) AS count FROM private_memory_audit WHERE event_type='profile.purged' AND subject_id='arnaud'"), 1);

    const failed = ctx.service.createMemory(input("arnaud", "purge-failed"));
    ctx.service.updateMemory(failed.id, { statement: "Mémoire synthétique purge-failed-version" });
    const failedBefore = rawMemory(ctx, failed.id);
    const versionsBefore = count(ctx, "SELECT COUNT(*) AS count FROM private_memory_versions WHERE memory_id=?", failed.id);
    assert.throws(() => serviceFor(ctx, "purge").purgeSubject("arnaud"), { code: "TEST_PURGE_FAILURE" });
    assert.deepEqual(rawMemory(ctx, failed.id), failedBefore);
    assert.equal(count(ctx, "SELECT COUNT(*) AS count FROM private_memory_versions WHERE memory_id=?", failed.id), versionsBefore);

    assert.throws(() => serviceFor(ctx, "audit").purgeSubject("arnaud"), { code: "TEST_AUDIT_FAILURE" });
    assert.deepEqual(rawMemory(ctx, failed.id), failedBefore);

    ctx.database.database.exec("BEGIN IMMEDIATE");
    try {
      assert.throws(() => serviceFor(ctx, "audit").purgeSubject("arnaud"), { code: "TEST_AUDIT_FAILURE" });
      assert.equal(ctx.database.database.isTransaction, true);
      ctx.database.database.prepare("UPDATE private_profiles SET updated_at=updated_at WHERE id=?").run("arnaud");
      ctx.database.database.exec("COMMIT");
    } catch (error) { try { ctx.database.database.exec("ROLLBACK"); } catch {} throw error; }
    assert.deepEqual(rawMemory(ctx, failed.id), failedBefore);

    ctx.database.database.exec("BEGIN IMMEDIATE");
    try {
      ctx.service.purgeSubject("arnaud");
      assert.equal(ctx.database.database.isTransaction, true);
      assert.equal(notifications(ctx, "profile.purged").filter((entry) => entry.subjectId === "arnaud").length, 1);
      ctx.database.database.exec("ROLLBACK");
    } catch (error) { try { ctx.database.database.exec("ROLLBACK"); } catch {} throw error; }
    assert.ok(ctx.service.getMemory(failed.id));
    assert.equal(count(ctx, "SELECT COUNT(*) AS count FROM private_memory_versions WHERE memory_id=?", failed.id), versionsBefore);
    assert.equal(count(ctx, "SELECT COUNT(*) AS count FROM private_memory_audit WHERE event_type='profile.purged' AND subject_id='arnaud'"), 1);
    assert.equal(ctx.service.purgeSubject("arnaud"), 1);
  } finally { ctx.close(); }
});

test("rollbackMigration ne touche que ses cibles et rollbacke statuts, suppressions et audit", () => {
  const ctx = fixture();
  try {
    const success = seedMigration(ctx, "migration-success");
    assert.deepEqual(ctx.service.rollbackMigration("migration-success"), { migrationId: "migration-success", removed: 1 });
    assert.equal(ctx.service.getMemory(success.target.id), null);
    assert.ok(ctx.service.getMemory(success.unrelated.id));
    assert.equal(count(ctx, "SELECT COUNT(*) AS count FROM private_memory_versions WHERE memory_id=?", success.target.id), 0);
    assert.equal(ctx.database.database.prepare("SELECT disposition FROM private_memory_migration_records WHERE migration_id=?").get("migration-success").disposition, "rolled_back");
    assert.equal(ctx.service.migrationStatus("migration-success").status, "rolled_back");
    assert.equal(count(ctx, "SELECT COUNT(*) AS count FROM private_memory_audit WHERE event_type='migration.rolled_back' AND record_id='migration-success'"), 1);

    const failed = seedMigration(ctx, "migration-failed");
    const failedBefore = rawMemory(ctx, failed.target.id);
    assert.throws(() => serviceFor(ctx, "migration").rollbackMigration("migration-failed"), { code: "TEST_MIGRATION_FAILURE" });
    assert.deepEqual(rawMemory(ctx, failed.target.id), failedBefore);
    assert.equal(ctx.database.database.prepare("SELECT disposition FROM private_memory_migration_records WHERE migration_id=?").get("migration-failed").disposition, "migrated");
    assert.equal(ctx.service.migrationStatus("migration-failed").status, "running");

    assert.throws(() => serviceFor(ctx, "audit").rollbackMigration("migration-failed"), { code: "TEST_AUDIT_FAILURE" });
    assert.deepEqual(rawMemory(ctx, failed.target.id), failedBefore);

    const external = seedMigration(ctx, "migration-external");
    const externalBefore = rawMemory(ctx, external.target.id);
    ctx.database.database.exec("BEGIN IMMEDIATE");
    try {
      ctx.service.rollbackMigration("migration-external");
      assert.equal(ctx.database.database.isTransaction, true);
      assert.equal(notifications(ctx, "migration.rolled_back", "migration-external").length, 0);
      ctx.database.database.exec("ROLLBACK");
    } catch (error) { try { ctx.database.database.exec("ROLLBACK"); } catch {} throw error; }
    assert.deepEqual(rawMemory(ctx, external.target.id), externalBefore);
    assert.equal(ctx.database.database.prepare("SELECT disposition FROM private_memory_migration_records WHERE migration_id=?").get("migration-external").disposition, "migrated");
    assert.equal(ctx.service.migrationStatus("migration-external").status, "running");
    assert.equal(count(ctx, "SELECT COUNT(*) AS count FROM private_memory_audit WHERE event_type='migration.rolled_back' AND record_id='migration-external'"), 0);

    ctx.database.database.exec("BEGIN IMMEDIATE");
    try {
      assert.throws(() => serviceFor(ctx, "audit").rollbackMigration("migration-failed"), { code: "TEST_AUDIT_FAILURE" });
      assert.equal(ctx.database.database.isTransaction, true);
      ctx.database.database.prepare("UPDATE private_profiles SET updated_at=updated_at WHERE id=?").run("arnaud");
      ctx.database.database.exec("COMMIT");
    } catch (error) { try { ctx.database.database.exec("ROLLBACK"); } catch {} throw error; }
    assert.equal(ctx.service.rollbackMigration("migration-failed").removed, 1);
  } finally { ctx.close(); }
});
