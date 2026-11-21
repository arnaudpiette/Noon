"use strict";

// Compagnon iPhone — IP-3 : composition dans Noon, commandes locales /api/remote-lan/* et
// panneau « Compagnon iPhone » du Control Center.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { Readable } = require("node:stream");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createSyncCrypto } = require("../services/sync/sync-crypto");
const { QR_PREFIX } = require("../services/remote/remote-lan-gateway");
const { createRemoteLanService, pickLanAddress } = require("../services/remote/remote-lan-service");
const { createRemoteLanHttpRoutes, qrMatrix } = require("../services/remote/remote-lan-http-routes");
const { readJsonBody } = require("../services/http/request-utils");

const PUBLIC = path.join(__dirname, "..", "public");
const SPKI = { ed25519: "302a300506032b6570032100", x25519: "302a300506032b656e032100" };
const rawToPem = (type, key) => `-----BEGIN PUBLIC KEY-----\n${Buffer.concat([Buffer.from(SPKI[type], "hex"), Buffer.from(key.export({ format: "jwk" }).x, "base64url")]).toString("base64")}\n-----END PUBLIC KEY-----\n`;

function makePhone() {
  const signing = crypto.generateKeyPairSync("ed25519"); const encryption = crypto.generateKeyPairSync("x25519");
  const identity = {
    deviceId: `device_${crypto.randomUUID()}`, deviceType: "IPHONE", displayName: "iPhone d'Arnaud",
    publicSigningKey: rawToPem("ed25519", signing.publicKey), publicEncryptionKey: rawToPem("x25519", encryption.publicKey),
    privateSigningKey: signing.privateKey.export({ type: "pkcs8", format: "pem" }), privateEncryptionKey: encryption.privateKey.export({ type: "pkcs8", format: "pem" }), keyId: "phone",
  };
  return { identity, crypto: createSyncCrypto({ identity }) };
}

function memorySecureStore(persistent = true) {
  const values = new Map();
  return { persistent, get: (key) => (values.has(key) ? JSON.parse(values.get(key)) : null), set: (key, value) => { values.set(key, JSON.stringify(value)); return { persistent }; }, values };
}

function setup({ secureStore = memorySecureStore(), lanAddress = () => "127.0.0.1", databaseWrapper = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-lan-svc-"));
  let flag = true;
  const events = [];
  const options = { isEnabled: () => flag, databaseWrapper: databaseWrapper || createPersonalDatabase(path.join(root, "p.sqlite")), secureStore, port: 0, lanAddress, allowLoopback: true, observability: (event) => events.push(event) };
  const service = createRemoteLanService(options);
  const routes = createRemoteLanHttpRoutes({ isEnabled: () => flag, service: () => service });
  async function call(method, requestPath, body, headers = { "x-noon-request": "1" }) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.method = method; req.headers = headers;
    let status = 0; let payload = "";
    const res = { writeHead: (code) => { status = code; }, end: (text) => { payload = text; } };
    assert.ok(routes.matches(requestPath), requestPath);
    await routes.handle(req, res, { requestPath, readJsonBody });
    return { status, body: JSON.parse(payload) };
  }
  return { service, call, options, events, setFlag: (value) => { flag = value; } };
}

