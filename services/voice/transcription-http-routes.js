"use strict";

// V3-L7 — route de transcription audio (/transcribe), sortie de server.js.
// Bloc déplacé tel quel depuis server.js ; ses dépendances sont lues à chaque requête
// (accesseurs), ce qui préserve les variables initialisées plus tard au démarrage.

const { NOT_HANDLED } = require("../http/route-result");

const DEPENDENCIES = Object.freeze(["MAX_AUDIO_BYTES","assertRemoteVoiceAvailable","getBudgetStatus","localIntelligenceRuntime","trackTranscriptionUsage","transcribeAudioBuffer"]);

function createTranscriptionHttpRoutes(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  return async function handle(req, res, requestPath) {
    const {
      MAX_AUDIO_BYTES,
      assertRemoteVoiceAvailable,
      getBudgetStatus,
      localIntelligenceRuntime,
      trackTranscriptionUsage,
      transcribeAudioBuffer,
    } = deps;

    if (
      req.method === "POST" &&
      req.url === "/transcribe"
    ) {
      const transcriptionStartedAt = Date.now();
      const budget = getBudgetStatus();

      try {
        assertRemoteVoiceAvailable(localIntelligenceRuntime, "REMOTE_TRANSCRIPTION");
      } catch (error) {
        res.writeHead(error.statusCode || 409, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", code: error.code, message: error.message }));
      }

      if (budget.mode === "BLOCKED") {
        res.writeHead(403);

        return res.end(
          JSON.stringify({
            status: "error",
            message:
              "Budget mensuel Noon atteint.",
          })
        );
      }

      const chunks = [];
      let totalBytes = 0;
      let audioTooLarge = false;

      req.on("data", (chunk) => {
        if (audioTooLarge) return;

        totalBytes += chunk.length;

        if (totalBytes > MAX_AUDIO_BYTES) {
          audioTooLarge = true;
          chunks.length = 0;
          return;
        }

        chunks.push(chunk);
      });

      req.on("end", async () => {
        if (audioTooLarge) {
          res.writeHead(413);

          return res.end(
            JSON.stringify({
              status: "error",
              message: "Enregistrement trop volumineux.",
            })
          );
        }

        if (chunks.length === 0) {
          res.writeHead(400);

          return res.end(
            JSON.stringify({
              status: "error",
              message: "Aucun son reçu.",
            })
          );
        }

        try {
          const audioBuffer = Buffer.concat(chunks);

          const text = await transcribeAudioBuffer(
            audioBuffer,
            req.headers["content-type"]
          );

          if (!text) {
            res.writeHead(422);

            return res.end(
              JSON.stringify({
                status: "error",
                message:
                  "Aucune parole n'a été reconnue.",
              })
            );
          }

          trackTranscriptionUsage(
            req.headers["x-audio-duration-ms"]
          );

          res.writeHead(200, {
            "Content-Type": "application/json",
            "X-Transcription-Ms": String(Date.now() - transcriptionStartedAt),
          });

          return res.end(
            JSON.stringify({
              status: "ok",
              text,
            })
          );
        } catch (error) {
          console.error(
            "Erreur de transcription :",
            error.message
          );

          res.writeHead(500);

          return res.end(
            JSON.stringify({
              status: "error",
              message:
                "Impossible de transcrire la voix.",
            })
          );
        }
      });

      return;
    }

    return NOT_HANDLED;
  };
}

module.exports = { DEPENDENCIES, createTranscriptionHttpRoutes };
