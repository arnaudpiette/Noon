"use strict";

// V3-L7 — routes système, sorties de server.js : santé, diagnostics, reprise de session,
// Control Center, capacités runtime, extensions et contexte ambiant.
// Bloc déplacé tel quel depuis server.js ; ses dépendances sont lues à chaque requête
// (accesseurs), ce qui préserve les variables initialisées plus tard au démarrage.

const { NOT_HANDLED } = require("../http/route-result");

const DEPENDENCIES = Object.freeze(["DEFAULT_HOST","WEB_SEARCH_DAILY_LIMIT","ambientContextEngine","contextBuilder","controlCenterService","devMissionHttpRoutes","extensionRegistry","findCodexExecutable","getBudgetStatus","getVoiceBudgetStatus","localIntelligenceRuntime","mcpService","noonHealthReport","noonObservability","normalizeNoonMode","normalizeSessionId","readJsonBody","recorderService","refreshDailyWebSearchUsage","reliabilityEngine","remoteLanHttpRoutes","selfDevHttpRoutes","sessionContinuityEngine"]);

function createSystemHttpRoutes(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  return async function handle(req, res, requestPath) {
    const {
      DEFAULT_HOST,
      WEB_SEARCH_DAILY_LIMIT,
      ambientContextEngine,
      contextBuilder,
      controlCenterService,
      devMissionHttpRoutes,
      extensionRegistry,
      findCodexExecutable,
      getBudgetStatus,
      getVoiceBudgetStatus,
      localIntelligenceRuntime,
      mcpService,
      recorderService,
      noonHealthReport,
      noonObservability,
      normalizeNoonMode,
      normalizeSessionId,
      readJsonBody,
      refreshDailyWebSearchUsage,
      reliabilityEngine,
      remoteLanHttpRoutes,
      selfDevHttpRoutes,
      sessionContinuityEngine,
    } = deps;

    if (requestPath === "/api/noon-health" && req.method === "GET") {
      const healthUrl = new URL(req.url, `http://${req.headers.host || DEFAULT_HOST}`);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", health: noonHealthReport.report({ days: Number(healthUrl.searchParams.get("days")) || 7 }) }));
    }

    if (requestPath === "/api/diagnostics/metrics" && req.method === "GET") {
      const diagnosticsUrl = new URL(req.url, `http://${req.headers.host || DEFAULT_HOST}`);
      const requestedExecutionId = diagnosticsUrl.searchParams.get("executionId");
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      return res.end(JSON.stringify({
        status: "ok",
        diagnostics: noonObservability.summary({ sinceMs: 30 * 24 * 60 * 60 * 1000 }),
        trace: requestedExecutionId ? noonObservability.getTrace(requestedExecutionId) : undefined,
      }));
    }

    if (req.url === "/api/diagnostics/voice" && req.method === "POST") {
      try {
        const body = await readJsonBody(req, 16 * 1024);
        const executionId = String(body.executionId || "");
        if (!noonObservability.getTrace(executionId)) {
          noonObservability.startExecution({
            executionId,
            channel: body.channel === "live_voice" ? "live_voice" : "voice",
            intent: "voice",
          });
        }
        noonObservability.recordVoice(executionId, body.metrics || {});
        if (body.completed === true) {
          const duration = Number(body.metrics?.sessionTotalMs) || 0;
          noonObservability.completeExecution(executionId, {
            status: "completed", wallClockTotalMs: duration, technicalExecutionMs: duration,
          });
        }
        res.writeHead(204, { "Cache-Control": "no-store" });
        return res.end();
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "error", message: "Métriques audio invalides." }));
      }
    }

    if (req.method === "GET" && req.url.startsWith("/sessions/diagnostics")) {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const requestedSessionId = String(url.searchParams.get("sessionId") || "").trim();
        const diagnostics = sessionContinuityEngine.diagnostics(requestedSessionId || null);
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        return res.end(JSON.stringify({
          status: "ok",
          count: diagnostics.length,
          sessions: diagnostics,
        }));
      } catch (error) {
        res.writeHead(error.code === "SESSION_NOT_FOUND" ? 404 : 400, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (
      req.method === "POST" &&
      ["/sessions/resume", "/sessions/suspend"].includes(req.url)
    ) {
      try {
        if (req.headers["x-noon-request"] !== "1") {
          const error = new Error("Requête Noon refusée.");
          error.statusCode = 403;
          throw error;
        }
        const body = await readJsonBody(req, 16 * 1024);
        const explicitSessionId = String(body.sessionId || "").trim();
        let session = explicitSessionId
          ? sessionContinuityEngine.getSession(explicitSessionId)
          : sessionContinuityEngine.getActiveSession({
              conversationId: normalizeSessionId(body.conversationId),
              profileScope: "arnaud",
            });
        if (!session && body.conversationId) {
          session = sessionContinuityEngine.resolveSession({
            conversationId: normalizeSessionId(body.conversationId),
            workspaceId: body.workspaceId || null,
            projectId: body.projectId || null,
            mode: normalizeNoonMode(body.mode),
            channel: body.channel === "voice" ? "voice" : "chat",
            profileScope: "arnaud",
          });
        }
        if (!session) {
          const error = new Error("Session introuvable.");
          error.statusCode = 404;
          throw error;
        }
        const result = req.url === "/sessions/resume"
          ? sessionContinuityEngine.restoreContext(session.id, {
              query: String(body.query || "").slice(0, 1000),
              includeOldHistory: body.includeOldHistory === true,
            })
          : sessionContinuityEngine.suspendSession(session.id, String(body.reason || "conversation_left").slice(0, 80));
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        return res.end(JSON.stringify({ status: "ok", session: result }));
      } catch (error) {
        res.writeHead(error.statusCode || (error.code === "SESSION_NOT_FOUND" ? 404 : 400), {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (req.method === "GET" && req.url.startsWith("/api/control-center/overview")) {
      try {
        const url = new URL(req.url, `http://${req.headers.host || DEFAULT_HOST}`);
        const snapshot = await controlCenterService.getOverview({ view: url.searchParams.get("view") || "USER", force: url.searchParams.get("refresh") === "1" });
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "ok", snapshot }));
      } catch (error) {
        res.writeHead(error.code === "CONTROL_CENTER_DISABLED" ? 404 : 400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "error", code: error.code || "CONTROL_OVERVIEW_FAILED", message: "Le Control Center est temporairement indisponible." }));
      }
    }

    if (req.method === "GET" && req.url.startsWith("/api/control-center/sections/")) {
      try {
        const url = new URL(req.url, `http://${req.headers.host || DEFAULT_HOST}`);
        const sectionId = decodeURIComponent(url.pathname.slice("/api/control-center/sections/".length));
        const sectionModel = await controlCenterService.getSection(sectionId, { view: url.searchParams.get("view") || "USER", force: url.searchParams.get("refresh") === "1" });
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "ok", section: sectionModel }));
      } catch (error) {
        res.writeHead(error.code === "CONTROL_SECTION_UNKNOWN" ? 404 : 400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "error", code: error.code || "CONTROL_SECTION_FAILED", message: "Cette section est temporairement indisponible." }));
      }
    }

    if (req.method === "POST" && req.url === "/api/control-center/actions") {
      try {
        if (req.headers["x-noon-request"] !== "1") throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403, code: "CONTROL_TRUSTED_UI_REQUIRED" });
        const body = await readJsonBody(req, 16 * 1024);
        const result = await controlCenterService.requestAction(body, { actor: "owner", origin: "trusted_ui" });
        res.writeHead(result.status === "PENDING_APPROVAL" ? 202 : 200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "ok", action: result }));
      } catch (error) {
        res.writeHead(error.statusCode || (error.code === "CONTROL_ACTION_UNKNOWN" ? 404 : 400), { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "error", code: error.code || "CONTROL_ACTION_FAILED", message: "L’action n’a pas été exécutée." }));
      }
    }

    if (req.method === "GET" && req.url === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", diagnostic: reliabilityEngine.report() }));
    }

    if (req.method === "GET" && req.url.startsWith("/api/health/")) {
      try {
        const componentId = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname.slice("/api/health/".length));
        const snapshot = await reliabilityEngine.check(componentId);
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "ok", component: snapshot, explanation: reliabilityEngine.explain([componentId]) }));
      } catch (error) {
        res.writeHead(error.code === "COMPONENT_UNKNOWN" ? 404 : 400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "error", message: "Diagnostic indisponible pour ce composant." }));
      }
    }

    if (req.method === "POST" && req.url === "/api/health/diagnose") {
      try {
        if (req.headers["x-noon-request"] !== "1") throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403 });
        const body = await readJsonBody(req, 4 * 1024);
        const diagnostic = await reliabilityEngine.diagnose({ deep: body.deep === true });
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "ok", diagnostic, explanation: reliabilityEngine.explain() }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (req.method === "POST" && req.url.startsWith("/api/health/") && req.url.endsWith("/repair")) {
      try {
        if (req.headers["x-noon-request"] !== "1") throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403 });
        const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
        const componentId = decodeURIComponent(pathname.slice("/api/health/".length, -"/repair".length));
        const result = await reliabilityEngine.selfHeal(componentId);
        res.writeHead(result.repaired ? 200 : 409, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: result.repaired ? "ok" : "refused", componentId, ...result }));
      } catch (error) {
        res.writeHead(error.statusCode || (error.code === "COMPONENT_UNKNOWN" ? 404 : 400), { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "error", message: "Réparation sûre indisponible pour ce composant." }));
      }
    }

    if (req.method === "GET" && req.url.startsWith("/api/runtime/capabilities")) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const snapshot = localIntelligenceRuntime.snapshot({
        internetAvailable: url.searchParams.get("internet") !== "offline",
        providerAvailable: url.searchParams.get("provider") !== "unavailable",
        lanAvailable: url.searchParams.get("lan") === "available" ? true : undefined,
      });
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", runtime: snapshot }));
    }

    if (req.method === "POST" && req.url === "/api/runtime/mode") {
      try {
        if (req.headers["x-noon-request"] !== "1") throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403 });
        const body = await readJsonBody(req, 10 * 1024);
        const runtime = localIntelligenceRuntime.setPreference(body.preference, { origin: "user" });
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "ok", runtime }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (devMissionHttpRoutes.matches(requestPath)) {
      return devMissionHttpRoutes.handle(req, res, { requestPath, readJsonBody });
    }
    if (remoteLanHttpRoutes.matches(requestPath)) {
      return remoteLanHttpRoutes.handle(req, res, { requestPath, readJsonBody });
    }

    if (selfDevHttpRoutes.matches(requestPath)) {
      return selfDevHttpRoutes.handle(req, res, { requestPath, readJsonBody });
    }

    if (mcpService.matches(requestPath)) {
      return mcpService.handle(req, res, { requestPath, readJsonBody });
    }

    if (recorderService.matches(requestPath)) {
      return recorderService.handle(req, res, { requestPath, readJsonBody });
    }

    if (req.method === "GET" && req.url === "/api/extensions") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", isolation: "IN_PROCESS_TRUSTED", extensions: extensionRegistry.list() }));
    }

    if (req.method === "POST" && /^\/api\/extensions\/[^/]+\/(enable|disable|health)$/.test(req.url)) {
      try {
        if (req.headers["x-noon-request"] !== "1") throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403 });
        const [, , , encodedId, action] = new URL(req.url, `http://${req.headers.host}`).pathname.split("/");
        const extensionId = decodeURIComponent(encodedId);
        const extension = action === "enable" ? await extensionRegistry.enable(extensionId)
          : action === "disable" ? await extensionRegistry.disable(extensionId)
            : { ...extensionRegistry.get(extensionId), health: await extensionRegistry.checkHealth(extensionId) };
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "ok", extension }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "error", code: error.code || "EXTENSION_ACTION_FAILED", message: error.message }));
      }
    }

    if (req.url === "/health" && req.method === "GET") {
      const budget = getBudgetStatus();
      const currentWebUsage = refreshDailyWebSearchUsage();

      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });

      return res.end(
        JSON.stringify({
          status: "ok",
          service: "Noon",
          budgetMode: budget.mode,
          codex: {
            available: Boolean(findCodexExecutable()),
            mode: "read-only",
          },
          webSearchUsage: {
            used: currentWebUsage.calls,
            limit: WEB_SEARCH_DAILY_LIMIT,
            remaining:
              WEB_SEARCH_DAILY_LIMIT - currentWebUsage.calls,
          },
          voiceBudget: getVoiceBudgetStatus(),
          observability: noonObservability.healthSummary(),
          contextCache: contextBuilder.cacheStats(),
          reliability: reliabilityEngine.report(),
          timestamp: new Date().toISOString(),
        })
      );
    }

    // Contrats locaux du contexte ambiant. Ils n'activent aucune collecte : seul
    // un POST explicite avec l'en-tête interne peut démarrer une session.
    if (req.method === "GET" && req.url === "/api/context/ambient") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", context: ambientContextEngine.currentView() }));
    }

    if (req.method === "POST" && req.url.startsWith("/api/context/ambient/")) {
      try {
        if (req.headers["x-noon-request"] !== "1") {
          const error = new Error("Requête Noon refusée."); error.statusCode = 403; throw error;
        }
        const body = await readJsonBody(req, 64 * 1024);
        const action = req.url.slice("/api/context/ambient/".length);
        let result;
        if (action === "start") result = ambientContextEngine.start({ requestedMode: body.mode || "EXPLICIT_SHARE", durationMs: body.durationMs, userExplicit: body.userExplicit === true });
        else if (action === "stop") result = ambientContextEngine.stop("user_stop");
        else if (action === "signal") result = ambientContextEngine.receive(body.signal || {});
        else { const error = new Error("Action de contexte inconnue."); error.statusCode = 404; throw error; }
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "ok", result, context: ambientContextEngine.currentView() }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", code: error.code || null, message: error.message }));
      }
    }

    return NOT_HANDLED;
  };
}

module.exports = { DEPENDENCIES, createSystemHttpRoutes };
