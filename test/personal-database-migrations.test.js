"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Worker } = require("node:worker_threads");
const {
  PERSONAL_DATABASE_BUSY_TIMEOUT_MS,
  SCHEMA_VERSION,
  createPersonalDatabase,
  createSchema,
  loadSqlite,
} = require("../services/persistence/database");

const sqlite = loadSqlite();
const hasSqlite = Boolean(sqlite?.DatabaseSync);

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-schema-migration-"));
  return { directory, filePath: path.join(directory, "legacy.sqlite") };
}

function seedLegacyDatabase(filePath) {
  const database = new sqlite.DatabaseSync(filePath);
  try {
    database.exec(`
      CREATE TABLE sync_changes (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, change_id TEXT NOT NULL UNIQUE,
        entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, operation TEXT NOT NULL,
        version INTEGER NOT NULL, changed_at TEXT NOT NULL, origin_device_id TEXT NOT NULL,
        profile_scope TEXT NOT NULL, sync_classification TEXT NOT NULL,
        changed_fields_json TEXT NOT NULL DEFAULT '[]', tombstone_until TEXT
      );
      CREATE TABLE execution_items (
        id TEXT PRIMARY KEY, action_id TEXT NOT NULL, plan_id TEXT, plan_block_id TEXT,
        subject_scope TEXT NOT NULL DEFAULT 'arnaud', source TEXT NOT NULL, source_ref TEXT,
        planned_start TEXT, planned_end TEXT, actual_start TEXT, actual_end TEXT,
        status TEXT NOT NULL, progress REAL, confidence REAL NOT NULL,
        completion_source TEXT, blocker_json TEXT, notes_encrypted TEXT,
        remaining_duration_minutes INTEGER, priority_score REAL NOT NULL DEFAULT 0,
        due_at TEXT, dependencies_json TEXT NOT NULL DEFAULT '[]', manual_move INTEGER NOT NULL DEFAULT 0,
        deferred_until TEXT, last_event_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    database.prepare(`INSERT INTO execution_items(
      id, action_id, subject_scope, source, status, confidence, last_event_at, created_at, updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
      "legacy-item", "legacy-action", "arnaud", "legacy", "planned", 0.5,
      "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"
    );
  } finally {
    database.close();
  }
}

function hasColumn(database, tableName, columnName) {
  return database.prepare(`PRAGMA table_info(${tableName})`).all()
    .some((column) => column.name === columnName);
}

function recordedVersion(database) {
  const table = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
  if (!table) return null;
  return database.prepare("SELECT version FROM schema_migrations WHERE name=?").get("personal-intelligence-base")?.version ?? null;
}

function startWriteLock(filePath, holdMs) {
  const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const worker = new Worker(`
    const { DatabaseSync } = require("node:sqlite");
    const { parentPort, workerData } = require("node:worker_threads");
    let database = null;
    try {
      database = new DatabaseSync(workerData.filePath);
      database.exec("BEGIN IMMEDIATE");
      parentPort.postMessage({ type: "locked" });
      Atomics.wait(new Int32Array(workerData.gate), 0, 0, workerData.holdMs);
      database.exec("COMMIT");
      parentPort.postMessage({ type: "released" });
    } catch (error) {
      try { database?.exec("ROLLBACK"); } catch {}
      parentPort.postMessage({ type: "error", message: error?.message || String(error) });
    } finally {
      try { database?.close(); } catch {}
    }
  `, { eval: true, workerData: { filePath, gate, holdMs } });
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

function duplicateColumnError(columnName) {
  const database = new sqlite.DatabaseSync(":memory:");
  try {
    database.exec("CREATE TABLE probe (id INTEGER)");
    database.exec(`ALTER TABLE probe ADD COLUMN ${columnName} TEXT`);
    database.exec(`ALTER TABLE probe ADD COLUMN ${columnName} TEXT`);
  } catch (error) {
    return error;
  } finally {
    database.close();
  }
  throw new Error("La collision SQLite attendue n'a pas été produite");
}

function schemaProxy(database, alterExecutionItems) {
  return {
    exec(sql) {
      if (String(sql).startsWith("ALTER TABLE execution_items ADD COLUMN project_id")) {
        return alterExecutionItems(sql);
      }
      return database.exec(sql);
    },
    prepare: database.prepare.bind(database),
  };
}

test("migre les colonnes additives, préserve les données et reste idempotent", { skip: !hasSqlite }, () => {
  const f = fixture();
  seedLegacyDatabase(f.filePath);
  let database = createPersonalDatabase(f.filePath);
  try {
    assert.equal(hasColumn(database.database, "sync_changes", "base_field_versions_json"), true);
    assert.equal(hasColumn(database.database, "execution_items", "project_id"), true);
    const migrated = database.database.prepare("SELECT action_id, project_id FROM execution_items WHERE id=?").get("legacy-item");
    assert.equal(migrated.action_id, "legacy-action");
    assert.equal(migrated.project_id, null);
    assert.equal(recordedVersion(database.database), SCHEMA_VERSION);
  } finally {
    database.close();
  }
  database = createPersonalDatabase(f.filePath);
  try {
    assert.equal(hasColumn(database.database, "sync_changes", "base_field_versions_json"), true);
    assert.equal(hasColumn(database.database, "execution_items", "project_id"), true);
    assert.equal(recordedVersion(database.database), SCHEMA_VERSION);
  } finally {
    database.close();
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test("une erreur additive inattendue est propagée, ne marque pas la version et ferme la connexion", { skip: !hasSqlite }, () => {
  const f = fixture();
  seedLegacyDatabase(f.filePath);
  const prototype = sqlite.DatabaseSync.prototype;
  const originalExec = prototype.exec;
  const originalClose = prototype.close;
  let closeCalls = 0;
  prototype.exec = function patchedExec(sql) {
    if (String(sql).startsWith("ALTER TABLE execution_items ADD COLUMN project_id")) {
      throw new Error("forced migration failure");
    }
    return originalExec.call(this, sql);
  };
  prototype.close = function patchedClose() {
    closeCalls += 1;
    return originalClose.call(this);
  };
  try {
    assert.throws(() => createPersonalDatabase(f.filePath), /forced migration failure/);
  } finally {
    prototype.exec = originalExec;
    prototype.close = originalClose;
  }
  const inspect = new sqlite.DatabaseSync(f.filePath);
  try {
    assert.equal(hasColumn(inspect, "execution_items", "project_id"), false);
    assert.equal(recordedVersion(inspect), null);
    assert.equal(closeCalls, 1);
  } finally {
    inspect.close();
  }
  const recovered = createPersonalDatabase(f.filePath);
  try {
    assert.equal(hasColumn(recovered.database, "execution_items", "project_id"), true);
    assert.equal(recordedVersion(recovered.database), SCHEMA_VERSION);
  } finally {
    recovered.close();
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test("un verrou inter-processus est explicite, sans version finale, puis la reprise migre", { skip: !hasSqlite }, async () => {
  const f = fixture();
  seedLegacyDatabase(f.filePath);
  const holder = startWriteLock(f.filePath, PERSONAL_DATABASE_BUSY_TIMEOUT_MS + 250);
  try {
    await holder.waitFor("locked");
    assert.throws(() => createPersonalDatabase(f.filePath), /database is locked/i);
    await holder.waitFor("released");
    const inspect = new sqlite.DatabaseSync(f.filePath);
    try { assert.equal(recordedVersion(inspect), null); }
    finally { inspect.close(); }
    const recovered = createPersonalDatabase(f.filePath);
    try {
      assert.equal(hasColumn(recovered.database, "sync_changes", "base_field_versions_json"), true);
      assert.equal(hasColumn(recovered.database, "execution_items", "project_id"), true);
      assert.equal(recordedVersion(recovered.database), SCHEMA_VERSION);
    } finally { recovered.close(); }
  } finally {
    await holder.worker.terminate();
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test("une colonne déjà présente satisfait la postcondition sans nouvel ALTER", { skip: !hasSqlite }, () => {
  const f = fixture();
  seedLegacyDatabase(f.filePath);
  const database = new sqlite.DatabaseSync(f.filePath);
  try {
    database.exec("ALTER TABLE sync_changes ADD COLUMN base_field_versions_json TEXT NOT NULL DEFAULT '{}'");
    database.exec("ALTER TABLE execution_items ADD COLUMN project_id TEXT");
    const proxy = {
      exec(sql) {
        if (String(sql).startsWith("ALTER TABLE")) throw new Error("ALTER ne doit pas être relancé");
        return database.exec(sql);
      },
      prepare: database.prepare.bind(database),
    };
    createSchema(proxy);
    assert.equal(recordedVersion(database), SCHEMA_VERSION);
  } finally {
    database.close();
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test("une collision SQLite réelle après pré-vérification est tolérée seulement après postcondition", { skip: !hasSqlite }, () => {
  const f = fixture();
  seedLegacyDatabase(f.filePath);
  const database = new sqlite.DatabaseSync(f.filePath);
  try {
    const proxy = schemaProxy(database, (sql) => {
      database.exec(sql);
      return database.exec(sql);
    });
    createSchema(proxy);
    assert.equal(hasColumn(database, "execution_items", "project_id"), true);
    assert.equal(recordedVersion(database), SCHEMA_VERSION);
  } finally {
    database.close();
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});

test("BUSY et erreur inattendue restent des échecs même si la colonne apparaît", { skip: !hasSqlite }, () => {
  for (const error of [
    Object.assign(new Error("database is locked"), { code: "ERR_SQLITE_ERROR", errcode: 5, errstr: "database is locked" }),
    new Error("forced unexpected migration failure"),
  ]) {
    const f = fixture();
    seedLegacyDatabase(f.filePath);
    const database = new sqlite.DatabaseSync(f.filePath);
    try {
      const proxy = schemaProxy(database, (sql) => {
        database.exec(sql);
        throw error;
      });
      assert.throws(() => createSchema(proxy), (actual) => actual === error);
      assert.equal(hasColumn(database, "execution_items", "project_id"), true);
      assert.equal(recordedVersion(database), null);
    } finally {
      database.close();
      fs.rmSync(f.directory, { recursive: true, force: true });
    }
  }
});

test("une collision annoncée sans colonne ne masque pas l'erreur ALTER d'origine", { skip: !hasSqlite }, () => {
  const f = fixture();
  seedLegacyDatabase(f.filePath);
  const database = new sqlite.DatabaseSync(f.filePath);
  try {
    const error = duplicateColumnError("project_id");
    assert.equal(error.code, "ERR_SQLITE_ERROR");
    assert.equal(error.errcode, 1);
    assert.match(error.message, /^duplicate column name: project_id$/i);
    const proxy = schemaProxy(database, () => { throw error; });
    assert.throws(() => createSchema(proxy), (actual) => actual === error);
    assert.equal(hasColumn(database, "execution_items", "project_id"), false);
    assert.equal(recordedVersion(database), null);
  } finally {
    database.close();
    fs.rmSync(f.directory, { recursive: true, force: true });
  }
});
