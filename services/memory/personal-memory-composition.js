"use strict";

const { createAttachmentResolver } = require("../context/attachment-resolver");
const { createAutonomousMemoryPipeline } = require("../personal-memory/autonomous-memory-pipeline");
const { createPrivateContextBuilder } = require("../personal-memory/context-builder");
const { parseConversationMemoryCommand, executeConversationMemoryCommand } = require("../personal-memory/conversation-memory-commands");
const { createMemoryCipher, loadOrCreateProtectedMasterKey } = require("../personal-memory/crypto");
const { createPrivateMemoryService } = require("../personal-memory/private-memory-service");
const { createHardRulesRegistry } = require("../rules/hard-rules-registry");
const { LEGACY_PRIVATE_MEMORY_MIGRATION_ID, createLegacyMemoryMigration } = require("./legacy-memory-migration");
const { createMemoryEngine } = require("./memory-engine");

function createPersonalMemoryComposition(dependencies) {
  const {
    DATA_DIRECTORY,
    longTermMemoryStore,
    personalDatabase,
    personalRepository,
    runtimeSafeStorage,
    toolAuditLog,
  } = dependencies;

  let privateMemoryCipher = null;
  try {
    // Le smoke packagé utilise un profil jetable et ne doit pas créer de clé de
    // mémoire privée ni attendre le trousseau macOS pour valider le cœur local.
    // Le service sait déjà fonctionner indisponible lorsque safeStorage manque.
    const protectedKey = loadOrCreateProtectedMasterKey(DATA_DIRECTORY, runtimeSafeStorage);
    if (protectedKey) privateMemoryCipher = createMemoryCipher(protectedKey);
  } catch {
    toolAuditLog.append("private-memory.unavailable", { code: "KEYSTORE_UNAVAILABLE" });
  }
  const privateMemoryService = createPrivateMemoryService({
    databaseWrapper: personalDatabase,
    cipher: privateMemoryCipher,
    audit: (_event, metadata) => toolAuditLog.append("private-memory.audit", metadata),
  });
  const privateContextBuilder = createPrivateContextBuilder(privateMemoryService);
  const hardRulesRegistry = createHardRulesRegistry({
    debug: (event, metadata) => toolAuditLog.append(event, metadata),
  });
  const legacyMemoryMigration = privateMemoryService.available
    ? createLegacyMemoryMigration({
      dataDirectory: DATA_DIRECTORY,
      privateMemoryService,
      structuredRepository: personalRepository,
      legacyStore: longTermMemoryStore,
      hardRulesRegistry,
    })
    : null;
  const legacyMemoryReadAdapter = {
    relevant(...args) {
      const migrated = privateMemoryService.available &&
        privateMemoryService.migrationStatus(LEGACY_PRIVATE_MEMORY_MIGRATION_ID)?.status === "completed";
      return migrated ? [] : longTermMemoryStore.relevant(...args);
    },
  };
  let legacyMemoryMigrationChecked = false;

  function runLegacyMemoryMigrationOnce() {
    if (legacyMemoryMigrationChecked || !legacyMemoryMigration || process.env.NOON_MEMORY_MIGRATION === "false") return null;
    legacyMemoryMigrationChecked = true;
    const migrationId = LEGACY_PRIVATE_MEMORY_MIGRATION_ID;
    const dryRun = legacyMemoryMigration.dryRun(migrationId);
    if (dryRun.eligible === 0 || dryRun.eligible === dryRun.duplicates + dryRun.unchanged) {
      toolAuditLog.append("memory-migration.skipped", { migrationId, discovered: dryRun.discovered, eligible: dryRun.eligible });
      return { dryRun, skipped: true };
    }
    const backup = legacyMemoryMigration.createBackup(migrationId);
    const report = legacyMemoryMigration.migrate({ migrationId, backup });
    const comparison = legacyMemoryMigration.compare();
    toolAuditLog.append("memory-migration.completed", {
      migrationId, migrated: report.migrated, duplicates: report.duplicates,
      quarantined: report.quarantined, failed: report.failed,
      comparisonCount: comparison.length,
    });
    return { dryRun, report, comparison, backup: { fileCount: backup.fileCount } };
  }
  // Point de lecture unique des stockages existants. Les fonctions de
  // conversation sont déclarées plus bas mais ne sont invoquées qu'à la requête.
  const memoryEngine = createMemoryEngine({
    privateMemoryService,
    privateContextBuilder,
    structuredRepository: personalRepository,
    legacyStore: legacyMemoryReadAdapter,
    projectProvider: () => personalRepository.listProjects(),
    hardRulesRegistry,
    conversationProvider: ({ conversationId }) =>
      dependencies.getConversationHistory(dependencies.createConversationKey({ sessionId: conversationId })),
    // Déclaré plus bas ; résolu seulement au moment d'une correction.
    operationalProfile: { respondToInference: (...args) => dependencies.operationalProfileService.respondToInference(...args) },
    // V3-L7 (A.6) : invalidation unique après toute écriture mémoire, pour qu'un souvenir
    // corrigé ou oublié ne ressorte pas d'un cache de contexte ou de recherche.
    onChange: ({ subjectId }) => {
      dependencies.contextBuilder.invalidateMemory();
      dependencies.personalSearchEngine?.invalidate();
      dependencies.multiSourceSynthesisEngine?.invalidate();
      if (subjectId) dependencies.contextBuilder.invalidateProfile(subjectId);
    },
    debug: (event, counts) => toolAuditLog.append(event, counts),
  });
  const attachmentResolver = createAttachmentResolver();
  const recentAutomaticMemoryIds = new Map();
  // Dernier compte-rendu de mémorisation automatique par conversation (« qu'as-tu retenu de ce fichier ? »).
  const recentAutomaticMemoryReports = new Map();
  const autonomousMemoryPipeline = createAutonomousMemoryPipeline({
    personalRepository,
    privateMemoryService,
    audit: (event, metadata) => toolAuditLog.append(event, metadata),
  });

  function executeExplicitConversationMemoryCommand(question, options = {}) {
    const command = parseConversationMemoryCommand(question);
    if (!command) return null;
    const result = executeConversationMemoryCommand({ privateMemoryService, personalRepository, attachmentResolver }, command, options);
    if (result && !["not_found", "needs_clarification", "unavailable"].includes(result.status)) {
      memoryEngine.notifyChanged({ store: "private_memory", action: `conversation-${command.action}` });
    }
    toolAuditLog.append("private-memory.conversation-command", { action: command.action, subjectId: command.subjectId, status: result?.status || "unavailable", memoryCount: result?.memoryIds?.length || 0 });
    return { command, ...result };
  }

  return {
    attachmentResolver,
    autonomousMemoryPipeline,
    executeExplicitConversationMemoryCommand,
    hardRulesRegistry,
    memoryEngine,
    privateMemoryCipher,
    privateMemoryService,
    recentAutomaticMemoryIds,
    recentAutomaticMemoryReports,
    runLegacyMemoryMigrationOnce,
  };
}

module.exports = { createPersonalMemoryComposition };
