"use strict";

/*
 * Préférences explicitement demandées par l'utilisateur.
 *
 * Ce profil complète la mémoire personnelle :
 * il définit les conventions opérationnelles stables du dialogue,
 * sans contenir de donnée sensible et sans affaiblir la sécurité.
 */

const ARNAUD_CONVERSATION_PROFILE = Object.freeze({
  response: Object.freeze({
    summaryFirst: true,
    direct: true,
    actionable: true,
    avoidUnnecessaryClarifications: true,
  }),

  continuity: Object.freeze({
    shortCueContinuesCurrentContext: true,
    doNotAskUserToRepeatKnownContext: true,
  }),

  development: Object.freeze({
    largeTerminalBlocks: true,
    minimizeRoundTrips: true,
    stopCommandsOnFailure: true,
    preserveExistingWorktree: true,
    pushRequiresExplicitRequest: true,
    destructiveGitRequiresExplicitRequest: true,
  }),

  modelGuidance: Object.freeze({
    routineImplementation: "Terra",
    architectureAndHardReasoning: "Sol",
  }),
});

function renderConversationStyleInstruction({
  mode = null,
} = {}) {
  const instructions = [
    "Préférences de collaboration explicitement confirmées : commence par une synthèse claire puis détaille seulement ce qui est utile.",
    "Réponds directement et de façon actionnable ; n'oblige pas l'utilisateur à répéter un contexte déjà disponible.",
    "Une relance conversationnelle courte classée CONTINUE signifie poursuivre le contexte actif et enchaîner sur la prochaine étape logique.",
    "Une demande de pause conversationnelle signifie suspendre l'échange ; elle n'annule aucune exécution technique.",
  ];

  if (
    String(mode || "").toUpperCase() === "DEV" ||
    String(mode || "").toUpperCase() === "CODE"
  ) {
    instructions.push(
      "En DEV, regroupe autant que possible les commandes terminal sûres dans de gros blocs cohérents afin de limiter les allers-retours.",
      "Les blocs terminal doivent s'arrêter sur erreur et préserver les modifications locales existantes.",
      "Ne fais jamais de push Git sans demande explicite de l'utilisateur.",
      "N'utilise pas d'opération Git destructive sans demande ou validation explicite.",
      "Pour le choix de modèle DEV : Terra convient à l'implémentation courante, aux tests, bugs et refactors locaux ; Sol est préféré pour les décisions d'architecture et les problèmes de raisonnement difficiles.",
    );
  }

  return instructions.join(" ");
}

module.exports = {
  ARNAUD_CONVERSATION_PROFILE,
  renderConversationStyleInstruction,
};
