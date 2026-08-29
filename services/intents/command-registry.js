"use strict";

const COMMANDS = Object.freeze([
  { id: "workspace.switch", intentType: "SWITCH_CONTEXT", action: "workspace", aliases: ["passe sur", "ouvre le projet", "/focus"], channels: ["chat", "voice", "shortcut", "ui"], requiredEntities: ["workspace"], needsConfirmation: false, handlerTarget: "orchestrator" },
  { id: "mode.switch", intentType: "CONTROL", action: "mode", aliases: ["mode dev", "mode da", "mode soutenance", "retour normal"], channels: ["chat", "voice", "shortcut", "ui"], requiredEntities: ["mode"], needsConfirmation: false, handlerTarget: "orchestrator" },
  { id: "reminder.create", intentType: "CREATE", action: "reminder", aliases: ["rappelle-moi", "mets-moi un rappel", "create reminder"], channels: ["chat", "voice", "shortcut", "ui"], requiredEntities: ["title"], needsConfirmation: false, handlerTarget: "orchestrator" },
  { id: "calendar.create", intentType: "CREATE", action: "calendar_event", aliases: ["ajoute à l'agenda", "crée un événement"], channels: ["chat", "voice", "shortcut", "ui"], requiredEntities: ["title"], needsConfirmation: true, handlerTarget: "orchestrator" },
  { id: "file.search", intentType: "SEARCH", action: "file", aliases: ["retrouve le fichier", "cherche le fichier"], channels: ["chat", "voice", "shortcut", "ui"], requiredEntities: ["query"], needsConfirmation: false, handlerTarget: "orchestrator" },
  { id: "artifact.generate", intentType: "GENERATE", action: "artifact", aliases: ["fais-moi un pdf", "génère une présentation"], channels: ["chat", "voice", "shortcut", "ui"], requiredEntities: ["format"], needsConfirmation: false, handlerTarget: "orchestrator" },
  { id: "approval.confirm", intentType: "CONFIRM", action: "approval", aliases: ["oui", "confirme"], channels: ["chat", "voice", "ui"], requiredEntities: ["approvalId"], needsConfirmation: false, handlerTarget: "orchestrator" },
  { id: "approval.reject", intentType: "REJECT", action: "approval", aliases: ["non", "refuse"], channels: ["chat", "voice", "ui"], requiredEntities: ["approvalId"], needsConfirmation: false, handlerTarget: "orchestrator" },
]);

function createCommandRegistry(definitions = COMMANDS) {
  const commands = new Map();
  for (const definition of definitions) {
    if (!definition?.id || commands.has(definition.id)) throw new TypeError("Définition de commande invalide ou dupliquée.");
    commands.set(definition.id, Object.freeze({ ...definition, aliases: Object.freeze([...(definition.aliases || [])]), channels: Object.freeze([...(definition.channels || [])]) }));
  }
  return { get: (id) => commands.get(id) || null, list: () => [...commands.values()], forChannel: (channel) => [...commands.values()].filter((item) => item.channels.includes(channel)) };
}

module.exports = { COMMANDS, createCommandRegistry };
