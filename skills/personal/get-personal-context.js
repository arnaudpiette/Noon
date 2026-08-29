"use strict";
module.exports = {
  category: "personal-intelligence", deferred: true,
  definition: { type: "function", name: "get_personal_context", description: "Consulte uniquement les faits confirmés et utilisables du portrait personnel local de l’utilisateur.", parameters: { type: "object", properties: { query: { type: "string", description: "Sujet précis à rechercher dans la mémoire structurée." } }, required: ["query"], additionalProperties: false }, strict: true },
  permissions: { level: "read", explicitOrderRequired: false, confirmationRequired: false, destructive: false, networkAccess: false },
  async execute(args, context) { return context.handlers.getPersonalContext(args.query); },
};
