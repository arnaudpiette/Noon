"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Worker } = require("node:worker_threads");

const { createPersonalDatabase, loadSqlite } = require("../services/persistence/database");
const { createReviewLearningRepository } = require("../services/persistence/repositories/review-learning-repository");

const hasSqlite = Boolean(loadSqlite()?.DatabaseSync);
const PERIOD_START = "2026-10-05T00:00:00.000Z";
const PERIOD_END = "2026-10-06T00:00:00.000Z";

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-review-learning-concurrency-"));
  const filePath = path.join(directory, "reviews.sqlite");
  const wrapper = createPersonalDatabase(filePath);
  return { directory, filePath, wrapper, repository: createReviewLearningRepository(wrapper) };
}

function closeFixture(value) {
  try { value.wrapper.close(); } finally { fs.rmSync(value.directory, { recursive: true, force: true }); }
}

function review(id, fingerprint, overrides = {}) {
  return {
    reviewId: id,
    reviewType: "daily",
    subjectScope: "arnaud",
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    fingerprint,
    summary: "Synthèse synthétique",
    ...overrides,
  };
}

function waitFor(messages, type, failure) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5_000;
    const timer = setInterval(() => {
      if (failure.value) { clearInterval(timer); reject(failure.value); return; }
      const message = messages.find((entry) => entry.type === type);
      if (message) { clearInterval(timer); resolve(message); return; }
      if (Date.now() >= deadline) { clearInterval(timer); reject(new Error(`Worker sans signal ${type}`)); }
    }, 10);
  });
}

function concurrentSave(value, candidate) {
  const messages = [];
  const failure = { value: null };
  const worker = new Worker(`
    const { parentPort, workerData } = require("node:worker_threads");
    const { createPersonalDatabase } = require(workerData.databaseModule);
    const { createReviewLearningRepository } = require(workerData.repositoryModule);
    let wrapper = null;
    try {
      wrapper = createPersonalDatabase(workerData.filePath);
      const database = new Proxy(wrapper.database, {
        get(target, property) {
          const member = Reflect.get(target, property, target);
          if (property === "exec") return (sql) => {
            const result = target.exec(sql);
            if (sql === "BEGIN IMMEDIATE") {
              parentPort.postMessage({ type: "locked" });
              Atomics.wait(new Int32Array(workerData.gate), 0, 0, workerData.holdMs);
            }
            return result;
          };
          return typeof member === "function" ? member.bind(target) : member;
        },
      });
      const repository = createReviewLearningRepository({ kind: "sqlite", database });
      const result = repository.save(workerData.candidate);
      parentPort.postMessage({ type: "saved", result });
    } catch (error) {
      parentPort.postMessage({ type: "error", message: error?.message || String(error), code: error?.code });
    } finally {
      try { wrapper?.close(); } catch {}
    }
  `, {
    eval: true,
    workerData: {
      databaseModule: path.join(__dirname, "../services/persistence/database.js"),
      repositoryModule: path.join(__dirname, "../services/persistence/repositories/review-learning-repository.js"),
      filePath: value.filePath,
      candidate,
      gate: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
      holdMs: 150,
    },
  });
  worker.on("message", (message) => {
    messages.push(message);
    if (message.type === "error") failure.value = Object.assign(new Error(message.message), { code: message.code });
  });
  worker.on("error", (error) => { failure.value = error; });
  return { worker, messages, failure };
}

