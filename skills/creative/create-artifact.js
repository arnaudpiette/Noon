"use strict";

module.exports = {
  category: "creative",
  deferred: true,
  definition: {
    type: "function", name: "create_artifact",
    description: "Prépare et prévisualise, ou crée sur ordre explicite, un livrable déterministe vérifié sans jamais écraser silencieusement un fichier existant.",
    parameters: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["docx", "pdf", "png", "xlsx", "pptx", "md", "html", "rtf", "txt", "json", "csv"] },
        title: { type: "string", description: "Titre du livrable et base de son nom." },
        content: { type: "string", description: "Contenu complet du livrable." },
        outputDirectory: { type: "string", description: "Chemin absolu d’un dossier autorisé en lecture et création." },
        project: { type: "string", description: "Nom court du projet utilisé dans le nom versionné." },
        previewOnly: { type: "boolean", description: "Si vrai, prépare uniquement un aperçu temporaire sans écrire dans le dossier utilisateur." },
      },
      required: ["format", "title", "content", "outputDirectory", "project", "previewOnly"], additionalProperties: false,
    },
    strict: true,
  },
  permissions: { level: "write", explicitOrderRequired: true, confirmationRequired: false, destructive: false, networkAccess: false },
  async execute(args, context) { return context.handlers.createArtifact(args); },
};
