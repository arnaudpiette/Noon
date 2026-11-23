"use strict";

// Passerelle locale Noon ⇄ plugin Figma « Noon Bridge » (flag figma.bridge).
//
// Figma n'ouvre à Noon ni son serveur MCP en ligne (réservé à son catalogue) ni l'écriture via
// l'application de bureau. Le plugin, importé par l'utilisateur dans Figma Desktop, a lui accès
// au fichier ouvert ; son interface interroge ce petit serveur HTTP sur 127.0.0.1 :
//   POST /figma-bridge/v1/pair    { code }             → jeton (code affiché dans Noon, 5 min)
//   POST /figma-bridge/v1/hello   { fileName, … }      → présence
//   GET  /figma-bridge/v1/next                         → prochaine commande (attente longue)
//   POST /figma-bridge/v1/result  { id, ok, result }   → résultat d'une commande
// Le jeton n'est jamais stocké en clair côté Noon (empreinte SHA-256 seulement). Seules les
// commandes de la liste blanche partent vers le plugin. L'écriture (apply_changes) n'est acceptée
// qu'avec { authorizedWrite: true }, que seul l'outil Figma passe après validation de l'utilisateur.

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const DEFAULT_PORT = 3856;
const PREFIX = "/figma-bridge/v1/";
const READ_COMMANDS = Object.freeze(["ping", "get_selection", "get_page", "get_node", "get_design_tokens"]);
const WRITE_COMMANDS = Object.freeze(["apply_changes"]);
const WRITE_TIMEOUT_MS = 60_000;
const SMALL_BODY = 4 * 1024;
const RESULT_BODY = 1024 * 1024;
const PRESENCE_TTL_MS = 35_000;

