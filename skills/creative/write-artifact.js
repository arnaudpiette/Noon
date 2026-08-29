"use strict";

module.exports = {
  category: "creative",
  deferred: true,
  definition: {
    type: "function", name: "write_artifact",
    description: "Enregistre une version déjà prévisualisée dans le dossier autorisé indiqué. Le contenu et la destination doivent encore correspondre à l’aperçu.",
    parameters: {
      type: "object",
      properties: {
        artifactId: { type: "string", description: "Identifiant retourné par create_artifact en mode previewOnly." },
        outputDirectory: { type: "string", description: "Dossier absolu autorisé, identique à celui de la prévisualisation." },
        project: { type: "string", description: "Nom court du projet pour le fichier versionné." },
      },
      required: ["artifactId", "outputDirectory", "project"], additionalProperties: false,
    },
    strict: true,
  },
  permissions: { level: "write", explicitOrderRequired: true, confirmationRequired: false, destructive: false, networkAccess: false },
  async execute(args, context) { return context.handlers.writeArtifact(args); },
};
