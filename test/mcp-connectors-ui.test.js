"use strict";
const { readServerSource } = require("./helpers/server-source");
const { readAppSource } = require("./helpers/app-source");

// UI des connecteurs MCP sans navigateur : vm + faux DOM (innerHTML interdit).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const PUBLIC = path.join(__dirname, "..", "public");
const UI_SOURCE = fs.readFileSync(path.join(PUBLIC, "mcp-connectors-ui.js"), "utf8");

class FakeElement {
  constructor(tag, id = null) {
    this.tagName = String(tag).toUpperCase();
    this.id = id;
    this.children = [];
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.className = "";
    this.dataset = {};
    this.listeners = {};
    this.attributes = {};
    this.ownText = "";
    this.open = false;
    this.type = "";
    const element = this;
    this.classList = {
      toggle(name, force) {
        const names = new Set(element.className.split(/\s+/).filter(Boolean));
        if (force === undefined ? !names.has(name) : force) names.add(name); else names.delete(name);
        element.className = [...names].join(" ");
      },
      contains: (name) => element.className.split(/\s+/).includes(name),
    };
  }
  get childNodes() { return this.children; }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.children = []; this.ownText = String(value); }
  set innerHTML(_) { throw new Error("innerHTML interdit"); }
  get innerHTML() { throw new Error("innerHTML interdit"); }
  insertAdjacentHTML() { throw new Error("insertAdjacentHTML interdit"); }
  append(...nodes) { this.children.push(...nodes); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; this.ownText = ""; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  dispatch(type) { for (const handler of this.listeners[type] || []) handler({ target: this }); }
  click() { this.dispatch("click"); }
  querySelectorAll(selector) {
    if (selector !== "button") throw new Error(`sélecteur non pris en charge : ${selector}`);
    return all(this).filter((node) => node.tagName === "BUTTON");
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
}

const all = (node) => node.children.flatMap((child) => [child, ...all(child)]);
const find = (root, predicate) => all(root).find(predicate);
const buttonByText = (root, text) => find(root, (node) => node.tagName === "BUTTON" && node.textContent === text);
const checkboxFor = (root, name) => find(root, (node) => node.tagName === "LABEL" && node.textContent === name)?.children[0];
const settle = async () => { for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setImmediate(resolve)); };

function loadUi() {
  const document = { createElement: (tag) => new FakeElement(tag) };
  const context = { document, URL, Promise, Object, String, Array, Set, Map, Number, JSON, Error, TypeError, setTimeout: () => 0 };
  context.window = context;
  vm.runInNewContext(UI_SOURCE, context);
  return { ui: context.window.NoonMcpConnectorsUi, document };
}

const FIGMA = Object.freeze({
  id: "figma", displayName: "Figma", url: "https://mcp.figma.com/mcp", auth: "oauth", dataClass: "PRIVATE",
  note: "Serveur distant officiel.", readOnlyTools: ["get_metadata", "get_screenshot", "whoami"],
});

function harness({ responses = {}, openExternal = null, confirm = () => true } = {}) {
  const { ui, document } = loadUi();
  const calls = [];
  let listBody = responses.list || { status: "ok", catalog: [{ ...FIGMA, installed: false }], servers: [] };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method, headers: { ...(options.headers || {}) }, body: options.body ? JSON.parse(options.body) : undefined });
    const key = `${options.method} ${url}`;
    const reply = typeof responses[key] === "function" ? responses[key]() : responses[key];
    if (options.method === "GET") {
      if (responses.listStatus) return { ok: false, status: responses.listStatus, json: async () => ({ status: "error", code: "MCP_DISABLED" }) };
      const body = typeof listBody === "function" ? listBody() : listBody;
      return { ok: true, status: 200, json: async () => body };
    }
    if (reply?.error) return { ok: false, status: reply.status || 400, json: async () => ({ status: "error", code: reply.error, message: "brut serveur" }) };
    return { ok: true, status: 200, json: async () => reply || { status: "ok" } };
  };
  const scheduled = [];
  const root = new FakeElement("section", "mcpConnectorsPanel");
  root.ownerDocument = document;
  root.hidden = true;
  const controller = ui.createMcpConnectorsController({
    elements: { root }, api: ui.createMcpConnectorsApi({ fetchImpl }), openExternal, confirmImpl: confirm,
    schedule: (fn) => { scheduled.push(fn); },
  });
  return { ui, controller, root, calls, scheduled, setList: (body) => { listBody = body; } };
}

