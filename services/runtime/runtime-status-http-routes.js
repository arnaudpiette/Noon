"use strict";

// V3-L7 : GET /api/features et /api/lifecycle/status, déplacés tels quels depuis server.js.
// Bloc déplacé tel quel depuis server.js ; ses dépendances sont lues à chaque requête
// (accesseurs), ce qui préserve les variables initialisées plus tard au démarrage.

const { NOT_HANDLED } = require("../http/route-result");

const DEPENDENCIES = Object.freeze(["DEFAULT_HOST","featureFlags","updateRecoveryEngine"]);

function createRuntimeStatusHttpRoutes(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  return async function handle(req, res, requestPath) {
    const {
      DEFAULT_HOST,
      featureFlags,
      updateRecoveryEngine,
    } = deps;

    if (req.method === "GET" && req.url.startsWith("/api/features")) {
      const url = new URL(req.url, `http://${req.headers.host || DEFAULT_HOST}`);
      const context = { workspaceId: url.searchParams.get("workspaceId"), sessionId: url.searchParams.get("sessionId") };
      const snapshot = featureFlags.snapshot(context);
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", ...snapshot, debt: featureFlags.debt() }));
    }

    if (req.method === "GET" && req.url === "/api/lifecycle/status") {
      const diagnostic = updateRecoveryEngine.startupDiagnostic();
      const updatePlan = updateRecoveryEngine.plan();
      const preflight = updateRecoveryEngine.preflight(updatePlan);
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", diagnostic, plan: updatePlan, preflight }));
    }

    return NOT_HANDLED;
  };
}

module.exports = { DEPENDENCIES, createRuntimeStatusHttpRoutes };
