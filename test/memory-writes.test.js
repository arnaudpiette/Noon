"use strict";

// V3-L7 (A.6) — MemoryEngine porte aussi les écritures : un seul point d'entrée, une seule
// invalidation, et un souvenir oublié ne ressort ni du contexte ni après réouverture.
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
const { createPrivateContextBuilder } = require("../services/personal-memory/context-builder");
const { createMemoryEngine } = require("../services/memory/memory-engine");
const { createMemoryHttpRoutes } = require("../services/memory/memory-http-routes");

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-memory-writes-"));
  const file = path.join(directory, "memory.sqlite");
  const key = crypto.randomBytes(32);
  const changes = [];
  let database;
  function open() {
    database = createPersonalDatabase(file);
    const privateMemoryService = createPrivateMemoryService({ databaseWrapper: database, cipher: createMemoryCipher(key), audit: () => {} });
    const structuredRepository = createPersonalIntelligenceRepository(database);
    const engine = createMemoryEngine({
      privateMemoryService, privateContextBuilder: createPrivateContextBuilder(privateMemoryService), structuredRepository,
      operationalProfile: { respondToInference: (id, action, value) => structuredRepository.updateMemory(id, { value, status: "confirmed", confidence: 1, explicitConfirmation: action === "correct" }) },
      onChange: (change) => changes.push(change),
    });
    return { engine, privateMemoryService, structuredRepository };
  }
  return {
    changes, open,
    reopen() { database.close(); return open(); },
    close() { database.close(); fs.rmSync(directory, { recursive: true, force: true }); },
  };
}

const remoteStatements = (engine, query) => engine.getRelevantContext({ query }).remoteContext.map((item) => JSON.stringify(item));

test("mémoire privée : créer, confirmer, oublier passe par MemoryEngine et ne ressuscite pas", () => {
  const ctx = fixture();
  try {
    let { engine } = ctx.open();
    const created = engine.applyPrivate("create", { memory: { subjectId: "arnaud", category: "preference", statement: "Préfère les cafés serrés fictifs", status: "pending_review", sensitivity: "low" } });
    assert.equal(remoteStatements(engine, "cafés serrés").some((text) => text.includes("cafés serrés")), false, "candidat non confirmé : jamais envoyé");
    engine.applyPrivate("confirm", { id: created.id });
    assert.equal(remoteStatements(engine, "cafés serrés").some((text) => text.includes("cafés serrés")), true, "confirmé : utilisable");
    engine.applyPrivate("forget", { id: created.id });
    assert.equal(remoteStatements(engine, "cafés serrés").some((text) => text.includes("cafés serrés")), false, "oublié : plus utilisé");
    assert.deepEqual(ctx.changes.map((change) => `${change.store}:${change.action}`), ["private_memory:create", "private_memory:confirm", "private_memory:forget"]);

    ({ engine } = ctx.reopen());
    assert.equal(remoteStatements(engine, "cafés serrés").some((text) => text.includes("cafés serrés")), false, "toujours oublié après redémarrage");
    assert.equal(engine.listPrivate({ subjectId: "arnaud" }).some((item) => item.id === created.id && item.status !== "deleted"), false);
  } finally { ctx.close(); }
});

test("mémoire structurée : créer confirmé, corriger, oublier ; action inconnue refusée sans invalidation", () => {
  const ctx = fixture();
  try {
    const { engine, structuredRepository } = ctx.open();
    const created = engine.applyStructured("create", { memory: { type: "work_preference", subject: "Réunions", value: "Pas de réunion le lundi (fictif)" } });
    assert.equal(created.status, "confirmed");
    assert.equal(engine.listStructured({ query: "réunion" }).length, 1);
    engine.applyStructured("correct", { id: created.id, value: "Pas de réunion le vendredi (fictif)" });
    assert.match(JSON.stringify(structuredRepository.getMemory(created.id).value), /vendredi/);
    engine.applyStructured("forget", { id: created.id });
    assert.equal(structuredRepository.getMemory(created.id).status, "rejected");
    const before = ctx.changes.length;
    assert.throws(() => engine.applyStructured("drop", { id: created.id }), (error) => error.statusCode === 400);
    assert.throws(() => engine.applyPrivate("drop", {}), (error) => error.statusCode === 400);
    assert.equal(ctx.changes.length, before, "aucune invalidation sur une action refusée");
  } finally { ctx.close(); }
});

