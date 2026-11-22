"use strict";

// V3-L5c — routes locales des missions DEV : préfixe /api/dev-missions, flag dev.missions.
// En-tête x-noon-request obligatoire pour toute mutation ; corps bornés à clés exactes.

const ROUTE = /^\/api\/dev-missions(?:\/(mission-[0-9a-f]{12})(?:\/(start|apply|renew-apply|discard|patch))?)?$/;
const BODY_LIMIT = 16 * 1024;

const httpError = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });
function exactKeys(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw httpError(400, "MISSION_BODY_INVALID", "Corps de requête invalide.");
  for (const key of Object.keys(body)) if (!allowed.includes(key)) throw httpError(400, "MISSION_BODY_INVALID", `Champ non autorisé : ${key}.`);
  return body;
}

function createDevMissionHttpRoutes({ isEnabled, service } = {}) {
  if (typeof isEnabled !== "function" || !service) throw new TypeError("isEnabled et service requis.");
  const matches = (requestPath) => ROUTE.test(String(requestPath || ""));

  async function route(req, readJsonBody, requestPath) {
    const [, id, action] = requestPath.match(ROUTE);
    if (req.method === "GET") {
      if (action === "patch") return { status: "ok", patch: service.patch(id) };
      if (action) throw httpError(405, "MISSION_METHOD_INVALID", "Méthode non autorisée.");
      return id ? { status: "ok", mission: service.get(id) } : { status: "ok", enabled: true, executors: await service.executors(), repositories: service.repositories(), missions: service.list() };
    }
    if (req.method !== "POST") throw httpError(405, "MISSION_METHOD_INVALID", "Méthode non autorisée.");
    if (req.headers["x-noon-request"] !== "1") throw httpError(403, "MISSION_REQUEST_REFUSED", "Requête Noon refusée.");
    const body = await readJsonBody(req, BODY_LIMIT);
    if (action === "patch") throw httpError(405, "MISSION_METHOD_INVALID", "Méthode non autorisée.");
    if (!id) return { status: "ok", mission: service.propose(exactKeys(body, ["workspaceId", "repositoryRoot", "objective", "allowedPaths", "executor"])) };
    if (action === "start") return { status: "ok", mission: service.start(id, exactKeys(body, ["approvalId"])) };
    if (action === "apply") return { status: "ok", mission: service.apply(id, exactKeys(body, ["approvalId"])) };
    if (action === "renew-apply") { exactKeys(body, []); return { status: "ok", mission: service.renewApplyApproval(id) }; }
    if (action === "discard") { exactKeys(body, []); return { status: "ok", mission: service.discard(id) }; }
    throw httpError(404, "MISSION_ROUTE_UNKNOWN", "Route inconnue.");
  }

  async function handle(req, res, { requestPath, readJsonBody }) {
    const send = (statusCode, payload) => { res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(payload)); };
    if (!isEnabled()) return send(404, { status: "error", code: "MISSION_DISABLED", message: "Missions DEV désactivées (flag dev.missions)." });
    try { return send(200, await route(req, readJsonBody, requestPath)); }
    catch (error) {
      const code = String(error?.code || "");
      const known = /^(MISSION_|APPROVAL_|approval_)/.test(code);
      return send(error.statusCode || (known ? 409 : 500), { status: "error", code: known ? code : "MISSION_ERROR", message: known ? error.message : "Mission DEV indisponible.", ...(Array.isArray(error.files) ? { files: error.files } : {}) });
    }
  }

  return Object.freeze({ matches, handle });
}

module.exports = { createDevMissionHttpRoutes };
