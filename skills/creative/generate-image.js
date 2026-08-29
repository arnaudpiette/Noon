"use strict";

module.exports = {
  category: "creative",
  deferred: true,
  definition: {
    type: "function", name: "generate_creative_image",
    description: "Génère avec GPT Image 2 un aperçu PNG temporaire visible dans la conversation, sans l’enregistrer automatiquement dans les dossiers de l’utilisateur.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Brief visuel complet et autonome." }, title: { type: "string", description: "Titre court du fichier PNG." },
        project: { type: "string", description: "Nom court du projet." }, quality: { type: "string", enum: ["low", "medium", "high"] },
        size: { type: "string", enum: ["1024x1024", "1536x1024", "1024x1536"] },
      },
      required: ["prompt", "title", "project", "quality", "size"], additionalProperties: false,
    },
    strict: true,
  },
  permissions: { level: "external", explicitOrderRequired: true, confirmationRequired: false, destructive: false, networkAccess: true },
  async execute(args, context) { return context.handlers.generateImage(args); },
};
