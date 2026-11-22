"use strict";

// Passerelle Noon ⇄ plugin Figma « Noon Bridge » : jumelage par code, jeton jamais stocké en
// clair, liste blanche de commandes (lecture seule dans cette tranche), refus sans jeton.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createFigmaBridge, READ_COMMANDS } = require("../services/figma-bridge/figma-bridge");
const { createFigmaBridgeHttpRoutes } = require("../services/figma-bridge/figma-bridge-http-routes");

const ROOT = path.join(__dirname, "..");

async function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-figma-bridge-"));
  const stateFile = path.join(directory, "figma-bridge.json");
  const events = [];
  const bridge = createFigmaBridge({ stateFile, port: 0, pollTimeoutMs: 300, requestTimeoutMs: 2000, observability: (event) => events.push(event), ...options });
  const pairing = await bridge.createPairingCode();
  // Port 0 en test : le port réellement attribué est renvoyé par createPairingCode.
  const base = `http://127.0.0.1:${pairing.port}/figma-bridge/v1/`;
  return { bridge, pairing, base, stateFile, events, directory, close: async () => { await bridge.stop(); fs.rmSync(directory, { recursive: true, force: true }); } };
}

const call = (base, method, route, { token, body } = {}) => fetch(base + route, {
  method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { "X-Noon-Figma-Token": token } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});

test("jumelage : mauvais code refusé, bon code → jeton ; seule l'empreinte est stockée", async () => {
  const fx = await fixture();
  try {
    assert.match(fx.pairing.code, /^\d{6}$/);
    const wrong = await call(fx.base, "POST", "pair", { body: { code: fx.pairing.code === "000000" ? "111111" : "000000" } });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get("access-control-allow-origin"), "*", "iframe Figma à origine nulle");
    const ok = await call(fx.base, "POST", "pair", { body: { code: fx.pairing.code } });
    assert.equal(ok.status, 200);
    const { token } = await ok.json();
    assert.ok(token.length >= 40);
    const saved = fs.readFileSync(fx.stateFile, "utf8");
    assert.doesNotMatch(saved, new RegExp(token), "jeton jamais en clair");
    assert.match(JSON.parse(saved).tokenHash, /^[0-9a-f]{64}$/);
    assert.equal(fx.bridge.status().paired, true);
    const reused = await call(fx.base, "POST", "pair", { body: { code: fx.pairing.code } });
    assert.equal(reused.status, 410, "code à usage unique");
  } finally { await fx.close(); }
});

test("jumelage : 5 essais faux verrouillent le code", async () => {
  const fx = await fixture({ maxPairingAttempts: 3 });
  try {
    const bad = fx.pairing.code === "000000" ? "111111" : "000000";
    assert.equal((await call(fx.base, "POST", "pair", { body: { code: bad } })).status, 401);
    assert.equal((await call(fx.base, "POST", "pair", { body: { code: bad } })).status, 401);
    assert.equal((await call(fx.base, "POST", "pair", { body: { code: bad } })).status, 429);
    assert.equal((await call(fx.base, "POST", "pair", { body: { code: fx.pairing.code } })).status, 410, "même le bon code ne passe plus");
  } finally { await fx.close(); }
});

test("sans jeton valide : hello, next et result refusés ; OPTIONS répond pour le pré-vol CORS", async () => {
  const fx = await fixture();
  try {
    assert.equal((await call(fx.base, "OPTIONS", "next")).status, 204);
    for (const [method, route] of [["POST", "hello"], ["GET", "next"], ["POST", "result"]]) {
      assert.equal((await call(fx.base, method, route, { token: "x".repeat(43), body: method === "POST" ? {} : undefined })).status, 401, route);
    }
  } finally { await fx.close(); }
});

test("aller-retour : Noon envoie get_page, le plugin répond, Noon reçoit le résultat", async () => {
  const fx = await fixture();
  try {
    const { token } = await (await call(fx.base, "POST", "pair", { body: { code: fx.pairing.code } })).json();
    await call(fx.base, "POST", "hello", { token, body: { fileName: "Maquette fictive", pageName: "Page 1", editorType: "figma" } });
    assert.equal(fx.bridge.status().connected, true);
    assert.equal(fx.bridge.status().file.fileName, "Maquette fictive");
    const pending = fx.bridge.request("get_page", {});
    const next = await call(fx.base, "GET", "next", { token });
    assert.equal(next.status, 200);
    const { command } = await next.json();
    assert.equal(command.type, "get_page");
    await call(fx.base, "POST", "result", { token, body: { id: command.id, ok: true, result: { pageName: "Page 1", childCount: 3 } } });
    assert.deepEqual(await pending, { pageName: "Page 1", childCount: 3 });
    const failing = assert.rejects(fx.bridge.request("get_selection", {}), { code: "FIGMA_PLUGIN_ERROR", message: "Refus fictif" });
    const second = await (await call(fx.base, "GET", "next", { token })).json();
    await call(fx.base, "POST", "result", { token, body: { id: second.command.id, ok: false, error: { code: "FIGMA_PLUGIN_ERROR", message: "Refus fictif" } } });
    await failing;
  } finally { await fx.close(); }
});

test("liste blanche : aucune commande d'écriture dans cette tranche ; plugin fermé ou non jumelé refusé", async () => {
  assert.deepEqual([...READ_COMMANDS], ["ping", "get_selection", "get_page"]);
  const fx = await fixture();
  try {
    await assert.rejects(fx.bridge.request("create_frame", {}), { code: "FIGMA_BRIDGE_COMMAND_NOT_ALLOWED" });
    await assert.rejects(fx.bridge.request("get_page", {}), { code: "FIGMA_BRIDGE_NOT_PAIRED" });
    const { token } = await (await call(fx.base, "POST", "pair", { body: { code: fx.pairing.code } })).json();
    assert.ok(token);
    fx.bridge.unpair();
    assert.equal(fx.bridge.status().paired, false);
    assert.equal((await call(fx.base, "POST", "hello", { token, body: {} })).status, 401, "jeton révoqué par la dissociation");
  } finally { await fx.close(); }
});