const installedFigma = (overrides = {}) => ({
  ...FIGMA, installed: true, userApprovedReadOnly: [], status: { state: "NOT_CONNECTED", lastError: null, toolCount: 0, hasCredentials: false },
  tools: { exposed: [], hidden: [] }, ...overrides,
});

test("flag OFF (404) : panneau masqué, init renvoie false, GET sans en-tête d'action", async () => {
  const h = harness({ responses: { listStatus: 404 } });
  assert.equal(await h.controller.init(), false);
  assert.equal(h.root.hidden, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].method, "GET");
  assert.equal(h.calls[0].headers["X-Noon-Request"], undefined);
});

test("catalogue : installation par POST avec X-Noon-Request ; valeurs serveur rendues en texte", async () => {
  const hostile = { ...FIGMA, displayName: "<img src=x onerror=alert(1)>", installed: false };
  const h = harness({ responses: { list: { status: "ok", catalog: [hostile], servers: [] } } });
  assert.equal(await h.controller.init(), true);
  assert.equal(h.root.hidden, false);
  assert.ok(h.root.textContent.includes("<img src=x onerror=alert(1)>"), "nom affiché tel quel, en texte");
  buttonByText(h.root, "Installer").click();
  await settle();
  const post = h.calls.find((call) => call.method === "POST");
  assert.equal(post.url, "/api/mcp/servers/figma/install");
  assert.equal(post.headers["X-Noon-Request"], "1");
  assert.deepEqual(post.body, {});
});

test("Figma en ligne indisponible : raison affichée, ni Installer ni Connecter", async () => {
  const unavailable = { code: "MCP_CLIENT_NOT_ACCEPTED", message: "Indisponible : Noon n'est pas dans le catalogue MCP de Figma." };
  const catalogOnly = harness({ responses: { list: { status: "ok", catalog: [{ ...FIGMA, installed: false, unavailable }], servers: [] } } });
  await catalogOnly.controller.init();
  assert.ok(catalogOnly.root.textContent.includes(unavailable.message));
  assert.ok(!buttonByText(catalogOnly.root, "Installer"));
  const installed = harness({ responses: { list: { status: "ok", catalog: [], servers: [installedFigma({ unavailable })] } } });
  await installed.controller.init();
  assert.ok(installed.root.textContent.includes(unavailable.message));
  assert.ok(!buttonByText(installed.root, "Connecter"));
  assert.ok(buttonByText(installed.root, "Désinstaller"), "la désinstallation reste possible");
});

test("connexion OAuth : seule une URL https est ouverte, puis l'état est relu jusqu'à CONNECTED", async () => {
  const opened = [];
  let state = "NOT_CONNECTED";
  const h = harness({
    openExternal: async (url) => { opened.push(url); },
    responses: {
      list: () => ({ status: "ok", catalog: [{ ...FIGMA, installed: true }], servers: [installedFigma({ status: { state, toolCount: state === "CONNECTED" ? 12 : 0 } })] }),
      "POST /api/mcp/servers/figma/connect": { status: "AUTH_REQUIRED", authorizationUrl: "https://www.figma.com/oauth?client_id=c&state=s" },
    },
  });
  await h.controller.init();
  buttonByText(h.root, "Connecter").click();
  await settle();
  assert.deepEqual(opened, ["https://www.figma.com/oauth?client_id=c&state=s"]);
  assert.ok(h.root.textContent.includes("Termine l'autorisation Figma dans ton navigateur"));
  assert.equal(h.scheduled.length, 1, "relecture planifiée");
  state = "CONNECTED";
  await h.scheduled.shift()();
  await settle();
  assert.ok(h.root.textContent.includes("Connecté. Valide ensuite les outils à exposer."));
  assert.equal(h.scheduled.length, 0, "relecture arrêtée une fois connecté");
});

