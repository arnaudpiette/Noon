"use strict";

/*
 * Conventions conversationnelles courtes.
 *
 * Elles décrivent uniquement l'intention de dialogue.
 * Elles ne constituent jamais une autorisation d'exécuter
 * une opération protégée ou d'approuver une action.
 */

function normalizeCue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("fr")
    .replace(/[’']/g, " ")
    .replace(/[-‐-‒–—]+/g, " ")
    .replace(/[.!?,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CONTINUE_CUES = new Set([
  "la suite",
  "suite",
  "continue",
  "continuer",
  "on continue",
  "on poursuit",
  "poursuis",
  "reprends",
  "on reprend",
  "vas y",
  "ok vas y",
  "allez vas y",
  "prochaine etape",
  "etape suivante",
  "la prochaine etape",
  "et apres",
  "apres",
  "go",
]);

const PAUSE_CUES = new Set([
  "attends",
  "attend",
  "attends une seconde",
  "attends deux secondes",
  "une seconde",
  "deux secondes",
  "2 secondes",
  "pause",
  "bouge pas",
]);

const ACKNOWLEDGEMENT_CUES = new Set([
  "ok",
  "d accord",
  "compris",
  "merci",
]);

function classifyConversationConvention(text) {
  const normalized = normalizeCue(text);

  if (!normalized) {
    return null;
  }

  if (CONTINUE_CUES.has(normalized)) {
    return {
      kind: "continue",
      action: "previous_task",
      normalized,
    };
  }

  if (PAUSE_CUES.has(normalized)) {
    return {
      kind: "pause",
      action: "pause_conversation",
      normalized,
    };
  }

  if (ACKNOWLEDGEMENT_CUES.has(normalized)) {
    return {
      kind: "acknowledgement",
      action: "acknowledgement",
      normalized,
    };
  }

  return null;
}

module.exports = {
  ACKNOWLEDGEMENT_CUES,
  CONTINUE_CUES,
  PAUSE_CUES,
  classifyConversationConvention,
  normalizeCue,
};
