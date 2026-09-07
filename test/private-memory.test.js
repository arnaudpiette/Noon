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
const { createPrivateContextBuilder } = require("../services/personal-memory/context-builder");
const { createPrivateSeedImporter, validateSeed } = require("../services/personal-memory/seed-importer");
const { extractExplicitMemoryCandidates } = require("../services/personal-memory/candidate-extractor");

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-private-memory-"));
  const database = createPersonalDatabase(path.join(directory, "memory.sqlite"));
  const cipher = createMemoryCipher(crypto.randomBytes(32));
  const events = [];
  const service = createPrivateMemoryService({ databaseWrapper: database, cipher, audit: (_event, metadata) => events.push(metadata) });
  return { directory, database, cipher, service, events, close() { database.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
}

test("le chiffrement authentifié refuse une mauvaise clé", () => {
  const cipher = createMemoryCipher(crypto.randomBytes(32));
  const encrypted = cipher.encrypt({ statement: "information fictive" });
  assert.equal(cipher.decrypt(encrypted).statement, "information fictive");
  assert.throws(() => createMemoryCipher(crypto.randomBytes(32)).decrypt(encrypted));
  assert.doesNotMatch(encrypted, /information fictive/);
});

test("les profils sont séparés et les contenus restent chiffrés au repos", () => {
  const ctx = fixture();
  try {
    ctx.service.createMemory({ subjectId: "arnaud", category: "preference", statement: "Préfère les exemples fictifs", status: "confirmed", consentStatus: "granted", sensitivity: "low" });
    ctx.service.createMemory({ subjectId: "alexandra", category: "preference", statement: "Information de démonstration séparée", status: "pending_review", sensitivity: "medium" });
    assert.equal(ctx.service.listMemories({ subjectId: "arnaud" }).length, 1);
    assert.equal(ctx.service.listMemories({ subjectId: "alexandra" }).length, 1);
    const raw = fs.readFileSync(ctx.database.filePath);
    assert.equal(raw.includes(Buffer.from("Préfère les exemples fictifs")), false);
    assert.equal(ctx.events.every((event) => !JSON.stringify(event).includes("Préfère")), true);
  } finally { ctx.close(); }
});

test("les données protégées restent en attente et ne quittent pas le contexte local", () => {
  const ctx = fixture();
  try {
    const child = ctx.service.createMemory({ subjectId: "sinan", category: "school", statement: "Donnée scolaire fictive", status: "confirmed", consentStatus: "pending", sensitivity: "high" });
    const local = ctx.service.createMemory({ subjectId: "arnaud", category: "identity", statement: "Donnée locale fictive", status: "confirmed", consentStatus: "granted", apiPolicy: "local_only", sensitivity: "restricted" });
    assert.equal(child.status, "pending_review");
    assert.equal(child.apiPolicy, "confirm_each_use");
    assert.equal(local.apiPolicy, "local_only");
    const context = createPrivateContextBuilder(ctx.service).build({ question: "Parle de la donnée scolaire fictive et locale" });
    assert.deepEqual(context.memoryIds, []);
  } finally { ctx.close(); }
});

test("le contexte est minimal, pertinent et expose seulement ses identifiants", () => {
  const ctx = fixture();
  try {
    const relevant = ctx.service.createMemory({ subjectId: "arnaud", category: "preference", statement: "Utiliser une typographie sobre", status: "confirmed", consentStatus: "granted", sensitivity: "low", apiPolicy: "contextual" });
    ctx.service.createMemory({ subjectId: "arnaud", category: "preference", statement: "Préférer un thé fictif", status: "confirmed", consentStatus: "granted", sensitivity: "low", apiPolicy: "contextual" });
    const context = createPrivateContextBuilder(ctx.service, { maxCharacters: 200 }).build({ question: "Quelle typographie utiliser ?" });
    assert.deepEqual(context.memoryIds, [relevant.id]);
    assert.match(context.instruction, /typographie sobre/);
    assert.doesNotMatch(context.instruction, /thé fictif/);
  } finally { ctx.close(); }
});

test("correction, versionnement, expiration, oubli et purge fonctionnent", () => {
  const ctx = fixture();
  try {
    const item = ctx.service.createMemory({ subjectId: "arnaud", category: "temporary", statement: "Ancienne valeur fictive", status: "confirmed", consentStatus: "granted", sensitivity: "low", expiresAt: "2000-01-01T00:00:00.000Z" });
    assert.equal(ctx.service.listMemories({ subjectId: "arnaud" })[0].status, "historical");
    const corrected = ctx.service.updateMemory(item.id, { statement: "Valeur corrigée fictive", status: "confirmed", consentStatus: "granted" });
    assert.equal(corrected.statement, "Valeur corrigée fictive");
    ctx.service.forgetMemory(item.id);
    assert.equal(ctx.service.listMemories({ subjectId: "arnaud" }).length, 0);
    assert.equal(ctx.service.exportSubject("arnaud").memories.length, 1);
    assert.equal(ctx.service.purgeSubject("arnaud"), 1);
  } finally { ctx.close(); }
});

test("un souvenir corrigé puis oublié ne ressuscite pas après redémarrage", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-private-memory-restart-"));
  const filePath = path.join(directory, "memory.sqlite");
  const masterKey = crypto.randomBytes(32);
  let database = createPersonalDatabase(filePath);
  try {
    let service = createPrivateMemoryService({
      databaseWrapper: database,
      cipher: createMemoryCipher(masterKey),
    });
    const candidate = service.createMemory({
      subjectId: "arnaud", category: "preference",
      statement: "La couleur fictive est orange", status: "candidate",
      consentStatus: "pending", sensitivity: "low", apiPolicy: "contextual",
    });
    assert.deepEqual(createPrivateContextBuilder(service).build({ question: "Quelle est la couleur fictive ?" }).memoryIds, []);

    service.updateMemory(candidate.id, {
      statement: "La couleur fictive est violette", status: "confirmed", consentStatus: "granted",
    }, "confirmation et correction P1.1");
    assert.deepEqual(createPrivateContextBuilder(service).build({ question: "Quelle est la couleur fictive ?" }).memoryIds, [candidate.id]);
    service.forgetMemory(candidate.id);
    assert.deepEqual(createPrivateContextBuilder(service).build({ question: "Quelle est la couleur fictive ?" }).memoryIds, []);

    database.close();
    database = createPersonalDatabase(filePath);
    service = createPrivateMemoryService({ databaseWrapper: database, cipher: createMemoryCipher(masterKey) });
    assert.deepEqual(createPrivateContextBuilder(service).build({ question: "Quelle est la couleur fictive ?" }).memoryIds, []);
    assert.equal(service.listMemories({ subjectId: "arnaud" }).length, 0);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("l'import refuse un seed invalide et ne confirme jamais automatiquement le sensible", () => {
  assert.equal(validateSeed({ memories: [{ subjectId: "arnaud", statement: "", sensitivity: "low" }] }).valid, false);
  const ctx = fixture();
  try {
    const importer = createPrivateSeedImporter(ctx.service);
    const seed = { memories: [{ subjectId: "alexandra", category: "health", statement: "Exemple médical entièrement fictif", sensitivity: "high", status: "pending_review" }] };
    const preview = importer.preview(seed);
    assert.equal(preview.valid, true);
    assert.equal(preview.entries[0].status, "pending_review");
    const report = importer.importSelected(seed, [0]);
    assert.equal(report.importedCount, 1);
    assert.equal(ctx.service.listMemories({ subjectId: "alexandra" })[0].status, "pending_review");
  } finally { ctx.close(); }
});

test("une phrase explicite crée seulement un candidat attribué à Arnaud", () => {
  assert.deepEqual(extractExplicitMemoryCandidates("Peut-être qu'Alex préfère le bleu."), []);
  const candidates = extractExplicitMemoryCandidates("Souviens-toi que je préfère les réponses courtes.");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].subjectId, "arnaud");
  assert.equal(candidates[0].status, "candidate");
});

test("un profil désactivé ne peut pas alimenter le contexte", () => {
  const ctx = fixture();
  try {
    ctx.service.createMemory({ subjectId: "arnaud", category: "preference", statement: "Réponse synthétique fictive", status: "confirmed", consentStatus: "granted", sensitivity: "low" });
    ctx.service.setProfileEnabled("arnaud", false);
    const context = createPrivateContextBuilder(ctx.service).build({ question: "Donne une réponse synthétique" });
    assert.deepEqual(context.memoryIds, []);
  } finally { ctx.close(); }
});
