"use strict";

// Vérifie la création, la sélection et la suppression des souvenirs durables locaux.
const test = require("node:test"); const assert = require("node:assert/strict"); const fs = require("fs"); const os = require("os"); const path = require("path");
const { createLongTermMemoryStore } = require("../lib/long-term-memory");
test("crée, corrige, sélectionne et supprime les souvenirs", () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-memory-")); const store = createLongTermMemoryStore(path.join(root, "memory.json")); const item = store.add("Le projet Kasa utilise React", ["kasa"]); assert.equal(store.relevant("router Kasa").some((m) => m.id === item.id), true); store.update(item.id, "Le projet Kasa utilise React Router"); assert.match(store.load().memories.find((m) => m.id === item.id).text, /Router/); assert.equal(store.remove(item.id), true); });
test("désactive complètement le chargement pertinent", () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-memory-")); const store = createLongTermMemoryStore(path.join(root, "memory.json")); store.setEnabled(false); assert.deepEqual(store.relevant("Arnaud graphiste"), []); });
