"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createMemoryCipher } = require("../services/personal-memory/crypto");
const { createPrivateMemoryService } = require("../services/personal-memory/private-memory-service");
const { executeConversationMemoryCommand, parseConversationMemoryCommand } = require("../services/personal-memory/conversation-memory-commands");

function fixture() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noon-conversation-memory-")); const database = createPersonalDatabase(path.join(dir, "memory.sqlite")); return { dir, database, service: createPrivateMemoryService({ databaseWrapper: database, cipher: createMemoryCipher(crypto.randomBytes(32)) }) }; }
test("les commandes conversationnelles de mémoire sont locales, persistantes et sans LLM", () => {
  const fx = fixture();
  try {
    const saved = executeConversationMemoryCommand(fx.service, parseConversationMemoryCommand("Noon, retiens que le café fictif préféré est court"));
    assert.equal(saved.status, "saved");
    const search = executeConversationMemoryCommand(fx.service, parseConversationMemoryCommand("Noon, qu'est-ce que tu sais sur le café fictif ?"));
    assert.equal(search.status, "found"); assert.match(search.answer, /court/);
    const updated = executeConversationMemoryCommand(fx.service, parseConversationMemoryCommand("Noon, modifie dans ma mémoire le café fictif préféré est court en le café fictif préféré est allongé"));
    assert.equal(updated.status, "updated");
    const deleted = executeConversationMemoryCommand(fx.service, parseConversationMemoryCommand("Noon, oublie de ma mémoire le café fictif préféré est allongé"));
    assert.equal(deleted.status, "deleted");
    assert.equal(fx.service.listMemories({ subjectId: "arnaud" }).length, 0);
  } finally { fx.database.close(); fs.rmSync(fx.dir, { recursive: true, force: true }); }
});
test("une suppression ambiguë est refusée sans écrire", () => {
  const fx = fixture();
  try { for (const statement of ["Projet fictif alpha", "Projet fictif beta"]) fx.service.createMemory({ subjectId: "arnaud", category: "general", statement, status: "confirmed", consentStatus: "granted", sensitivity: "low" }); const result = executeConversationMemoryCommand(fx.service, parseConversationMemoryCommand("Noon, oublie de ma mémoire Projet fictif")); assert.equal(result.status, "needs_clarification"); assert.equal(fx.service.listMemories({ subjectId: "arnaud" }).length, 2); } finally { fx.database.close(); fs.rmSync(fx.dir, { recursive: true, force: true }); }
});
test("la lecture d'un profil nommé interroge son seul espace mémoire", () => {
  const fx = fixture();
  try { fx.service.createMemory({ subjectId: "alexandra", category: "general", statement: "Information fictive distincte", status: "confirmed", consentStatus: "granted", sensitivity: "low" }); const result = executeConversationMemoryCommand(fx.service, parseConversationMemoryCommand("Noon, qu'est-ce que tu sais sur Alexandra ?")); assert.equal(result.status, "found"); assert.match(result.answer, /distincte/); } finally { fx.database.close(); fs.rmSync(fx.dir, { recursive: true, force: true }); }
});
