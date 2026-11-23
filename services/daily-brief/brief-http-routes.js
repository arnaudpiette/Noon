"use strict";

// V3-L7 — routes HTTP de planification et de génération du Brief du jour.
// Bloc déplacé tel quel depuis server.js ; ses dépendances sont lues à chaque requête
// (accesseurs), ce qui préserve les variables initialisées plus tard au démarrage.

const { NOT_HANDLED } = require("../http/route-result");

const DEPENDENCIES = Object.freeze(["briefScheduledTime","briefUsageLog","generateDailyBrief","personalBriefStore","readJsonBody","safeUsageLog"]);

function createBriefHttpRoutes(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  return async function handle(req, res, requestPath) {
    const {
      briefScheduledTime,
      briefUsageLog,
      generateDailyBrief,
      personalBriefStore,
      readJsonBody,
      safeUsageLog,
    } = deps;

    if (req.method === "POST" && ["/daily-brief/schedule", "/brief/schedule"].includes(req.url)) {
      try {
        const body = await readJsonBody(req, 10 * 1024);
        const nextScheduledAt = new Date(body.nextScheduledAt);
        if (!Number.isFinite(nextScheduledAt.getTime())) {
          const error = new Error("Date de planification invalide.");
          error.statusCode = 400;
          throw error;
        }
        const state = personalBriefStore.markScheduled(nextScheduledAt);
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "ok", nextScheduledAt: state.nextScheduledAt }));
      } catch (error) {
        res.writeHead(error.statusCode || 400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (req.method === "POST" && ["/daily-brief/generate", "/brief/generate", "/personal-brief/generate"].includes(req.url)) {
      try {
        const body = await readJsonBody(req, 10 * 1024);
        const brief = await generateDailyBrief({ force: body.force === true });
        if (brief?.date) safeUsageLog(() => briefUsageLog.recordGenerated({ date: brief.date, generatedAt: brief.generatedAt, trigger: body.trigger, scheduledTime: briefScheduledTime() }));
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "ok", brief }));
      } catch (error) {
        safeUsageLog(() => briefUsageLog.recordFailure({ code: error.code, scheduledTime: briefScheduledTime() }));
        res.writeHead(error.code === "BUDGET_BLOCKED" ? 403 : 500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", code: error.code || null, message: error.message }));
      }
    }

    return NOT_HANDLED;
  };
}

module.exports = { DEPENDENCIES, createBriefHttpRoutes };
