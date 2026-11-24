"use strict";

// V3-L7 — assemblage du cycle de vie (registre des stockages durables, sauvegardes, journal de
// mise à jour, migrations, reprise après mise à jour), sorti de server.js. Bloc déplacé tel
// quel ; seul le chemin de package.json est réécrit depuis ce dossier (même module, même
// cache). server.js l'appelle au même endroit qu'avant. Toutes les dépendances sont déjà
// initialisées à l'appel : elles sont lues une fois.

const fs = require("fs");
const path = require("path");
const { SCHEMA_VERSION, loadSqlite } = require("../persistence/database");
const { createDurableStoreRegistry } = require("./durable-store-registry");
const { createBackupService } = require("./backup-service");
const { createUpdateJournal } = require("./update-journal");
const { createMigrationManager } = require("./migration-manager");
const { createUpdateRecoveryEngine } = require("./update-recovery-engine");

const DEPENDENCIES = Object.freeze(["ARTIFACT_PREVIEW_DIRECTORY","CONVERSATION_INDEX_FILE","CONVERSATION_MEMORY_FILE","CONVERSATION_SUMMARIES_FILE","DATA_DIRECTORY","PROJECTS_REGISTRY_FILE","configRegistry","featureFlags","personalDatabase","privateMemoryService","reliabilityEngine","runtimeConfig","toolAuditLog","transactionalExecutionRepository"]);

function createLifecycleComposition(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  const {
    ARTIFACT_PREVIEW_DIRECTORY,
    CONVERSATION_INDEX_FILE,
    CONVERSATION_MEMORY_FILE,
    CONVERSATION_SUMMARIES_FILE,
    DATA_DIRECTORY,
    PROJECTS_REGISTRY_FILE,
    configRegistry,
    featureFlags,
    personalDatabase,
    privateMemoryService,
    reliabilityEngine,
    runtimeConfig,
    toolAuditLog,
    transactionalExecutionRepository,
  } = deps;

  // Le lifecycle est initialement branché en diagnostic/dry-run : le bootstrap
  // existant reste autoritaire et aucune migration utilisateur n'est rejouée.
  const durableStoreRegistry = createDurableStoreRegistry([
    { storeId: "personal-database", path: personalDatabase.filePath, kind: personalDatabase.kind === "sqlite" ? "sqlite" : "json", criticality: "CRITICAL", sensitive: true, encrypted: false, validateBackup(backupPath) { if (personalDatabase.kind !== "sqlite") { JSON.parse(fs.readFileSync(backupPath, "utf8")); return true; } const sqlite = loadSqlite(); const candidate = new sqlite.DatabaseSync(backupPath, { readOnly: true }); try { return candidate.prepare("PRAGMA integrity_check").get()?.integrity_check === "ok" && Boolean(candidate.prepare("SELECT 1 FROM schema_migrations LIMIT 1").get()); } finally { candidate.close(); } } },
    { storeId: "conversations", path: CONVERSATION_MEMORY_FILE, kind: "json", criticality: "CRITICAL", sensitive: true, encrypted: false },
    { storeId: "conversation-index", path: CONVERSATION_INDEX_FILE, kind: "json", criticality: "CRITICAL", sensitive: true, encrypted: false },
    { storeId: "conversation-summaries", path: CONVERSATION_SUMMARIES_FILE, kind: "json", criticality: "IMPORTANT", sensitive: true, encrypted: false },
    { storeId: "runtime-config", path: path.join(DATA_DIRECTORY, "runtime-config.json"), kind: "json", criticality: "CRITICAL", sensitive: false, encrypted: false },
    { storeId: "projects-registry", path: PROJECTS_REGISTRY_FILE, kind: "json", criticality: "IMPORTANT", sensitive: true, encrypted: false },
    { storeId: "artifact-previews", path: ARTIFACT_PREVIEW_DIRECTORY, kind: "directory", criticality: "EPHEMERAL", rebuildable: true, backup: false },
  ]);
  const lifecycleBackupService = createBackupService({
    backupRoot: path.join(DATA_DIRECTORY, "recovery-backups"),
    storeRegistry: durableStoreRegistry,
    appVersion: require("../../package.json").version,
    schemaVersion: SCHEMA_VERSION,
    configSchemaVersion: configRegistry.schemaVersion,
    sqliteBackup: async (_store, destination) => {
      const escaped = String(destination).replace(/'/g, "''");
      personalDatabase.database.exec(`VACUUM INTO '${escaped}'`);
    },
    observability: (event, metadata) => toolAuditLog.append(`lifecycle.${event}`, metadata),
  });
  const lifecycleJournal = createUpdateJournal(path.join(DATA_DIRECTORY, "update-journal.json"));
  const lifecycleMigrationManager = createMigrationManager({
    migrations: [], expectedSchemaVersion: SCHEMA_VERSION,
    minimumSupportedSchemaVersion: SCHEMA_VERSION,
    readSchemaVersion: () => Number(personalDatabase.kind === "sqlite"
      ? personalDatabase.database.prepare(
        "SELECT version FROM schema_migrations WHERE name = 'personal-intelligence-base' ORDER BY version DESC LIMIT 1"
      ).get()?.version
      : personalDatabase.load().version) || 0,
    writeSchemaVersion: () => { throw new Error("Aucune migration lifecycle active n'est enregistrée."); },
    observability: (event, metadata) => toolAuditLog.append(`lifecycle.${event}`, metadata),
  });
  const updateRecoveryEngine = createUpdateRecoveryEngine({
    appVersion: require("../../package.json").version,
    migrationManager: lifecycleMigrationManager,
    backupService: lifecycleBackupService,
    journal: lifecycleJournal,
    runtimeConfig,
    featureFlags,
    reliability: reliabilityEngine,
    activeExecutions: () => transactionalExecutionRepository.listRecoverable(),
    secureStorageAvailable: () => privateMemoryService.available,
    observability: (event, metadata) => toolAuditLog.append(`lifecycle.${event}`, metadata),
  });

  return { updateRecoveryEngine };
}

module.exports = { DEPENDENCIES, createLifecycleComposition };
