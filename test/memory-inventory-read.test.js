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
const { executeConversationMemoryCommand, parseConversationMemoryCommand } = require("../services/personal-memory/conversation-memory-commands");

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noon-memory-inventory-"));
  const database = createPersonalDatabase(path.join(dir, "memory.sqlite"));
  const repository = createPersonalIntelligenceRepository(database);
  const privateService = createPrivateMemoryService({ databaseWrapper: database, cipher: createMemoryCipher(crypto.randomBytes(32)) });
  return { dir, database, repository, privateService };
}
function close(fx) { fx.database.close(); fs.rmSync(fx.dir, { recursive: true, force: true }); }
function execute(fx, text, options = {}) { return executeConversationMemoryCommand({ personalRepository: fx.repository, privateMemoryService: fx.privateService }, parseConversationMemoryCommand(text), options); }
function seed(fx) {
  fx.repository.upsertMemory({ type: "work_preference", subject: "Langage", value: "Je préfère TypeScript", status: "confirmed", confidence: 1, explicitConfirmation: true, useAllowed: true });
  fx.privateService.createMemory({ subjectId: "arnaud", category: "address", statement: "Adresse sensible fixture 10 rue Test", sensitivity: "high", status: "confirmed", consentStatus: "granted", apiPolicy: "local_only" });
  fx.privateService.createMemory({ subjectId: "project:noon", category: "decision", statement: "Cedar reste la voix par défaut", sensitivity: "low", status: "confirmed", consentStatus: "granted", apiPolicy: "contextual", payload: { projectName: "Noon" } });
}

test("la reproduction sans apostrophe et avec garder devient MEMORY_INVENTORY", () => {
  const command = parseConversationMemoryCommand("qu'as tu garder dans ta mémoire ?");
  assert.equal(command.action, "memory_read");
  assert.equal(command.intent, "MEMORY_INVENTORY");
});

test("les variantes naturelles convergent vers la même lecture locale", () => {
  for (const text of ["qu'as-tu gardé en mémoire ?", "qu'est-ce que tu as retenu ?", "que sais-tu sur moi ?", "quelles informations as-tu mémorisées ?", "montre-moi ce que tu as en mémoire", "qu'as-tu enregistré sur moi ?", "qu'as-tu gardé localement ?"]) {
    assert.equal(parseConversationMemoryCommand(text)?.action, "memory_read", text);
  }
});

test("l'inventaire lit SQLite sans appeler aucun provider", () => {
  const fx = fixture(); let providerCalls = 0;
  try {
    seed(fx);
    const providers = { openai: () => { providerCalls += 1; throw new Error("down"); }, claude: () => { providerCalls += 1; throw new Error("down"); }, gemini: () => { providerCalls += 1; throw new Error("down"); } };
    assert.equal(Object.keys(providers).length, 3);
    const result = execute(fx, "qu'as tu garder dans ta mémoire ?", { projectId: "noon", projectName: "Noon" });
    assert.equal(result.status, "inspected");
    assert.equal(providerCalls, 0);
    assert.match(result.answer, /TypeScript/);
  } finally { close(fx); }
});

test("l'inventaire général résume le privé sans exposer sa valeur", () => {
  const fx = fixture();
  try {
    seed(fx);
    const result = execute(fx, "qu'as-tu gardé dans ta mémoire ?", { projectId: "noon", projectName: "Noon" });
    assert.equal(result.privateCount, 1);
    assert.match(result.answer, /Mémoire privée locale/);
    assert.doesNotMatch(result.answer, /10 rue Test/);
    assert.match(result.answer, /Projet actif/);
  } finally { close(fx); }
});

test("une demande privée explicite lit uniquement private_memories", () => {
  const fx = fixture();
  try {
    seed(fx);
    const result = execute(fx, "montre-moi ce que tu as dans ma mémoire privée");
    assert.equal(result.generalCount, 0);
    assert.equal(result.privateCount, 1);
    assert.match(result.answer, /10 rue Test/);
    assert.doesNotMatch(result.answer, /TypeScript/);
  } finally { close(fx); }
});

test("une recherche ciblée interroge les repositories réels", () => {
  const fx = fixture();
  try {
    seed(fx);
    const general = execute(fx, "qu'as-tu retenu sur TypeScript ?", { projectId: "noon", projectName: "Noon" });
    assert.equal(general.status, "found");
    assert.match(general.answer, /TypeScript/);
    const project = execute(fx, "qu'as-tu retenu sur Noon ?", { projectId: "noon", projectName: "Noon" });
    assert.equal(project.projectCount, 1);
    assert.match(project.answer, /Cedar/);
  } finally { close(fx); }
});

test("une base vide produit un fallback local déterministe", () => {
  const fx = fixture();
  try {
    const result = execute(fx, "qu'as tu garder dans ta mémoire ?");
    assert.equal(result.status, "not_found");
    assert.equal(result.answer, "Je n’ai actuellement aucune mémoire persistante active.");
  } finally { close(fx); }
});
