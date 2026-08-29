"use strict";

module.exports = {
  category: "personal-search",
  deferred: true,
  definition: {
    type: "function",
    name: "synthesize_personal_sources",
    description: "Recherche puis synthétise plusieurs sources personnelles autorisées en conservant les décisions, évolutions, contradictions et citations. À utiliser pour résumer, comparer ou reconstruire l’historique de plusieurs sources.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Question précise à synthétiser." },
        mode: { type: "string", enum: ["SUMMARY", "COMPARE", "TIMELINE", "CURRENT_STATE", "CONFLICT_ANALYSIS", "DECISION_HISTORY", "DIFF"] },
        sourceScopes: { type: "array", items: { type: "string", enum: ["conversation", "memory", "project", "file", "note", "reminder", "email", "calendar", "document"] } },
      },
      required: ["query", "mode", "sourceScopes"],
      additionalProperties: false,
    },
    strict: true,
  },
  permissions: { level: "read", explicitOrderRequired: false, confirmationRequired: false, destructive: false, networkAccess: true },
  async execute(args, context) { return context.handlers.synthesizePersonalSources(args); },
};
