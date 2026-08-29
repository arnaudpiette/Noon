"use strict";

module.exports = {
  category: "files",
  deferred: false,
  definition: {
    type: "function", name: "browse_directory",
    description: "Liste le contenu d'un dossier autorisé sur le Mac afin de comprendre la structure d'un projet.",
    parameters: { type: "object", properties: { path: { type: "string", description: "Chemin absolu du dossier à explorer." } }, required: ["path"], additionalProperties: false },
    strict: true,
  },
  permissions: { level: "read", explicitOrderRequired: false, confirmationRequired: false, destructive: false, networkAccess: false },
  async execute(args, context) { return context.handlers.browseDirectory(args.path); },
};
