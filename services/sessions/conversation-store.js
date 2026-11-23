"use strict";

// V3-L7 — historique, résumés et index des conversations (persistance locale).
// Domaine déplacé tel quel depuis server.js. Dépendances déjà déclarées quand server.js le
// construit : lues une fois ; les autres (`deps.x`) : lues à chaque usage, par accesseur.

const fs = require("node:fs");
const { GENERAL_FOLDER_ID, normalizeConversationStore, upsertConversationIndex } = require("../../lib/conversation-index");
const { trimHistoryByCharacters, updateConversationSummary } = require("../../lib/noon-intelligence");
const { trimConversationHistory } = require("../../lib/voice-utils");

const DEPENDENCIES = Object.freeze(["CONVERSATION_INDEX_FILE","CONVERSATION_MEMORY_FILE","CONVERSATION_SUMMARIES_FILE","contextBuilder","multiSourceSynthesisEngine","personalSearchEngine","sessionActivities"]);

function createConversationStore(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  const {
    CONVERSATION_INDEX_FILE,
    CONVERSATION_MEMORY_FILE,
    CONVERSATION_SUMMARIES_FILE,
    contextBuilder,
  } = deps;

  function loadConversationSessions() {
    if (!fs.existsSync(CONVERSATION_MEMORY_FILE)) {
      return new Map();
    }

    try {
      const savedSessions = JSON.parse(
        fs.readFileSync(
          CONVERSATION_MEMORY_FILE,
          "utf8"
        )
      );

      const validSessions = Object.entries(
        savedSessions
      ).filter(([, history]) => Array.isArray(history));

      return new Map(validSessions);
    } catch (error) {
      console.warn(
        "Mémoire Noon illisible :",
        error.message
      );

      return new Map();
    }
  }

  function saveConversationSessions() {
    const temporaryFile =
      `${CONVERSATION_MEMORY_FILE}.tmp`;

    try {
      const savedSessions = Object.fromEntries(
        conversationSessions
      );

      fs.writeFileSync(
        temporaryFile,
        JSON.stringify(savedSessions, null, 2)
      );

      fs.renameSync(
        temporaryFile,
        CONVERSATION_MEMORY_FILE
      );
    } catch (error) {
      console.error(
        "Impossible d'enregistrer la mémoire Noon :",
        error.message
      );
    }
  }

  const conversationSessions =
    loadConversationSessions();

  function loadConversationSummaries() {
    try {
      const saved = JSON.parse(
        fs.readFileSync(CONVERSATION_SUMMARIES_FILE, "utf8")
      );
      return new Map(
        Object.entries(saved).filter(([, summary]) => typeof summary === "string")
      );
    } catch {
      return new Map();
    }
  }

  const conversationSummaries = loadConversationSummaries();

  // Le checkpoint est dérivable de la fenêtre conservée ; il reste local et
  // évite de résumer à nouveau tous les anciens messages à chaque échange.
  const conversationSummaryCheckpoints = new Map();

  function loadConversationIndex() {
    try {
      const saved = JSON.parse(fs.readFileSync(CONVERSATION_INDEX_FILE, "utf8"));
      const normalized = normalizeConversationStore(saved);
      if (Array.isArray(saved)) {
        const backup = `${CONVERSATION_INDEX_FILE}.v1.backup.json`;
        if (!fs.existsSync(backup)) fs.copyFileSync(CONVERSATION_INDEX_FILE, backup);
        const temporary = `${CONVERSATION_INDEX_FILE}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(normalized, null, 2), { mode: 0o600 });
        fs.renameSync(temporary, CONVERSATION_INDEX_FILE);
      }
      return normalized;
    } catch {
      return normalizeConversationStore(null);
    }
  }

  let conversationIndex = loadConversationIndex();

  // Lecture de l’index depuis l’extérieur du domaine (il est réaffecté à chaque mise à jour).
  function getConversationIndex() {
    return conversationIndex;
  }

  function saveConversationIndex() {
    const temporaryFile = `${CONVERSATION_INDEX_FILE}.tmp`;
    fs.writeFileSync(
      temporaryFile,
      JSON.stringify(conversationIndex, null, 2),
      { mode: 0o600 }
    );
    fs.renameSync(temporaryFile, CONVERSATION_INDEX_FILE);
  }

  // V3-L7 : les routes de conversations (sorties de server.js) remplacent l'index par ce point unique.
  function replaceConversationIndex(store) {
    conversationIndex = store;
    saveConversationIndex();
  }

  function touchConversation(sessionId, question = "", folderId = GENERAL_FOLDER_ID) {
    const id = normalizeSessionId(sessionId);
    const now = new Date().toISOString();
    const update = upsertConversationIndex(conversationIndex, {
      id,
      question,
      folderId,
      now,
    });
    conversationIndex = update.store;
    saveConversationIndex();
    return update.entry;
  }

  function deleteConversation(sessionId) {
    const id = normalizeSessionId(sessionId);
    clearConversationSession(id);
    deps.sessionActivities.delete(id);
    conversationIndex.conversations = conversationIndex.conversations.filter((item) => item.id !== id);
    saveConversationIndex();
  }

  function saveConversationSummaries() {
    const temporaryFile = `${CONVERSATION_SUMMARIES_FILE}.tmp`;
    try {
      fs.writeFileSync(
        temporaryFile,
        JSON.stringify(Object.fromEntries(conversationSummaries), null, 2),
        { mode: 0o600 }
      );
      fs.renameSync(temporaryFile, CONVERSATION_SUMMARIES_FILE);
    } catch (error) {
      console.error("Impossible d'enregistrer les résumés Noon :", error.message);
    }
  }

  const MAX_HISTORY_EXCHANGES = 30;

  const MAX_HISTORY_CHARS = 4000;

  function normalizeSessionId(value) {
    const sessionId =
      typeof value === "string" ? value.trim() : "";

    if (!/^[a-zA-Z0-9-]{8,80}$/.test(sessionId)) {
      return "noon-local";
    }

    return sessionId;
  }

  function createConversationKey({
    sessionId,
  }) {
    return `${sessionId}::conversation`;
  }

  function getConversationHistory(conversationKey) {
    let savedHistory = conversationSessions.get(conversationKey) || [];
    if (savedHistory.length === 0) {
      const sessionPrefix = `${conversationKey.split("::")[0]}::`;
      savedHistory = [...conversationSessions.entries()]
        .filter(([key]) => key.startsWith(sessionPrefix) && key !== conversationKey)
        .flatMap(([, messages]) => messages)
        .sort((left, right) => Number(left.savedAt || 0) - Number(right.savedAt || 0));
    }
    const history = trimHistoryByCharacters(
      savedHistory.map(({ role, content }) => ({ role, content })),
      32_000
    );
    const summary = conversationSummaries.get(conversationKey);
    return summary
      ? [{
          role: "system",
          content:
            "Résumé local des échanges plus anciens. Utilise-le comme contexte, " +
            "sans le citer ni supposer qu’il remplace les messages récents :\n" +
            summary,
        }, ...history]
      : history;
  }

  function getConversationTranscript(conversationKey) {
    return [...(conversationSessions.get(conversationKey) || [])];
  }

  function rememberConversation(
    conversationKey,
    question,
    answer,
    artifacts = []
  ) {
    const history = [
      ...(conversationSessions.get(conversationKey) || []),
    ];
    const previousRecentHistory = trimHistoryByCharacters(
      trimConversationHistory(history, MAX_HISTORY_EXCHANGES),
      48_000
    );
    const previousCovered = conversationSummaryCheckpoints.has(conversationKey)
      ? conversationSummaryCheckpoints.get(conversationKey)
      : conversationSummaries.has(conversationKey)
        ? Math.max(0, history.length - previousRecentHistory.length)
        : 0;

    history.push(
      {
        role: "user",
        content: String(question).slice(
          0,
          MAX_HISTORY_CHARS
        ),
      },
      {
        role: "assistant",
        content: String(answer).slice(
          0,
          MAX_HISTORY_CHARS
        ),
        artifacts: artifacts.map((artifact) => ({ name: artifact.name, type: artifact.type, format: artifact.format, size: artifact.size, path: artifact.path, creative: artifact.creative === true, temporary: artifact.temporary === true, model: artifact.model || null, width: artifact.width || null, height: artifact.height || null, quality: artifact.quality || null })),
      }
    );

    const recentHistory = trimHistoryByCharacters(trimConversationHistory(history, MAX_HISTORY_EXCHANGES), 48_000);
    const removedMessages = history.slice(0, Math.max(0, history.length - recentHistory.length));
    if (removedMessages.length > previousCovered) {
      conversationSummaries.set(
        conversationKey,
        updateConversationSummary(
          conversationSummaries.get(conversationKey) || "",
          removedMessages.slice(previousCovered)
        )
      );
      conversationSummaryCheckpoints.set(conversationKey, removedMessages.length);
      saveConversationSummaries();
    }
    // L’historique brut reste complet sur disque. Seule la fenêtre envoyée au
    // modèle est bornée et résumée par getConversationHistory().
    conversationSessions.set(conversationKey, history);

    saveConversationSessions();
    deps.personalSearchEngine?.invalidate();
    deps.multiSourceSynthesisEngine?.invalidate();
  }

  function clearConversationSession(sessionId) {
    const prefix = `${sessionId}::`;

    for (const conversationKey of conversationSessions.keys()) {
      if (conversationKey.startsWith(prefix)) {
        conversationSessions.delete(conversationKey);
      }
    }

    for (const conversationKey of conversationSummaries.keys()) {
      if (conversationKey.startsWith(prefix)) {
        conversationSummaries.delete(conversationKey);
        conversationSummaryCheckpoints.delete(conversationKey);
      }
    }

    saveConversationSessions();
    saveConversationSummaries();
    contextBuilder.invalidateSession(sessionId);
    deps.personalSearchEngine?.invalidate();
    deps.multiSourceSynthesisEngine?.invalidate();
  }

  return { getConversationIndex, conversationSummaries, replaceConversationIndex, touchConversation, deleteConversation, normalizeSessionId, createConversationKey, getConversationHistory, getConversationTranscript, rememberConversation, clearConversationSession };
}

module.exports = { DEPENDENCIES, createConversationStore };
