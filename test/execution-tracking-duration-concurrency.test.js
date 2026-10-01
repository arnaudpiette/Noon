"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Worker } = require("node:worker_threads");
const { createPersonalDatabase, loadSqlite } = require("../services/persistence/database");
const { createExecutionTrackingRepository } = require("../services/persistence/repositories/execution-tracking-repository");

const hasSqlite = Boolean(loadSqlite()?.DatabaseSync);

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-duration-concurrency-"));
  const filePath = path.join(directory, "tracking.sqlite");
  const wrapper = createPersonalDatabase(filePath);
  return { directory, filePath, wrapper, repository: createExecutionTrackingRepository(wrapper) };
}

function closeFixture(value) {
  try { value.wrapper.close(); } finally { fs.rmSync(value.directory, { recursive: true, force: true }); }
}

function waitFor(messages, type, failure) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5_000;
    const timer = setInterval(() => {
      if (failure.value) { clearInterval(timer); reject(failure.value); return; }
      const message = messages.find((item) => item.type === type);
      if (message) { clearInterval(timer); resolve(message); return; }
      if (Date.now() >= deadline) { clearInterval(timer); reject(new Error(`Worker sans signal ${type}`)); }
    }, 10);
  });
}

function transactionalProxy(database, { failUpsert = false, trace = null } = {}) {
  return new Proxy(database, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property === "exec") return (sql) => { trace?.push(`exec:${sql}`); return target.exec(sql); };
      if (property === "prepare") return (sql) => {
        trace?.push(`prepare:${sql}`);
        if (failUpsert && /^INSERT INTO duration_statistics/.test(sql)) {
          return { run() { throw Object.assign(new Error("insertion refusée"), { code: "TEST_WRITE_FAILURE" }); } };
        }
        return target.prepare(sql);
      };
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

test("recordDuration sérialise deux connexions et conserve les deux durées", { skip: !hasSqlite }, async () => {
  const value = fixture();
  const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const messages = [], failure = { value: null };
  const worker = new Worker(`
    const { parentPort, workerData } = require("node:worker_threads");
    const { createPersonalDatabase } = require(workerData.databaseModule);
    const { createExecutionTrackingRepository } = require(workerData.repositoryModule);
    let wrapper = null;
    try {
      wrapper = createPersonalDatabase(workerData.filePath);
      const repository = createExecutionTrackingRepository(wrapper);
      wrapper.database.exec("BEGIN IMMEDIATE");
      repository.recordDuration("project:shared", 20, 20);
      parentPort.postMessage({ type: "written" });
      Atomics.wait(new Int32Array(workerData.gate), 0, 0, 200);
      wrapper.database.exec("COMMIT");
      parentPort.postMessage({ type: "committed" });
    } catch (error) {
      try { wrapper?.database.exec("ROLLBACK"); } catch {}
      parentPort.postMessage({ type: "error", message: error?.message || String(error) });
    } finally {
      try { wrapper?.close(); } catch {}
    }
  `, {
    eval: true,
    workerData: {
      databaseModule: path.join(__dirname, "../services/persistence/database.js"),
      repositoryModule: path.join(__dirname, "../services/persistence/repositories/execution-tracking-repository.js"),
      filePath: value.filePath,
      gate,
    },
  });
  worker.on("message", (message) => {
    messages.push(message);
    if (message.type === "error") failure.value = new Error(message.message);
  });
  worker.on("error", (error) => { failure.value = error; });

  try {
    await waitFor(messages, "written", failure);
    value.repository.recordDuration("project:shared", 10, 10);
    await waitFor(messages, "committed", failure);
    const raw = value.wrapper.database.prepare("SELECT * FROM duration_statistics WHERE scope_key=?").get("project:shared");
    const stats = value.repository.getDurationStats("project:shared");
    assert.deepEqual({ count: raw.sample_count, estimated: raw.total_estimated_minutes, actual: raw.total_actual_minutes, samples: JSON.parse(raw.samples_json) }, {
      count: 2, estimated: 30, actual: 30, samples: [20, 10],
    });
    assert.equal(stats.meanActualMinutes, 15);
  } finally {
    await worker.terminate();
    closeFixture(value);
  }
});

test("recordDuration acquiert BEGIN IMMEDIATE avant sa lecture et participe à une transaction appelante", { skip: !hasSqlite }, () => {
  const value = fixture();
  const trace = [];
  const repository = createExecutionTrackingRepository({ kind: "sqlite", database: transactionalProxy(value.wrapper.database, { trace }) });
  try {
    repository.recordDuration("project:trace", 10, 10);
    const begin = trace.indexOf("exec:BEGIN IMMEDIATE");
    const select = trace.findIndex((entry) => entry.startsWith("prepare:SELECT * FROM duration_statistics"));
    assert.ok(begin >= 0 && begin < select);
    assert.ok(trace.includes("exec:COMMIT"));

    value.wrapper.database.exec("BEGIN IMMEDIATE");
    try {
      repository.recordDuration("project:outer", 20, 20);
      value.wrapper.database.exec("COMMIT");
    } catch (error) {
      try { value.wrapper.database.exec("ROLLBACK"); } catch {}
      throw error;
    }
    assert.equal(repository.getDurationStats("project:outer").sampleCount, 1);

    value.wrapper.database.exec("BEGIN IMMEDIATE");
    try {
      repository.recordDuration("project:outer-rollback", 30, 30);
      assert.equal(value.wrapper.database.isTransaction, true);
      value.wrapper.database.exec("ROLLBACK");
    } catch (error) {
      try { value.wrapper.database.exec("ROLLBACK"); } catch {}
      throw error;
    }
    assert.equal(repository.getDurationStats("project:outer-rollback"), null);
    repository.recordDuration("project:outer-rollback", 30, 30);
    assert.equal(repository.getDurationStats("project:outer-rollback").sampleCount, 1);
  } finally { closeFixture(value); }
});

test("recordDuration conserve la fenêtre de cinquante échantillons", { skip: !hasSqlite }, () => {
  const value = fixture();
  try {
    for (let actual = 1; actual <= 55; actual += 1) value.repository.recordDuration("project:window", 10, actual);
    const raw = value.wrapper.database.prepare("SELECT * FROM duration_statistics WHERE scope_key=?").get("project:window");
    assert.equal(raw.sample_count, 55);
    assert.equal(raw.total_estimated_minutes, 550);
    assert.equal(raw.total_actual_minutes, 1540);
    assert.deepEqual(JSON.parse(raw.samples_json), Array.from({ length: 50 }, (_, index) => index + 6));
  } finally { closeFixture(value); }
});

test("recordDuration rollbacke une écriture échouée et laisse la connexion réutilisable", { skip: !hasSqlite }, () => {
  const value = fixture();
  const failing = createExecutionTrackingRepository({ kind: "sqlite", database: transactionalProxy(value.wrapper.database, { failUpsert: true }) });
  try {
    value.repository.recordDuration("project:rollback", 10, 10);
    assert.throws(() => failing.recordDuration("project:rollback", 20, 20), { code: "TEST_WRITE_FAILURE" });
    assert.deepEqual({ ...value.wrapper.database.prepare("SELECT sample_count,total_estimated_minutes,total_actual_minutes,samples_json FROM duration_statistics WHERE scope_key=?").get("project:rollback") }, {
      sample_count: 1, total_estimated_minutes: 10, total_actual_minutes: 10, samples_json: "[10]",
    });
    value.repository.recordDuration("project:rollback", 20, 20);
    assert.deepEqual(value.repository.getDurationStats("project:rollback"), {
      scopeKey: "project:rollback", sampleCount: 2, meanActualMinutes: 15,
      meanEstimateErrorMinutes: 0, medianActualMinutes: 20, confidence: "low",
    });
  } finally { closeFixture(value); }
});
