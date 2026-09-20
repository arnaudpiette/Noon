"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createPersonalIntelligenceRepository } = require("../services/persistence/repositories/personal-intelligence-repository");
const { createMemoryCipher } = require("../services/personal-memory/crypto");
const { createPrivateMemoryService } = require("../services/personal-memory/private-memory-service");
const { createAutonomousMemoryPipeline } = require("../services/personal-memory/autonomous-memory-pipeline");
const { executeConversationMemoryCommand, parseConversationMemoryCommand } = require("../services/personal-memory/conversation-memory-commands");

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noon-autonomous-memory-"));
  const file = path.join(dir, "memory.sqlite");
  const key = crypto.randomBytes(32);
  const database = createPersonalDatabase(file);
  const repository = createPersonalIntelligenceRepository(database);
  const privateService = createPrivateMemoryService({ databaseWrapper: database, cipher: createMemoryCipher(key) });
  const pipeline = createAutonomousMemoryPipeline({ personalRepository: repository, privateMemoryService: privateService });
  return { dir, file, key, database, repository, privateService, pipeline };
}

function close(fx) { fx.database.close(); fs.rmSync(fx.dir, { recursive: true, force: true }); }
function context(fx) { return { personalRepository: fx.repository, privateMemoryService: fx.privateService }; }

test("les commandes privées extraient le scope, lisent la DB et vérifient l'oubli", () => {
  const fx = fixture();
  try {
    const save = executeConversationMemoryCommand(context(fx), parseConversationMemoryCommand("retiens dans ta mémoire privée que mon test est ORION"));
    assert.equal(save.status, "saved");
    assert.equal(save.receipt.persisted, true);
    assert.equal(fx.privateService.getMemory(save.memoryIds[0]).statement, "mon test est ORION");
    const read = executeConversationMemoryCommand(context(fx), parseConversationMemoryCommand("qu'as-tu dans ta mémoire privée concernant ORION ?"));
    assert.equal(read.status, "found");
    assert.match(read.answer, /ORION/);
    const forgotten = executeConversationMemoryCommand(context(fx), parseConversationMemoryCommand("oublie ORION de ta mémoire privée"));
    assert.equal(forgotten.status, "deleted");
    assert.equal(forgotten.receipt.persisted, true);
    assert.equal(fx.privateService.getMemory(save.memoryIds[0]).status, "deleted");
  } finally { close(fx); }
});

test("une préférence durable est persistée, notifiée, dédupliquée puis corrigée", () => {
  const fx = fixture();
  try {
    const first = fx.pipeline.process({ text: "À partir de maintenant je préfère JavaScript." });
    assert.equal(first.receipt.general.created, 1);
    assert.match(first.notification, /retenu/i);
    const duplicate = fx.pipeline.process({ text: "À partir de maintenant je préfère JavaScript." });
    assert.equal(duplicate.receipt.general.skipped, 1);
    assert.equal(duplicate.notification, "");
    const correction = fx.pipeline.process({ text: "Finalement je préfère TypeScript et non JavaScript." });
    assert.equal(correction.receipt.general.updated, 1);
    assert.equal(fx.repository.listMemories().length, 1);
    assert.match(fx.repository.listMemories()[0].value, /TypeScript/);
    assert.equal(fx.repository.listMemories()[0].metadata.versions.length, 1);
  } finally { close(fx); }
});

test("une décision nommant le Focus devient une mémoire de projet", () => {
  const fx = fixture();
  try {
    const result = fx.pipeline.process({ text: "Cedar devient la voix par défaut pour Noon.", projectId: "noon", projectName: "Noon" });
    assert.equal(result.receipt.project.created, 1);
    assert.match(result.notification, /projet Noon/);
    const stored = fx.privateService.listMemories({ subjectId: "project:noon", includeDeleted: false });
    assert.equal(stored.length, 1);
    assert.equal(stored[0].apiPolicy, "contextual");
  } finally { close(fx); }
});