test("mémoire privée indisponible : 503 explicite, rien n'est écrit", () => {
  const engine = createMemoryEngine({ privateMemoryService: { available: false, reason: "Clé locale absente." }, onChange: () => { throw new Error("ne doit pas être appelé"); } });
  assert.deepEqual(engine.privateStatus(), { available: false, reason: "Clé locale absente." });
  assert.throws(() => engine.applyPrivate("create", { memory: {} }), (error) => error.statusCode === 503 && /Clé locale absente/.test(error.message));
});

function fakeResponse() {
  return { statusCode: null, headers: null, body: null, writeHead(code, headers) { this.statusCode = code; this.headers = headers; }, end(text) { this.body = JSON.parse(text); } };
}

test("routes HTTP : contrats conservés (GET/POST privé, GET/POST structuré, 503, 400)", async () => {
  const ctx = fixture();
  try {
    const { engine } = ctx.open();
    const routes = createMemoryHttpRoutes({ memoryEngine: engine, seedImporter: null, validateSeed: null });
    const call = async (method, url, body = {}) => {
      const res = fakeResponse();
      const req = { method, url, headers: {} };
      assert.equal(routes.matches(req), true, `${method} ${url}`);
      await routes.handle(req, res, { readJsonBody: async () => body });
      return res;
    };
    assert.equal(routes.matches({ method: "POST", url: "/personal-intelligence/memories/x" }), false);
    assert.equal(routes.matches({ method: "DELETE", url: "/private-memory" }), false);

    let res = await call("POST", "/private-memory", { action: "create", memory: { subjectId: "arnaud", category: "preference", statement: "Aime le thé vert fictif", status: "confirmed", consentStatus: "granted", sensitivity: "low" } });
    assert.equal(res.statusCode, 200); assert.equal(res.body.status, "ok"); assert.equal(res.headers["Cache-Control"], "no-store");
    res = await call("GET", "/private-memory?subjectId=arnaud");
    assert.equal(res.body.memories.length, 1); assert.ok(res.body.settings);
    res = await call("GET", "/private-memory/profiles");
    assert.ok(Array.isArray(res.body.profiles));
    res = await call("GET", "/private-memory/why");
    assert.equal(res.body.status, "ok"); assert.ok(Array.isArray(res.body.sourcesUsed));
    res = await call("POST", "/private-memory", { action: "inconnue" });
    assert.equal(res.statusCode, 400); assert.equal(res.body.message, "Action de mémoire privée inconnue.");
    res = await call("POST", "/private-memory/import/preview", { seed: {} });
    assert.equal(res.statusCode, 503, "import non câblé : refus explicite");

    res = await call("POST", "/personal-intelligence/memories", { action: "create", memory: { type: "work_preference", subject: "Focus", value: "Matinées sans notifications (fictif)" } });
    assert.equal(res.statusCode, 200); assert.equal(res.body.result.status, "confirmed");
    res = await call("GET", "/personal-intelligence/memories?q=matinees");
    assert.equal(res.body.status, "ok"); assert.equal(res.body.count, res.body.memories.length);
    res = await call("POST", "/personal-intelligence/memories", { action: "inconnue" });
    assert.equal(res.statusCode, 400); assert.deepEqual(res.body, { status: "error", code: null, message: "Action mémoire inconnue." });

    const unavailable = createMemoryHttpRoutes({ memoryEngine: createMemoryEngine({ privateMemoryService: { available: false, reason: "Indisponible." } }) });
    const off = fakeResponse();
    await unavailable.handle({ method: "GET", url: "/private-memory", headers: {} }, off, { readJsonBody: async () => ({}) });
    assert.equal(off.statusCode, 503); assert.deepEqual(off.body, { status: "error", message: "Indisponible." });
  } finally { ctx.close(); }
});

test("server.js : plus aucune écriture mémoire ni invalidation en direct hors MemoryEngine", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.doesNotMatch(server, /privateMemoryService\.(createMemory|updateMemory|forgetMemory|purgeSubject)\(/);
  assert.doesNotMatch(server, /personalRepository\.(upsertMemory|confirmMemory|forgetMemory|blockMemory)\(/);
  assert.equal((server.match(/contextBuilder\.invalidateMemory\(\)/g) || []).length, 1, "une seule invalidation : onChange de MemoryEngine");
  assert.match(server, /memoryHttpRoutes\.matches\(req\)/);
});
