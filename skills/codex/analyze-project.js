"use strict";

module.exports = {
  category: "codex",
  deferred: true,
  definition: {
    type: "function", name: "ask_codex",
    description: "Demande à Codex une analyse spécialisée et vérifiée du code du projet Focus, strictement en lecture seule.",
    parameters: { type: "object", properties: { question: { type: "string", description: "Question technique précise à analyser dans le projet Focus courant." } }, required: ["question"], additionalProperties: false },
    strict: true,
  },
  permissions: { level: "read", explicitOrderRequired: false, confirmationRequired: false, destructive: false, networkAccess: false },
  async execute(args, context) { return context.handlers.askCodex(args.question); },
};
