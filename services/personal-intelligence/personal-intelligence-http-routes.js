"use strict";

// V3-L7 — routes de l'intelligence personnelle, sorties de server.js : profil opérationnel,
// recherche et synthèse personnelles, projets, boîte d'entrée, recommandations proactives,
// suivis, métriques et créneaux.
// Bloc déplacé tel quel depuis server.js ; ses dépendances sont lues à chaque requête
// (accesseurs), ce qui préserve les variables initialisées plus tard au démarrage.

const { NOT_HANDLED } = require("../http/route-result");

const DEPENDENCIES = Object.freeze(["DEFAULT_HOST","DEFAULT_WEIGHTS","contextBuilder","followUpService","metricsService","multiSourceSynthesisEngine","normalizeFocusName","normalizeFocusPath","operationalProfileService","personalDatabase","personalInboxService","personalMigration","personalRepository","personalSearchEngine","planningPreferenceStore","proactiveEngine","projectIntelligenceService","readJsonBody","timeSlotService"]);

function createPersonalIntelligenceHttpRoutes(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  return async function handle(req, res, requestPath) {
    const {
      DEFAULT_HOST,
      DEFAULT_WEIGHTS,
      contextBuilder,
      followUpService,
      metricsService,
      multiSourceSynthesisEngine,
      normalizeFocusName,
      normalizeFocusPath,
      operationalProfileService,
      personalDatabase,
      personalInboxService,
      personalMigration,
      personalRepository,
      personalSearchEngine,
      planningPreferenceStore,
      proactiveEngine,
      projectIntelligenceService,
      readJsonBody,
      timeSlotService,
    } = deps;

    if (req.method === "GET" && req.url.startsWith("/personal-intelligence/profile")) {
      const profile = operationalProfileService.portrait();
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", database: personalDatabase.kind, ftsAvailable: personalDatabase.ftsAvailable, migration: personalMigration, profile }));
    }

    if (req.method === "POST" && req.url === "/personal-search") {
      try {
        if (req.headers["x-noon-request"] !== "1") {
          throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403 });
        }
        const body = await readJsonBody(req, 40 * 1024);
        const projectPath = normalizeFocusPath(body.projectPath);
        if (body.projectPath && !projectPath) {
          throw Object.assign(new Error("Le chemin du projet n’est pas autorisé."), { statusCode: 403 });
        }
        const result = await personalSearchEngine.search({
          query: body.query,
          intent: body.intent,
          sourceScopes: Array.isArray(body.sourceScopes) ? body.sourceScopes : [],
          projectId: body.projectId || null,
          projectPath,
          profileScope: normalizeFocusName(body.profileScope) || "arnaud",
          timeRange: body.timeRange || null,
          maxResults: body.maxResults,
          globalSearch: body.globalSearch === true,
        });
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "ok", ...result }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (req.method === "POST" && req.url === "/personal-synthesis") {
      try {
        if (req.headers["x-noon-request"] !== "1") {
          throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403 });
        }
        const body = await readJsonBody(req, 40 * 1024);
        const projectPath = normalizeFocusPath(body.projectPath);
        if (body.projectPath && !projectPath) {
          throw Object.assign(new Error("Le chemin du projet n’est pas autorisé."), { statusCode: 403 });
        }
        const profileScope = normalizeFocusName(body.profileScope) || "arnaud";
        const evidence = await personalSearchEngine.search({
          query: body.query,
          sourceScopes: Array.isArray(body.sourceScopes) ? body.sourceScopes : [],
          projectId: body.projectId || null,
          projectPath,
          profileScope,
          timeRange: body.timeRange || null,
          maxResults: Math.min(30, Number(body.maxResults) || 20),
          globalSearch: body.globalSearch === true,
        });
        const synthesis = await multiSourceSynthesisEngine.synthesize(evidence, {
          mode: body.mode,
          purpose: "local",
          profileScope,
          projectScope: body.projectId || null,
          maxSources: body.maxSources,
          maxEvidenceTokens: body.maxEvidenceTokens,
        });
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "ok", synthesis }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (req.method === "POST" && req.url === "/personal-synthesis/drill-down") {
      try {
        if (req.headers["x-noon-request"] !== "1") {
          throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403 });
        }
        const body = await readJsonBody(req, 10 * 1024);
        const evidence = await multiSourceSynthesisEngine.drillDown(body.evidenceId, {
          purpose: "local",
          profileScope: normalizeFocusName(body.profileScope) || "arnaud",
        });
        if (!evidence) throw Object.assign(new Error("Preuve indisponible ou permission révoquée."), { statusCode: 404 });
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "ok", evidence }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (req.method === "GET" && req.url === "/personal-intelligence/projects") {
      const projects = projectIntelligenceService.listWithSignals();
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", count: projects.length, projects }));
    }

    if (req.method === "POST" && req.url === "/personal-intelligence/projects") {
      try { const body = await readJsonBody(req, 80 * 1024); const project = projectIntelligenceService.upsert(body.project || {}); contextBuilder.invalidateProject(project.id); personalSearchEngine?.invalidate(); multiSourceSynthesisEngine?.invalidate(); res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "ok", project })); }
      catch (error) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "error", code: error.code || null, message: error.message })); }
    }

    if (req.method === "GET" && req.url.startsWith("/personal-intelligence/inbox")) {
      personalInboxService.expire();
      const url = new URL(req.url, `http://${req.headers.host || DEFAULT_HOST}`);
      const projectValue = url.searchParams.get("projectId");
      const items = personalInboxService.list({ status: url.searchParams.get("status") || null, projectId: projectValue === "none" ? null : projectValue || undefined });
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", count: items.length, items }));
    }

    if (req.method === "POST" && req.url === "/personal-intelligence/inbox") {
      try {
        const body = await readJsonBody(req, 80 * 1024); let result;
        if (body.action === "associate") result = personalInboxService.associate(String(body.id || ""), body.projectId || null);
        else if (body.action === "convert") result = personalInboxService.convertToNextAction(String(body.id || ""));
        else if (body.action === "update") result = personalRepository.updateInbox(String(body.id || ""), body.changes || {});
        else throw Object.assign(new Error("Action de boîte d’entrée inconnue."), { statusCode: 400 });
        res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "ok", result }));
      } catch (error) { res.writeHead(error.statusCode || 400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "error", message: error.message })); }
    }

    if (req.method === "GET" && req.url.startsWith("/personal-intelligence/recommendations")) {
      const url = new URL(req.url, `http://${req.headers.host || DEFAULT_HOST}`);
      const allowedScopes = new Set(["arnaud", "alexandra", "sinan", "kaan", "household", "projects"]);
      const subjectScope = allowedScopes.has(url.searchParams.get("subjectScope")) ? url.searchParams.get("subjectScope") : "arnaud";
      const at = new Date();
      const signals = personalInboxService.toPriorityActions().map((item) => {
        const sourceType = ["calendar", "reminders", "notes", "gmail", "projects", "memory", "daily_brief", "local"].includes(item.sourceType)
          ? item.sourceType : "local";
        return proactiveEngine.adapters.normalize(sourceType, item, { now: at, stale: item.metadata?.sourceStale === true });
      });
      const result = await proactiveEngine.evaluate(signals, {
        at,
        channel: "app",
        subjectScope,
        focusActive: url.searchParams.get("focusActive") === "true",
        remoteModel: false,
      });
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", limit: Number(process.env.NOON_MAX_PROACTIVE_NOTIFICATIONS) || 3,
        weights: DEFAULT_WEIGHTS, ...result }));
    }

    if (req.method === "POST" && req.url === "/personal-intelligence/feedback") {
      try { const body = await readJsonBody(req, 20 * 1024); const result = proactiveEngine.feedback(String(body.recommendationHash || ""), String(body.value || ""), { minutes: body.minutes }); res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "ok", result })); }
      catch (error) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "error", message: error.message })); }
    }

    if (req.method === "GET" && req.url.startsWith("/proactive/status")) {
      const recommendations = proactiveEngine.list({ activeOnly: true, limit: 100 });
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", enabled: true, count: recommendations.length,
        interruptionLevels: ["IGNORE", "STORE_FOR_BRIEF", "SURFACE_WHEN_RELEVANT", "SUGGEST", "NOTIFY", "URGENT_NOTIFY"] }));
    }

    if (req.method === "POST" && req.url === "/personal-intelligence/followups") {
      try { const body = await readJsonBody(req, 30 * 1024); const result = body.action === "complete" ? followUpService.complete(body.followup || {}) : followUpService.schedule(body.followup || {}); res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "ok", result })); }
      catch (error) { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "error", message: error.message })); }
    }

    if (req.method === "GET" && req.url.startsWith("/personal-intelligence/metrics")) {
      const url = new URL(req.url, `http://${req.headers.host || DEFAULT_HOST}`); const since = url.searchParams.get("since") || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); return res.end(JSON.stringify({ status: "ok", metrics: metricsService.dashboard(since) }));
    }

    if (req.method === "POST" && req.url === "/personal-intelligence/slots") {
      try { const body = await readJsonBody(req, 30 * 1024); const slots = await timeSlotService.suggest({ durationMinutes: Math.max(15, Math.min(240, Number(body.durationMinutes) || 45)), settings: planningPreferenceStore.load().settings, mode: body.mode || "Focus", offline: body.offline === true, events: Array.isArray(body.events) ? body.events : null }); res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "ok", validationRequired: true, slots })); }
      catch (error) { res.writeHead(503, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "error", message: error.message })); }
    }

    return NOT_HANDLED;
  };
}

module.exports = { DEPENDENCIES, createPersonalIntelligenceHttpRoutes };