test("connexion OAuth : une URL non https n'est jamais ouverte", async () => {
  for (const authorizationUrl of ["http://evil.example/oauth", "javascript:alert(1)", "https://user:pw@evil.example/", "file:///etc/passwd"]) {
    const opened = [];
    const h = harness({
      openExternal: async (url) => { opened.push(url); },
      responses: {
        list: { status: "ok", catalog: [], servers: [installedFigma()] },
        "POST /api/mcp/servers/figma/connect": { status: "AUTH_REQUIRED", authorizationUrl },
      },
    });
    await h.controller.init();
    buttonByText(h.root, "Connecter").click();
    await settle();
    assert.deepEqual(opened, [], authorizationUrl);
    assert.ok(h.root.textContent.includes("Adresse d'autorisation invalide"), authorizationUrl);
    assert.equal(h.scheduled.length, 0);
  }
});

test("mode local uniquement : message dédié, sans reprendre le message brut du serveur", async () => {
  const h = harness({
    responses: {
      list: { status: "ok", catalog: [], servers: [installedFigma()] },
      "POST /api/mcp/servers/figma/connect": { error: "MCP_REMOTE_BLOCKED", status: 409 },
    },
  });
  await h.controller.init();
  buttonByText(h.root, "Connecter").click();
  await settle();
  assert.ok(h.root.textContent.includes("Serveur distant bloqué : Noon est en mode local uniquement ou hors ligne."));
  assert.equal(h.root.textContent.includes("brut serveur"), false);
});

test("outils : cases à cocher, enregistrement explicite par PUT dans l'ordre du catalogue", async () => {
  const h = harness({
    responses: {
      list: { status: "ok", catalog: [], servers: [installedFigma({
        status: { state: "CONNECTED", toolCount: 3 }, userApprovedReadOnly: ["whoami"],
        tools: { exposed: [{ name: "whoami" }], hidden: [{ name: "get_metadata", level: "WRITE", reason: "READ_ONLY_NOT_APPROVED_BY_USER" }, { name: "get_screenshot", level: "WRITE", reason: "SERVER_DECLARES_WRITE" }] },
      })] },
    },
  });
  await h.controller.init();
  assert.ok(h.root.textContent.includes("exposé à Noon"));
  assert.ok(h.root.textContent.includes("masqué : le serveur le déclare en écriture"));
  const save = () => buttonByText(h.root, "Enregistrer les outils validés");
  assert.equal(save().disabled, true, "rien à enregistrer tant que rien ne change");
  const metadata = checkboxFor(h.root, "get_metadata");
  metadata.checked = true; metadata.dispatch("change");
  assert.equal(save().disabled, false);
  save().click();
  await settle();
  const put = h.calls.find((call) => call.method === "PUT");
  assert.equal(put.url, "/api/mcp/servers/figma/read-only-tools");
  assert.equal(put.headers["X-Noon-Request"], "1");
  assert.deepEqual(put.body, { tools: ["get_metadata", "whoami"] });
});

test("désinstallation : confirmation obligatoire, aucun DELETE si refusée", async () => {
  for (const accepted of [false, true]) {
    const h = harness({ confirm: () => accepted, responses: { list: { status: "ok", catalog: [], servers: [installedFigma()] } } });
    await h.controller.init();
    buttonByText(h.root, "Désinstaller").click();
    await settle();
    assert.equal(h.calls.some((call) => call.method === "DELETE"), accepted);
  }
});

test("contrat source : aucun innerHTML, aucun stockage navigateur ni jeton manipulé", () => {
  assert.equal(/innerHTML|insertAdjacentHTML|localStorage|sessionStorage|document\.cookie/.test(UI_SOURCE), false);
  assert.equal(/access_token|refresh_token/.test(UI_SOURCE), false);
});

