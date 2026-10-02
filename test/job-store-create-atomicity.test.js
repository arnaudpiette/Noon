"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createPersonalDatabase } = require("../services/persistence/database");
const { createJobStore } = require("../services/jobs/job-store");

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-job-store-create-"));
  const database = createPersonalDatabase(path.join(directory, "jobs.sqlite"));
  return {
    database,
    directory,
    close() { database.close(); fs.rmSync(directory, { recursive: true, force: true }); },
  };
}

function record(id) {
  return {
    id, type: "MAINTENANCE", handlerVersion: 1, priority: "LOW", resourceClass: "LIGHT",
    inputMode: "REFERENCE_ONLY", inputRef: { taskRef: `synthetic:${id}` }, maxAttempts: 1,
  };
}

function transitionFailure(database) {
  return new Proxy(database, {
    get(target, property) {
      if (property === "exec") return target.exec.bind(target);
      if (property === "prepare") {
        return (sql) => {
          if (String(sql).startsWith("UPDATE background_jobs SET state")) {
            return { run() { throw Object.assign(new Error("échec transition simulé"), { code: "TEST_JOB_TRANSITION_FAILURE" }); } };
          }
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

test("create persiste le job et son état QUEUED ensemble", () => {
  const ctx = fixture();
  try {
    const store = createJobStore(ctx.database);
    const job = store.create(record("success"));
    assert.equal(job.state, "QUEUED");
    assert.equal(store.get(job.id).reason_code, "ENQUEUED");
  } finally { ctx.close(); }
});

test("un échec de transition rollbacke l'insert et laisse la connexion réutilisable", () => {
  const ctx = fixture();
  try {
    const failingStore = createJobStore({ kind: "sqlite", database: transitionFailure(ctx.database.database) });
    assert.throws(() => failingStore.create(record("failure")), { code: "TEST_JOB_TRANSITION_FAILURE" });
    const store = createJobStore(ctx.database);
    assert.equal(store.get("failure"), null);
    assert.equal(store.create(record("reusable")).state, "QUEUED");
  } finally { ctx.close(); }
});

test("create participe à la transaction appelante et son savepoint isole un échec", () => {
  const ctx = fixture();
  const db = ctx.database.database;
  try {
    const store = createJobStore(ctx.database);
    db.exec("BEGIN IMMEDIATE");
    try {
      store.create(record("external-rollback"));
      assert.equal(db.isTransaction, true);
      db.exec("ROLLBACK");
    } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
    assert.equal(store.get("external-rollback"), null);

    db.exec("BEGIN IMMEDIATE");
    try {
      store.create(record("external-commit"));
      assert.equal(db.isTransaction, true);
      db.exec("COMMIT");
    } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
    assert.equal(store.get("external-commit").state, "QUEUED");

    db.exec("BEGIN IMMEDIATE");
    try {
      const failingStore = createJobStore({ kind: "sqlite", database: transitionFailure(db) });
      assert.throws(() => failingStore.create(record("external-failure")), { code: "TEST_JOB_TRANSITION_FAILURE" });
      assert.equal(db.isTransaction, true);
      db.prepare("SELECT 1").get();
      db.exec("COMMIT");
    } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
    assert.equal(store.get("external-failure"), null);
  } finally { ctx.close(); }
});