async function gatewayPost(lan, route, body) {
  const response = await fetch(`http://${lan.host}:${lan.port}${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

test("routes : 404 si remote.lan est OFF, en-tête Noon obligatoire, rien n'écoute avant « Démarrer »", async () => {
  const h = setup();
  const status = await h.call("GET", "/api/remote-lan/status");
  assert.equal(status.status, 200);
  assert.equal(status.body.lan.listening, false);
  assert.equal(h.service.isListening(), false);
  assert.equal((await h.call("POST", "/api/remote-lan/start", {}, {})).body.code, "REMOTE_LAN_REQUEST_REFUSED");
  assert.equal((await h.call("POST", "/api/remote-lan/invitations", {})).body.code, "REMOTE_LAN_NOT_LISTENING");
  assert.equal((await h.call("POST", "/api/remote-lan/start", { port: 80 })).body.code, "REMOTE_LAN_BODY_INVALID");
  assert.equal((await h.call("DELETE", "/api/remote-lan/status")).status, 405);
  h.setFlag(false);
  const off = await h.call("GET", "/api/remote-lan/status");
  assert.equal(off.status, 404); assert.equal(off.body.code, "REMOTE_LAN_DISABLED");
  assert.equal(createRemoteLanHttpRoutes({ isEnabled: () => true, service: () => null }).matches("/api/remote-lan/../selfdev"), false);
});

test("démarrage refusé sans coffre persistant ou sans réseau local", async () => {
  const noVault = setup({ secureStore: memorySecureStore(false) });
  assert.equal((await noVault.call("POST", "/api/remote-lan/start", {})).body.code, "REMOTE_LAN_KEYSTORE_UNAVAILABLE");
  assert.equal((await noVault.call("GET", "/api/remote-lan/status")).body.lan.keystore, false);
  const noLan = setup({ lanAddress: () => null });
  assert.equal((await noLan.call("POST", "/api/remote-lan/start", {})).body.code, "REMOTE_LAN_NO_NETWORK");
  assert.equal(noLan.service.isListening(), false);
});

test("parcours complet : démarrer, inviter (QR), appairer, approuver avec scopes, ping chiffré, révoquer, arrêter", async () => {
  const h = setup();
  try {
    const started = await h.call("POST", "/api/remote-lan/start", {});
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const lan = started.body.lan;
    assert.equal(lan.listening, true); assert.equal(lan.host, "127.0.0.1"); assert.match(lan.macFingerprint, /^[0-9a-f]{16}$/);

    const invite = await h.call("POST", "/api/remote-lan/invitations", {});
    const modules = invite.body.invitation.modules;
    assert.ok(modules.length >= 21 && modules.length % 4 === 1 && modules.every((row) => /^[01]+$/.test(row) && row.length === modules.length));
    assert.equal(JSON.stringify(invite.body).includes("token"), false, "le jeton n'est livré que dans le QR");

    // L'iPhone scanne une invitation (le test lit directement la chaîne du QR).
    const phone = makePhone();
    const scanned = JSON.parse(Buffer.from(h.service.createInvitation().qr.slice(QR_PREFIX.length), "base64url").toString("utf8"));
    assert.equal(scanned.host, "127.0.0.1"); assert.equal(scanned.port, lan.port);
    const { privateSigningKey: _s, privateEncryptionKey: _e, ...publicDevice } = phone.identity;
    const begin = await gatewayPost(lan, "/v1/pair/begin", { protocolVersion: 1, invitationToken: scanned.token, device: { ...publicDevice, requestedScopes: ["CONVERSATIONS", "JOB_STATUS"] } });
    assert.equal(begin.status, 200, JSON.stringify(begin.body));

    const pending = (await h.call("GET", "/api/remote-lan/status")).body.lan.pendingPairings;
    assert.equal(pending.length, 1);
    assert.equal(pending[0].verificationCode, begin.body.verificationCode);
    assert.equal(JSON.stringify(pending).includes("pairingCode"), false);
    assert.equal((await h.call("GET", "/api/remote-lan/status")).body.lan.devices.length, 0, "un appareil en attente n'apparaît pas comme appairé");

    assert.equal((await h.call("POST", `/api/remote-lan/pairings/${pending[0].pairingId}/approve`, { grantedScopes: ["NOTIFICATIONS"] })).body.code, "PAIRING_SCOPE_ESCALATION");
    assert.equal((await h.call("POST", `/api/remote-lan/pairings/${pending[0].pairingId}/approve`, { grantedScopes: "JOB_STATUS" })).body.code, "REMOTE_LAN_BODY_INVALID");
    const approved = await h.call("POST", `/api/remote-lan/pairings/${pending[0].pairingId}/approve`, { grantedScopes: ["CONVERSATIONS"] });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.deepEqual(approved.body.device.scopes, ["CONVERSATIONS"]);

    const macDevice = { deviceId: begin.body.mac.deviceId, ...begin.body.mac };
    const ping = phone.crypto.seal({ targetDevice: macDevice, header: { entityType: "remote.ping", entityId: "ping", operation: "UPSERT", entityVersion: 1 }, payload: {} });
    const pong = await gatewayPost(lan, "/v1/envelopes", ping);
    assert.equal(pong.status, 200, JSON.stringify(pong.body));
    assert.equal(phone.crypto.open(pong.body.envelope, macDevice).pong, true);
    const other = phone.crypto.seal({ targetDevice: macDevice, header: { entityType: "remote.shell", entityId: "x", operation: "UPSERT", entityVersion: 1 }, payload: { command: "rm -rf" } });
    assert.equal(phone.crypto.open((await gatewayPost(lan, "/v1/envelopes", other)).body.envelope, macDevice).code, "REMOTE_LAN_NOT_SUPPORTED");

    const devices = (await h.call("GET", "/api/remote-lan/status")).body.lan.devices;
    assert.equal(devices.length, 1); assert.equal(devices[0].status, "ACTIVE"); assert.ok(devices[0].lastSeenAt);

    assert.equal((await h.call("POST", `/api/remote-lan/devices/${phone.identity.deviceId}/revoke`, {})).body.revoked, true);
    const afterRevoke = phone.crypto.seal({ targetDevice: macDevice, header: { entityType: "remote.ping", entityId: "p2", operation: "UPSERT", entityVersion: 1 }, payload: {} });
    assert.equal((await gatewayPost(lan, "/v1/envelopes", afterRevoke)).body.code, "REMOTE_LAN_DEVICE_NOT_ACTIVE");
    assert.equal((await h.call("POST", "/api/remote-lan/devices/device_inconnu/revoke", {})).body.code, "REMOTE_LAN_DEVICE_UNKNOWN");

    const stopped = await h.call("POST", "/api/remote-lan/stop", {});
    assert.equal(stopped.body.lan.listening, false);
    await assert.rejects(fetch(`http://${lan.host}:${lan.port}/v1/pair/status`));
  } finally { await h.service.stop(); }
});

