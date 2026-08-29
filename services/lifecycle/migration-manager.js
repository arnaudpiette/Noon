"use strict";

function createMigrationManager({ migrations = [], expectedSchemaVersion, minimumSupportedSchemaVersion = 1, readSchemaVersion, writeSchemaVersion, transaction = async (work) => work(), observability = null } = {}) {
  const ordered = [...migrations].sort((a, b) => a.fromVersion - b.fromVersion);
  const ids = new Set();
  for (const migration of ordered) { if (!migration.id || ids.has(migration.id) || migration.toVersion !== migration.fromVersion + 1 || typeof migration.up !== "function" || typeof migration.validate !== "function") throw new TypeError(`Migration invalide : ${migration.id}`); ids.add(migration.id); }
  function plan({ targetSchemaVersion = expectedSchemaVersion } = {}) {
    const currentSchemaVersion = readSchemaVersion();
    if (currentSchemaVersion > expectedSchemaVersion) return { compatible: false, reason: "FUTURE_SCHEMA", readOnly: true, currentSchemaVersion, targetSchemaVersion, migrations: [] };
    if (currentSchemaVersion < minimumSupportedSchemaVersion) return { compatible: false, reason: "SCHEMA_TOO_OLD", readOnly: true, currentSchemaVersion, targetSchemaVersion, migrations: [] };
    const required = []; let version = currentSchemaVersion;
    while (version < targetSchemaVersion) { const migration = ordered.find((item) => item.fromVersion === version); if (!migration) return { compatible: false, reason: "MIGRATION_PATH_MISSING", readOnly: true, currentSchemaVersion, targetSchemaVersion, migrations: required }; required.push(migration); version = migration.toVersion; }
    return { compatible: true, reason: required.length ? "MIGRATION_REQUIRED" : "CURRENT", readOnly: false, currentSchemaVersion, targetSchemaVersion, migrations: required, backupRequired: required.some((item) => item.requiresBackup), rollbackSafe: required.every((item) => item.rollbackSafe), estimatedRisk: required.some((item) => item.estimatedRisk === "HIGH") ? "HIGH" : required.some((item) => item.estimatedRisk === "MEDIUM") ? "MEDIUM" : "LOW", affectedStores: [...new Set(required.flatMap((item) => item.affectedStores || []))] };
  }
  async function execute(planResult, context = {}) {
    if (!planResult.compatible) throw Object.assign(new Error(`Migration impossible : ${planResult.reason}`), { code: planResult.reason });
    const applied = [];
    for (const migration of planResult.migrations) {
      if (readSchemaVersion() >= migration.toVersion) continue;
      observability?.("migration_started", { migrationId: migration.id, from: migration.fromVersion, to: migration.toVersion });
      try {
        await transaction(async () => { await migration.up(context); await migration.validate(context); writeSchemaVersion(migration.toVersion, migration.id); });
        applied.push(migration.id); observability?.("migration_completed", { migrationId: migration.id });
      } catch (error) { observability?.("migration_failed", { migrationId: migration.id, code: error.code || error.name }); throw error; }
    }
    return { applied, schemaVersion: readSchemaVersion() };
  }
  return { execute, expectedSchemaVersion, minimumSupportedSchemaVersion, plan, registry: () => ordered.map(({ up, validate, rollback, ...metadata }) => metadata) };
}

module.exports = { createMigrationManager };
