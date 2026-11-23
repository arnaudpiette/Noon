"use strict";

// V3-L7 : GET /api/config/status, déplacé tel quel depuis server.js.
// Bloc déplacé tel quel depuis server.js ; ses dépendances sont lues à chaque requête
// (accesseurs), ce qui préserve les variables initialisées plus tard au démarrage.

const { NOT_HANDLED } = require("../http/route-result");

const DEPENDENCIES = Object.freeze(["DEFAULT_HOST","runtimeConfig"]);

function createConfigStatusHttpRoutes(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  return async function handle(req, res, requestPath) {
    const {
      DEFAULT_HOST,
      runtimeConfig,
    } = deps;

    if (req.method === "GET" && req.url.startsWith("/api/config/status")) {
      const url = new URL(req.url, `http://${req.headers.host || DEFAULT_HOST}`);
      const context = { workspaceId: url.searchParams.get("workspaceId"), sessionId: url.searchParams.get("sessionId") };
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", config: runtimeConfig.getPublicConfig(context), snapshot: runtimeConfig.snapshot(context) }));
    }

    return NOT_HANDLED;
  };
}

module.exports = { DEPENDENCIES, createConfigStatusHttpRoutes };
