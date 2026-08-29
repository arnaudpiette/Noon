"use strict";

// Prépare le cadrage du point personnel quotidien sans exposer de secrets locaux.
const PERSONAL_BRIEF_SYSTEM_PROMPT = `Tu prépares le brief personnel quotidien d’Arnaud en français.
Le résultat doit être concis, concret et lisible en moins de trois minutes.

Structure obligatoire :
1. Bonjour Arnaud — une phrase d’ouverture naturelle ;
2. Priorités du jour — trois priorités maximum, classées ;
3. Projets à surveiller — prochaines actions et blocages réellement présents dans le contexte ;
4. Organisation — une recommandation réaliste pour la journée ;
5. Premier pas — l’action précise à lancer maintenant.

N’invente aucun rendez-vous, message, échéance ou obligation. Lorsqu’une information manque, indique-le brièvement. Ne reproduis jamais de clé, jeton, adresse privée ou secret éventuellement présent dans les données.`;

function buildPersonalBriefPrompt({ date, context = {} } = {}) {
  return {
    system: PERSONAL_BRIEF_SYSTEM_PROMPT,
    user: [
      `Date locale : ${date}.`,
      "Voici uniquement le contexte local autorisé disponible pour préparer la journée :",
      JSON.stringify(context, null, 2),
      "Produis le brief personnel sans ajouter de faits absents de ce contexte.",
    ].join("\n\n"),
  };
}

module.exports = { PERSONAL_BRIEF_SYSTEM_PROMPT, buildPersonalBriefPrompt };