test("identité du Mac conservée dans le coffre : même empreinte après redémarrage de Noon", async () => {
  const secureStore = memorySecureStore();
  const first = setup({ secureStore });
  const fingerprint = (await first.call("GET", "/api/remote-lan/status")).body.lan.macFingerprint;
  assert.match(fingerprint, /^[0-9a-f]{16}$/);
  const stored = [...secureStore.values.values()][0];
  assert.ok(stored.includes("privateSigningKey"), "clés privées uniquement dans le coffre");
  const second = setup({ secureStore, databaseWrapper: first.options.databaseWrapper });
  assert.equal((await second.call("GET", "/api/remote-lan/status")).body.lan.macFingerprint, fingerprint);
});

test("kill switch : flag repassé OFF → écoute arrêtée et passerelle muette", async () => {
  const h = setup();
  const { lan } = (await h.call("POST", "/api/remote-lan/start", {})).body;
  h.setFlag(false);
  const response = await fetch(`http://${lan.host}:${lan.port}/v1/pair/status`).catch(() => null);
  if (response) assert.equal(response.status, 404);
  h.service.status();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(h.service.isListening(), false);
});

test("adresse d'écoute : IPv4 privée, en0 en priorité, jamais publique, interne ou lien local", () => {
  assert.equal(pickLanAddress({
    lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    en5: [{ address: "10.0.0.5", family: "IPv4", internal: false }],
    en0: [{ address: "fe80::1", family: "IPv6", internal: false }, { address: "192.168.1.20", family: "IPv4", internal: false }],
    utun3: [{ address: "100.64.0.1", family: "IPv4", internal: false }],
  }), "192.168.1.20");
  assert.equal(pickLanAddress({ en1: [{ address: "169.254.3.4", family: "IPv4", internal: false }], en2: [{ address: "8.8.8.8", family: "IPv4", internal: false }] }), null);
  assert.equal(pickLanAddress({ en7: [{ address: "172.20.1.2", family: 4, internal: false }] }), "172.20.1.2");
});

test("matrice QR : carrée, motifs de repérage présents", () => {
  const rows = qrMatrix(`${QR_PREFIX}${"a".repeat(360)}`);
  assert.equal(rows.length % 4, 1);
  for (const [r, c] of [[0, 0], [0, rows.length - 7], [rows.length - 7, 0]]) {
    assert.equal(rows[r].slice(c, c + 7), "1111111");
    assert.equal(rows[r + 1].slice(c, c + 7), "1000001");
    assert.equal(rows[r + 3].slice(c, c + 7), "1011101");
  }
});

