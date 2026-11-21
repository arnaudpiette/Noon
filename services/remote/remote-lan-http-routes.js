"use strict";

// IP-3 — commandes locales de la section « Appareils » : préfixe /api/remote-lan/, flag
// remote.lan. Servies uniquement par le serveur local de Noon (jamais par la passerelle).
// 404 si le flag est OFF, en-tête x-noon-request obligatoire pour toute mutation, corps
// bornés à clés exactes. Le QR est renvoyé sous forme de matrice de modules : l'interface
// le dessine sans injecter de HTML.

const qrcode = require("qrcode-generator");

const ROUTE = /^\/api\/remote-lan\/(status|start|stop|invitations|pairings|devices)(?:\/([A-Za-z0-9_-]{6,140})(?:\/(approve|reject|revoke))?)?$/;
const BODY_LIMIT = 4 * 1024;

function httpError(status, code, message) { return Object.assign(new Error(message), { status, code }); }

function exactKeys(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw httpError(400, "REMOTE_LAN_BODY_INVALID", "Corps de requête invalide.");
  for (const key of Object.keys(body)) if (!allowed.includes(key)) throw httpError(400, "REMOTE_LAN_BODY_INVALID", `Champ non autorisé : ${key}.`);
  return body;
}

function qrMatrix(text) {
  const code = qrcode(0, "M");
  code.addData(text, "Byte");
  code.make();
  const size = code.getModuleCount();
  const rows = [];
  for (let row = 0; row < size; row += 1) {
    let line = "";
    for (let column = 0; column < size; column += 1) line += code.isDark(row, column) ? "1" : "0";
    rows.push(line);
  }
  return rows;
}

function createRemoteLanHttpRoutes({ isEnabled, service, observability = () => {} } = {}) {
  if (typeof isEnabled !== "function" || typeof service !== "function") throw new TypeError("isEnabled et service requis.");
  const emit = (event, metadata) => { try { observability(event, metadata); } catch {} };
  const matches = (requestPath) => ROUTE.test(String(requestPath || ""));

  async function dispatch(req, requestPath, readJsonBody) {
    const [, resource, id, action] = ROUTE.exec(requestPath);
    const method = req.method;
    const lan = service();
    if (resource === "status" && method === "GET" && !id) return { status: "ok", lan: lan.status() };
    if (method !== "POST") throw httpError(405, "REMOTE_LAN_METHOD_NOT_ALLOWED", "Méthode non autorisée.");
    if (req.headers["x-noon-request"] !== "1") throw httpError(403, "REMOTE_LAN_REQUEST_REFUSED", "Requête Noon refusée.");
    const body = await readJsonBody(req, BODY_LIMIT);

    if (resource === "start" && !id) { exactKeys(body, []); const lanStatus = await lan.start(); emit("remote.lan.admin_start", {}); return { status: "ok", lan: lanStatus }; }
    if (resource === "stop" && !id) { exactKeys(body, []); return { status: "ok", lan: await lan.stop() }; }
    if (resource === "invitations" && !id) {
      exactKeys(body, []);
      const invitation = lan.createInvitation();
      return { status: "ok", invitation: { expiresAt: invitation.expiresAt, host: invitation.host, port: invitation.port, modules: qrMatrix(invitation.qr) } };
    }
    if (resource === "pairings" && id && action === "approve") {
      const payload = exactKeys(body, ["grantedScopes"]);
      if (!Array.isArray(payload.grantedScopes) || payload.grantedScopes.length > 10 || payload.grantedScopes.some((scope) => typeof scope !== "string")) throw httpError(400, "REMOTE_LAN_BODY_INVALID", "grantedScopes invalide.");
      return { status: "ok", device: lan.approve(id, payload.grantedScopes) };
    }
    if (resource === "pairings" && id && action === "reject") { exactKeys(body, []); return { status: "ok", ...lan.reject(id) }; }
    if (resource === "devices" && id && action === "revoke") { exactKeys(body, []); return { status: "ok", ...lan.revoke(id) }; }
    throw httpError(405, "REMOTE_LAN_METHOD_NOT_ALLOWED", "Méthode non autorisée.");
  }

  async function handle(req, res, { requestPath, readJsonBody }) {
    const send = (status, payload) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(payload)); };
    if (!isEnabled()) return send(404, { status: "error", code: "REMOTE_LAN_DISABLED", message: "Passerelle iPhone désactivée." });
    try {
      return send(200, await dispatch(req, requestPath, readJsonBody));
    } catch (error) {
      const code = String(error?.code || "");
      const known = /^(REMOTE_LAN_|PAIRING_|DEVICE_)/.test(code);
      return send(error.status || (known ? 400 : 500), { status: "error", code: known ? code : "REMOTE_LAN_ERROR", message: known ? error.message : "Erreur de la passerelle iPhone." });
    }
  }

  return Object.freeze({ matches, handle });
}

module.exports = { createRemoteLanHttpRoutes, qrMatrix };
