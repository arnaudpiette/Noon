"use strict";

// V3-L7 — routes HTTP des espaces de travail (création, contexte, liste) et de l’analyse
// d’intention (/intents/parse).
// Bloc déplacé tel quel depuis server.js ; ses dépendances sont lues à chaque requête
// (accesseurs), ce qui préserve les variables initialisées plus tard au démarrage.

const { NOT_HANDLED } = require("../http/route-result");

const DEPENDENCIES = Object.freeze(["PRIORITY_DIRECTORIES","buildIntentContext","getAllowedDirectories","intentCommandEngine","listDirectory","normalizeSessionId","readJsonBody","sessionContinuityEngine","workspaceEngine"]);

function createWorkspaceHttpRoutes(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  return async function handle(req, res, requestPath) {
    const {
      PRIORITY_DIRECTORIES,
      buildIntentContext,
      getAllowedDirectories,
      intentCommandEngine,
      listDirectory,
      normalizeSessionId,
      readJsonBody,
      sessionContinuityEngine,
      workspaceEngine,
    } = deps;

      if (req.url === "/workspaces" && req.method === "POST") {
        try {
          const body = await readJsonBody(req, 64 * 1024);
          const workspace = workspaceEngine.create(body);
          for (const projectId of Array.isArray(body.projectIds) ? body.projectIds : []) workspaceEngine.linkProject(workspace.id, String(projectId));
          for (const root of Array.isArray(body.roots) ? body.roots : []) workspaceEngine.bindRoot(workspace.id, root.path, root.mode);
          res.writeHead(201, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          return res.end(JSON.stringify({ status: "ok", workspace: workspaceEngine.context(workspace.id) }));
        } catch (error) {
          res.writeHead(error.code === "WORKSPACE_NOT_FOUND" ? 404 : 400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ status: "error", code: error.code, message: error.message }));
        }
      }

      if (req.url === "/intents/parse" && req.method === "POST") {
        try {
          const body = await readJsonBody(req, 128 * 1024);
          const channel = ["chat", "voice", "shortcut", "ui", "system", "proactive", "brief"].includes(body.channel) ? body.channel : "chat";
          const conversationId = normalizeSessionId(body.conversationId || body.sessionId);
          const workspaceId = typeof body.workspaceId === "string" && body.workspaceId ? body.workspaceId : null;
          if (workspaceId) workspaceEngine.get(workspaceId);
          const continuitySession = sessionContinuityEngine.resolveSession({
            conversationId, workspaceId, channel,
            mode: body.uiAction?.mode || body.input?.mode || null,
            profileScope: body.profileScope || "arnaud",
          });
          const intent = await intentCommandEngine.parse(channel, {
            ...(body.input && typeof body.input === "object" ? body.input : {}),
            text: body.text,
            transcript: body.transcript,
            uiAction: body.uiAction,
            shortcutPayload: body.shortcutPayload,
            sessionId: continuitySession.id,
            conversationId,
            workspaceId,
            locale: body.locale || "fr-FR",
            originTrust: body.originTrust,
          }, buildIntentContext({ sessionId: continuitySession.id, conversationId, workspaceId, ttsActive: body.ttsActive === true, activeExecutionId: body.activeExecutionId || null }));
          sessionContinuityEngine.applyIntent(continuitySession.id, intent);
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          return res.end(JSON.stringify({ status: "ok", parseOnly: true, sessionId: continuitySession.id, conversationId, intent }));
        } catch (error) {
          res.writeHead(error.code === "INTENT_UNTRUSTED_ORIGIN" ? 403 : 400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          return res.end(JSON.stringify({ status: "error", code: error.code || "INTENT_FAILED", message: error.message }));
        }
      }

      const workspaceRoute = req.url.match(/^\/workspaces\/([^/?]+)(?:\/(activate|archive|conversations|artifacts))?$/);
      if (workspaceRoute) {
        try {
          const workspaceId = decodeURIComponent(workspaceRoute[1]);
          const action = workspaceRoute[2] || null;
          let result;
          if (req.method === "GET" && !action) result = workspaceEngine.context(workspaceId);
          else if (req.method === "PATCH" && !action) result = workspaceEngine.update(workspaceId, await readJsonBody(req, 64 * 1024));
          else if (req.method === "POST" && action === "activate") result = workspaceEngine.activate(workspaceId, await readJsonBody(req, 16 * 1024));
          else if (req.method === "POST" && action === "archive") result = workspaceEngine.archive(workspaceId);
          else if (req.method === "POST" && action === "conversations") { const body = await readJsonBody(req, 16 * 1024); workspaceEngine.moveConversation(body.conversationId, workspaceId); result = workspaceEngine.context(workspaceId); }
          else if (req.method === "POST" && action === "artifacts") { const body = await readJsonBody(req, 16 * 1024); workspaceEngine.linkArtifact(workspaceId, body.artifactId, body.projectId); result = workspaceEngine.context(workspaceId); }
          else { res.writeHead(405, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "error", message: "Opération Workspace non autorisée." })); }
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          return res.end(JSON.stringify({ status: "ok", workspace: result }));
        } catch (error) {
          res.writeHead(error.code === "WORKSPACE_NOT_FOUND" ? 404 : 400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ status: "error", code: error.code, message: error.message }));
        }
      }

      if (req.url === "/workspaces" && req.method === "GET") {
        // Liste les espaces autorisés et leur contenu de premier niveau.
        try {
          const allowedLocations = getAllowedDirectories().map((dirPath) => ({
            path: dirPath,
            priority: PRIORITY_DIRECTORIES.some((priorityPath) =>
              priorityPath.startsWith(dirPath)
            ),
            contents: listDirectory(dirPath),
          }));

          res.writeHead(200);
          return res.end(
            JSON.stringify(
              {
                status: "ok",
                mode: "read-only",
                workspaces: workspaceEngine.list().map((workspace) => ({
                  ...workspace,
                  context: workspaceEngine.context(workspace.id),
                })),
                allowedLocations,
              },
              null,
              2
            )
          );
        } catch (error) {
          res.writeHead(500);
          return res.end(
            JSON.stringify(
              {
                status: "error",
                message: error.message,
              },
              null,
              2
            )
          );
        }
      }

    return NOT_HANDLED;
  };
}

module.exports = { DEPENDENCIES, createWorkspaceHttpRoutes };
