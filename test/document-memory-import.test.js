"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createAttachmentResolver } = require("../services/context/attachment-resolver");
const { parseTemporal } = require("../services/intents/temporal-parser");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createPersonalIntelligenceRepository } = require("../services/persistence/repositories/personal-intelligence-repository");
const { createMemoryCipher } = require("../services/personal-memory/crypto");
const { executeConversationMemoryCommand, importDateRange, parseConversationMemoryCommand } = require("../services/personal-memory/conversation-memory-commands");
const { createPrivateMemoryService } = require("../services/personal-memory/private-memory-service");

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noon-document-memory-"));
  const file = path.join(dir, "memory.sqlite");
  const key = crypto.randomBytes(32);
  const database = createPersonalDatabase(file);
  return {
    dir, file, key, database,
    repository: createPersonalIntelligenceRepository(database),
    privateService: createPrivateMemoryService({ databaseWrapper: database, cipher: createMemoryCipher(key) }),
    resolver: createAttachmentResolver(),
  };
}

function context(fx) {
  return { privateMemoryService: fx.privateService, personalRepository: fx.repository, attachmentResolver: fx.resolver };
}

function importCommand(fx, text, currentAttachments = []) {
  return executeConversationMemoryCommand(context(fx), parseConversationMemoryCommand(text), {
    conversationId: "conversation-fixture", currentAttachments,
  });
}

function close(fx) { fx.database.close(); fs.rmSync(fx.dir, { recursive: true, force: true }); }

test("une mémoire directe conserve le fait et jamais l'instruction", () => {
  const fx = fixture();
  try {
    const result = executeConversationMemoryCommand(context(fx), parseConversationMemoryCommand("Retiens que je préfère React."));
    assert.equal(result.status, "saved");
    assert.equal(result.scope, "general");
    assert.equal(fx.repository.listMemories().length, 1);
    assert.equal(fx.repository.listMemories()[0].value, "je préfère React");
  } finally { close(fx); }
});

test("un document récent produit des souvenirs atomiques généraux et privés", () => {
  const fx = fixture();
  try {
    fx.resolver.registerAttachments({ conversationId: "conversation-fixture", attachments: [{
      kind: "text", name: "test-context.txt",
      content: "Camille est directrice artistique.\nCamille préfère les explications concrètes avant le jargon.\nMorgan est sa partenaire.",
    }] });
    const result = importCommand(fx, "Retiens tout ce qui est important dans ce document.");
    assert.equal(result.status, "saved");
    assert.equal(result.importResult.savedCount, 3);
    assert.equal(result.importResult.generalCount, 2);
    assert.equal(result.importResult.privateCount, 1);
    const stored = [...fx.repository.listMemories().map((item) => item.value), ...fx.privateService.listMemories({ includeDeleted: false }).map((item) => item.statement)];
    assert.equal(stored.some((value) => /tout ce qui est important/i.test(value)), false);
  } finally { close(fx); }
});

test("un dossier résout tout le dernier lot de pièces jointes", () => {
  const resolver = createAttachmentResolver();
  resolver.registerAttachments({ conversationId: "conversation-fixture", attachments: [
    { kind: "text", name: "alpha.txt", content: "Préférence fictive alpha." },
    { kind: "text", name: "beta.txt", content: "Préférence fictive beta." },
  ] });
  assert.deepEqual(resolver.resolveAttachmentReferences("Mémorise ce dossier", { conversationId: "conversation-fixture" }).map((item) => item.filename), ["alpha.txt", "beta.txt"]);
});

test("les formulations naturelles d'import ne deviennent jamais une mémoire directe", () => {
  for (const value of [
    "Garde les informations de ce document",
    "Retiens tout ce qui est important ici",
    "Mémorise ces fichiers",
    "Retiens ce que je viens de te donner",
  ]) assert.equal(parseConversationMemoryCommand(value)?.action, "import_document", value);
});

test("réimporter le même fait ne crée pas de doublon", () => {
  const fx = fixture();
  try {
    const attachment = { kind: "text", name: "duplicate.txt", content: "Camille préfère une interface claire." };
    const first = importCommand(fx, "Retiens ce document", [attachment]);
    const second = importCommand(fx, "Retiens ce document", [attachment]);
    assert.equal(first.importResult.savedCount, 1);
    assert.equal(second.importResult.duplicateCount, 1);
    assert.equal(fx.repository.listMemories().length, 1);
  } finally { close(fx); }
});

