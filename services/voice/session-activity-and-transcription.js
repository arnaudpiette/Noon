"use strict";

// V3-L7 — activité de session (état affiché pendant un travail : réflexion, outil, arrière-plan)
// et transcription audio (OpenAI, français), sorties de server.js.
// Domaine déplacé tel quel depuis server.js. Dépendances déjà déclarées quand server.js le
// construit : lues une fois ; les autres (`deps.x`) : lues à chaque usage, par accesseur.

const DEPENDENCIES = Object.freeze(["getOpenAIClient","toFile"]);

function createSessionActivityAndTranscription(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  const {
    getOpenAIClient,
    toFile,
  } = deps;

  const sessionActivities = new Map();

  function setSessionActivity(sessionId, state, text) {
    sessionActivities.set(sessionId, {
      state,
      text,
      updatedAt: new Date().toISOString(),
    });
  }

  function getSessionActivity(sessionId) {
    return (
      sessionActivities.get(sessionId) || {
        state: "idle",
        text: "En attente.",
        updatedAt: null,
      }
    );
  }

  const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

  async function transcribeAudioBuffer(
    audioBuffer,
    contentType
  ) {
    const mediaType = (
      contentType || "audio/webm"
    ).split(";")[0];

    const extension = mediaType.includes("mp4")
      ? "m4a"
      : "webm";

    const audioFile = await toFile(
      audioBuffer,
      `noon-voice.${extension}`,
      {
        type: mediaType,
      }
    );

    const transcription =
      await getOpenAIClient().audio.transcriptions.create({
        file: audioFile,
        model: "gpt-4o-mini-transcribe",
        language: "fr",
      });

    return transcription.text?.trim() || "";
  }

  return { sessionActivities, setSessionActivity, getSessionActivity, MAX_AUDIO_BYTES, transcribeAudioBuffer };
}

module.exports = { DEPENDENCIES, createSessionActivityAndTranscription };
