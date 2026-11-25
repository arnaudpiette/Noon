"use strict";

// Recorder V1 (V3-L8), E.2 : transcription d'un enregistrement par OpenAI, seulement après l'accord
// explicite d'Arnaud pour cet enregistrement (le service le vérifie avant d'appeler ce module).
// whisper-1 en verbose_json : texte et passages horodatés (début/fin en secondes d'audio), qui
// serviront aux horodatages du résumé (E.3). Aucun contenu n'est journalisé.

const RECORDER_TRANSCRIPTION_MODEL = "whisper-1";
const RECORDER_TRANSCRIPTION_PRICE_PER_MINUTE = 0.006;
// Limite d'envoi de l'API audio d'OpenAI : 25 Mo par fichier ; marge de sécurité.
const MAX_TRANSCRIPTION_BYTES = 24 * 1024 * 1024;

function estimateTranscriptionCostUsd(durationMs) {
  return Math.round((Math.max(0, Number(durationMs) || 0) / 60000) * RECORDER_TRANSCRIPTION_PRICE_PER_MINUTE * 1000) / 1000;
}

function createOpenAiRecorderTranscriber({ getOpenAIClient, toFile, isRemoteAllowed, budgetBlocked, trackUsage = () => {} }) {
  if (typeof getOpenAIClient !== "function" || typeof toFile !== "function") throw new TypeError("getOpenAIClient et toFile requis.");
  return Object.freeze({
    model: RECORDER_TRANSCRIPTION_MODEL,
    isRemoteAllowed: () => { try { return isRemoteAllowed() === true; } catch { return false; } },
    budgetBlocked: () => { try { return budgetBlocked() === true; } catch { return true; } },
    async transcribe({ buffer, mimeType, durationMs }) {
      const type = String(mimeType || "audio/webm").split(";")[0];
      const file = await toFile(buffer, `noon-recording.${type.includes("mp4") ? "m4a" : "webm"}`, { type });
      const result = await getOpenAIClient().audio.transcriptions.create({
        file, model: RECORDER_TRANSCRIPTION_MODEL, response_format: "verbose_json", timestamp_granularities: ["segment"],
      });
      trackUsage(durationMs);
      return {
        model: RECORDER_TRANSCRIPTION_MODEL,
        language: String(result?.language || ""),
        text: String(result?.text || "").trim(),
        segments: (Array.isArray(result?.segments) ? result.segments : []).map((segment) => ({
          start: Math.max(0, Number(segment.start) || 0), end: Math.max(0, Number(segment.end) || 0), text: String(segment.text || "").trim(),
        })).filter((segment) => segment.text),
      };
    },
  });
}

module.exports = { MAX_TRANSCRIPTION_BYTES, RECORDER_TRANSCRIPTION_MODEL, RECORDER_TRANSCRIPTION_PRICE_PER_MINUTE, createOpenAiRecorderTranscriber, estimateTranscriptionCostUsd };