test("une information évolutive met à jour la mémoire et conserve son historique", () => {
  const fx = fixture();
  try {
    importCommand(fx, "Retiens ce document", [{ kind: "text", name: "version-a.txt", content: "La formation en cours se termine le 10/11/2030." }]);
    const updated = importCommand(fx, "Retiens ce document", [{ kind: "text", name: "version-b.txt", content: "La formation en cours se termine le 20/11/2030." }]);
    assert.equal(updated.importResult.updatedCount, 1);
    const item = fx.repository.listMemories()[0];
    assert.match(item.value, /20\/11\/2030/);
    assert.equal(item.metadata.versions.length, 1);
  } finally { close(fx); }
});

test("une contradiction ambiguë reste à résoudre et n'écrase pas l'ancien souvenir", () => {
  const fx = fixture();
  try {
    importCommand(fx, "Retiens ce document", [{ kind: "text", name: "relation-a.txt", content: "Morgan est la partenaire de Camille." }]);
    const result = importCommand(fx, "Retiens ce document", [{ kind: "text", name: "relation-b.txt", content: "Morgan n'est plus la partenaire de Camille." }]);
    assert.equal(result.importResult.conflicts.length, 1);
    assert.equal(fx.privateService.listMemories({ includeDeleted: false }).length, 1);
    assert.doesNotMatch(fx.privateService.listMemories({ includeDeleted: false })[0].statement, /n'est plus/);
  } finally { close(fx); }
});

test("un secret synthétique est ignoré et n'est jamais persisté", () => {
  const fx = fixture();
  try {
    const result = importCommand(fx, "Retiens ce document", [{ kind: "text", name: "secret-fixture.txt", content: "OPENAI_API_KEY=fixture-redacted-value" }]);
    assert.equal(result.status, "error");
    assert.equal(result.importResult.ignoredCount, 1);
    assert.equal(fx.repository.listMemories().length, 0);
    assert.equal(fx.privateService.listMemories({ includeDeleted: false }).length, 0);
  } finally { close(fx); }
});

test("les souvenirs persistent après réouverture SQLite et restent recherchables par provenance", () => {
  const fx = fixture();
  try {
    importCommand(fx, "Retiens ce document", [{ kind: "text", name: "restart-fixture.txt", content: "Camille préfère les démonstrations visuelles." }]);
    fx.database.close();
    fx.database = createPersonalDatabase(fx.file);
    fx.repository = createPersonalIntelligenceRepository(fx.database);
    fx.privateService = createPrivateMemoryService({ databaseWrapper: fx.database, cipher: createMemoryCipher(fx.key) });
    const result = executeConversationMemoryCommand(context(fx), parseConversationMemoryCommand("Montre-moi les souvenirs importés provenant du fichier restart-fixture.txt"));
    assert.equal(result.status, "inspected");
    assert.equal(result.generalCount, 1);
    assert.match(result.answer, /démonstrations visuelles/);
  } finally { close(fx); }
});

test("une écriture non vérifiable ne peut pas produire un faux succès", () => {
  const personalRepository = { listMemories: () => [], upsertMemory: () => ({ id: "missing" }), getMemory: () => null };
  const result = executeConversationMemoryCommand({ personalRepository, privateMemoryService: { available: false } }, parseConversationMemoryCommand("Retiens ce document"), {
    currentAttachments: [{ kind: "text", name: "write-failure.txt", content: "Camille préfère les exemples fictifs." }],
  });
  assert.equal(result.status, "error");
  assert.doesNotMatch(result.answer, /retenu|mémorisée/i);
});

test("hier est calculé comme une date Europe/Paris même au changement d'heure", () => {
  assert.equal(parseTemporal("hier", { now: new Date("2026-03-29T10:00:00Z"), timeZone: "Europe/Paris" }).date, "2026-03-28");
  assert.equal(parseTemporal("hier", { now: new Date("2026-10-25T10:00:00Z"), timeZone: "Europe/Paris" }).date, "2026-10-24");
});

test("récemment et cette semaine produisent des plages d'import distinctes", () => {
  const now = new Date("2026-09-16T10:00:00Z");
  assert.deepEqual(importDateRange("récemment", now), { start: "2026-09-09", end: "2026-09-16" });
  assert.deepEqual(importDateRange("cette semaine", now), { start: "2026-09-14", end: "2026-09-16" });
});