const bridgeError = (code, message, statusCode = 409) => Object.assign(new Error(message), { code, statusCode });
const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const safeText = (value, max = 200) => (typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").slice(0, max) : null);

function sameHash(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function createFigmaBridge({
  stateFile, port = DEFAULT_PORT, host = "127.0.0.1", now = () => Date.now(),
  randomInt = crypto.randomInt, randomBytes = crypto.randomBytes, observability = () => {},
  pollTimeoutMs = 25_000, requestTimeoutMs = 15_000, pairingTtlMs = 5 * 60_000, maxPairingAttempts = 5,
} = {}) {
  if (!stateFile) throw new TypeError("stateFile requis.");
  const emit = (event, metadata = {}) => { try { observability(`figma-bridge.${event}`, metadata); } catch {} };
  let state = loadState();
  let pairing = null;
  let presence = null;
  let server = null;
  // « localhost » peut viser ::1 sous macOS : seconde écoute IPv6 locale, au mieux (jamais 0.0.0.0).
  let serverV6 = null;
  let waiter = null;
  const queue = [];
  const pending = new Map();

  function loadState() {
    try {
      const saved = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      return typeof saved?.tokenHash === "string" && /^[0-9a-f]{64}$/.test(saved.tokenHash) ? { tokenHash: saved.tokenHash, pairedAt: saved.pairedAt || null } : {};
    } catch { return {}; }
  }
  function saveState() {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    const temporary = `${stateFile}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, stateFile);
  }

  const paired = () => Boolean(state.tokenHash);
  const boundPort = () => (server?.listening ? server.address().port : port);
  const connected = () => Boolean(presence && now() - presence.lastSeenAt < PRESENCE_TTL_MS);

  function status() {
    return {
      listening: Boolean(server?.listening), port: boundPort(), paired: paired(), pairedAt: state.pairedAt || null,
      connected: connected(),
      file: connected() ? { fileName: presence.fileName, pageName: presence.pageName, editorType: presence.editorType, pluginVersion: presence.pluginVersion } : null,
      pairing: pairing && pairing.expiresAt > now() ? { expiresAt: new Date(pairing.expiresAt).toISOString() } : null,
      pending: pending.size, readCommands: [...READ_COMMANDS], writeCommands: [...WRITE_COMMANDS],
    };
  }

  // ---------- Serveur local ----------

  function send(res, statusCode, payload) {
    res.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
      // L'iframe d'un plugin Figma a une origine nulle : seul « * » est accepté.
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type, x-noon-figma-token",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Max-Age": "600",
    });
    res.end(payload === undefined ? "" : JSON.stringify(payload));
  }

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > limit) { reject(bridgeError("FIGMA_BRIDGE_BODY_TOO_LARGE", "Corps trop volumineux.", 413)); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on("end", () => {
        try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
        catch { reject(bridgeError("FIGMA_BRIDGE_BODY_INVALID", "JSON invalide.", 400)); }
      });
      req.on("error", reject);
    });
  }

  function authorized(req) {
    const token = req.headers["x-noon-figma-token"];
    return paired() && typeof token === "string" && token.length >= 32 && sameHash(sha256(token), state.tokenHash);
  }

  function touchPresence(patch = {}) {
    presence = {
      fileName: null, pageName: null, editorType: null, pluginVersion: null, ...(presence || {}),
      ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)), lastSeenAt: now(),
    };
  }

  function pair(body) {
    if (!pairing || pairing.expiresAt <= now()) { pairing = null; throw bridgeError("FIGMA_BRIDGE_PAIRING_EXPIRED", "Code expiré : génère un nouveau code dans Noon.", 410); }
    pairing.attempts += 1;
    const code = String(body?.code || "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code) || !sameHash(sha256(code), pairing.codeHash)) {
      if (pairing.attempts >= maxPairingAttempts) { pairing = null; emit("pairing_locked"); throw bridgeError("FIGMA_BRIDGE_PAIRING_LOCKED", "Trop d'essais : génère un nouveau code dans Noon.", 429); }
      throw bridgeError("FIGMA_BRIDGE_PAIRING_INVALID", "Code incorrect.", 401);
    }
    const token = randomBytes(32).toString("base64url");
    // Un nouveau jumelage remplace l'ancien : l'ancien jeton cesse de fonctionner.
    state = { tokenHash: sha256(token), pairedAt: new Date(now()).toISOString() };
    saveState();
    pairing = null;
    touchPresence({ pluginVersion: safeText(body?.pluginVersion, 20) });
    emit("paired");
    return { status: "ok", token };
  }

  function deliver() {
    if (!waiter || !queue.length) return;
    const { res, timer } = waiter; waiter = null; clearTimeout(timer);
    send(res, 200, { status: "ok", command: queue.shift() });
  }

  function waitForCommand(req, res) {
    touchPresence();
    if (waiter) { clearTimeout(waiter.timer); send(waiter.res, 204); }
    const timer = setTimeout(() => { if (waiter?.res === res) { waiter = null; send(res, 204); } }, pollTimeoutMs);
    timer.unref?.();
    waiter = { res, timer };
    req.on("close", () => { if (waiter?.res === res && !res.writableEnded) { clearTimeout(timer); waiter = null; } });
    deliver();
  }

  function acceptResult(body) {
    const entry = pending.get(String(body?.id || ""));
    if (!entry) throw bridgeError("FIGMA_BRIDGE_COMMAND_UNKNOWN", "Commande inconnue ou expirée.", 404);
    pending.delete(entry.id); clearTimeout(entry.timer);
    if (body.ok === true) entry.resolve(body.result ?? null);
    else {
      const code = /^[A-Z0-9_]{1,60}$/.test(String(body?.error?.code || "")) ? body.error.code : "FIGMA_PLUGIN_ERROR";
      entry.reject(bridgeError(code, safeText(body?.error?.message, 300) || "Le plugin Figma a refusé la commande."));
    }
    return { status: "ok" };
  }

  async function handle(req, res) {
    const url = new URL(req.url, `http://${host}`);
    if (req.method === "OPTIONS") return send(res, 204);
    if (!url.pathname.startsWith(PREFIX)) return send(res, 404, { status: "error", code: "FIGMA_BRIDGE_ROUTE_UNKNOWN" });
    const route = url.pathname.slice(PREFIX.length);
    try {
      if (req.method === "POST" && route === "pair") return send(res, 200, pair(await readBody(req, SMALL_BODY)));
      if (!authorized(req)) return send(res, 401, { status: "error", code: "FIGMA_BRIDGE_UNAUTHORIZED", message: "Jumelage requis." });
      if (req.method === "POST" && route === "hello") {
        const body = await readBody(req, SMALL_BODY);
        touchPresence({ fileName: safeText(body.fileName), pageName: safeText(body.pageName), editorType: safeText(body.editorType, 20), pluginVersion: safeText(body.pluginVersion, 20) });
        return send(res, 200, { status: "ok" });
      }
      if (req.method === "GET" && route === "next") return waitForCommand(req, res);
      if (req.method === "POST" && route === "result") { touchPresence(); return send(res, 200, acceptResult(await readBody(req, RESULT_BODY))); }
      return send(res, 405, { status: "error", code: "FIGMA_BRIDGE_METHOD_NOT_ALLOWED" });
    } catch (error) {
      return send(res, error.statusCode || 500, { status: "error", code: error.code || "FIGMA_BRIDGE_ERROR", message: error.code ? error.message : "Erreur de la passerelle Figma." });
    }
  }

  function start() {
    if (server?.listening) return Promise.resolve({ port: boundPort() });
    server = http.createServer((req, res) => { void handle(req, res); });
    return new Promise((resolve, reject) => {
      server.once("error", (error) => { server = null; reject(bridgeError(error.code === "EADDRINUSE" ? "FIGMA_BRIDGE_PORT_IN_USE" : "FIGMA_BRIDGE_START_FAILED", error.code === "EADDRINUSE" ? `Le port ${port} est déjà utilisé sur ce Mac.` : "Passerelle Figma impossible à démarrer.", 503)); });
      server.listen(port, host, () => {
        const bound = server.address().port;
        if (host === "127.0.0.1") {
          serverV6 = http.createServer((req, res) => { void handle(req, res); });
          serverV6.once("error", () => { serverV6 = null; });
          serverV6.listen(bound, "::1");
        }
        emit("listening", { port: bound });
        resolve({ port: bound });
      });
    });
  }

  function failPending(code, message) {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(bridgeError(code, message, 503)); }
    pending.clear(); queue.length = 0;
  }

  async function stop() {
    if (waiter) { clearTimeout(waiter.timer); send(waiter.res, 204); waiter = null; }
    failPending("FIGMA_BRIDGE_STOPPED", "Passerelle Figma arrêtée.");
    presence = null;
    if (!server) return;
    if (serverV6) { const v6 = serverV6; serverV6 = null; v6.closeAllConnections?.(); v6.close(() => {}); }
    const closing = server; server = null;
    closing.closeAllConnections?.();
    await new Promise((resolve) => closing.close(() => resolve()));
  }

  // ---------- Côté Noon ----------

  async function createPairingCode() {
    await start();
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    pairing = { codeHash: sha256(code), expiresAt: now() + pairingTtlMs, attempts: 0 };
    emit("pairing_code_created");
    return { code, expiresAt: new Date(pairing.expiresAt).toISOString(), port: boundPort() };
  }

  function unpair() {
    state = {}; saveState(); presence = null; pairing = null;
    failPending("FIGMA_BRIDGE_UNPAIRED", "Plugin Figma dissocié.");
    emit("unpaired");
    return status();
  }

  function request(type, params = {}, { timeoutMs = null, authorizedWrite = false } = {}) {
    const write = WRITE_COMMANDS.includes(type);
    if (!READ_COMMANDS.includes(type) && !write) return Promise.reject(bridgeError("FIGMA_BRIDGE_COMMAND_NOT_ALLOWED", "Commande Figma non autorisée.", 400));
    if (write && authorizedWrite !== true) return Promise.reject(bridgeError("FIGMA_BRIDGE_WRITE_NOT_AUTHORIZED", "Écriture Figma refusée sans validation de l'utilisateur.", 403));
    const effectiveTimeoutMs = timeoutMs ?? (write ? Math.max(requestTimeoutMs, WRITE_TIMEOUT_MS) : requestTimeoutMs);
    if (!paired()) return Promise.reject(bridgeError("FIGMA_BRIDGE_NOT_PAIRED", "Plugin Figma non jumelé.", 409));
    if (!connected()) return Promise.reject(bridgeError("FIGMA_BRIDGE_NOT_CONNECTED", "Ouvre le plugin « Noon Bridge » dans Figma.", 409));
    const id = `fig-${crypto.randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        const index = queue.findIndex((command) => command.id === id);
        if (index >= 0) queue.splice(index, 1);
        reject(bridgeError("FIGMA_BRIDGE_TIMEOUT", write ? "Le plugin Figma n'a pas confirmé à temps : vérifie dans Figma ce qui a été appliqué." : "Le plugin Figma n'a pas répondu à temps.", 504));
      }, effectiveTimeoutMs);
      timer.unref?.();
      pending.set(id, { id, resolve, reject, timer });
      queue.push({ id, type, params: params && typeof params === "object" ? params : {} });
      emit("command_sent", { type, write });
      deliver();
    });
  }

  return Object.freeze({ start, stop, status, createPairingCode, unpair, request, isPaired: paired });
}

module.exports = { DEFAULT_PORT, READ_COMMANDS, WRITE_COMMANDS, createFigmaBridge };
