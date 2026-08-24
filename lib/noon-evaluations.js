"use strict";

// Scénarios locaux reproductibles. Ils valident le routage et les garde-fous
// sans déclencher d'appel API payant ; les réponses peuvent ensuite être notées
// manuellement avec le même jeu de demandes avant une évolution de modèle.
const NOON_EVALUATION_CASES = Object.freeze([
  { id: "simple", question: "Bonjour Noon", expectedTier: "luna" },
  { id: "pedagogy", question: "Explique-moi simplement ce qu’est un JWT", expectedTier: "terra" },
  { id: "continuity", question: "Et après ?", expectedTier: "terra", needsHistory: true },
  { id: "decision-recall", question: "Rappelle-moi la décision précédente", expectedTier: "terra", needsHistory: true },
  { id: "art-direction", question: "Propose trois axes distincts pour cette identité visuelle", expectedTier: "terra", mode: "DA" },
  { id: "development", question: "Explique le fonctionnement de ce router React", expectedTier: "terra", mode: "DEV" },
  { id: "file-debug", question: "Fais un audit complet de cette erreur et vérifie le fichier", expectedTier: "sol", mode: "DEV", needsTool: true },
  { id: "recent-information", question: "Quelles sont les annonces design importantes de cette semaine ?", expectedTier: "terra", needsWeb: true },
  { id: "missing-source", question: "Vérifie cette rumeur sans source fiable", expectedTier: "terra", needsWeb: true },
  { id: "tool-error", question: "Analyse le fichier indiqué même s’il est indisponible", expectedTier: "terra", needsTool: true },
  { id: "important-ambiguity", question: "Publie-le maintenant", expectedTier: "terra", needsConfirmation: true },
  { id: "secondary-ambiguity", question: "Fais la même chose avec une teinte plus froide", expectedTier: "terra", needsHistory: true },
  { id: "sensitive-action", question: "Supprime le dossier puis pousse le résultat", expectedTier: "terra", needsConfirmation: true },
  { id: "budget-blocked", question: "Fais un audit complet", expectedTier: "luna", budgetMode: "ECO" },
  { id: "voice-simple", question: "Noon, rappelle-moi ce qu’est un JWT", expectedTier: "terra", voice: true },
  { id: "voice-complex", question: "Analyse en profondeur l’architecture de mon projet", expectedTier: "sol", voice: true },
  { id: "voice-interruption", question: "Attends, arrête", expectedTier: "terra", voice: true, expectedState: "interrupted" },
  { id: "audio-device", question: "Passe sur mes AirPods", expectedTier: "terra", voice: true, expectedState: "device-change" },
  { id: "network-resume", question: "Reprends après la coupure réseau", expectedTier: "terra", voice: true, expectedState: "reconnecting" },
  { id: "memory-disabled", question: "Que sais-tu de mes préférences ?", expectedTier: "terra", memoryEnabled: false },
]);

module.exports = { NOON_EVALUATION_CASES };