// ---- Control Center : entrée « Connecteurs MCP » ----

function loadControlCenter() {
  const ids = ["controlCenter", "controlCenterNavigation", "controlCenterOverview", "controlCenterSection",
    "controlCenterLoading", "controlCenterView", "openControlCenterButton", "closeControlCenter",
    "refreshControlCenter", "quickSettings", "controlCenterGoalModeDev", "controlCenterMcp"];
  const nodes = Object.fromEntries(ids.map((id) => [id, new FakeElement(id === "controlCenter" ? "dialog" : "div", id)]));
  nodes.controlCenterView.value = "USER";
  nodes.controlCenterGoalModeDev.hidden = true;
  nodes.controlCenterMcp.hidden = true;
  const sentinel = new FakeElement("section", "mcpConnectorsPanel");
  nodes.controlCenterMcp.append(sentinel);
  const urls = [];
  let refreshes = 0;
  const fetch = async (url) => {
    urls.push(url);
    const body = url.includes("/overview")
      ? { snapshot: { availableSections: ["approvals", "goals"], sections: {}, needsAttention: [], overallStatus: "OK" } }
      : { section: { sectionId: "goals", summary: "Objectifs", status: "OK", items: [] } };
    return { ok: true, json: async () => body };
  };
  const window = { NoonMcpConnectors: { refresh: async () => { refreshes += 1; } } };
  const document = { getElementById: (id) => nodes[id] || null, createElement: (tag) => new FakeElement(tag) };
  vm.runInNewContext(fs.readFileSync(path.join(PUBLIC, "control-center.js"), "utf8"), { window, document, fetch, URLSearchParams, encodeURIComponent, Promise, Object, String, Array });
  // Interface V3, étape 2 : la navigation intercale des titres de groupe ; seuls les boutons comptent.
  const navEntries = () => nodes.controlCenterNavigation.children.filter((node) => node.tagName === "BUTTON");
  const navLabels = () => navEntries().map((button) => button.textContent);
  const navButton = (label) => navEntries().find((button) => button.textContent === label);
  return { api: window.NoonControlCenter, nodes, sentinel, urls, navLabels, navButton, refreshes: () => refreshes };
}

test("Control Center : entrée MCP seulement si disponible, panneau jamais vidé, cohabitation avec Goal Mode DEV", async () => {
  const h = loadControlCenter();
  await h.api.open();
  assert.deepEqual(h.navLabels(), ["Vue d’ensemble", "Validations", "Objectifs"]);
  h.api.setMcpAvailable(true);
  h.api.setGoalModeDevAvailable(true);
  // Étape 2 UI : MCP est rangé dans « Intégrations », avant le groupe « DEV ».
  assert.deepEqual(h.navLabels(), ["Vue d’ensemble", "Validations", "Objectifs", "Connecteurs MCP", "Goal Mode DEV"]);
  h.navButton("Connecteurs MCP").click();
  await settle();
  assert.equal(h.nodes.controlCenterMcp.hidden, false);
  assert.equal(h.nodes.controlCenterGoalModeDev.hidden, true);
  assert.equal(h.nodes.controlCenterOverview.hidden, true);
  assert.equal(h.refreshes(), 1, "état relu à l'ouverture du panneau");
  assert.equal(h.urls.some((url) => url.includes("mcp")), false, "aucune section serveur « mcp » demandée");
  h.navButton("Goal Mode DEV").click();
  await settle();
  assert.equal(h.nodes.controlCenterMcp.hidden, true);
  assert.equal(h.nodes.controlCenterGoalModeDev.hidden, false);
  h.navButton("Objectifs").click();
  await settle();
  assert.equal(h.nodes.controlCenterMcp.hidden, true);
  assert.deepEqual(h.nodes.controlCenterMcp.children, [h.sentinel]);
  h.navButton("Connecteurs MCP").click();
  await settle();
  h.api.setMcpAvailable(false);
  await settle();
  assert.deepEqual(h.navLabels(), ["Vue d’ensemble", "Validations", "Objectifs", "Goal Mode DEV"]);
  assert.equal(h.nodes.controlCenterMcp.hidden, true);
  assert.equal(h.nodes.controlCenterOverview.hidden, false);
});

