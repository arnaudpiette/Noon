"use strict";
// Mémoire durable locale : préférences, souvenirs pertinents et opérations de mise à jour.
const fs = require("fs"); const path = require("path"); const crypto = require("crypto");
const DEFAULT_MEMORIES = [
  "Arnaud est directeur artistique en publicité.", "Arnaud est graphiste et illustrateur.",
  "Arnaud est web designer et développeur web en formation.",
];
function tokenize(value) { return new Set(String(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]{3,}/g) || []); }
function createLongTermMemoryStore(filePath) {
  const empty = { version: 1, enabled: true, memories: DEFAULT_MEMORIES.map((text, index) => ({ id: `profile-${index + 1}`, text, tags: ["profil"], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() })) };
  function load() { try { const value = JSON.parse(fs.readFileSync(filePath, "utf8")); return { ...empty, ...value, memories: Array.isArray(value.memories) ? value.memories : empty.memories }; } catch { return structuredClone(empty); } }
  function save(value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); const tmp = `${filePath}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(tmp, filePath); return value; }
  function setEnabled(enabled) { const state = load(); state.enabled = Boolean(enabled); return save(state); }
  function add(text, tags = []) { const state = load(); const now = new Date().toISOString(); const memory = { id: crypto.randomUUID(), text: String(text).trim().slice(0, 1000), tags: tags.map(String).slice(0, 8), createdAt: now, updatedAt: now }; if (!memory.text) throw new Error("Souvenir vide."); state.memories.unshift(memory); state.memories = state.memories.slice(0, 200); save(state); return memory; }
  function update(id, text) { const state = load(); const memory = state.memories.find((item) => item.id === id); if (!memory) throw new Error("Souvenir introuvable."); memory.text = String(text).trim().slice(0, 1000); if (!memory.text) throw new Error("Souvenir vide."); memory.updatedAt = new Date().toISOString(); save(state); return memory; }
  function remove(id) { const state = load(); const before = state.memories.length; state.memories = state.memories.filter((item) => item.id !== id); save(state); return before !== state.memories.length; }
  function clear() { const state = load(); state.memories = []; return save(state); }
  function relevant(query, limit = 8) { const state = load(); if (!state.enabled) return []; const queryTokens = tokenize(query); return state.memories.map((memory) => { const words = tokenize(`${memory.text} ${(memory.tags || []).join(" ")}`); let score = 0; for (const token of queryTokens) if (words.has(token)) score += 1; if ((memory.tags || []).includes("profil")) score += 0.25; return { memory, score }; }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(({ memory }) => memory); }
  return { load, setEnabled, add, update, remove, clear, relevant };
}
module.exports = { createLongTermMemoryStore };
