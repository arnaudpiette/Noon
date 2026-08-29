"use strict";

module.exports = {
  category: "personal-intelligence",
  deferred: true,
  definition: {
    type: "function",
    name: "list_execution_items",
    description: "Liste les actions locales suivies afin d’identifier sans ambiguïté celle dont l’utilisateur parle. Ne modifie rien.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: ["string", "null"],
          enum: ["planned", "in_progress", "completed", "missed", "delayed", "blocked", "cancelled", "deferred", "unknown", null],
        },
      },
      required: ["status"],
      additionalProperties: false,
    },
    strict: true,
  },
  permissions: {
    level: "read", explicitOrderRequired: false, confirmationRequired: false,
    destructive: false, networkAccess: false,
  },
  async execute(args, context) {
    return context.handlers.listExecutionItems(args.status);
  },
};
