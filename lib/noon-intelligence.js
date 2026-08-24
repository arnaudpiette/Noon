"use strict";
const PROFILES = Object.freeze({ economical: "gpt-5.6-luna", balanced: "gpt-5.6-terra", maximum: "gpt-5.6-sol" });
const LIGHT_PATTERN = /^(bonjour|bonsoir|salut|merci|ok|d'accord|reformule|résume brièvement)\b/i;
const COMPLEX_PATTERN = /\b(réfléchis bien|analyse en profondeur|vérifie tout|audit|architecture|débogage difficile|compare précisément|meilleure solution|stratégie complète)\b/i;
function normalizeIntelligenceProfile(value) { return Object.hasOwn(PROFILES, value) ? value : "balanced"; }
function selectModelRoute({ question = "", profile = "balanced", budgetMode = "NORMAL", attachments = 0 } = {}) {
  const normalized = normalizeIntelligenceProfile(profile); const text = String(question).trim();
  if (["PROTECTION", "ECO"].includes(budgetMode) || (text.length < 180 && LIGHT_PATTERN.test(text) && attachments === 0)) return { model: "gpt-5.6-luna", effort: "low", verbosity: "low", profile: normalized };
  if (normalized === "maximum" || COMPLEX_PATTERN.test(text) || attachments > 1 || text.length > 1800) return { model: "gpt-5.6-sol", effort: "high", verbosity: "medium", profile: normalized };
  if (normalized === "economical") return { model: "gpt-5.6-luna", effort: "low", verbosity: "low", profile: normalized };
  return { model: "gpt-5.6-terra", effort: "medium", verbosity: "medium", profile: normalized };
}
function modelFallbacks(primary) { return [...new Set([primary, "gpt-5.6-terra", "gpt-5.6-luna"])]; }
function trimHistoryByCharacters(history, maximumCharacters = 32000) { const kept = []; let used = 0; for (let i = history.length - 1; i >= 0; i -= 1) { const message = history[i]; const size = String(message?.content || "").length; if (kept.length && used + size > maximumCharacters) break; kept.unshift(message); used += size; } return kept; }
function updateConversationSummary(previousSummary = "", messages = [], maximumCharacters = 8000) {
  const facts = [];
  for (const message of messages) {
    const role = message?.role === "assistant" ? "Noon" : "Arnaud";
    const text = String(message?.content || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    const useful = sentences.filter((sentence) =>
      /\b(décid|choix|préfér|doit|souhaite|contrainte|reste|prochaine|à faire|todo|projet|erreur|solution|validé|focus)\b/i.test(sentence)
    );
    const selected = (useful.length ? useful : sentences.slice(0, 1)).slice(0, 3);
    for (const sentence of selected) facts.push(`- ${role} : ${sentence.slice(0, 700)}`);
  }
  const additions = facts.join("\n");
  return [previousSummary, additions].filter(Boolean).join("\n").slice(-maximumCharacters);
}
module.exports = { PROFILES, modelFallbacks, normalizeIntelligenceProfile, selectModelRoute, trimHistoryByCharacters, updateConversationSummary };
