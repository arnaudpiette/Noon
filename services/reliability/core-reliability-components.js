"use strict";

// V3-L7 — enregistrement des composants surveillés par ReliabilityEngine (stockage, mémoire
// privée, fichiers, cache de contexte, capacité, artefacts, connecteurs, modèles, voix,
// planificateur, multimodal), sorti de server.js. Bloc déplacé tel quel. server.js l'appelle au
// même endroit qu'avant, donc l'ordre des composants est inchangé. Toutes les dépendances sont
// déjà initialisées à l'appel : elles sont lues une fois.

const fs = require("fs");
const { SCHEMA_VERSION } = require("../persistence/database");

const DEPENDENCIES = Object.freeze(["ARTIFACT_PREVIEW_DIRECTORY","calendarConnector","contextBuilder","getAllowedDirectories","gmailConnector","notesConnector","personalDatabase","portfolioCapacityEngine","privateMemoryCipher","privateMemoryService","reliabilityEngine","remindersConnector"]);

function registerCoreReliabilityComponents(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  const {
    ARTIFACT_PREVIEW_DIRECTORY,
    calendarConnector,
    contextBuilder,
    getAllowedDirectories,
    gmailConnector,
    notesConnector,
    personalDatabase,
    portfolioCapacityEngine,
    privateMemoryCipher,
    privateMemoryService,
    reliabilityEngine,
    remindersConnector,
  } = deps;

  reliabilityEngine.register({
    componentId: "sqlite", type: "storage", criticality: "critical",
    capabilities: ["read", "write", "schema"], ttlMs: 30_000,
    healthCheck: async ({ deep }) => {
      if (personalDatabase.kind !== "sqlite") {
        const error = new Error("SQLite indisponible : fallback local actif.");
        error.code = "SQLITE_FALLBACK"; throw error;
      }
      personalDatabase.database.prepare("SELECT 1 AS ok").get();
      const version = personalDatabase.database.prepare(
        "SELECT version FROM schema_migrations WHERE name = 'personal-intelligence-base' ORDER BY version DESC LIMIT 1"
      ).get()?.version;
      if (Number(version) !== SCHEMA_VERSION) throw Object.assign(new Error("Schema version mismatch"), { code: "SCHEMA_MISMATCH" });
      if (deep) personalDatabase.database.prepare("PRAGMA quick_check").get();
      return { ok: true };
    },
    impact: "La mémoire, les sessions et les registres persistants peuvent être indisponibles.",
  });
  reliabilityEngine.register({
    componentId: "private-memory", type: "storage", criticality: "important",
    capabilities: ["read", "decrypt", "candidate_write"], ttlMs: 60_000,
    healthCheck: async () => {
      if (!privateMemoryService.available || !privateMemoryCipher) throw Object.assign(new Error("Private memory key missing"), { code: "KEYSTORE_UNAVAILABLE" });
      return { ok: true };
    }, impact: "Les souvenirs privés ne peuvent pas être consultés.",
  });
  reliabilityEngine.register({
    componentId: "filesystem", type: "filesystem", criticality: "important",
    capabilities: ["read", "search"], ttlMs: 30_000,
    healthCheck: async () => {
      const roots = getAllowedDirectories();
      if (!roots.length) throw Object.assign(new Error("No authorized root"), { code: "CONFIGURATION_ERROR" });
      const missing = roots.filter((root) => !fs.existsSync(root));
      if (missing.length === roots.length) throw Object.assign(new Error("All roots unavailable"), { status: 503 });
      const denied = roots.filter((root) => { try { fs.accessSync(root, fs.constants.R_OK); return false; } catch { return true; } });
      if (denied.length) throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      return { degradedCapabilities: missing.length ? ["missing_roots"] : [] };
    }, impact: "Certains dossiers locaux ne peuvent pas être parcourus.",
  });
  reliabilityEngine.register({
    componentId: "context-cache", type: "engine", criticality: "important",
    capabilities: ["read", "invalidate"], ttlMs: 30_000,
    healthCheck: async () => { const stats = contextBuilder.cacheStats(); if (!Number.isFinite(stats.entries) || stats.entries < 0) throw new Error("Cache invalid response"); return { ok: true }; },
    safeRepair: async () => contextBuilder.clearContextCache(),
    impact: "Le contexte sera reconstruit sans cache.",
  });
  reliabilityEngine.register({
    componentId: "portfolio-capacity", type: "engine", criticality: "optional",
    capabilities: ["capacity_snapshot", "portfolio_snapshot", "overload", "scenario_simulation"], ttlMs: 60_000,
    healthCheck: async () => {
      const state = portfolioCapacityEngine.health();
      if (state.executionAuthority || state.calendarWriteAuthority || state.projectWriteAuthority || state.goalWriteAuthority) {
        throw Object.assign(new Error("Portfolio authority boundary violated"), { code: "PORTFOLIO_AUTHORITY_VIOLATION" });
      }
      return state;
    },
    impact: "L’analyse globale de capacité peut être indisponible ; Planning et Priority restent inchangés.",
  });
  reliabilityEngine.register({
    componentId: "artifacts", type: "renderer", criticality: "optional",
    capabilities: ["docx", "pdf", "pptx", "xlsx", "png"], ttlMs: 60_000,
    healthCheck: async () => { fs.mkdirSync(ARTIFACT_PREVIEW_DIRECTORY, { recursive: true }); fs.accessSync(ARTIFACT_PREVIEW_DIRECTORY, fs.constants.R_OK | fs.constants.W_OK); return { ok: true }; },
    impact: "La prévisualisation ou certains exports peuvent être indisponibles.",
  });
  for (const [connector, operation] of [[notesConnector, "listRecentNotes"], [remindersConnector, "listIncompleteReminders"]]) {
    reliabilityEngine.register({ componentId: connector.id, type: "connector", criticality: "optional",
      capabilities: connector.readCapabilities, ttlMs: 60_000, authState: () => connector.status.authState,
      healthCheck: async () => { await connector[operation](); }, impact: "Cette source locale ne peut pas être vérifiée." });
  }
  reliabilityEngine.register({ componentId: "gmail", type: "connector", criticality: "optional", capabilities: ["read", "search", "draft"], ttlMs: 60_000, authState: () => gmailConnector.connected ? "connected" : "missing", healthCheck: async () => { if (!gmailConnector.connected) throw Object.assign(new Error("Google non connecté"), { status: 401, code: "AUTH_MISSING" }); await gmailConnector.searchGmailMessages("newer_than:1d", { maxResults: 1 }); }, impact: "Les emails ne peuvent pas être vérifiés ou inclus." });
  reliabilityEngine.register({ componentId: "google-calendar", type: "connector", criticality: "optional", capabilities: ["read", "availability", "write"], ttlMs: 60_000, authState: () => calendarConnector.connected ? "connected" : "missing", healthCheck: async () => { if (!calendarConnector.connected) throw Object.assign(new Error("Google non connecté"), { status: 401, code: "AUTH_MISSING" }); await calendarConnector.listCalendars(); }, impact: "Les disponibilités de l’agenda restent inconnues." });
  reliabilityEngine.register({ componentId: "openai-models", type: "model", criticality: "important", capabilities: ["luna", "terra", "sol", "astra"], ttlMs: 60_000, healthCheck: async () => { if (!process.env.OPENAI_API_KEY) throw Object.assign(new Error("OpenAI API key missing"), { code: "CONFIGURATION_ERROR" }); }, impact: "Le chat IA et les analyses distantes ne peuvent pas répondre." });
  reliabilityEngine.register({ componentId: "google-ai-models", type: "model", criticality: "optional", capabilities: ["gemini"], ttlMs: 60_000, healthCheck: async () => { if (!process.env.GEMINI_API_KEY) throw Object.assign(new Error("Gemini credential missing"), { code: "CONFIGURATION_ERROR" }); }, impact: "Gemini est exclu ; OpenAI reste disponible." });
  for (const modelId of ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-6-astra"]) {
    reliabilityEngine.register({ componentId: modelId, type: "model", criticality: "optional", capabilities: ["responses"], ttlMs: 30_000, circuitThreshold: 2, impact: "Ce profil de modèle est temporairement évité par le routeur." });
  }
  reliabilityEngine.register({ componentId: "gemini-3.8-flash", type: "model", criticality: "optional", capabilities: ["generateContent"], ttlMs: 30_000, circuitThreshold: 2, circuitCooldownMs: 30_000, impact: "Gemini est temporairement évité après deux échecs transitoires ; OpenAI reste disponible." });
  reliabilityEngine.register({ componentId: "realtime", type: "voice", criticality: "optional", capabilities: ["webrtc", "stt", "tts"], ttlMs: 60_000, fallback: "text-chat", fallbackQuality: "degraded", healthCheck: async () => { if (!process.env.OPENAI_API_KEY) throw Object.assign(new Error("OpenAI API key missing"), { code: "CONFIGURATION_ERROR" }); }, impact: "La voix Live est indisponible, mais le chat texte reste utilisable." });
  reliabilityEngine.register({ componentId: "wake-word", type: "voice", criticality: "optional", capabilities: ["wake_word"], ttlMs: 120_000, impact: "L’activation par « Salut Noon » peut être indisponible." });
  reliabilityEngine.register({ componentId: "scheduler", type: "scheduler", criticality: "important", capabilities: ["daily_brief"], ttlMs: 60_000, impact: "Le brief planifié peut être retardé." });
  for (const [componentId, capabilities] of [
    ["multimodal-image", ["vision", "ocr"]],
    ["multimodal-screenshot", ["vision", "ocr"]],
    ["multimodal-pdf", ["native_text", "vision", "ocr"]],
    ["multimodal-audio", ["speech_transcription"]],
  ]) {
    reliabilityEngine.register({
      componentId, type: "multimodal", criticality: "optional", capabilities,
      ttlMs: 60_000,
      healthCheck: async () => {
        if (!process.env.OPENAI_API_KEY) throw Object.assign(
          new Error("OpenAI API key missing"), { code: "CONFIGURATION_ERROR" }
        );
        return { ok: true };
      },
      impact: "L’analyse de ce type de média est temporairement indisponible.",
    });
  }
}

module.exports = { DEPENDENCIES, registerCoreReliabilityComponents };
