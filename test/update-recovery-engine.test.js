"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createDurableStoreRegistry } = require("../services/lifecycle/durable-store-registry");
const { createBackupService } = require("../services/lifecycle/backup-service");
const { createUpdateJournal } = require("../services/lifecycle/update-journal");
const { createMigrationManager } = require("../services/lifecycle/migration-manager");
const { createUpdateRecoveryEngine } = require("../services/lifecycle/update-recovery-engine");
const { createRecoveryService } = require("../services/lifecycle/recovery-service");

function fixture({ migrationFails = false, validationFails = false, diskSpace = Infinity, active = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-lifecycle-test-"));
  const data = path.join(root, "state.json"); fs.writeFileSync(data, JSON.stringify({ conversations: ["conversation-fixture"], encryptedMemory: "ciphertext" }));
  const stores = createDurableStoreRegistry([{ storeId: "state", path: data, kind: "json", criticality: "CRITICAL", sensitive: true, encrypted: true }]);
  const backup = createBackupService({ backupRoot: path.join(root, "backups"), storeRegistry: stores, appVersion: "1.0.6", schemaVersion: 2, configSchemaVersion: 1 });
  let version = 1; let runs = 0;
  const migration = createMigrationManager({ expectedSchemaVersion: 2, minimumSupportedSchemaVersion: 1, readSchemaVersion: () => version, writeSchemaVersion: (next) => { version = next; }, migrations: [{ id: "002_fixture", fromVersion: 1, toVersion: 2, requiresBackup: true, rollbackSafe: true, estimatedRisk: "MEDIUM", affectedStores: ["state"], up: async () => { runs += 1; if (migrationFails) throw new Error("fixture failure"); fs.writeFileSync(data, JSON.stringify({ conversations: ["conversation-fixture"], migrated: true, encryptedMemory: "ciphertext" })); }, validate: async () => { if (validationFails) throw new Error("invalid fixture"); } }] });
  const journal = createUpdateJournal(path.join(root, "update-journal.json"));
  const runtimeConfig = { recovery: () => null, state: () => ({ configVersion: 2 }) };
  const featureFlags = { snapshot: () => ({ featureFlagVersion: 1 }) };
  const engine = createUpdateRecoveryEngine({ appVersion: "1.0.6", migrationManager: migration, backupService: backup, journal, runtimeConfig, featureFlags, diskSpace: () => diskSpace, activeExecutions: () => active, validation: async () => ({ valid: !validationFails }), criticalEvaluation: async () => ({ releaseGate: "PASS" }) });
  return { root, data, stores, backup, migration, journal, engine, getVersion: () => version, getRuns: () => runs };
}

test("planifie sans écrire et distingue no migration, future et too old", () => {
  const f = fixture(); const before = fs.readFileSync(f.data, "utf8");
  assert.equal(f.engine.plan().backupRequired, true); assert.equal(fs.readFileSync(f.data, "utf8"), before);
  const current = createMigrationManager({ expectedSchemaVersion: 2, minimumSupportedSchemaVersion: 1, readSchemaVersion: () => 2, writeSchemaVersion() {}, migrations: [] });
  assert.equal(current.plan().reason, "CURRENT");
  const future = createMigrationManager({ expectedSchemaVersion: 2, minimumSupportedSchemaVersion: 1, readSchemaVersion: () => 3, writeSchemaVersion() {}, migrations: [] });
  assert.equal(future.plan().reason, "FUTURE_SCHEMA"); assert.equal(future.plan().readOnly, true);
  const old = createMigrationManager({ expectedSchemaVersion: 2, minimumSupportedSchemaVersion: 1, readSchemaVersion: () => 0, writeSchemaVersion() {}, migrations: [] });
  assert.equal(old.plan().reason, "SCHEMA_TOO_OLD");
});

test("crée et valide un backup chiffré sans déchiffrement", async () => {
  const f = fixture(); const created = await f.backup.create({ reason: "MANUAL" });
  assert.equal(created.manifest.state, "VALID"); assert.equal(created.manifest.encrypted, true);
  const copied = fs.readFileSync(path.join(created.directory, created.manifest.stores[0].relativePath), "utf8");
  assert.match(copied, /ciphertext/); assert.doesNotMatch(copied, /plain-secret/);
});

test("SQLite WAL est sauvegardé en image cohérente via VACUUM INTO", async (context) => {
  let sqlite; try { sqlite = require("node:sqlite"); } catch { context.skip("node:sqlite indisponible"); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-sqlite-backup-test-")); const source = path.join(root, "fixture.sqlite");
  const db = new sqlite.DatabaseSync(source); db.exec("PRAGMA journal_mode=WAL; CREATE TABLE fixture(id TEXT PRIMARY KEY); INSERT INTO fixture VALUES ('stable-id');");
  const stores = createDurableStoreRegistry([{ storeId: "sqlite", path: source, kind: "sqlite", criticality: "CRITICAL", validateBackup(target) { const copy = new sqlite.DatabaseSync(target, { readOnly: true }); try { return copy.prepare("SELECT id FROM fixture").get()?.id === "stable-id"; } finally { copy.close(); } } }]);
  const backup = createBackupService({ backupRoot: path.join(root, "backups"), storeRegistry: stores, appVersion: "test", schemaVersion: 1, configSchemaVersion: 1, sqliteBackup: async (_store, target) => db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`) });
  const created = await backup.create(); assert.equal(backup.validate(created.directory).valid, true); db.close();
});

test("refuse disque plein, traversal et manifeste altéré", async () => {
  const f = fixture(); await assert.rejects(f.backup.create({ availableBytes: 1 }), { code: "BACKUP_DISK_FULL" });
  const created = await f.backup.create(); const target = path.join(created.directory, created.manifest.stores[0].relativePath); fs.appendFileSync(target, "tamper");
  assert.throws(() => f.backup.validate(created.directory), { code: "BACKUP_INVALID" });
});

test("réalise clean update, backup, migration, validation et LKG", async () => {
  const f = fixture(); const result = await f.engine.run({ toAppVersion: "1.0.7" });
  assert.equal(result.state, "SUCCEEDED"); assert.equal(f.getVersion(), 2); assert.equal(f.getRuns(), 1);
  assert.equal(f.journal.load().lastKnownGood.schemaVersion, 2); assert.equal(f.engine.maintenance.get(), "NORMAL");
  assert.match(fs.readFileSync(f.data, "utf8"), /conversation-fixture/);
});

test("backup/preflight failure empêche toute migration", async () => {
  const f = fixture({ diskSpace: 1 }); await assert.rejects(f.engine.run(), { code: "UPDATE_PREFLIGHT_FAILED" });
  assert.equal(f.getRuns(), 0); assert.equal(f.getVersion(), 1);
});

test("une exécution active bloque maintenance et migration concurrente", () => {
  const f = fixture({ active: ["execution-fixture"] }); assert.equal(f.engine.preflight(f.engine.plan()).checks.noCriticalExecution, false);
  f.journal.begin({ updateId: "first" }); assert.throws(() => f.journal.begin({ updateId: "second" }), { code: "MIGRATION_ACTIVE" });
});

test("un échec migration n'avance pas la version et impose read-only", async () => {
  const f = fixture({ migrationFails: true }); await assert.rejects(f.engine.run(), /fixture failure/);
  assert.equal(f.getVersion(), 1); assert.equal(f.engine.maintenance.get(), "MAINTENANCE_READ_ONLY"); assert.equal(f.journal.load().updates[0].state, "FAILED");
});

test("un run dupliqué est idempotent", async () => {
  const f = fixture(); await f.engine.run(); assert.equal(f.migration.plan().reason, "CURRENT"); assert.equal((await f.migration.execute(f.migration.plan())).applied.length, 0); assert.equal(f.getRuns(), 1);
});

test("le startup détecte un crash avant validation sans restaurer aveuglément", () => {
  const f = fixture(); f.journal.begin({ updateId: "crash" }); f.journal.transition("crash", "MIGRATING");
  const diagnosis = f.engine.startupDiagnostic(); assert.equal(diagnosis.recoveryRequired, true); assert.equal(diagnosis.migrationState, "MIGRATING");
});

test("la restauration exige approbation, sauvegarde current et valide", async () => {
  const f = fixture(); const original = fs.readFileSync(f.data, "utf8"); const saved = await f.backup.create(); fs.writeFileSync(f.data, JSON.stringify({ newer: true }));
  const maintenance = { state: "NORMAL", set(value) { this.state = value; } };
  const recovery = createRecoveryService({ backupService: f.backup, storeRegistry: f.stores, maintenance, backupCurrent: async () => ({ backupId: "safety" }), validateRestored: async () => true });
  await assert.rejects(recovery.restore(saved.backupId), { code: "RESTORE_APPROVAL_REQUIRED" });
  const result = await recovery.restore(saved.backupId, { approved: true }); assert.equal(result.safetyBackupId, "safety"); assert.equal(fs.readFileSync(f.data, "utf8"), original); assert.equal(maintenance.state, "MAINTENANCE_READ_ONLY");
});

test("la rétention ne supprime jamais le dernier backup valide", async () => {
  const f = fixture(); const one = await f.backup.create({ reason: "MANUAL" }); f.backup.prune({ keepPerReason: 0 }); assert.ok(f.backup.list().some((item) => item.backupId === one.backupId));
});

test("journaux et diagnostics ne contiennent aucun payload privé", async () => {
  const f = fixture(); await f.engine.run(); const journal = fs.readFileSync(path.join(f.root, "update-journal.json"), "utf8"); assert.doesNotMatch(journal, /conversation-fixture|ciphertext/);
});
