// @ts-check
"use strict";

// Conversation Live : personnes reconnues par DÉCLARATION (« c'est Kaan »), jamais par empreinte
// vocale. Quand un enfant (Kaan, Sinan) est identifié, la session Live est restreinte côté serveur :
// aucun outil ne touche aux données d'Arnaud, et ses instructions sont remplacées par une version
// sans historique ni souvenirs. La restriction dure jusqu'à la fin de la session Live : déclarer
// ensuite « c'est Arnaud » ne la lève pas. Ce n'est pas une authentification : elle protège d'un
// accès accidentel, pas d'un enfant qui relancerait lui-même une nouvelle session.

/** @typedef {{ label: string, child: boolean, greeting: string | null }} LiveSpeaker */

/** @type {Readonly<Record<string, Readonly<LiveSpeaker>>>} */
const LIVE_SPEAKERS = Object.freeze({
  arnaud: Object.freeze({ label: "Arnaud", child: false, greeting: null }),
  alexandra: Object.freeze({
    label: "Alexandra",
    child: false,
    greeting: "Ah, salut Cleopatatra ! Qu'est-ce que je peux faire pour toi, ma divine déesse ?",
  }),
  kaan: Object.freeze({
    label: "Kaan",
    child: true,
    greeting: "Mais quelle bonne surprise ! Ton père sait que tu es sur son ordi, petit schmète ?",
  }),
  sinan: Object.freeze({
    label: "Sinan",
    child: true,
    greeting: "Mais quelle bonne surprise ! Ton père sait que tu es sur son ordi, petit schmète ?",
  }),
});

// Seuls outils encore utilisables quand un enfant parle.
const CHILD_ALLOWED_TOOLS = Object.freeze(["set_noon_speaker", "set_noon_voice_style"]);

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeLiveSpeaker(value) {
  const key = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LIVE_SPEAKERS, key) ? key : null;
}

/** Règle ajoutée aux instructions de toute session Live. */
function speakerRulesInstruction() {
  return "Si la personne qui parle dit être Alexandra, Kaan ou Sinan, appelle immédiatement set_noon_speaker "
    + "avec son prénom, puis prononce mot pour mot la phrase d'accueil (« say ») renvoyée par l'outil, sans rien y ajouter. "
    + "Ne devine jamais qui parle d'après la voix.";
}

/**
 * Instructions de remplacement quand un enfant parle : ni historique, ni souvenirs, ni outils privés.
 * @param {{ label: string, greeting: string | null, styleInstructions?: string }} speaker
 */
function childSessionInstructions({ label, greeting, styleInstructions = "" }) {
  return [
    styleInstructions,
    `Tu parles maintenant avec ${label}, un enfant d'Arnaud.`,
    greeting ? `Commence par dire mot pour mot : « ${greeting} »` : "",
    "Ne révèle jamais rien de la vie privée d'Arnaud : ni conversations précédentes, ni souvenirs, mails, agenda, fichiers, projets ou réglages. "
      + "Si on te le demande, réponds gentiment que tu ne peux pas en parler et propose autre chose.",
    "Tu peux répondre aux questions générales avec bienveillance, simplement et de façon adaptée à son âge. "
      + "N'appelle aucun outil sauf set_noon_voice_style.",
  ].filter(Boolean).join(" ");
}

/**
 * Personne déclarée par session Live. Un enfant identifié le reste jusqu'au prochain démarrage de session.
 * @param {{ maxSessions?: number }} [options]
 */
function createLiveSpeakerRegistry({ maxSessions = 200 } = {}) {
  /** @type {Map<string, string>} */
  const speakers = new Map();

  return Object.freeze({
    /** @param {string} sessionId */
    start(sessionId) { speakers.delete(sessionId); },
    /**
     * @param {string} sessionId
     * @param {unknown} speaker
     */
    declare(sessionId, speaker) {
      const key = normalizeLiveSpeaker(speaker);
      if (!key) throw Object.assign(new Error("Personne inconnue pour Conversation Live."), { statusCode: 400, code: "LIVE_SPEAKER_UNKNOWN" });
      const current = speakers.get(sessionId);
      const next = current && LIVE_SPEAKERS[current].child && !LIVE_SPEAKERS[key].child ? current : key;
      speakers.delete(sessionId);
      speakers.set(sessionId, next);
      while (speakers.size > maxSessions) speakers.delete(/** @type {string} */ (speakers.keys().next().value));
      return { speaker: next, ...LIVE_SPEAKERS[next], kept: next !== key };
    },
    /** @param {string} sessionId */
    current(sessionId) { return speakers.get(sessionId) || null; },
    /** @param {string} sessionId */
    isChildSession(sessionId) {
      const key = speakers.get(sessionId);
      return Boolean(key && LIVE_SPEAKERS[key].child);
    },
  });
}

module.exports = { CHILD_ALLOWED_TOOLS, LIVE_SPEAKERS, childSessionInstructions, createLiveSpeakerRegistry, normalizeLiveSpeaker, speakerRulesInstruction };
