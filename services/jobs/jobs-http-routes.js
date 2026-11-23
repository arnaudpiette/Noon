"use strict";

// V3-L7 — routes HTTP des tâches de fond (/jobs) et des analyses en arrière-plan
// (/background-analyses).
// Bloc déplacé tel quel depuis server.js ; ses dépendances sont lues à chaque requête
// (accesseurs), ce qui préserve les variables initialisées plus tard au démarrage.

const { NOT_HANDLED } = require("../http/route-result");

const DEPENDENCIES = Object.freeze(["DEFAULT_HOST","backgroundAnalysisService","backgroundJobEngine","getBudgetStatus","readJsonBody","selectConfiguredModelRoute"]);

function createJobsHttpRoutes(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  return async function handle(req, res, requestPath) {
    const {
      DEFAULT_HOST,
      backgroundAnalysisService,
      backgroundJobEngine,
      getBudgetStatus,
      readJsonBody,
      selectConfiguredModelRoute,
    } = deps;

    if (req.method === "GET" && req.url.startsWith("/jobs")) {
      if (!backgroundJobEngine) { res.writeHead(503); return res.end(JSON.stringify({ status: "error", code: "JOB_STORE_UNAVAILABLE" })); }
      const url = new URL(req.url, `http://${req.headers.host || DEFAULT_HOST}`);
      const match = url.pathname.match(/^\/jobs\/([^/]+)$/);
      const profileScope = url.searchParams.get("profileScope") || "arnaud";
      if (match) {
        const job = backgroundJobEngine.get(match[1]);
        if (!job || job.profile_scope !== profileScope) { res.writeHead(404); return res.end(JSON.stringify({ status: "error", message: "Job introuvable." })); }
        res.writeHead(200, { "Cache-Control": "no-store" }); return res.end(JSON.stringify({ status: "ok", job }));
      }
      const jobs = backgroundJobEngine.list({ profileScope, workspaceId: url.searchParams.get("workspaceId") || null, state: url.searchParams.get("state") || null, limit: url.searchParams.get("limit") || 100 });
      res.writeHead(200, { "Cache-Control": "no-store" }); return res.end(JSON.stringify({ status: "ok", mode: backgroundJobEngine.mode(), count: jobs.length, stats: backgroundJobEngine.stats(), jobs }));
    }
    if (req.method === "POST" && req.url === "/jobs") {
      try {
        if (!backgroundJobEngine) throw Object.assign(new Error("Moteur de jobs indisponible."), { statusCode: 503 });
        const body = await readJsonBody(req, 48 * 1024);
        const result = backgroundJobEngine.enqueue({ type: body.type, inputRef: body.inputRef || {}, profileScope: body.profileScope || "arnaud", workspaceId: body.workspaceId || null, projectId: body.projectId || null, sessionId: body.sessionId || null, conversationId: body.conversationId || null, priority: body.priority, scheduledAt: body.scheduledAt, idempotencyKey: body.idempotencyKey, dedupeKey: body.dedupeKey, dependencies: body.dependencies, budget: body.budget || {} });
        res.writeHead(result.accepted ? 202 : 200); return res.end(JSON.stringify({ status: "ok", ...result }));
      } catch (error) { res.writeHead(error.statusCode || 400); return res.end(JSON.stringify({ status: "error", code: error.code || null, message: error.message })); }
    }
    if (req.method === "POST" && /^\/jobs\/[^/]+\/cancel$/.test(req.url)) {
      try {
        const body = await readJsonBody(req, 8 * 1024); const id = req.url.split("/")[2];
        const job = backgroundJobEngine?.cancel(id, { profileScope: body.profileScope || "arnaud" });
        if (!job) { res.writeHead(404); return res.end(JSON.stringify({ status: "error", message: "Job introuvable." })); }
        res.writeHead(200); return res.end(JSON.stringify({ status: "ok", job }));
      } catch (error) { res.writeHead(400); return res.end(JSON.stringify({ status: "error", message: error.message })); }
    }
    if (req.method === "POST" && req.url === "/jobs/recover") {
      const recovered = backgroundJobEngine?.recover() || 0;
      res.writeHead(200); return res.end(JSON.stringify({ status: "ok", recovered }));
    }

    if (req.method === "GET" && req.url === "/background-analyses") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); return res.end(JSON.stringify({ status: "ok", enabled: backgroundAnalysisService.enabled, interrupted: backgroundAnalysisService.interrupted(), tasks: backgroundAnalysisService.list() }));
    }
    if (req.method === "POST" && req.url === "/background-analyses/start") {
      try {
        const body = await readJsonBody(req, 2 * 1024 * 1024);
        const requestedProfile = body.profile || ({
          "gpt-5.6-luna": "economical",
          "gpt-5.6-terra": "balanced",
          "gpt-5.6-sol": "maximum",
          "gpt-6-astra": "exceptional",
        }[body.model]) || "balanced";
        const route = selectConfiguredModelRoute({
          question: typeof body.input === "string" ? body.input : String(body.kind || "Analyse en arrière-plan"),
          profile: requestedProfile,
          budgetMode: getBudgetStatus().mode,
          context: { estimatedTokens: Number(body.metadata?.estimatedTokens) || 0 },
          tools: { expectedCount: Number(body.metadata?.expectedToolCount) || 0 },
          output: { expectedLength: "long" },
        });
        const task = await backgroundAnalysisService.start({
          kind: body.kind,
          input: body.input,
          model: route.model,
          metadata: {
            ...(body.metadata || {}),
            routingPolicyVersion: route.routingPolicyVersion,
            routingScore: route.score,
            routingReasonCodes: route.reasonCodes,
          },
        });
        res.writeHead(202, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "ok", task }));
      }
      catch (error) { res.writeHead(error.code === "BACKGROUND_DISABLED" ? 409 : 400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "error", code: error.code || null, message: error.message })); }
    }
    if (req.method === "POST" && /^\/background-analyses\/[^/]+\/(poll|cancel)$/.test(req.url)) {
      try { const [, , id, action] = req.url.split("/"); const task = action === "cancel" ? await backgroundAnalysisService.cancel(id) : await backgroundAnalysisService.poll(id); res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "ok", task })); }
      catch (error) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "error", message: error.message })); }
    }

    return NOT_HANDLED;
  };
}

module.exports = { DEPENDENCIES, createJobsHttpRoutes };
