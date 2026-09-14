"use strict";

// Gestion de l’index des dossiers et conversations, avec limites et opérations de classement.

const MAX_FOLDERS = 15;
const MAX_CONVERSATIONS_PER_FOLDER = 15;
const GENERAL_FOLDER_ID = "general";

function createConversationTitle(question) {
  return String(question || "").replace(/\s+/g, " ").trim().slice(0, 72) || "Nouvelle conversation";
}

function defaultFolder(now = new Date().toISOString()) {
  return { id: GENERAL_FOLDER_ID, title: "Général", position: 0, createdAt: now, updatedAt: now };
}

function normalizeConversationStore(saved, now = new Date().toISOString()) {
  if (Array.isArray(saved)) return { version: 2, folders: [defaultFolder(now)], conversations: saved.filter(Boolean).map((item) => ({ ...item, folderId: GENERAL_FOLDER_ID, pinned: false })) };
  const folders = Array.isArray(saved?.folders) ? saved.folders.slice(0, MAX_FOLDERS) : [];
  if (!folders.some(({ id }) => id === GENERAL_FOLDER_ID)) folders.unshift(defaultFolder(now));
  const validIds = new Set(folders.map(({ id }) => id));
  return { version: 2, folders: folders.map((folder, position) => ({ ...folder, position })), conversations: (Array.isArray(saved?.conversations) ? saved.conversations : []).filter((item) => item?.id).map((item) => ({ ...item, folderId: validIds.has(item.folderId) ? item.folderId : GENERAL_FOLDER_ID, pinned: item.pinned === true })) };
}

function folderConversationCount(store, folderId) {
  return store.conversations.filter((item) => item.folderId === folderId).length;
}

function upsertConversationIndex(saved, { id, question = "", folderId = GENERAL_FOLDER_ID, now = new Date().toISOString() } = {}) {
  const store = normalizeConversationStore(saved, now);
  const existing = store.conversations.find((item) => item.id === id);
  if (!existing && folderConversationCount(store, folderId) >= MAX_CONVERSATIONS_PER_FOLDER) throw new Error("Limite atteinte : 15 conversations dans ce dossier.");
  if (!store.folders.some((folder) => folder.id === folderId)) throw new Error("Dossier de conversations introuvable.");
  const entry = existing ? { ...existing, title: existing.title === "Nouvelle conversation" && question ? createConversationTitle(question) : existing.title, updatedAt: now } : { id, folderId, title: createConversationTitle(question), pinned: false, createdAt: now, updatedAt: now };
  store.conversations = [entry, ...store.conversations.filter((item) => item.id !== id)];
  return { store, conversations: store.conversations, removed: [], entry };
}

function createFolder(saved, { id, title, now = new Date().toISOString() } = {}) {
  const store = normalizeConversationStore(saved, now);
  if (store.folders.length >= MAX_FOLDERS) throw new Error("Limite atteinte : 15 dossiers.");
  const cleanTitle = String(title || "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!cleanTitle) throw new Error("Le nom du dossier est vide.");
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(String(id || ""))) throw new Error("Identifiant de dossier invalide.");
  const folder = { id, title: cleanTitle, position: store.folders.length, createdAt: now, updatedAt: now };
  store.folders.push(folder);
  return { store, folder };
}

function renameFolder(saved, id, title, now = new Date().toISOString()) {
  const store = normalizeConversationStore(saved, now);
  const folder = store.folders.find((item) => item.id === id);
  if (!folder) throw new Error("Dossier introuvable.");
  const cleanTitle = String(title || "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!cleanTitle) throw new Error("Le nom du dossier est vide.");
  folder.title = cleanTitle; folder.updatedAt = now;
  return store;
}

function updateConversation(saved, id, changes = {}, now = new Date().toISOString()) {
  const store = normalizeConversationStore(saved, now);
  const conversation = store.conversations.find((item) => item.id === id);
  if (!conversation) throw new Error("Conversation introuvable.");
  if (changes.folderId && changes.folderId !== conversation.folderId) {
    if (!store.folders.some((folder) => folder.id === changes.folderId)) throw new Error("Dossier introuvable.");
    if (folderConversationCount(store, changes.folderId) >= MAX_CONVERSATIONS_PER_FOLDER) throw new Error("Limite atteinte : 15 conversations dans ce dossier.");
    conversation.folderId = changes.folderId;
  }
  if (typeof changes.title === "string") conversation.title = createConversationTitle(changes.title);
  if (typeof changes.pinned === "boolean") conversation.pinned = changes.pinned;
  conversation.updatedAt = now;
  return store;
}

function deleteFolder(saved, id, { deleteConversations = false, destinationFolderId = null } = {}) {
  const store = normalizeConversationStore(saved);
  if (id === GENERAL_FOLDER_ID) throw new Error("Le dossier Général ne peut pas être supprimé.");
  if (!store.folders.some((folder) => folder.id === id)) throw new Error("Dossier introuvable.");
  const children = store.conversations.filter((item) => item.folderId === id);
  if (children.length && !deleteConversations && !destinationFolderId) throw new Error("Le dossier contient des conversations.");
  if (destinationFolderId) {
    if (destinationFolderId !== GENERAL_FOLDER_ID && folderConversationCount(store, destinationFolderId) + children.length > MAX_CONVERSATIONS_PER_FOLDER) throw new Error("Le dossier de destination ne dispose pas d’assez de place.");
    children.forEach((item) => { item.folderId = destinationFolderId; });
  } else if (deleteConversations) store.conversations = store.conversations.filter((item) => item.folderId !== id);
  store.folders = store.folders.filter((folder) => folder.id !== id).map((folder, position) => ({ ...folder, position }));
  return { store, deletedConversationIds: deleteConversations ? children.map(({ id: conversationId }) => conversationId) : [] };
}

module.exports = { GENERAL_FOLDER_ID, MAX_FOLDERS, MAX_CONVERSATIONS_PER_FOLDER, createConversationTitle, normalizeConversationStore, upsertConversationIndex, createFolder, renameFolder, updateConversation, deleteFolder, folderConversationCount };
