"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Worker } = require("node:worker_threads");
const {
  PERSONAL_DATABASE_BUSY_TIMEOUT_MS,
  createPersonalDatabase,
  loadSqlite,
} = require("../services/persistence/database");

const hasSqlite = Boolean(loadSqlite()?.DatabaseSync);

function temporaryDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-sqlite-busy-"));
  return { directory, filePath: path.join(directory, "personal.sqlite") };
}

function busyTimeout(database) {
  return Number(database.prepare("PRAGMA busy_timeout").get().timeout);
}

function startLockHolder(filePath, holdMs) {
  const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const worker = new Worker(`
    const { parentPort, workerData } = require("node:worker_threads");
    const { createPersonalDatabase } = require(workerData.databaseModule);
    let wrapper = null;
    try {
      wrapper = createPersonalDatabase(workerData.filePath);
      wrapper.database.exec("BEGIN IMMEDIATE");
      parentPort.postMessage({ type: "locked" });
      Atomics.wait(new Int32Array(workerData.gate), 0, 0, workerData.holdMs);
      wrapper.database.exec("COMMIT");
      parentPort.postMessage({ type: "released" });
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
      filePath,
      gate,
      holdMs,
    },
  });
  const messages = [];
  let failure = null;
  worker.on("message", (message) => {
    messages.push(message);
    if (message.type === "error") failure = new Error(message.message);
  });
  worker.on("error", (error) => { failure = error; });

  async function waitFor(type) {
    const deadline = Date.now() + PERSONAL_DATABASE_BUSY_TIMEOUT_MS + 2_000;
    while (!messages.some((message) => message.type === type)) {
      if (failure) throw failure;
      if (Date.now() >= deadline) throw new Error(`Worker SQLite sans signal ${type}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  return { worker, waitFor };
}

test("createPersonalDatabase configure busy_timeout sur chaque connexion", { skip: !hasSqlite }, () => {
  const fixture = temporaryDatabase();
  const first = createPersonalDatabase(fixture.filePath);
  const second = createPersonalDatabase(fixture.filePath);
  try {
    assert.equal(busyTimeout(first.database), PERSONAL_DATABASE_BUSY_TIMEOUT_MS);
    assert.equal(busyTimeout(second.database), PERSONAL_DATABASE_BUSY_TIMEOUT_MS);
  } finally {
    second.close();
    first.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("une écriture attend un verrou inter-connexion libéré avant l'échéance", { skip: !hasSqlite }, async () => {
  const fixture = temporaryDatabase();
  const contender = createPersonalDatabase(fixture.filePath);
  contender.database.exec("CREATE TABLE contention_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
  const holder = startLockHolder(fixture.filePath, 100);
  try {
    await holder.waitFor("locked");
    const result = contender.database.prepare("INSERT INTO contention_probe(value) VALUES(?)").run("once");
    await holder.waitFor("released");
    assert.equal(result.changes, 1);
    assert.equal(contender.database.prepare("SELECT COUNT(*) AS count FROM contention_probe").get().count, 1);
  } finally {
    await holder.worker.terminate();
    contender.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("un verrou maintenu au-delà de l'échéance échoue sans écriture partielle puis la connexion reste utilisable", { skip: !hasSqlite }, async () => {
  const fixture = temporaryDatabase();
  const contender = createPersonalDatabase(fixture.filePath);
  contender.database.exec("CREATE TABLE contention_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
  const holder = startLockHolder(fixture.filePath, PERSONAL_DATABASE_BUSY_TIMEOUT_MS + 250);
  try {
    await holder.waitFor("locked");
    assert.throws(
      () => contender.database.prepare("INSERT INTO contention_probe(value) VALUES(?)").run("blocked"),
      /database is locked/i
    );
    assert.equal(contender.database.prepare("SELECT COUNT(*) AS count FROM contention_probe").get().count, 0);
    await holder.waitFor("released");
    assert.equal(contender.database.prepare("INSERT INTO contention_probe(value) VALUES(?)").run("after-release").changes, 1);
    assert.equal(contender.database.prepare("SELECT COUNT(*) AS count FROM contention_probe").get().count, 1);
  } finally {
    await holder.worker.terminate();
    contender.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});
