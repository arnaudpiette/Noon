"use strict";

module.exports = {
  category: "personal-search",
  deferred: false,
  definition: {
    type: "function",
    name: "search_personal_sources",
    description: "Recherche des informations vérifiables dans les sources personnelles autorisées de Noon (conversations, mémoire, projets, fichiers, notes, rappels, Gmail ou agenda) et renvoie leur provenance. À utiliser avant toute affirmation portant sur ces sources.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Information précise à retrouver." },
        sourceScopes: { type: "array", items: { type: "string", enum: ["conversation", "memory", "project", "file", "note", "reminder", "email", "calendar", "document"] }, description: "Sources explicites à consulter, ou tableau vide pour la sélection automatique." },
        globalSearch: { type: "boolean", description: "Vrai uniquement si une recherche étendue à toutes les sources est indispensable." },
      },
      required: ["query", "sourceScopes", "globalSearch"],
      additionalProperties: false,
    },
    strict: true,
  },
  permissions: { level: "read", explicitOrderRequired: false, confirmationRequired: false, destructive: false, networkAccess: true },
  async execute(args, context) {
    return context.handlers.searchPersonalSources(args);
  },
};
