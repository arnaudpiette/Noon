"use strict";

// Clé maîtresse de la mémoire privée : créée au premier lancement, jamais remplacée ensuite.
// Une clé existante illisible rend la mémoire privée indisponible au lieu de la régénérer, ce qui
// rendrait illisibles les souvenirs déjà chiffrés.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createMemoryCipher, loadOrCreateProtectedMasterKey } = require("../services/personal-memory/crypto");
const { createPersonalMemoryComposition } = require("../services/memory/personal-memory-composition");

const KEY_FILE = "private-memory-master-key.bin";

function tempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-master-key-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// Doublure de safeStorage : chiffrement réversible, déchiffrement refusé hors de son format.
function fakeSafeStorage({ available = true, decryptFails = false } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`enc:${value}`, "utf8"),
    decryptString: (buffer) => {
      const text = buffer.toString("utf8");
      if (decryptFails || !text.startsWith("enc:")) throw new Error("Error while decrypting the ciphertext provided to safeStorage.decryptString.");
      return text.slice(4);
    },
  };
}

function leftovers(directory) {
  return fs.readdirSync(directory).filter((name) => name !== KEY_FILE);
}

test("premier lancement : la clé est créée (32 octets, 0600) puis relue à l'identique", (t) => {
  const directory = tempDirectory(t);
  const safeStorage = fakeSafeStorage();
  const created = loadOrCreateProtectedMasterKey(directory, safeStorage);
  assert.equal(created.length, 32);
  const keyPath = path.join(directory, KEY_FILE);
  assert.equal(fs.statSync(keyPath).mode & 0o777, 0o600);
  assert.deepEqual(leftovers(directory), [], "aucun fichier temporaire ne reste");
  const reloaded = loadOrCreateProtectedMasterKey(directory, safeStorage);
  assert.ok(created.equals(reloaded));
  const cipher = createMemoryCipher(reloaded);
  assert.deepEqual(cipher.decrypt(createMemoryCipher(created).encrypt({ statement: "souvenir" })), { statement: "souvenir" });
});

test("clé existante indéchiffrable : erreur explicite, fichier conservé octet pour octet", (t) => {
  const directory = tempDirectory(t);
  loadOrCreateProtectedMasterKey(directory, fakeSafeStorage());
  const keyPath = path.join(directory, KEY_FILE);
  const before = fs.readFileSync(keyPath);
  assert.throws(
    () => loadOrCreateProtectedMasterKey(directory, fakeSafeStorage({ decryptFails: true })),
    (error) => error.code === "PRIVATE_MEMORY_KEY_UNREADABLE" && error.stage === "decrypt" && !/enc:/.test(error.message),
  );
  assert.ok(fs.readFileSync(keyPath).equals(before), "la clé existante n'est jamais remplacée");
  assert.deepEqual(leftovers(directory), []);
});

test("clé existante corrompue ou vide : jamais remplacée", (t) => {
  for (const content of [Buffer.from("garbage"), Buffer.alloc(0)]) {
    const directory = tempDirectory(t);
    const keyPath = path.join(directory, KEY_FILE);
    fs.writeFileSync(keyPath, content, { mode: 0o600 });
    assert.throws(() => loadOrCreateProtectedMasterKey(directory, fakeSafeStorage()), { code: "PRIVATE_MEMORY_KEY_UNREADABLE", stage: "decrypt" });
    assert.ok(fs.readFileSync(keyPath).equals(content));
  }
});

test("emplacement de la clé illisible (autre que absent) : erreur de lecture, rien n'est créé", (t) => {
  const directory = tempDirectory(t);
  fs.mkdirSync(path.join(directory, KEY_FILE));
  assert.throws(() => loadOrCreateProtectedMasterKey(directory, fakeSafeStorage()), { code: "PRIVATE_MEMORY_KEY_UNREADABLE", stage: "read" });
  assert.ok(fs.statSync(path.join(directory, KEY_FILE)).isDirectory());
});

test("coffre macOS indisponible : aucune clé créée", (t) => {
  const directory = tempDirectory(t);
  assert.equal(loadOrCreateProtectedMasterKey(directory, fakeSafeStorage({ available: false })), null);
  assert.equal(loadOrCreateProtectedMasterKey(directory, null), null);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test("composition : clé illisible → mémoire privée indisponible, audit précis, clé conservée", (t) => {
  const directory = tempDirectory(t);
  loadOrCreateProtectedMasterKey(directory, fakeSafeStorage());
  const keyPath = path.join(directory, KEY_FILE);
  const before = fs.readFileSync(keyPath);
  const audit = [];
  const composition = createPersonalMemoryComposition({
    DATA_DIRECTORY: directory,
    longTermMemoryStore: { relevant: () => [] },
    personalDatabase: { kind: "sqlite" },
    personalRepository: {},
    runtimeSafeStorage: fakeSafeStorage({ decryptFails: true }),
    toolAuditLog: { append: (event, details) => audit.push({ event, details }) },
  });
  assert.equal(composition.privateMemoryCipher, null);
  assert.equal(composition.privateMemoryService.available, false);
  assert.deepEqual(audit.find((entry) => entry.event === "private-memory.unavailable")?.details, { code: "PRIVATE_MEMORY_KEY_UNREADABLE", stage: "decrypt" });
  assert.ok(fs.readFileSync(keyPath).equals(before));
});
