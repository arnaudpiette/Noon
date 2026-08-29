"use strict";

module.exports = {
  category: "files",
  deferred: false,
  definition: {
    type: "function", name: "search_files",
    description: "Recherche des fichiers et dossiers dans les espaces de travail autorisés de l'utilisateur.",
    parameters: { type: "object", properties: { query: { type: "string", description: "Nom ou partie du nom du fichier, dossier ou projet à rechercher." } }, required: ["query"], additionalProperties: false },
    strict: true,
  },
  permissions: { level: "read", explicitOrderRequired: false, confirmationRequired: false, destructive: false, networkAccess: false },
  async execute(args, context) { return context.handlers.searchFiles(args.query); },
};
