"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createLongTermMemoryStore } = require("../lib/long-term-memory");
const { createLegacyMemoryMigration } = require("../services/memory/legacy-memory-migration");
const { createMemoryCipher } = require("../services/personal-memory/crypto");
const { createPrivateMemoryService } = require("../services/personal-memory/private-memory-service");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createPersonalIntelligenceRepository } = require("../services/persistence/repositories/personal-intelligence-repository");
const { createHardRulesRegistry } = require("../services/rules/hard-rules-registry");

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-memory-migration-"));
  const legacy = createLongTermMemoryStore(path.join(directory, "long-term-memory.json"));
  legacy.clear();
  legacy.add("Le propriétaire préfère le thème fictif bleu de démonstration.", ["préférence"]);
  const database = createPersonalDatabase(path.join(directory, "personal-intelligence.sqlite"));
  const repository = createPersonalIntelligenceRepository(database);
  repository.upsertMemory({ id: "health-1", type: "temporary_information", subject: "Santé",
    value: { text: "Information médicale de test entièrement fictive." }, sourceType: "user",
    status: "confirmed", confidence: 1, sensitivity: "restricted",
    metadata: { profileId: "alexandra", category: "health" } });
  repository.upsertMemory({ id: "rule-1", type: "permanent_constraint", subject: "Pause protégée entre 12 h 30 et 13 h 30",
    value: { rule: "Pause protégée entre 12 h 30 et 13 h 30" }, sourceType: "user",
    status: "confirmed", confidence: 1 });
  const privateMemoryService = createPrivateMemoryService({ databaseWrapper: database,
    cipher: createMemoryCipher(Buffer.alloc(32, 7)) });
  const migration = createLegacyMemoryMigration({ dataDirectory: directory, privateMemoryService,
    structuredRepository: repository, legacyStore: legacy, hardRulesRegistry: createHardRulesRegistry() });
  return { directory, database, legacy, repository, privateMemoryService, migration };
}

test("le dry-run classe sans écrire de mémoire privée", () => {
  const context = fixture();
  const before = context.privateMemoryService.listMemories({ includeDeleted: true }).length;
  const report = context.migration.dryRun("dry-test");
  assert.equal(report.discovered, 3);
  assert.equal(report.skippedRules, 1);
  assert.equal(report.byProfile.alexandra, 1);
  assert.equal(context.privateMemoryService.listMemories({ includeDeleted: true }).length, before);
  context.database.close();
});

test("la migration est chiffrée, prudente, idempotente et réversible", () => {
  const context = fixture();
  const backup = context.migration.createBackup("migration-test");
  assert.ok(fs.existsSync(path.join(backup.directory, "manifest.json")));
  const report = context.migration.migrate({ migrationId: "migration-test", backup });
  assert.equal(report.migrated, 2);
  assert.equal(report.skippedRules, 1);
  const items = context.privateMemoryService.listMemories({ includeDeleted: false });
  const protectedMemory = items.find((item) => item.subjectId === "alexandra");
  assert.equal(protectedMemory.status, "pending_review");
  assert.equal(protectedMemory.apiPolicy, "confirm_each_use");
  assert.equal(protectedMemory.consentStatus, "pending");
  const encryptedRows = context.database.database.prepare("SELECT payload_encrypted FROM private_memories").all();
  assert.equal(encryptedRows.some((row) => row.payload_encrypted.includes("thème fictif bleu")), false);
  const second = context.migration.migrate({ migrationId: "migration-test-2" });
  assert.equal(second.migrated, 0);
  assert.equal(second.unchanged, 3);
  const comparison = context.migration.compare(["préférence"]);
  assert.equal(comparison.length, 1);
  assert.equal(typeof comparison[0].difference, "number");
  const rollback = context.migration.rollback("migration-test");
  assert.equal(rollback.removed, 2);
  assert.equal(context.privateMemoryService.listMemories({ includeDeleted: false }).length, 0);
  context.database.close();
});

test("les secrets potentiels et les valeurs sans phrase sont mis en quarantaine", () => {
  const context = fixture();
  context.repository.upsertMemory({ id: "empty", type: "feedback", subject: "Vide", value: {},
    sourceType: "user", status: "inferred", confidence: 0.2 });
  // Le repository refuse déjà les secrets. On vérifie néanmoins le classifieur
  // directement par une source JSON historique, sans persister le secret.
  context.legacy.add("api key de démonstration interdite", []);
  const report = context.migration.dryRun("quarantine-test");
  assert.ok(report.quarantined >= 2);
  assert.ok(report.errorCodes.NO_CANONICAL_STATEMENT >= 1);
  assert.ok(report.errorCodes.POTENTIAL_SECRET >= 1);
  context.database.close();
});
