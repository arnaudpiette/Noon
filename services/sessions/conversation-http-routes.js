"use strict";

// V3-L7 — routes des conversations, dossiers, historique et activité de session, sorties de
// server.js.
// Bloc déplacé tel quel depuis server.js ; ses dépendances sont lues à chaque requête
// (accesseurs), ce qui préserve les variables initialisées plus tard au démarrage.

const { NOT_HANDLED } = require("../http/route-result");

const DEPENDENCIES = Object.freeze(["GENERAL_FOLDER_ID","MAX_CONVERSATIONS_PER_FOLDER","MAX_FOLDERS","clearConversationSession","conversationIndex","createConversationKey","createFolder","crypto","deleteConversation","deleteFolder","getConversationTranscript","getSessionActivity","normalizeFocusName","normalizeFocusPath","normalizeNoonMode","normalizeSessionId","readJsonBody","renameFolder","replaceConversationIndex","resolveFocusCatalogSelection","sessionActivities","sessionContinuityEngine","touchConversation","updateConversation"]);

function createConversationHttpRoutes(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  return async function handle(req, res, requestPath) {
    const {
      GENERAL_FOLDER_ID,
      MAX_CONVERSATIONS_PER_FOLDER,
      MAX_FOLDERS,
      clearConversationSession,
      createConversationKey,
      createFolder,
      crypto,
      deleteConversation,
      deleteFolder,
      getConversationTranscript,
      getSessionActivity,
      normalizeFocusName,
      normalizeFocusPath,
      normalizeNoonMode,
      normalizeSessionId,
      readJsonBody,
      renameFolder,
      replaceConversationIndex,
      resolveFocusCatalogSelection,
      sessionActivities,
      sessionContinuityEngine,
      touchConversation,
      updateConversation,
    } = deps;

    if (
      req.method === "POST" &&
      req.url.startsWith("/session/clear")
    ) {
      const url = new URL(
        req.url,
        `http://${req.headers.host}`
      );

      const sessionId = normalizeSessionId(
        url.searchParams.get("sessionId")
      );

      clearConversationSession(sessionId);

      res.writeHead(200);

      return res.end(
        JSON.stringify({
          status: "ok",
          message: "Mémoire de conversation supprimée.",
        })
      );
    }

    if (req.method === "GET" && req.url === "/conversations") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      return res.end(JSON.stringify({
        status: "ok",
        limits: { folders: MAX_FOLDERS, conversationsPerFolder: MAX_CONVERSATIONS_PER_FOLDER },
        folders: deps.conversationIndex.folders,
        conversations: deps.conversationIndex.conversations,
      }));
    }

    if (req.method === "POST" && req.url === "/conversations") {
      try {
        if (req.headers["x-noon-request"] !== "1") {
          const error = new Error("Requête Noon refusée.");
          error.statusCode = 403;
          throw error;
        }
        const body = await readJsonBody(req, 10 * 1024);
        const conversation = touchConversation(body.sessionId, body.title || "", body.folderId || GENERAL_FOLDER_ID);
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "ok", conversation }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (req.method === "DELETE" && requestPath.startsWith("/conversations/")) {
      try {
        if (req.headers["x-noon-request"] !== "1") {
          const error = new Error("Requête Noon refusée.");
          error.statusCode = 403;
          throw error;
        }
        const sessionId = decodeURIComponent(requestPath.slice("/conversations/".length));
        if (!deps.conversationIndex.conversations.some((item) => item.id === sessionId)) {
          const error = new Error("Conversation introuvable.");
          error.statusCode = 404;
          throw error;
        }
        deleteConversation(sessionId);
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "ok" }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (req.method === "POST" && req.url === "/conversation-folders") {
      try {
        if (req.headers["x-noon-request"] !== "1") throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403 });
        const body = await readJsonBody(req, 10 * 1024);
        const result = createFolder(deps.conversationIndex, { id: crypto.randomUUID(), title: body.title });
        replaceConversationIndex(result.store);
        res.writeHead(201, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "ok", folder: result.folder }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (req.method === "PATCH" && requestPath.startsWith("/conversation-folders/")) {
      try {
        if (req.headers["x-noon-request"] !== "1") throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403 });
        const id = decodeURIComponent(requestPath.slice("/conversation-folders/".length));
        const body = await readJsonBody(req, 10 * 1024);
        replaceConversationIndex(renameFolder(deps.conversationIndex, id, body.title));
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "ok" }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (req.method === "DELETE" && requestPath.startsWith("/conversation-folders/")) {
      try {
        if (req.headers["x-noon-request"] !== "1") throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403 });
        const id = decodeURIComponent(requestPath.slice("/conversation-folders/".length));
        const url = new URL(req.url, "http://127.0.0.1");
        const result = deleteFolder(deps.conversationIndex, id, { deleteConversations: url.searchParams.get("deleteConversations") === "true", destinationFolderId: url.searchParams.get("destinationFolderId") || null });
        for (const conversationId of result.deletedConversationIds) clearConversationSession(conversationId);
        replaceConversationIndex(result.store);
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "ok" }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (req.method === "PATCH" && requestPath.startsWith("/conversations/")) {
      try {
        if (req.headers["x-noon-request"] !== "1") throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403 });
        const id = decodeURIComponent(requestPath.slice("/conversations/".length));
        const body = await readJsonBody(req, 10 * 1024);
        replaceConversationIndex(updateConversation(deps.conversationIndex, id, { title: body.title, folderId: body.folderId, pinned: body.pinned }));
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "ok" }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (
      req.method === "GET" &&
      req.url.startsWith("/session/history")
    ) {
      try {
        const url = new URL(
          req.url,
          `http://${req.headers.host}`
        );

        const sessionId = normalizeSessionId(
          url.searchParams.get("sessionId")
        );

        const mode = normalizeNoonMode(
          url.searchParams.get("mode")
        );

        let focus = normalizeFocusName(
          url.searchParams.get("focus")
        );

        let focusPath = normalizeFocusPath(
          url.searchParams.get("focusPath")
        );
        const catalogSelection = resolveFocusCatalogSelection(
          url.searchParams.get("focusId"),
          url.searchParams.get("focusPath")
        );
        if (catalogSelection) {
          focus = catalogSelection.name;
          focusPath = catalogSelection.path;
        }

        const conversationKey = createConversationKey({
          sessionId,
          mode,
          focus,
          focusPath,
        });

        const history = getConversationTranscript(
          conversationKey
        );
        const continuitySession = sessionContinuityEngine.resolveSession({
          conversationId: sessionId,
          projectId: focus || null,
          mode,
          channel: "chat",
          profileScope: "arnaud",
        });
        const restoredSession = sessionContinuityEngine.restoreContext(
          continuitySession.id
        );

        res.writeHead(200);

        return res.end(
          JSON.stringify({
            status: "ok",
            sessionId: continuitySession.id,
            conversationId: sessionId,
            continuity: {
              state: sessionContinuityEngine.getSession(continuitySession.id).status,
              summaryVersion: restoredSession.summary?.version || 0,
              recentEntityCount: restoredSession.recentEntityRefs.length,
              recoveredFromCrash: restoredSession.recoveredFromCrash,
            },
            count: history.length,
            history,
          })
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

    if (
      req.method === "GET" &&
      req.url.startsWith("/session/activity")
    ) {
      const url = new URL(
        req.url,
        `http://${req.headers.host}`
      );

      const sessionId = normalizeSessionId(
        url.searchParams.get("sessionId")
      );

      res.writeHead(200);

      return res.end(
        JSON.stringify({
          status: "ok",
          activity: getSessionActivity(sessionId),
        })
      );
    }

    // Supprime la mémoire de tous les modes et Focus pour la session courante.
    if (
      req.url === "/conversation/reset" &&
      req.method === "POST"
    ) {
      try {
        if (req.headers["x-noon-request"] !== "1") {
          res.writeHead(403, {
            "Content-Type": "application/json",
          });

          return res.end(
            JSON.stringify({
              status: "error",
              message: "Requête Noon refusée.",
            })
          );
        }

        const body = await readJsonBody(req, 10 * 1024);
        const sessionId = normalizeSessionId(body.sessionId);

        const continuitySession = sessionContinuityEngine.getActiveSession({
          conversationId: sessionId,
          profileScope: "arnaud",
        });
        if (continuitySession && continuitySession.status !== "closed") {
          sessionContinuityEngine.closeSession(continuitySession.id);
        }

        clearConversationSession(sessionId);
        sessionActivities.delete(sessionId);

        res.writeHead(200, {
          "Content-Type": "application/json",
        });

        return res.end(
          JSON.stringify({
            status: "ok",
            message: "Conversation réinitialisée.",
          })
        );
      } catch (error) {
        res.writeHead(error.statusCode || 500, {
          "Content-Type": "application/json",
        });

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

module.exports = { DEPENDENCIES, createConversationHttpRoutes };