test("une donnée sensible reste privée local-only et un secret est exclu", () => {
  const fx = fixture();
  try {
    const sensitive = fx.pipeline.process({ text: "Mon adresse est 10 rue Exemple à Testville." });
    assert.equal(sensitive.receipt.private.created, 1);
    assert.match(sensitive.notification, /privée locale/);
    const stored = fx.privateService.listMemories({ includeDeleted: false });
    assert.equal(stored[0].apiPolicy, "local_only");
    const secret = fx.pipeline.process({ text: "Ma clé API est sk-test-1234567890." });
    assert.equal(secret.candidates.length, 0);
    assert.equal(fx.repository.listMemories().length, 0);
    assert.equal(fx.privateService.listMemories({ includeDeleted: false }).length, 1);
  } finally { close(fx); }
});

test("une pièce jointe ne conserve que les faits utiles et jamais l'anecdote ou le secret", () => {
  const fx = fixture();
  try {
    const result = fx.pipeline.process({ attachments: [{ name: "fixture.txt", extractedText: [
      "Je travaille désormais principalement avec Astro.",
      "Mon adresse est 10 rue Exemple à Testville.",
      "J'ai mangé une pomme ce matin.",
      "Ma clé API est sk-test-1234567890.",
    ].join("\n") }] });
    assert.equal(result.receipt.general.created, 1);
    assert.equal(result.receipt.private.created, 1);
    assert.equal(result.candidates.length, 2);
    assert.match(result.notification, /données sensibles/);
  } finally { close(fx); }
});

test("une erreur d'écriture ne produit ni persistance ni fausse notification", () => {
  const pipeline = createAutonomousMemoryPipeline({
    personalRepository: { listMemories: () => [], upsertMemory: () => { throw new Error("fixture failure"); }, getMemory: () => null },
    privateMemoryService: { available: false },
  });
  const result = pipeline.process({ text: "À partir de maintenant je préfère TypeScript." });
  assert.equal(result.receipt.success, false);
  assert.equal(result.receipt.persisted, false);
  assert.match(result.notification, /échoué/);
  assert.doesNotMatch(result.notification, /retenu|conservé|mémorisée/i);
});

test("les souvenirs autonomes survivent à une nouvelle instance SQLite", () => {
  const fx = fixture();
  try {
    fx.pipeline.process({ text: "À partir de maintenant je préfère TypeScript." });
    fx.database.close();
    fx.database = createPersonalDatabase(fx.file);
    fx.repository = createPersonalIntelligenceRepository(fx.database);
    fx.privateService = createPrivateMemoryService({ databaseWrapper: fx.database, cipher: createMemoryCipher(fx.key) });
    assert.equal(fx.repository.searchMemories("TypeScript").length, 1);
  } finally { close(fx); }
});

test("oublie ça supprime réellement les dernières mémoires notifiées", () => {
  const fx = fixture();
  try {
    const automatic = fx.pipeline.process({ text: "À partir de maintenant je préfère TypeScript." });
    const command = parseConversationMemoryCommand("Non, oublie ça.");
    const result = executeConversationMemoryCommand(context(fx), command, { recentMemoryIds: automatic.receipt.memoryIds });
    assert.equal(result.status, "deleted");
    assert.equal(result.receipt.persisted, true);
    assert.equal(fx.repository.getMemory(automatic.receipt.memoryIds[0]).status, "rejected");
  } finally { close(fx); }
});

test("les salutations, questions et exemples explicitement fictifs sont ignorés", () => {
  const fx = fixture();
  try {
    for (const text of ["Bonjour", "Quel langage dois-je utiliser ?", "Pour cet exemple fictif, je préfère Rust."]) {
      assert.equal(fx.pipeline.process({ text }).candidates.length, 0);
    }
    assert.equal(fx.repository.listMemories().length, 0);
  } finally { close(fx); }
});
