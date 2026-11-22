"use strict";

// V3-L7 (A.6) — routes HTTP de gestion de la mémoire, sorties de server.js sans changement
// de contrat : /private-memory (mémoire privée chiffrée) et /personal-intelligence/memories
// (mémoire structurée). Toutes les écritures passent par MemoryEngine, qui invalide les caches.

const PRIVATE_BODY_LIMIT = 2 * 1024 * 1024;
const STRUCTURED_BODY_LIMIT = 40 * 1024;
const STRUCTURED_PATH = "/personal-intelligence/memories";

const JSON_NO_STORE = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function createMemoryHttpRoutes({ memoryEngine, seedImporter = null, validateSeed = null } = {}) {
  if (!memoryEngine?.applyPrivate || !memoryEngine?.applyStructured) throw new TypeError("memoryEngine avec écritures requis.");

  function matches(req) {
    const url = String(req?.url || "");
    if (req?.method === "GET") return url.startsWith("/private-memory") || url.startsWith(STRUCTURED_PATH);
    if (req?.method === "POST") return url.startsWith("/private-memory") || url === STRUCTURED_PATH;
    return false;
  }

  const send = (res, statusCode, headers, payload) => { res.writeHead(statusCode, headers); res.end(JSON.stringify(payload)); };

  function getPrivate(res, url) {
    const status = memoryEngine.privateStatus();
    if (!status.available) return send(res, 503, JSON_NO_STORE, { status: "error", message: status.reason });
    if (url.pathname === "/private-memory/profiles") return send(res, 200, JSON_NO_STORE, { status: "ok", ...memoryEngine.privateProfiles() });
    if (url.pathname === "/private-memory/why") return send(res, 200, JSON_NO_STORE, { status: "ok", ...memoryEngine.lastUsage() });
    if (url.pathname === "/private-memory/export") return send(res, 200, JSON_NO_STORE, { status: "ok", export: memoryEngine.exportPrivate(url.searchParams.get("subjectId") || "arnaud") });
    const memories = memoryEngine.listPrivate({
      subjectId: String(url.searchParams.get("subjectId") || "arnaud"),
      status: url.searchParams.get("status") || null,
      sensitivity: url.searchParams.get("sensitivity") || null,
      query: url.searchParams.get("q") || "",
    });
    return send(res, 200, JSON_NO_STORE, { status: "ok", memories, settings: memoryEngine.privateSettings() });
  }

  async function postPrivate(req, res, url, readJsonBody) {
    try {
      const status = memoryEngine.privateStatus();
      if (!status.available) throw Object.assign(new Error(status.reason), { statusCode: 503 });
      const body = await readJsonBody(req, PRIVATE_BODY_LIMIT);
      let result;
      if (url.pathname === "/private-memory/import/preview") {
        if (!seedImporter || !validateSeed) throw Object.assign(new Error("Import indisponible."), { statusCode: 503 });
        const validation = validateSeed(body.seed);
        result = validation.valid ? seedImporter.preview(body.seed) : validation;
      } else if (url.pathname === "/private-memory/import") {
        if (!seedImporter) throw Object.assign(new Error("Import indisponible."), { statusCode: 503 });
        result = seedImporter.importSelected(body.seed, Array.isArray(body.selectedIndexes) ? body.selectedIndexes : []);
        memoryEngine.notifyChanged({ store: "private_memory", action: "import", subjectId: body.subjectId || null });
      } else {
        result = memoryEngine.applyPrivate(body.action, body);
      }
      return send(res, 200, JSON_NO_STORE, { status: "ok", result });
    } catch (error) {
      return send(res, error.statusCode || 400, JSON_NO_STORE, { status: "error", message: error.message });
    }
  }

  function getStructured(res, url) {
    const memories = memoryEngine.listStructured({
      query: url.searchParams.get("q") || "",
      status: url.searchParams.get("status") || null,
      type: url.searchParams.get("type") || null,
      limit: 300,
    });
    return send(res, 200, JSON_NO_STORE, { status: "ok", count: memories.length, memories });
  }

  async function postStructured(req, res, readJsonBody) {
    try {
      const body = await readJsonBody(req, STRUCTURED_BODY_LIMIT);
      const result = memoryEngine.applyStructured(body.action, body);
      return send(res, 200, { "Content-Type": "application/json" }, { status: "ok", result });
    } catch (error) {
      return send(res, error.statusCode || 400, { "Content-Type": "application/json" }, { status: "error", code: error.code || null, message: error.message });
    }
  }

  async function handle(req, res, { readJsonBody }) {
    const url = new URL(req.url, "http://127.0.0.1");
    const isPrivate = String(req.url).startsWith("/private-memory");
    if (req.method === "GET") return isPrivate ? getPrivate(res, url) : getStructured(res, url);
    return isPrivate ? postPrivate(req, res, url, readJsonBody) : postStructured(req, res, readJsonBody);
  }

  return Object.freeze({ matches, handle });
}

module.exports = { createMemoryHttpRoutes };
