"use strict";

// Configuration métier unique de Realtime. Les adapters WebRTC restent dans
// la couche HTTP, tandis que l'identité et la mémoire passent par leurs façades.
const REALTIME_TOOLS = Object.freeze([
  { type: "function", name: "set_noon_mode", description: "Change le mode de Noon de manière déterministe.", parameters: { type: "object", properties: { mode: { type: "string", enum: ["DA", "DEV"] } }, required: ["mode"], additionalProperties: false } },
  { type: "function", name: "set_noon_focus", description: "Sélectionne un projet local autorisé ou retire le Focus.", parameters: { type: "object", properties: { query: { type: "string" }, clear: { type: "boolean" } }, required: ["query", "clear"], additionalProperties: false } },
  { type: "function", name: "set_noon_voice_style", description: "Change la langue verrouillée ou automatique et le style d'accent.", parameters: { type: "object", properties: { language: { type: "string" }, accent: { type: "string" } }, required: ["language", "accent"], additionalProperties: false } },
  { type: "function", name: "ask_noon_brain", description: "Délègue obligatoirement toute analyse de fichier, dossier, projet, code, demande complexe ou déclaration d’avancement (commencé, terminé, bloqué, reporté, annulé) au cerveau texte de Noon et à ses outils locaux sécurisés, équivalents à ceux du Chat.", parameters: { type: "object", properties: { question: { type: "string" }, webSearch: { type: "boolean" } }, required: ["question", "webSearch"], additionalProperties: false } },
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
      "Pour toute demande concernant un fichier, un dossier, un projet, du code, une analyse complexe ou l’avancement explicite d’une action (commencée, terminée, bloquée, reportée ou annulée), appelle ask_noon_brain au lieu d'improviser. Ce cerveau partage les mêmes outils de recherche, navigation, lecture de fichiers, suivi d’exécution et analyse Codex que le Chat. Ne déduis jamais qu’une action est terminée parce que son horaire est dépassé.",
      "Confirme brièvement tout changement de langue, accent, mode ou Focus. Si l'utilisateur t'interrompt, arrête-toi immédiatement et écoute.",
      historyText ? `Contexte récent, sans le répéter :\n${historyText}` : "",
    ].filter(Boolean).join(" "));
  }
  return { buildInstructions, tools: REALTIME_TOOLS };
}

module.exports = { REALTIME_TOOLS, createRealtimeVoiceConfig };