// ---------- Interface ----------

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.hidden = false; this.disabled = false; this.checked = false;
    this.className = ""; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.ownText = ""; this.type = "";
  }
  get childNodes() { return this.children; }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.children = []; this.ownText = String(value); }
  set innerHTML(_) { throw new Error("innerHTML interdit"); }
  get innerHTML() { throw new Error("innerHTML interdit"); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; this.ownText = ""; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  dispatch(type) { for (const handler of this.listeners[type] || []) handler({ target: this }); }
  click() { this.dispatch("click"); }
}
const all = (node) => node.children.flatMap((child) => [child, ...all(child)]);
const buttonByText = (root, text) => all(root).find((node) => node.tagName === "BUTTON" && node.textContent === text);
const settle = async () => { for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setImmediate(resolve)); };

function loadUi({ status, replies = {}, confirm = () => true }) {
  const document = { createElement: (tag) => new FakeElement(tag), createElementNS: (_ns, tag) => new FakeElement(tag), createTextNode: (text) => { const node = new FakeElement("#text"); node.ownText = String(text); return node; } };
  const context = { document, Promise, Object, String, Array, Set, Map, Number, JSON, Error, TypeError, Date };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(PUBLIC, "iphone-companion-ui.js"), "utf8"), context);
  const ui = context.window.NoonIphoneCompanionUi;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method, headers: { ...(options.headers || {}) }, body: options.body ? JSON.parse(options.body) : undefined });
    if (options.method === "GET") return status === 404 ? { ok: false, status: 404, json: async () => ({ code: "REMOTE_LAN_DISABLED" }) } : { ok: true, status: 200, json: async () => ({ status: "ok", lan: typeof status === "function" ? status() : status }) };
    const reply = replies[`${options.method} ${url}`];
    if (reply?.error) return { ok: false, status: 409, json: async () => ({ code: reply.error, message: "brut" }) };
    return { ok: true, status: 200, json: async () => reply || { status: "ok" } };
  };
  const root = new FakeElement("section"); root.ownerDocument = document; root.hidden = true;
  const timers = [];
  const controller = ui.createIphoneCompanionController({ elements: { root }, api: ui.createIphoneCompanionApi({ fetchImpl }), confirmImpl: confirm, now: () => Date.parse("2026-11-21T10:00:00Z"), setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
  return { controller, root, calls, timers };
}

const baseStatus = (overrides = {}) => ({ enabled: true, keystore: true, listening: false, host: null, port: null, macFingerprint: "0123456789abcdef", scopeLabels: { CONVERSATIONS: "Conversations", JOB_STATUS: "État des tâches" }, pendingPairings: [], devices: [], ...overrides });

test("UI : panneau masqué si le flag est OFF (404)", async () => {
  const { controller, root } = loadUi({ status: 404 });
  assert.equal(await controller.init(), false);
  assert.equal(root.hidden, true);
});

test("UI : démarrer, inviter (QR en SVG), approuver après comparaison du code, révoquer avec confirmation", async () => {
  let current = baseStatus();
  const { controller, root, calls } = loadUi({
    status: () => current,
    replies: { "POST /api/remote-lan/invitations": { status: "ok", invitation: { expiresAt: "2026-11-21T10:05:00Z", host: "192.168.1.20", port: 47830, modules: ["111", "101", "111"] } } },
  });
  assert.equal(await controller.init(), true);
  assert.equal(root.hidden, false);
  assert.match(root.textContent, /Rien n'écoute sur le réseau/);
  buttonByText(root, "Démarrer").click(); await settle();
  assert.deepEqual(calls.at(-2), { url: "/api/remote-lan/start", method: "POST", headers: { "X-Noon-Request": "1", "Content-Type": "application/json" }, body: {} });

  current = baseStatus({ listening: true, host: "192.168.1.20", port: 47830 });
  await controller.refresh();
  assert.match(root.textContent, /192\.168\.1\.20:47830/);
  assert.match(root.textContent, /0123 4567 89ab cdef/);
  buttonByText(root, "Inviter un iPhone").click(); await settle();
  const svg = all(root).find((node) => node.tagName === "SVG");
  assert.ok(svg, "QR dessiné"); assert.equal(svg.attributes.viewBox, "0 0 11 11");
  assert.match(all(svg).find((node) => node.tagName === "PATH").attributes.d, /^M4 4h1v1h-1z/);

  current = baseStatus({ listening: true, host: "192.168.1.20", port: 47830, pendingPairings: [{ pairingId: "pairing_abc123", displayName: "iPhone d'Arnaud", verificationCode: "021320", requestedScopes: ["CONVERSATIONS", "JOB_STATUS"], expiresAt: "2026-11-21T10:05:00Z" }] });
  await controller.refresh();
  assert.equal(all(root).some((node) => node.tagName === "SVG"), false, "le QR disparaît dès que l'iPhone a scanné");
  assert.match(root.textContent, /021 320/);
  const approve = buttonByText(root, "Les codes sont identiques : approuver");
  assert.equal(approve.disabled, true, "aucune autorisation cochée par défaut");
  const checkbox = all(root).find((node) => node.tagName === "INPUT" && node.type === "checkbox");
  checkbox.checked = true; checkbox.dispatch("change");
  buttonByText(root, "Les codes sont identiques : approuver").click(); await settle();
  const approval = calls.find((call) => call.url.endsWith("/approve"));
  assert.deepEqual(approval.body, { grantedScopes: ["CONVERSATIONS"] });
  assert.equal(approval.url, "/api/remote-lan/pairings/pairing_abc123/approve");

  current = baseStatus({ listening: true, host: "192.168.1.20", port: 47830, devices: [{ deviceId: "device_1", displayName: "<img src=x>", deviceType: "IPHONE", status: "ACTIVE", scopes: ["CONVERSATIONS"], lastSeenAt: null }] });
  await controller.refresh();
  assert.match(root.textContent, /<img src=x>/, "nom rendu en texte brut");
  assert.match(root.textContent, /Autorisations : Conversations/);
  buttonByText(root, "Révoquer").click(); await settle();
  assert.ok(calls.some((call) => call.url === "/api/remote-lan/devices/device_1/revoke"));
});

test("UI : révocation annulée → aucune requête ; erreur serveur → message traduit", async () => {
  const current = baseStatus({ listening: true, host: "192.168.1.20", port: 47830, devices: [{ deviceId: "device_1", displayName: "iPhone", deviceType: "IPHONE", status: "ACTIVE", scopes: [] }] });
  const { controller, root, calls } = loadUi({ status: () => current, confirm: () => false, replies: { "POST /api/remote-lan/invitations": { error: "REMOTE_LAN_NOT_LISTENING" } } });
  await controller.init();
  buttonByText(root, "Révoquer").click(); await settle();
  assert.equal(calls.some((call) => call.url.endsWith("/revoke")), false);
  assert.equal(all(root).some((node) => node.attributes?.role === "alert"), false);
  buttonByText(root, "Inviter un iPhone").click(); await settle();
  assert.match(root.textContent, /Démarre d'abord la passerelle\./);
  assert.equal(root.textContent.includes("brut"), false);
});

test("câblage : Control Center, index, app et serveur", () => {
  const index = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  assert.ok(index.includes('id="controlCenterIphone"'));
  assert.ok(index.indexOf('<script src="iphone-companion-ui.js"></script>') < index.indexOf('<script src="app.js"></script>'));
  assert.match(fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8"), /window\.NoonControlCenter\?\.setIphoneCompanionAvailable\?\.\(available === true\)/);
  assert.match(fs.readFileSync(path.join(PUBLIC, "control-center.js"), "utf8"), /\[IPHONE_SECTION\]: "Compagnon iPhone"/);
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /req\.url === "\/iphone-companion-ui\.js"/);
  assert.match(server, /featureFlags\.evaluate\("remote\.lan", \{\}\)\.mode !== "OFF"/);
  assert.match(server, /secureStore: integrationTokenStore/);
  assert.equal(/listen\(\{[^}]*0\.0\.0\.0/.test(fs.readFileSync(path.join(__dirname, "..", "services", "remote", "remote-lan-service.js"), "utf8")), false);
});
