"use strict";

// V3-L7 — routes de la journée, sorties de server.js : brief quotidien, réglages de caractère,
// planning, suivi d'exécution, revues et intégrations Google (connexion, rappel OAuth, santé).
// Bloc déplacé tel quel depuis server.js ; ses dépendances sont lues à chaque requête
// (accesseurs), ce qui préserve les variables initialisées plus tard au démarrage.

const { NOT_HANDLED } = require("../http/route-result");

const DEPENDENCIES = Object.freeze(["CHARACTER_DIALS","DATA_DIRECTORY","DEFAULT_HOST","GOOGLE_ACCOUNT_EMAIL","briefUsageLog","calendarConnector","characterStore","completeGoogleOAuthCallback","createGoogleReadAuthorization","dailyBriefEngine","dailyPlanStore","dailyPlanningEngine","executionTrackingEngine","executionTrackingRepository","featureFlags","fs","getGoogleAccessToken","gmailConnector","notesConnector","path","planningPreferenceStore","readJsonBody","reliabilityEngine","remindersConnector","reviewLearningEngine","sendGoogleCallbackPage","toolAuditLog"]);

function createDayHttpRoutes(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  return async function handle(req, res, requestPath) {
    const {
      CHARACTER_DIALS,
      DATA_DIRECTORY,
      DEFAULT_HOST,
      GOOGLE_ACCOUNT_EMAIL,
      briefUsageLog,
      calendarConnector,
      characterStore,
      completeGoogleOAuthCallback,
      createGoogleReadAuthorization,
      dailyBriefEngine,
      dailyPlanStore,
      dailyPlanningEngine,
      executionTrackingEngine,
      executionTrackingRepository,
      featureFlags,
      fs,
      getGoogleAccessToken,
      gmailConnector,
      notesConnector,
      path,
      planningPreferenceStore,
      readJsonBody,
      reliabilityEngine,
      remindersConnector,
      reviewLearningEngine,
      sendGoogleCallbackPage,
      toolAuditLog,
    } = deps;

    if (req.method === "GET" && ["/daily-brief/current", "/daily-brief", "/brief", "/personal-brief"].includes(requestPath)) {
      let preferences = {};
      try { preferences = JSON.parse(fs.readFileSync(path.join(DATA_DIRECTORY, "preferences.json"), "utf8")); } catch {}
      const state = dailyBriefEngine.getCurrent({
        catchUp: new URL(req.url, `http://${req.headers.host}`).searchParams.get("catchUp") !== "false",
        enabled: preferences.creativeBriefEnabled !== false && process.env.NOON_SAFE_MODE !== "1",
        time: preferences.creativeBriefTime || "07:00",
      });
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify(state));
    }

    if (req.method === "GET" && requestPath === "/daily-brief/usage") {
      const days = Number(new URL(req.url, `http://${req.headers.host}`).searchParams.get("days")) || 14;
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", usage: briefUsageLog.summary({ days }) }));
    }

    if (req.method === "POST" && requestPath === "/daily-brief/opened") {
      try {
        if (req.headers["x-noon-request"] !== "1") throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403 });
        const body = await readJsonBody(req, 1024);
        const day = briefUsageLog.recordOpened({ date: String(body?.date || "") });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ status: "ok", recorded: Boolean(day) }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ status: "error", message: error.statusCode === 403 ? error.message : "Ouverture non enregistrée." }));
      }
    }

    if (req.method === "GET" && requestPath === "/daily-brief/history") {
      const date = new URL(req.url, `http://${req.headers.host}`).searchParams.get("date");
      const brief = dailyBriefEngine.getHistorical(date);
      res.writeHead(brief ? 200 : 404, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: brief ? "historical" : "missing", brief }));
    }

    if (req.method === "GET" && req.url === "/character/dials") {
      const state = characterStore.get();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", enabled: featureFlags.evaluate("character.charter", {}).enabled, dials: state.dials, updatedAt: state.updatedAt, charterVersion: state.charterVersion, definitions: CHARACTER_DIALS }));
    }

    if (req.method === "POST" && req.url === "/character/dials") {
      try {
        if (req.headers["x-noon-request"] !== "1") throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403, code: "CHARACTER_REQUEST_REFUSED" });
        const body = await readJsonBody(req, 4 * 1024);
        const state = characterStore.update(body?.dials);
        toolAuditLog.append("character.dials_updated", { keys: Object.keys(body?.dials || {}).slice(0, 5) });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ status: "ok", dials: state.dials, updatedAt: state.updatedAt }));
      } catch (error) {
        const known = /^CHARACTER_/.test(String(error?.code || ""));
        res.writeHead(error.statusCode || (known ? 400 : 500), { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ status: "error", code: known ? error.code : "CHARACTER_ERROR", message: known ? error.message : "Réglage du caractère impossible." }));
      }
    }

    if (req.method === "GET" && req.url === "/planning/preferences") {
      const state = planningPreferenceStore.load();
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", ...state }));
    }

    if (req.method === "POST" && req.url === "/planning/preferences") {
      try {
        const body = await readJsonBody(req, 40 * 1024); let result;
        if (body.action === "settings") result = planningPreferenceStore.updateSettings(body.settings || {});
        else if (body.action === "add") result = planningPreferenceStore.addPreference(body.preference || {});
        else if (body.action === "update") result = planningPreferenceStore.updatePreference(String(body.id || ""), body.changes || {});
        else if (body.action === "delete") result = planningPreferenceStore.removePreference(String(body.id || ""));
        else throw Object.assign(new Error("Action de préférence inconnue."), { statusCode: 400 });
        res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "ok", result }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (req.method === "GET" && req.url.startsWith("/planning/day")) {
      const url = new URL(req.url, `http://${req.headers.host || DEFAULT_HOST}`);
      const requestedDate = url.searchParams.get("date") || new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date());
      const plan = dailyPlanStore.get(requestedDate);
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", plan }));
    }

    if (req.method === "POST" && ["/planning/day/build", "/planning/day/replan"].includes(req.url)) {
      try {
        const body = await readJsonBody(req, 2 * 1024 * 1024);
        const input = {
          actions: Array.isArray(body.actions) ? body.actions.slice(0, 200) : [],
          events: Array.isArray(body.events) ? body.events.slice(0, 200) : [],
          at: body.at ? new Date(body.at) : new Date(),
          trigger: String(body.trigger || (req.url.endsWith("replan") ? "user_replan" : "user_build")).slice(0, 80),
        };
        if (!Number.isFinite(input.at.getTime())) throw Object.assign(new Error("Date de planification invalide."), { statusCode: 400 });
        const plan = req.url.endsWith("replan")
          ? await dailyPlanningEngine.replanDay(input)
          : await dailyPlanningEngine.buildPlan(input);
        executionTrackingEngine.ingestPlan(plan, { subjectScope: body.subjectScope || "arnaud" });
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "ok", plan }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (req.method === "POST" && req.url === "/planning/day/approval") {
      try {
        if (req.headers["x-noon-request"] !== "1") throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403 });
        const body = await readJsonBody(req, 50 * 1024);
        const plan = dailyPlanStore.get(String(body.date || ""));
        if (!plan || plan.planId !== body.planId || plan.planVersion !== Number(body.planVersion)) {
          throw Object.assign(new Error("Le planning a changé. Recalculez-le avant validation."), { statusCode: 409 });
        }
        const approval = await dailyPlanningEngine.previewApproval(plan, {
          executionId: body.executionId,
          calendarId: body.calendarId || "primary",
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "approval_required", approval }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (req.method === "GET" && req.url.startsWith("/tracking/items")) {
      const url = new URL(req.url, `http://${req.headers.host || DEFAULT_HOST}`);
      const allowedScopes = new Set(["arnaud", "alexandra", "sinan", "kaan", "household", "projects"]);
      const subjectScope = allowedScopes.has(url.searchParams.get("subjectScope")) ? url.searchParams.get("subjectScope") : "arnaud";
      const items = executionTrackingEngine.list({ subjectScope, status: url.searchParams.get("status") || undefined });
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", count: items.length, items }));
    }

    if (req.method === "POST" && ["/tracking/evidence", "/tracking/command"].includes(req.url)) {
      try {
        if (req.headers["x-noon-request"] !== "1") throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403 });
        const body = await readJsonBody(req, 80 * 1024);
        let result;
        if (req.url === "/tracking/command") {
          const candidates = (body.executionItemIds || []).slice(0, 10)
            .map((id) => executionTrackingRepository.get(String(id))).filter(Boolean);
          result = executionTrackingEngine.interpretUserCommand(body.text, candidates, {
            at: body.at ? new Date(body.at) : new Date(),
          });
        } else {
          result = executionTrackingEngine.synchronizeEvidence(body.evidence || {});
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "ok", result }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", code: error.code || null, message: error.message }));
      }
    }

    if (req.method === "POST" && req.url === "/tracking/drift") {
      try {
        if (req.headers["x-noon-request"] !== "1") throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403 });
        const body = await readJsonBody(req, 30 * 1024);
        const at = body.at ? new Date(body.at) : new Date();
        const drifts = executionTrackingEngine.detectDrift({ at, subjectScope: body.subjectScope || "arnaud" });
        const proactive = body.proactive === false ? null : await executionTrackingEngine.sendDriftsToProactive(drifts, { at, subjectScope: body.subjectScope || "arnaud" });
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "ok", drifts, proactive }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (req.method === "GET" && req.url.startsWith("/reviews")) {
      const url = new URL(req.url, `http://${req.headers.host || DEFAULT_HOST}`);
      const allowedScopes = new Set(["arnaud", "alexandra", "sinan", "kaan", "household", "projects"]);
      const subjectScope = allowedScopes.has(url.searchParams.get("subjectScope"))
        ? url.searchParams.get("subjectScope") : "arnaud";
      const reviewType = ["daily", "weekly"].includes(url.searchParams.get("type"))
        ? url.searchParams.get("type") : undefined;
      const reviews = reviewLearningEngine.list({ subjectScope, reviewType, limit: 30 });
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", count: reviews.length, reviews }));
    }

    if (req.method === "POST" && ["/reviews/daily", "/reviews/weekly"].includes(req.url)) {
      try {
        if (req.headers["x-noon-request"] !== "1") throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403 });
        const body = await readJsonBody(req, 30 * 1024);
        const allowedScopes = new Set(["arnaud", "alexandra", "sinan", "kaan", "household", "projects"]);
        const subjectScope = allowedScopes.has(body.subjectScope) ? body.subjectScope : "arnaud";
        const explicitPreferences = body.explicitPreferences && typeof body.explicitPreferences === "object"
          ? body.explicitPreferences : {};
        const review = req.url === "/reviews/daily"
          ? reviewLearningEngine.generateDaily({ date: body.date, subjectScope, explicitPreferences })
          : reviewLearningEngine.generateWeekly({
            at: body.at ? new Date(body.at) : new Date(), subjectScope, explicitPreferences,
          });
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "ok", review }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (req.method === "GET" && req.url === "/integrations/status") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({
        status: "ok",
        dryRunExternalWrites: true,
        integrations: [gmailConnector.status, calendarConnector.status, remindersConnector.status, notesConnector.status],
      }));
    }

    if (req.method === "POST" && ["/integrations/gmail/connect", "/integrations/google-calendar/connect"].includes(req.url)) {
      try {
        const { url } = await createGoogleReadAuthorization();
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "ok", authorizationUrl: url }));
      } catch (error) {
        res.writeHead(503, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (req.method === "GET" && requestPath === "/integrations/google/callback") {
      const callbackUrl = new URL(req.url, "http://127.0.0.1:3000");
      return sendGoogleCallbackPage(res, await completeGoogleOAuthCallback(callbackUrl));
    }

    if (req.method === "POST" && ["/integrations/gmail/disconnect", "/integrations/google-calendar/disconnect"].includes(req.url)) {
      const result = gmailConnector.disconnect();
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", ...result }));
    }

    if (req.method === "GET" && req.url === "/integrations/google-calendar/health") {
      try {
        const calendars = await calendarConnector.listCalendars(); calendarConnector.markSuccess();
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "ok", calendars: calendars.items?.length || 0 }));
      } catch (error) {
        calendarConnector.markError(error); const normalized = reliabilityEngine.recordFailure("google-calendar", error); res.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "error", reasonCode: normalized.category, message: normalized.safeMessage, recoveryAction: normalized.recoveryAction }));
      }
    }

    if (req.method === "GET" && req.url === "/integrations/gmail/health") {
      try {
        const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
          headers: { Authorization: `Bearer ${await getGoogleAccessToken()}` },
          signal: AbortSignal.timeout(10_000),
        });
        const profile = await response.json();
        if (!response.ok || profile.emailAddress?.toLowerCase() !== GOOGLE_ACCOUNT_EMAIL) {
          throw new Error("Le compte Gmail autorisé ne correspond pas.");
        }
        gmailConnector.markSuccess();
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "ok", account: GOOGLE_ACCOUNT_EMAIL }));
      } catch (error) {
        gmailConnector.markError(error);
        const normalized = reliabilityEngine.recordFailure("gmail", error);
        res.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "error", reasonCode: normalized.category, message: normalized.safeMessage, recoveryAction: normalized.recoveryAction }));
      }
    }

    return NOT_HANDLED;
  };
}

module.exports = { DEPENDENCIES, createDayHttpRoutes };
