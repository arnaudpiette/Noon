"use strict";

module.exports = {
  category: "personal-intelligence",
  deferred: true,
  definition: {
    type: "function",
    name: "update_execution_status",
    description: "Met à jour une action suivie uniquement après une déclaration explicite de l’utilisateur. Utiliser d’abord list_execution_items si l’identifiant exact est inconnu. Ne jamais déduire qu’une action est terminée parce que son horaire est dépassé.",
    parameters: {
      type: "object",
      properties: {
        executionItemId: { type: "string", description: "Identifiant exact renvoyé par list_execution_items." },
        status: { type: "string", enum: ["planned", "in_progress", "completed", "missed", "delayed", "blocked", "cancelled", "deferred", "unknown"] },
        progress: { type: ["number", "null"], minimum: 0, maximum: 100 },
        remainingDurationMinutes: { type: ["number", "null"], minimum: 0 },
        deferredUntil: { type: ["string", "null"], description: "Date ISO uniquement si le report a été explicitement demandé." },
      },
      required: ["executionItemId", "status", "progress", "remainingDurationMinutes", "deferredUntil"],
      additionalProperties: false,
    },
    strict: true,
  },
  permissions: {
    level: "write", explicitOrderRequired: true, confirmationRequired: false,
    destructive: false, networkAccess: false,
  },
  async execute(args, context) {
    return context.handlers.updateExecutionStatus(args);
  },
};