function faultingDatabase(database) {
  return new Proxy(database, {
    get(target, property) {
      const member = Reflect.get(target, property, target);
      if (property === "exec") return target.exec.bind(target);
      if (property === "prepare") return (sql) => {
        if (/^INSERT INTO review_records/.test(sql)) {
          return { run() { throw Object.assign(new Error("insertion review refusée"), { code: "TEST_REVIEW_INSERT_FAILURE" }); } };
        }
        return target.prepare(sql);
      };
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
}

test("save sérialise deux connexions pour un fingerprint et retourne le résultat idempotent", { skip: !hasSqlite }, async () => {
  const value = fixture();
  const workerSave = concurrentSave(value, review("worker-same", "same-fingerprint"));
  try {
    await waitFor(workerSave.messages, "locked", workerSave.failure);
    const mainResult = value.repository.save(review("main-same", "same-fingerprint"));
    const workerResult = await waitFor(workerSave.messages, "saved", workerSave.failure);
    assert.equal(workerResult.result.idempotent, false);
    assert.equal(mainResult.idempotent, true);
    assert.equal(mainResult.review.reviewId, "worker-same");
    assert.equal(value.wrapper.database.prepare("SELECT count(*) AS count FROM review_records WHERE fingerprint=?").get("same-fingerprint").count, 1);
  } finally {
    await workerSave.worker.terminate();
    closeFixture(value);
  }
});

test("save alloue des review_version distinctes par type, profil et période", { skip: !hasSqlite }, async () => {
  const value = fixture();
  const workerSave = concurrentSave(value, review("worker-version", "version-fingerprint-1"));
  try {
    await waitFor(workerSave.messages, "locked", workerSave.failure);
    const mainResult = value.repository.save(review("main-version", "version-fingerprint-2"));
    const workerResult = await waitFor(workerSave.messages, "saved", workerSave.failure);
    assert.equal(workerResult.result.review.reviewVersion, 1);
    assert.equal(mainResult.review.reviewVersion, 2);
    assert.deepEqual(value.wrapper.database.prepare(`SELECT review_version FROM review_records
      WHERE review_type=? AND subject_scope=? AND period_start=? AND period_end=? ORDER BY review_version`).all("daily", "arnaud", PERIOD_START, PERIOD_END)
      .map((row) => row.review_version), [1, 2]);
    const otherScope = value.repository.save(review("other-scope", "version-other-scope", { subjectScope: "other" }));
    assert.equal(otherScope.review.reviewVersion, 1);
  } finally {
    await workerSave.worker.terminate();
    closeFixture(value);
  }
});

test("save rollbacke un insert échoué et laisse la connexion réutilisable", { skip: !hasSqlite }, () => {
  const value = fixture();
  const failing = createReviewLearningRepository({ kind: "sqlite", database: faultingDatabase(value.wrapper.database) });
  try {
    assert.throws(() => failing.save(review("failed", "failed-fingerprint")), { code: "TEST_REVIEW_INSERT_FAILURE" });
    assert.equal(value.repository.getByFingerprint("failed-fingerprint"), null);
    const saved = value.repository.save(review("reusable", "reusable-fingerprint"));
    assert.equal(saved.idempotent, false);
    assert.equal(saved.review.reviewVersion, 1);
  } finally { closeFixture(value); }
});

test("save respecte commit, rollback et échec interne d'une transaction appelante", { skip: !hasSqlite }, () => {
  const value = fixture();
  const db = value.wrapper.database;
  const failing = createReviewLearningRepository({ kind: "sqlite", database: faultingDatabase(db) });
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      value.repository.save(review("external-commit", "external-commit"));
      assert.equal(db.isTransaction, true);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
    assert.equal(value.repository.getByFingerprint("external-commit")?.reviewId, "external-commit");

    db.exec("BEGIN IMMEDIATE");
    try {
      value.repository.save(review("external-rollback", "external-rollback"));
      assert.equal(db.isTransaction, true);
      db.exec("ROLLBACK");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
    assert.equal(value.repository.getByFingerprint("external-rollback"), null);

    db.exec("BEGIN IMMEDIATE");
    try {
      assert.throws(() => failing.save(review("external-failure", "external-failure")), { code: "TEST_REVIEW_INSERT_FAILURE" });
      assert.equal(db.isTransaction, true);
      value.repository.save(review("external-survivor", "external-survivor"));
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
    assert.equal(value.repository.getByFingerprint("external-failure"), null);
    assert.equal(value.repository.getByFingerprint("external-survivor")?.reviewId, "external-survivor");
  } finally { closeFixture(value); }
});
