"use strict";

// Vérifie les limites, dossiers, titres et déplacements de l’historique de conversation.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createConversationTitle,
  upsertConversationIndex,
  createFolder,
  updateConversation,
  normalizeConversationStore,
  deleteFolder,
} = require("../lib/conversation-index");

test("crée un titre court depuis la première demande", () => {
  assert.equal(createConversationTitle("  Analyse   mon projet Kasa  "), "Analyse mon projet Kasa");
  assert.equal(createConversationTitle(""), "Nouvelle conversation");
});

test("supprimer un projet replace ses conversations dans Chats sans les supprimer", () => {
  let store = normalizeConversationStore(null);
  store = createFolder(store, { id: "project-noon", title: "Noon" }).store;
  store = upsertConversationIndex(store, { id: "conversation-noon", folderId: "project-noon" }).store;
  const result = deleteFolder(store, "project-noon", { destinationFolderId: "general" });
  assert.equal(result.deletedConversationIds.length, 0);
  assert.equal(result.store.conversations.length, 1);
  assert.equal(result.store.conversations[0].folderId, "general");
  assert.equal(result.store.folders.some((folder) => folder.id === "project-noon"), false);
});

test("refuse la seizième conversation sans supprimer les quinze précédentes", () => {
  let store = normalizeConversationStore(null);
  for (let index = 0; index < 15; index += 1) {
    const update = upsertConversationIndex(store, {
      id: `session-${String(index).padStart(2, "0")}`,
      question: `Conversation ${index}`,
      now: new Date(2026, 7, 25, 10, index).toISOString(),
    });
    store = update.store;
  }
  assert.equal(store.conversations.length, 15);
  assert.throws(() => upsertConversationIndex(store, { id: "session-15" }), /Limite atteinte/);
  assert.equal(store.conversations.length, 15);
});

test("refuse le seizième dossier et bloque un déplacement vers un dossier plein", () => {
  let store = normalizeConversationStore(null);
  for (let index = 1; index < 15; index += 1) {
    store = createFolder(store, { id: `folder-${String(index).padStart(2, "0")}`, title: `Dossier ${index}` }).store;
  }
  assert.throws(() => createFolder(store, { id: "folder-15", title: "Trop" }), /15 dossiers/);
  for (let index = 0; index < 15; index += 1) store = upsertConversationIndex(store, { id: `session-${String(index).padStart(2, "0")}`, folderId: "folder-01" }).store;
  store = upsertConversationIndex(store, { id: "session-source", folderId: "general" }).store;
  assert.throws(() => updateConversation(store, "session-source", { folderId: "folder-01" }), /15 conversations/);
});