test("le plugin attend sans commande puis répond 204 ; la commande expire si le plugin ne répond pas", async () => {
  const fx = await fixture({ requestTimeoutMs: 200 });
  try {
    const { token } = await (await call(fx.base, "POST", "pair", { body: { code: fx.pairing.code } })).json();
    assert.equal((await call(fx.base, "GET", "next", { token })).status, 204);
    await call(fx.base, "POST", "hello", { token, body: {} });
    await assert.rejects(fx.bridge.request("ping", {}), { code: "FIGMA_BRIDGE_TIMEOUT" });
  } finally { await fx.close(); }
});

test("routes Control Center : 404 si flag OFF, mutations exigent x-noon-request", async () => {
  const bridge = { status: () => ({ paired: false }), createPairingCode: async () => ({ code: "123456" }), unpair: () => ({ paired: false }), request: async () => ({ pageName: "P" }) };
  const respond = () => { const res = { statusCode: 0, body: null, writeHead(code) { this.statusCode = code; }, end(text) { this.body = JSON.parse(text); } }; return res; };
  let enabled = false;
  const routes = createFigmaBridgeHttpRoutes({ isEnabled: () => enabled, bridge });
  let res = respond();
  await routes.handle({ method: "GET", headers: {} }, res, { requestPath: "/api/figma-bridge" });
  assert.equal(res.statusCode, 404); assert.equal(res.body.code, "FIGMA_BRIDGE_DISABLED");
  enabled = true;
  res = respond();
  await routes.handle({ method: "POST", headers: {} }, res, { requestPath: "/api/figma-bridge/pairing-code" });
  assert.equal(res.statusCode, 403);
  res = respond();
  await routes.handle({ method: "POST", headers: { "x-noon-request": "1" } }, res, { requestPath: "/api/figma-bridge/pairing-code" });
  assert.equal(res.statusCode, 200); assert.equal(res.body.pairing.code, "123456");
  assert.equal(routes.matches("/api/figma-bridge/test"), true);
  assert.equal(routes.matches("/api/figma-bridge/delete"), false);
});

test("plugin : manifeste limité à 127.0.0.1:3856, code principal en liste blanche de lecture", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "figma-plugin/noon-bridge/manifest.json"), "utf8"));
  assert.deepEqual(manifest.networkAccess.allowedDomains, ["none"]);
  assert.ok(manifest.networkAccess.devAllowedDomains.every((domain) => /^http:\/\/(127\.0\.0\.1|localhost):3856$/.test(domain)));
  const code = fs.readFileSync(path.join(ROOT, "figma-plugin/noon-bridge/code.js"), "utf8");
  const sandbox = { figma: { showUI() {}, on() {}, ui: { postMessage() {} }, currentPage: { name: "P", selection: [], children: [] }, root: { name: "F" }, editorType: "figma", clientStorage: {} }, __html__: "" };
  vm.runInNewContext(code, sandbox);
  assert.deepEqual(Object.keys(vm.runInNewContext("COMMANDS", sandbox)).sort(), [...READ_COMMANDS].sort());
  assert.doesNotMatch(code, /\bcreate[A-Z]\w*\(|\.remove\(\)|setAsync\("noonToken", [^t]/, "aucune écriture du fichier dans cette tranche");
  const ui = fs.readFileSync(path.join(ROOT, "figma-plugin/noon-bridge/ui.html"), "utf8");
  assert.match(ui, /http:\/\/127\.0\.0\.1:3856\/figma-bridge\/v1\//);
  assert.doesNotMatch(ui, /innerHTML|localStorage/);
});

test("câblage : flag OFF par défaut, routes branchées, plugin exclu de Noon.app", () => {
  const { FEATURE_FLAGS } = require("../services/config/feature-flag-registry");
  const list = Array.isArray(FEATURE_FLAGS) ? FEATURE_FLAGS : Object.values(require("../services/config/feature-flag-registry")).find(Array.isArray);
  const flag = list.find((entry) => entry.flagId === "figma.bridge");
  assert.equal(flag.defaultMode, "OFF");
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  assert.match(server, /figmaBridgeHttpRoutes\.matches\(requestPath\)/);
  assert.match(server, /featureFlags\.evaluate\("figma\.bridge", \{\}\)\.enabled/);
  assert.match(fs.readFileSync(path.join(ROOT, "forge.config.js"), "utf8"), /figma-plugin/);
  assert.match(fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8"), /id="figmaBridgePanel"/);
});

test("panneau Control Center : texte seulement, aucun stockage navigateur, entrée gérée par flag", () => {
  const ui = fs.readFileSync(path.join(ROOT, "public/figma-bridge-ui.js"), "utf8");
  assert.doesNotMatch(ui, /innerHTML|localStorage|sessionStorage|indexedDB/);
  assert.match(ui, /"X-Noon-Request"\] = "1"/);
  const center = fs.readFileSync(path.join(ROOT, "public/control-center.js"), "utf8");
  assert.match(center, /setFigmaBridgeAvailable/);
  const { STATIC_ASSETS } = require("../services/http/static-assets");
  assert.deepEqual(STATIC_ASSETS["/figma-bridge-ui.js"].file, ["figma-bridge-ui.js"]);
});
