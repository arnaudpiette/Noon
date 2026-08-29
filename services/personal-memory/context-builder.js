"use strict";

const SENSITIVE_TERMS = /\b(sant[eé]|m[eé]dical|juridique|droit|finance|banque|adresse|[eé]cole|enfant)\b/i;

function tokenize(text) {
  return new Set(String(text || "").toLocaleLowerCase("fr").match(/[\p{L}\p{N}]{3,}/gu) || []);
}

function createPrivateContextBuilder(service, { maxCharacters = 3500 } = {}) {
  let lastUsage = { memoryIds: [], reason: "Aucune mémoire privée utilisée." };
  function build({ question, focus = null, confirmedIds = [] } = {}) {
    if (!service.available || !service.settings().enabled) return { instruction: "", memoryIds: [], hardRules: [] };
    const queryTokens = tokenize(`${question} ${focus || ""}`);
    const explicit = new Set(confirmedIds);
    const settings = service.settings();
    const candidates = service.listMemories({ includeDeleted: false }).filter((item) => {
      if (!service.isProfileEnabled(item.subjectId)) return false;
      if (item.status !== "confirmed") return false;
      if (item.expiresAt && new Date(item.expiresAt) <= new Date()) return false;
      if (item.apiPolicy === "local_only") return false;
      if (item.apiPolicy === "confirm_each_use" && !explicit.has(item.id)) return false;
      if (["high", "restricted"].includes(item.sensitivity) && !settings.sensitiveApiAllowed) return false;
      if (item.subjectId === "alexandra" || item.subjectId === "sinan" || item.subjectId === "kaan") {
        if (!explicit.has(item.id)) return false;
      }
      const terms = tokenize(`${item.category} ${item.statement} ${(item.tags || []).join(" ")}`);
      return [...terms].some((term) => queryTokens.has(term)) || (SENSITIVE_TERMS.test(question) && item.sensitivity !== "low");
    }).map((item) => ({ item, score: [...tokenize(item.statement)].filter((term) => queryTokens.has(term)).length }))
      .sort((a, b) => b.score - a.score || new Date(b.item.updatedAt) - new Date(a.item.updatedAt));
    const selected = []; let used = 0;
    for (const { item } of candidates) {
      const minimal = `${item.subjectId}/${item.category}: ${item.statement}`;
      if (used + minimal.length > maxCharacters) continue;
      selected.push({ id: item.id, text: minimal }); used += minimal.length;
    }
    const hardRules = service.hardRules().map((rule) => rule.statement);
    lastUsage = selected.length
      ? { memoryIds: selected.map((entry) => entry.id), reason: `${selected.length} souvenir(s) confirmé(s), pertinent(s) et autorisé(s).` }
      : { memoryIds: [], reason: "Aucun souvenir privé pertinent et autorisé pour cette demande." };
    return { instruction: selected.length ? `Contexte personnel local minimal et confirmé :\n${selected.map((entry) => `- ${entry.text}`).join("\n")}` : "", memoryIds: lastUsage.memoryIds, hardRules };
  }
  return { build, lastUsage: () => ({ ...lastUsage }) };
}

module.exports = { createPrivateContextBuilder, tokenize };
