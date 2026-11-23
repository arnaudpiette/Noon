"use strict";

// V3-L7 — adaptateur de compatibilité /memory (panneau UI historique).
// Bloc déplacé tel quel depuis server.js ; ses dépendances sont lues à chaque requête
// (accesseurs), ce qui préserve les variables initialisées plus tard au démarrage.

const { NOT_HANDLED } = require("../http/route-result");

const DEPENDENCIES = Object.freeze(["longTermMemoryStore","readJsonBody"]);

function createLegacyMemoryHttpRoutes(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  return async function handle(req, res, requestPath) {
    const {
      longTermMemoryStore,
      readJsonBody,
    } = deps;

    // @deprecated Compatibility UI adapter. La lecture métier passe exclusivement
    // par MemoryEngine ; cette route sera retirée après migration du panneau UI.
    if (req.method === "GET" && req.url === "/memory") {
      const state = longTermMemoryStore.load();
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", enabled: state.enabled, memories: state.memories }));
    }

    if (req.method === "POST" && req.url === "/memory") {
      try {
        const body = await readJsonBody(req, 20 * 1024); const action = String(body.action || ""); let result;
        if (action === "enable") result = longTermMemoryStore.setEnabled(body.enabled === true);
        else if (action === "add") result = longTermMemoryStore.add(body.text, Array.isArray(body.tags) ? body.tags : []);
        else if (action === "update") result = longTermMemoryStore.update(String(body.id || ""), body.text);
        else if (action === "delete") result = longTermMemoryStore.remove(String(body.id || ""));
        else if (action === "clear") result = longTermMemoryStore.clear();
        else { const error = new Error("Action mémoire non autorisée."); error.statusCode = 400; throw error; }
        res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "ok", result }));
      } catch (error) { res.writeHead(error.statusCode || 400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "error", message: error.message })); }
    }

    return NOT_HANDLED;
  };
}

module.exports = { DEPENDENCIES, createLegacyMemoryHttpRoutes };
