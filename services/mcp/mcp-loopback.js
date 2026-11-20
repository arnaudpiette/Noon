"use strict";

// Récepteur OAuth loopback éphémère (127.0.0.1, port aléatoire), sur le modèle
// du récepteur Google existant. Il vérifie le state avant tout échange de code.

const http = require("node:http");

const CALLBACK_PATH = "/mcp/oauth/callback";

function page(title, message) {
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  return `<!doctype html><meta charset="utf-8"><title>${escape(title)}</title><body style="font-family:-apple-system,sans-serif;padding:40px"><h1>${escape(title)}</h1><p>${escape(message)}</p></body>`;
}

async function createMcpLoopbackReceiver({ timeoutMs = 10 * 60 * 1000, onCallback }) {
  let expectedState = null;
  let redirectUri = null;
  let handled = false;
  let timeout = null;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (status, title, message) => { res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); res.end(page(title, message)); };
    if (req.method !== "GET" || url.pathname !== CALLBACK_PATH) return send(404, "Introuvable", "Adresse inconnue.");
    if (handled) return send(409, "Déjà traité", "Cette autorisation a déjà été utilisée.");
    const state = url.searchParams.get("state");
    if (!expectedState || state !== expectedState) return send(400, "Autorisation refusée", "Paramètre state invalide.");
    handled = true;
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    try {
      if (error || !code) throw Object.assign(new Error("Autorisation refusée par le service."), { code: "MCP_OAUTH_DENIED" });
      await onCallback({ code });
      send(200, "Connexion réussie", "Vous pouvez fermer cette fenêtre et revenir dans Noon.");
    } catch (failure) {
      send(400, "Connexion impossible", failure?.code === "MCP_OAUTH_DENIED" ? failure.message : "L'échange d'autorisation a échoué.");
    } finally {
      setImmediate(close);
    }
  });
  function close() { if (timeout) clearTimeout(timeout); server.close(); }
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  redirectUri = `http://127.0.0.1:${server.address().port}${CALLBACK_PATH}`;
  timeout = setTimeout(close, timeoutMs); timeout.unref?.();
  return { redirectUri, setExpectedState(state) { expectedState = state; }, close };
}

module.exports = { createMcpLoopbackReceiver, CALLBACK_PATH };
