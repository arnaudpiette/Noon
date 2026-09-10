"use strict";

// Commandes explicites de mémoire. Elles sont volontairement déterministes :
// le contenu de la conversation ne choisit ni le profil ni une action d'écriture.

const SUBJECTS = new Set(["arnaud", "alexandra", "sinan", "kaan", "household", "noon", "projects"]);

function clean(value, max = 12000) {
  return String(value || "").replace(/[\0\r\n]+/g, " ").replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "").slice(0, max);
}

function subjectFor(text) {
  const normalized = String(text || "").toLocaleLowerCase("fr");
  if (/\balexandra\b/.test(normalized)) return "alexandra";
  if (/\bsinan\b/.test(normalized)) return "sinan";
  if (/\bkaan\b/.test(normalized)) return "kaan";
  if (/\b(?:foyer|famille)\b/.test(normalized)) return "household";
  return "arnaud";
}

function parseConversationMemoryCommand(text) {
  const source = clean(text, 4000);
  if (!source) return null;
  let match = source.match(/^(?:noon,?\s*)?(?:retiens|souviens-toi)\s+(?:que\s+)?(.+)$/i);
  if (match) return { action: "save", subjectId: subjectFor(source), statement: clean(match[1]) };
  match = source.match(/^(?:noon,?\s*)?(?:qu['’]est-ce que tu sais sur|que sais-tu sur|que sais tu sur)\s+(.+)$/i);
  if (match) {
    const subjectId = subjectFor(match[1]);
    const query = clean(match[1]);
    const onlySubject = new RegExp(`^${subjectId}$`, "i").test(query);
    return { action: "search", subjectId, query: onlySubject ? "" : query };
  }
  match = source.match(/^(?:noon,?\s*)?(?:cherche|recherche|retrouve)\s+(?:dans\s+)?(?:ma\s+)?m[eé]moire\s+(.+)$/i);
  if (match) return { action: "search", subjectId: subjectFor(match[1]), query: clean(match[1]) };
  match = source.match(/^(?:noon,?\s*)?(?:modifie|corrige|mets à jour)\s+(?:dans\s+)?(?:ma\s+)?m[eé]moire\s+(.+?)\s+(?:en|par)\s+(.+)$/i);
  if (match) return { action: "update", subjectId: subjectFor(source), previous: clean(match[1]), statement: clean(match[2]) };
  match = source.match(/^(?:noon,?\s*)?(?:oublie|supprime|efface)\s+(?:de\s+)?(?:ma\s+)?m[eé]moire\s+(.+)$/i);
  if (match) return { action: "delete", subjectId: subjectFor(source), previous: clean(match[1]) };
  return null;
}

function matchingMemories(service, subjectId, query) {
  const needle = clean(query, 4000).toLocaleLowerCase("fr");
  return service.listMemories({ subjectId, includeDeleted: false })
    .filter((item) => item.statement.toLocaleLowerCase("fr").includes(needle));
}

function executeConversationMemoryCommand(service, command) {
  if (!service?.available) return { status: "unavailable", answer: "La mémoire privée locale est indisponible." };
  if (!command || !SUBJECTS.has(command.subjectId)) return null;
  if (command.action === "save") {
    if (!command.statement) return { status: "needs_clarification", answer: "Que dois-je retenir exactement ?" };
    const item = service.createMemory({ subjectId: command.subjectId, category: "general", statement: command.statement, sensitivity: "low", status: "confirmed", confidence: 1, consentStatus: "granted", apiPolicy: "contextual", sourceType: "explicit-voice-or-chat" });
    return { status: item.duplicate ? "unchanged" : "saved", answer: item.duplicate ? "Cette information est déjà dans votre mémoire privée." : "C’est retenu dans votre mémoire privée.", memoryIds: [item.id] };
  }
  if (command.action === "search") {
    const matches = matchingMemories(service, command.subjectId, command.query);
    if (!matches.length) return { status: "not_found", answer: "Je n’ai trouvé aucune information correspondante dans votre mémoire privée." };
    return { status: "found", answer: matches.slice(0, 5).map((item) => item.statement).join(" "), memoryIds: matches.slice(0, 5).map((item) => item.id) };
  }
  const matches = matchingMemories(service, command.subjectId, command.previous);
  if (!matches.length) return { status: "not_found", answer: "Je n’ai pas trouvé cette information dans votre mémoire privée." };
  if (matches.length > 1) return { status: "needs_clarification", answer: "Plusieurs souvenirs correspondent. Dites la phrase complète à modifier ou à oublier.", memoryIds: matches.map((item) => item.id) };
  if (command.action === "update") {
    const item = service.updateMemory(matches[0].id, { statement: command.statement, status: "confirmed", consentStatus: "granted" }, "correction explicite par conversation");
    return { status: "updated", answer: "L’information a été mise à jour dans votre mémoire privée.", memoryIds: [item.id] };
  }
  service.forgetMemory(matches[0].id);
  return { status: "deleted", answer: "Cette information a été oubliée de votre mémoire privée.", memoryIds: [matches[0].id] };
}

module.exports = { executeConversationMemoryCommand, parseConversationMemoryCommand };
