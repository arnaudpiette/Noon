"use strict";

// V3-L7 — routes HTTP de lecture des dossiers autorisés (/browse, /search, /read) et des
// commandes locales simples sans modèle (/ask).
// Bloc déplacé tel quel depuis server.js ; ses dépendances sont lues à chaque requête
// (accesseurs), ce qui préserve les variables initialisées plus tard au démarrage.

const { NOT_HANDLED } = require("../http/route-result");

const DEPENDENCIES = Object.freeze(["buildIntentContext","fs","handleLocalCommand","intentCommandEngine","isPathAllowed","listDirectory","readAllowedFile","searchFiles","toolAuditLog"]);

function createLocalFilesHttpRoutes(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  return async function handle(req, res, requestPath) {
    const {
      buildIntentContext,
      fs,
      handleLocalCommand,
      intentCommandEngine,
      isPathAllowed,
      listDirectory,
      readAllowedFile,
      searchFiles,
      toolAuditLog,
    } = deps;

    // Parcourt un dossier autorisé indiqué avec le paramètre ?path=.
    if (req.url.startsWith("/browse")) {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const requestedPath = url.searchParams.get("path");

        if (!requestedPath) {
          res.writeHead(400);
          return res.end(
            JSON.stringify({
              status: "error",
              message: "Le paramètre path est obligatoire.",
            })
          );
        }

        if (!isPathAllowed(requestedPath)) {
          res.writeHead(403);
          return res.end(
            JSON.stringify({
              status: "error",
              message: "Accès refusé : dossier non autorisé.",
            })
          );
        }

        if (!fs.existsSync(requestedPath)) {
          res.writeHead(404);
          return res.end(
            JSON.stringify({
              status: "error",
              message: "Dossier introuvable.",
            })
          );
        }

        const contents = listDirectory(requestedPath);

        res.writeHead(200);
        return res.end(
          JSON.stringify(
            {
              status: "ok",
              mode: "read-only",
              path: requestedPath,
              contents,
            },
            null,
            2
          )
        );
      } catch (error) {
        res.writeHead(500);
        return res.end(
          JSON.stringify({
            status: "error",
            message: error.message,
          })
        );
      }
    }

    // Recherche des fichiers et dossiers avec le paramètre ?q=.
    if (req.url.startsWith("/search")) {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const query = url.searchParams.get("q");

        if (!query || query.trim().length < 2) {
          res.writeHead(400);

          return res.end(
            JSON.stringify({
              status: "error",
              message: "La recherche doit contenir au moins 2 caractères.",
            })
          );
        }

        const results = searchFiles(query.trim());

        res.writeHead(200);

        return res.end(
          JSON.stringify(
            {
              status: "ok",
              mode: "read-only",
              query,
              count: results.length,
              results,
            },
            null,
            2
          )
        );
      } catch (error) {
        res.writeHead(500);

        return res.end(
          JSON.stringify({
            status: "error",
            message: error.message,
          })
        );
      }
    }

    // Lit un fichier texte autorisé indiqué avec le paramètre ?path=.
    if (req.url.startsWith("/read")) {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const filePath = url.searchParams.get("path");

        if (!filePath) {
          res.writeHead(400);

          return res.end(
            JSON.stringify({
              status: "error",
              message: "Le paramètre path est obligatoire.",
            })
          );
        }

        const file = readAllowedFile(filePath);

        res.writeHead(200);

        return res.end(
          JSON.stringify(
            {
              status: "ok",
              mode: "read-only",
              file,
            },
            null,
            2
          )
        );
      } catch (error) {
        res.writeHead(403);

        return res.end(
          JSON.stringify({
            status: "error",
            message: error.message,
          })
        );
      }
    }

    // Traite une commande locale simple sans utiliser OpenAI.
    if (req.url.startsWith("/ask")) {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const question = url.searchParams.get("q");
        

        if (!question) {
          res.writeHead(400);

          return res.end(
            JSON.stringify({
              status: "error",
              message: "La question est obligatoire.",
            })
          );
        }

        const result = handleLocalCommand(question);
        const normalizedIntent = await intentCommandEngine.parse("chat", {
          text: question,
          sessionId: "noon-local",
          conversationId: "noon-local",
          locale: "fr-FR",
        }, buildIntentContext({ sessionId: "noon-local" }));
        const legacyType = result.action === "search" ? "SEARCH" : result.action === "list_workspaces" ? "OPEN" : "ASK";
        toolAuditLog.append(
          legacyType === normalizedIntent.type ? "intent_legacy_match" : "intent_legacy_mismatch",
          { legacyType, normalizedType: normalizedIntent.type, channel: "chat" }
        );

        res.writeHead(200);

        return res.end(
          JSON.stringify(
            {
              status: "ok",
              assistant: "Noon",
              question,
              normalizedIntent,
              legacyParity: legacyType === normalizedIntent.type ? "same" : "different",
              ...result,
            },
            null,
            2
          )
        );
      } catch (error) {
        res.writeHead(500);

        return res.end(
          JSON.stringify({
            status: "error",
            message: error.message,
          })
        );
      }
    }

    return NOT_HANDLED;
  };
}

module.exports = { DEPENDENCIES, createLocalFilesHttpRoutes };
