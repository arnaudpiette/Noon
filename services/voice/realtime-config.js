"use strict";

// Configuration métier unique de Realtime. Les adapters WebRTC restent dans
// la couche HTTP, tandis que l'identité et la mémoire passent par leurs façades.
const REALTIME_TOOLS = Object.freeze([
  { type: "function", name: "set_noon_mode", description: "Change le mode de Noon de manière déterministe.", parameters: { type: "object", properties: { mode: { type: "string", enum: ["DA", "DEV"] } }, required: ["mode"], additionalProperties: false } },
  { type: "function", name: "set_noon_focus", description: "Sélectionne un projet local autorisé ou retire le Focus.", parameters: { type: "object", properties: { query: { type: "string" }, clear: { type: "boolean" } }, required: ["query", "clear"], additionalProperties: false } },
  { type: "function", name: "set_noon_voice_style", description: "Change la langue verrouillée ou automatique et le style d'accent.", parameters: { type: "object", properties: { language: { type: "string" }, accent: { type: "string" } }, required: ["language", "accent"], additionalProperties: false } },
  { type: "function", name: "ask_noon_brain", description: "Délègue obligatoirement toute question, analyse, demande d’action ou déclaration d’avancement au pipeline canonique de Noon (Intent, contexte, mémoire, ModelRouter, sécurité et approvals), identique au Chat.", parameters: { type: "object", properties: { question: { type: "string" }, webSearch: { type: "boolean" } }, required: ["question", "webSearch"], additionalProperties: false } },
  { type: "function", name: "manage_noon_projects", description: "Actualise, liste ou localise les projets détectés dans les dossiers Focus autorisés.", parameters: { type: "object", properties: { action: { type: "string", enum: ["scan", "list", "find"] }, query: { type: "string" } }, required: ["action", "query"], additionalProperties: false } },
]);

function createRealtimeVoiceConfig({ voiceIdentity, memoryEngine, buildSystemPrompt, maxHistoryMessages = 60 }) {
  function buildInstructions({ language, accent, mode, focus, focusPath, history }) {
    const identity = voiceIdentity.resolve({ pipeline: "realtime", language, accent });
    const modeInstruction = mode === "DEV"
      ? "Mode DEV : concentre-toi sur le code, l'architecture, les tests, la sécurité et le débogage."
      : mode === "SOUTENANCE"
        ? "Mode Soutenance : entraîne la présentation, structure les arguments et anticipe les questions du jury."
        : "Mode DA : concentre-toi sur la direction artistique, l'UI/UX, l'accessibilité et la cohérence visuelle.";
    const focusInstruction = focus
      ? `Focus actif : ${focus}${focusPath ? ` (${focusPath})` : ""}. N'affirme jamais connaître un fichier non lu.`
      : "Aucun dossier Focus n'est actif.";
    const historyText = (history || []).slice(-maxHistoryMessages)
      .map((message) => `${message.role}: ${String(message.content).slice(0, 500)}`).join("\n");
    const voiceMemory = memoryEngine.getRelevantContext({
      query: `${focus || ""} ${(history || []).slice(-4).map((message) => message.content).join(" ")}`,
      channel: "live", purpose: "remote_model", includeConversation: false,
      maxItems: 8, maxCharacters: 3000,
    });
    const memoryText = voiceMemory.remoteContext
      .map((memory) => typeof memory.value === "string" ? memory.value : JSON.stringify(memory.value)).join(" | ");
    return buildSystemPrompt([
      identity.styleInstructions, modeInstruction, focusInstruction,
      memoryText ? `Souvenirs locaux utiles : ${memoryText}` : "",
      "Pour chaque question, analyse, demande d’action ou déclaration d’avancement, appelle toujours ask_noon_brain avec les mots de l’utilisateur au lieu de répondre ou d’agir directement. Seuls les changements déterministes de mode, Focus ou style vocal utilisent leurs outils dédiés. Le cerveau canonique partage IntentCommandEngine, ContextBuilder, MemoryEngine, ModelRouter, SecurityPolicy, ApprovalEngine et TransactionalExecution avec le Chat. Ne déduis jamais qu’une action est terminée parce que son horaire est dépassé.",
      "Confirme brièvement tout changement de langue, accent, mode ou Focus. Si l'utilisateur t'interrompt, arrête-toi immédiatement et écoute.",
      historyText ? `Contexte récent, sans le répéter :\n${historyText}` : "",
    ].filter(Boolean).join(" "));
  }
  return { buildInstructions, tools: REALTIME_TOOLS };
}

function assertRemoteVoiceAvailable(runtime, capabilityId) {
  const decision = runtime.preflight({
    requiredCapabilities: [capabilityId],
    privacy: "STANDARD",
  });
  if (decision.status !== "UNAVAILABLE") return decision;
  const error = new Error("Le mode local uniquement interdit ce service vocal distant.");
  error.code = "LOCAL_ONLY_REMOTE_VOICE_BLOCKED";
  error.statusCode = 409;
  throw error;
}

module.exports = { REALTIME_TOOLS, assertRemoteVoiceAvailable, createRealtimeVoiceConfig };
