"use strict";

// V3-L7 — routes HTTP de V3-L2 : capture rapide (fenêtre, enregistrement, récentes),
// « Où j’en étais ? » (/resume) et « Je dois faire X » (/first-step).
// Bloc déplacé tel quel depuis server.js ; ses dépendances sont lues à chaque requête
// (accesseurs), ce qui préserve les variables initialisées plus tard au démarrage.

const { NOT_HANDLED } = require("../http/route-result");

const DEPENDENCIES = Object.freeze(["DEFAULT_HOST","FIRST_STEP_MODEL","PUBLIC_DIRECTORY","firstStepService","fs","path","quickCaptureService","readJsonBody","renderFirstStep","renderResumeBriefing","resolveFocusCatalogSelection","resumeBriefingService","toolAuditLog"]);

function createCaptureHttpRoutes(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  return async function handle(req, res, requestPath) {
    const {
      DEFAULT_HOST,
      FIRST_STEP_MODEL,
      PUBLIC_DIRECTORY,
      firstStepService,
      fs,
      path,
      quickCaptureService,
      readJsonBody,
      renderFirstStep,
      renderResumeBriefing,
      resolveFocusCatalogSelection,
      resumeBriefingService,
      toolAuditLog,
    } = deps;

    // Sert la page principale de l'interface web locale.
    // V3-L2a : fenêtre de capture rapide et ses ressources.
    if (req.method === "GET" && ["/capture", "/capture.js", "/capture.css"].includes(req.url)) {
      const file = { "/capture": ["capture.html", "text/html; charset=utf-8"], "/capture.js": ["capture.js", "application/javascript; charset=utf-8"], "/capture.css": ["capture.css", "text/css; charset=utf-8"] }[req.url];
      res.writeHead(200, { "Content-Type": file[1], "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" });
      return res.end(fs.readFileSync(path.join(PUBLIC_DIRECTORY, file[0])));
    }

    if (req.method === "GET" && (req.url === "/resume" || req.url.startsWith("/resume?"))) {
      try {
        const url = new URL(req.url, `http://${req.headers.host || DEFAULT_HOST}`);
        const focusId = String(url.searchParams.get("focusId") || "").trim();
        const briefing = await resumeBriefingService.build({
          focusId: /^[a-zA-Z0-9_-]{1,80}$/.test(focusId) ? focusId : null,
          focusPath: url.searchParams.get("focusPath") || null,
        });
        toolAuditLog.append("resume.briefing_built", { focus: Boolean(briefing.focus), project: Boolean(briefing.project), captures: briefing.captures.length, nextStep: briefing.nextStep?.source || null });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({ status: "ok", briefing, text: renderResumeBriefing(briefing) }));
      } catch {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ status: "error", code: "RESUME_ERROR", message: "Point de reprise indisponible." }));
      }
    }

    if (req.method === "POST" && (req.url === "/first-step" || req.url === "/first-step/save")) {
      try {
        if (req.headers["x-noon-request"] !== "1") throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403, code: "FIRST_STEP_REQUEST_REFUSED" });
        const body = await readJsonBody(req, 8 * 1024);
        if (req.url === "/first-step") {
          const result = await firstStepService.suggest({ task: body?.task });
          toolAuditLog.append("first_step.suggested", { model: FIRST_STEP_MODEL, minutes: result.minutes, taskLength: result.task.length });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          return res.end(JSON.stringify({ status: "ok", result, text: renderFirstStep(result) }));
        }
        const focusId = String(body?.focusId || "").trim();
        const focus = /^[a-zA-Z0-9_-]{1,80}$/.test(focusId) ? (() => { try { return resolveFocusCatalogSelection(focusId, body?.focusPath || null); } catch { return null; } })() : null;
        const saved = await firstStepService.save({ task: body?.task, step: body?.step, focusName: focus?.name || null });
        toolAuditLog.append("first_step.saved", { savedTo: saved.savedTo });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ status: "ok", saved }));
      } catch (error) {
        const code = String(error?.code || "");
        const known = /^(FIRST_STEP_|CAPTURE_)/.test(code) || error?.statusCode === 503;
        toolAuditLog.append("first_step.failed", { code: code || "FIRST_STEP_ERROR" });
        res.writeHead(error.statusCode || (known ? 400 : 500), { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ status: "error", code: known ? (code || "FIRST_STEP_UNAVAILABLE") : "FIRST_STEP_ERROR", message: known ? error.message : "Premier pas indisponible." }));
      }
    }

    if (req.method === "GET" && req.url.startsWith("/capture/recent")) {
      const limit = Number(new URL(req.url, `http://${req.headers.host || DEFAULT_HOST}`).searchParams.get("limit")) || 10;
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", captures: quickCaptureService.recent(limit) }));
    }

    if (req.method === "POST" && req.url === "/capture") {
      try {
        if (req.headers["x-noon-request"] !== "1") throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403, code: "CAPTURE_REQUEST_REFUSED" });
        const body = await readJsonBody(req, 8 * 1024);
        const saved = quickCaptureService.capture({ text: body?.text, origin: body?.origin || "shortcut" });
        toolAuditLog.append("capture.saved", { origin: saved.origin, length: saved.text.length });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ status: "ok", capture: saved }));
      } catch (error) {
        const known = /^CAPTURE_/.test(String(error?.code || ""));
        res.writeHead(error.statusCode || (known ? 400 : 500), { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ status: "error", code: known ? error.code : "CAPTURE_ERROR", message: known ? error.message : "Note non enregistrée." }));
      }
    }

    return NOT_HANDLED;
  };
}

module.exports = { DEPENDENCIES, createCaptureHttpRoutes };
