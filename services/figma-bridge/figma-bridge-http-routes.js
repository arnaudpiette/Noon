"use strict";

// Routes du Control Center pour la passerelle Figma (flag figma.bridge) : préfixe /api/figma-bridge.
// Lecture d'état en GET ; toute mutation exige x-noon-request. « test » ne fait qu'une lecture.

const ROUTE = /^\/api\/figma-bridge(?:\/(pairing-code|unpair|test))?$/;

function createFigmaBridgeHttpRoutes({ isEnabled, bridge } = {}) {
  if (typeof isEnabled !== "function" || !bridge) throw new TypeError("isEnabled et bridge requis.");
  const matches = (requestPath) => ROUTE.test(String(requestPath || ""));

  async function handle(req, res, { requestPath }) {
    const send = (statusCode, payload) => { res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(payload)); };
    if (!isEnabled()) return send(404, { status: "error", code: "FIGMA_BRIDGE_DISABLED", message: "Passerelle Figma désactivée (flag figma.bridge)." });
    const [, action] = requestPath.match(ROUTE);
    try {
      if (req.method === "GET" && !action) return send(200, { status: "ok", bridge: bridge.status() });
      if (req.method !== "POST" || !action) return send(405, { status: "error", code: "FIGMA_BRIDGE_METHOD_NOT_ALLOWED", message: "Méthode non autorisée." });
      if (req.headers["x-noon-request"] !== "1") return send(403, { status: "error", code: "FIGMA_BRIDGE_REQUEST_REFUSED", message: "Requête Noon refusée." });
      if (action === "pairing-code") return send(200, { status: "ok", pairing: await bridge.createPairingCode(), bridge: bridge.status() });
      if (action === "unpair") return send(200, { status: "ok", bridge: bridge.unpair() });
      const page = await bridge.request("get_page", {});
      return send(200, { status: "ok", page, bridge: bridge.status() });
    } catch (error) {
      const code = String(error?.code || "");
      const known = /^FIGMA_/.test(code);
      return send(error.statusCode || (known ? 409 : 500), { status: "error", code: known ? code : "FIGMA_BRIDGE_ERROR", message: known ? error.message : "Passerelle Figma indisponible." });
    }
  }

  return Object.freeze({ matches, handle });
}

module.exports = { createFigmaBridgeHttpRoutes };
