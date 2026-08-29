"use strict";

module.exports = {
  category: "gmail",
  deferred: true,
  definition: {
    type: "function", name: "search_gmail",
    description: "Recherche en lecture seule dans les e-mails lorsque la demande concerne explicitement les mails de l'utilisateur.",
    parameters: { type: "object", properties: { query: { type: "string", description: "Requête de recherche Gmail." }, maxResults: { type: "integer", minimum: 1, maximum: 10, description: "Nombre maximal de messages à lire." } }, required: ["query", "maxResults"], additionalProperties: false },
    strict: true,
  },
  permissions: { level: "read", explicitOrderRequired: false, confirmationRequired: false, destructive: false, networkAccess: true },
  async execute(args, context) { return context.handlers.searchGmail(args.query, args.maxResults); },
};