test("câblage : script chargé avant app.js, conteneur dans le Control Center, route servie", () => {
  const index = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  assert.ok(index.indexOf('<script src="mcp-connectors-ui.js"></script>') < index.indexOf('<script src="app.js"></script>'));
  assert.match(index, /<div id="controlCenterMcp" class="control-center__mcp" hidden><section id="mcpConnectorsPanel"/);
  const app = readAppSource();
  assert.match(app, /window\.NoonControlCenter\?\.setMcpAvailable\?\.\(available === true\)/);
  const server = readServerSource();
  assert.match(server, /"\/mcp-connectors-ui\.js": \{ file: \["mcp-connectors-ui\.js"\]/);
});

// ---------- Phase 2 : écritures validées ----------

test("phase 2 : les outils d'écriture se cochent à part, avec confirmation, et partent par PUT write-tools", async () => {
  const server = installedFigma({
    status: { state: "CONNECTED", lastError: null, toolCount: 4, hasCredentials: true },
    userApprovedWriteTools: [],
    tools: { exposed: [], hidden: [
      { name: "get_metadata", level: "WRITE", reason: "READ_ONLY_NOT_APPROVED_BY_USER" },
      { name: "update_node", level: "WRITE", reason: "WRITE_NOT_APPROVED_BY_USER" },
      { name: "delete_file", level: "DESTRUCTIVE", reason: "DESTRUCTIVE_HINT" },
    ] },
  });
  const asked = [];
  const h = harness({ responses: { list: { status: "ok", catalog: [], servers: [server] } }, confirm: (text) => { asked.push(text); return true; } });
  await h.controller.init();
  const writeBox = find(h.root, (node) => node.className === "mcp-connectors__tools mcp-connectors__tools--write");
  assert.ok(writeBox, "section Outils d'écriture présente");
  const labels = all(writeBox).filter((node) => node.className === "mcp-connectors__tool-name").map((node) => node.textContent);
  assert.deepEqual(labels, ["update_node"], "ni l'outil lecture seule non validé, ni l'outil destructif");
  assert.match(writeBox.textContent, /confirmation exacte/);
  checkboxFor(writeBox, "update_node").checked = true;
  checkboxFor(writeBox, "update_node").dispatch("change");
  buttonByText(h.root, "Enregistrer les outils d'écriture").click();
  await settle();
  assert.equal(asked.length, 1);
  assert.match(asked[0], /Rien ne partira sans ta confirmation exacte/);
  const put = h.calls.find((call) => call.method === "PUT");
  assert.equal(put.url, "/api/mcp/servers/figma/write-tools");
  assert.equal(put.headers["X-Noon-Request"], "1");
  assert.deepEqual(put.body, { tools: ["update_node"] });
});

test("phase 2 : écriture refusée à la confirmation → aucun PUT", async () => {
  const server = installedFigma({ status: { state: "CONNECTED", lastError: null, toolCount: 1, hasCredentials: true }, userApprovedWriteTools: [], tools: { exposed: [], hidden: [{ name: "update_node", level: "WRITE", reason: "WRITE_NOT_APPROVED_BY_USER" }] } });
  const h = harness({ responses: { list: { status: "ok", catalog: [], servers: [server] } }, confirm: () => false });
  await h.controller.init();
  const writeBox = find(h.root, (node) => node.className === "mcp-connectors__tools mcp-connectors__tools--write");
  checkboxFor(writeBox, "update_node").checked = true;
  checkboxFor(writeBox, "update_node").dispatch("change");
  buttonByText(h.root, "Enregistrer les outils d'écriture").click();
  await settle();
  assert.equal(h.calls.filter((call) => call.method === "PUT").length, 0);
});

test("phase 2 : Supabase demande l'identifiant du projet avant d'installer", async () => {
  const supabase = { id: "supabase", displayName: "Supabase", url: "https://mcp.supabase.com/mcp", auth: "oauth", dataClass: "PRIVATE", installed: false, projectRef: { label: "Identifiant du projet Supabase", pattern: "^[a-z]{20}$" } };
  const h = harness({ responses: { list: { status: "ok", catalog: [supabase], servers: [] } } });
  await h.controller.init();
  const install = buttonByText(h.root, "Installer");
  assert.equal(install.disabled, true, "pas d'installation sans projet valide");
  const input = find(h.root, (node) => node.tagName === "INPUT");
  input.value = "abcdefghijklmnopqrst";
  input.dispatch("input");
  assert.equal(install.disabled, false);
  install.click();
  await settle();
  const post = h.calls.find((call) => call.method === "POST");
  assert.equal(post.url, "/api/mcp/servers/supabase/install");
  assert.deepEqual(post.body, { projectRef: "abcdefghijklmnopqrst" });
});

test("phase 2 : la carte d'approbation du chat montre les détails exacts en texte brut", () => {
  const app = readAppSource();
  const card = app.match(/function addApprovalCard\(approval\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(card, /for \(const item of Array\.isArray\(approval\.details\) \? approval\.details : \[\]\)/);
  assert.match(card, /text\.textContent = String\(item\?\.value \?\? ""\);/);
  assert.doesNotMatch(card, /innerHTML/);
});

// ---------- Phase 3 : serveur ajouté par URL ----------

test("phase 3 : ajout d'un serveur par URL, champs gardés à la frappe, POST avec en-tête Noon", async () => {
  const h = harness({ responses: { list: { status: "ok", catalog: [], servers: [] } } });
  await h.controller.init();
  const add = buttonByText(h.root, "Ajouter");
  assert.equal(add.disabled, true, "nom et adresse requis");
  const [name, address] = all(h.root).filter((node) => node.tagName === "INPUT");
  name.value = "Linear"; name.dispatch("input");
  assert.equal(add.disabled, true);
  address.value = "https://mcp.linear.app/mcp"; address.dispatch("input");
  assert.equal(add.disabled, false);
  assert.equal(all(h.root).filter((node) => node.tagName === "INPUT")[0], name, "pas de nouveau rendu pendant la frappe");
  add.click();
  await settle();
  const post = h.calls.find((call) => call.method === "POST");
  assert.equal(post.url, "/api/mcp/servers");
  assert.equal(post.headers["X-Noon-Request"], "1");
  assert.deepEqual(post.body, { displayName: "Linear", url: "https://mcp.linear.app/mcp" });
  assert.match(h.root.textContent, /N'ajoute que des serveurs de confiance/);
});

test("phase 3 : serveur ajouté par URL — lecture seule proposée d'après le serveur, outils différés signalés", async () => {
  const server = { id: "custom-0a1b2c3d", displayName: "Docs", url: "https://docs.example/mcp", auth: "oauth", dataClass: "PRIVATE", custom: true, installed: true,
    readOnlyTools: [], userApprovedReadOnly: ["search"], userApprovedWriteTools: [], status: { state: "CONNECTED", lastError: null, toolCount: 3, hasCredentials: true },
    tools: { exposed: [{ name: "search", level: "READ", deferred: true }], hidden: [{ name: "fetch_page", level: "WRITE", reason: "READ_ONLY_NOT_APPROVED_BY_USER" }, { name: "publish", level: "WRITE", reason: "WRITE_NOT_APPROVED_BY_USER" }] } };
  const h = harness({ responses: { list: { status: "ok", catalog: [], servers: [server] } } });
  await h.controller.init();
  const readBox = find(h.root, (node) => node.className === "mcp-connectors__tools");
  const names = all(readBox).filter((node) => node.className === "mcp-connectors__tool-name").map((node) => node.textContent);
  assert.deepEqual(names, ["fetch_page", "search"]);
  assert.match(readBox.textContent, /trouvé par recherche d'outils/);
  assert.match(h.root.textContent, /Ajouté par URL/);
});
