"use strict";

module.exports = {
  category: "files",
  deferred: false,
  definition: {
    type: "function", name: "read_file",
    description: "Lit le contenu d'un fichier texte autorisé sur le Mac. À utiliser uniquement pour les fichiers retournés par les outils de recherche ou de navigation.",
    parameters: { type: "object", properties: { path: { type: "string", description: "Chemin absolu du fichier à lire." } }, required: ["path"], additionalProperties: false },
    strict: true,
  },
  permissions: { level: "read", explicitOrderRequired: false, confirmationRequired: false, destructive: false, networkAccess: false },
  async execute(args, context) { return context.handlers.readFile(args.path); },
};
