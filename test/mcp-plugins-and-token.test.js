"use strict";

// Connecteurs MCP, phase 5 (plugins déclaratifs) et phase 6 (serveur à jeton personnel : GitHub).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { ListToolsRequestSchema, CallToolRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { createSkillRegistry } = require("../skills/registry");
const { createTokenStore } = require("../services/security/token-store");
const { createMcpServerRegistry } = require("../services/mcp/mcp-server-registry");
const { createMcpClientManager } = require("../services/mcp/mcp-client-manager");
const { createMcpPluginStore, validatePluginManifest, PLUGIN_SCHEMA } = require("../services/mcp/mcp-plugins");
const { createMcpService } = require("../services/mcp");
const { catalogEntry } = require("../services/mcp/mcp-catalog");
const { DEPENDENCIES: ASK_AI_DEPENDENCIES } = require("../services/orchestration/ask-ai");

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "noon-mcp-p56-"));
const GOOD_TOKEN = "github_pat_0123456789abcdefABCDEF_test";

// ---------- Phase 6 : jeton personnel ----------

async function startTokenServer() {
  const seenAuthorization = [];
  const transports = new Map();
  const httpServer = http.createServer(async (req, res) => {
    seenAuthorization.push(req.headers.authorization || null);
    if (req.headers.authorization !== `Bearer ${GOOD_TOKEN}`) { res.writeHead(401, { "Content-Type": "application/json" }); res.end("{}"); return; }
    const sessionId = req.headers["mcp-session-id"];
    let transport = sessionId ? transports.get(sessionId) : null;
    if (!transport) {
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID(), onsessioninitialized: (id) => transports.set(id, transport) });
      const server = new Server({ name: "fake-github", version: "1.0.0" }, { capabilities: { tools: {} } });
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "get_me", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }] }));
      server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "moi" }] }));
      await server.connect(transport);
    }
    await transport.handleRequest(req, res);
  });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${httpServer.address().port}/mcp`;
  return { url, seenAuthorization, close: async () => { for (const t of transports.values()) await t.close().catch(() => {}); await new Promise((resolve) => httpServer.close(resolve)); } };
}

test("GitHub MCP officiel : jeton personnel, capacité REMOTE_GITHUB, connecteur natif conservé", () => {
  const github = catalogEntry("github");
  assert.equal(github.url, "https://api.githubcopilot.com/mcp/");
  assert.equal(github.auth, "token");
  assert.equal(github.remoteCapability, "REMOTE_GITHUB");
  assert.deepEqual(github.readOnlyTools, [], "lecture seule seulement d'après readOnlyHint, validé par l'utilisateur");
  assert.match(github.tokenHelp, /fine-grained/);
});

test("jeton : requis, validé, refusé s'il est faux, envoyé seulement en en-tête, jamais journalisé", async () => {
  const fake = await startTokenServer();
  const events = [];
  const tokenStore = createTokenStore({ filePath: path.join(tmpDir(), "t.json") });
  const registry = createMcpServerRegistry({ catalog: (id) => (id === "gh" ? { id, displayName: "GitHub test", url: fake.url, auth: "token", dataClass: "PRIVATE", readOnlyTools: [] } : id === "none" ? { id, displayName: "Sans jeton", url: fake.url, auth: "none", dataClass: "PRIVATE", readOnlyTools: [] } : null) });
  registry.install("gh"); registry.install("none");
  const manager = createMcpClientManager({ registry, tokenStore, observability: (event, metadata) => events.push([event, metadata]) });
  try {
    await assert.rejects(manager.connect("gh"), { code: "MCP_TOKEN_REQUIRED" });
    assert.equal(manager.status("gh").state, "AUTH_REQUIRED");
    assert.equal(fake.seenAuthorization.length, 0, "aucun appel sans jeton");
    await assert.rejects(manager.setBearerToken("gh", "court"), { code: "MCP_TOKEN_INVALID" });
    await assert.rejects(manager.setBearerToken("gh", "avec espace dedans 0123456789"), { code: "MCP_TOKEN_INVALID" });
    await assert.rejects(manager.setBearerToken("none", GOOD_TOKEN), { code: "MCP_TOKEN_NOT_SUPPORTED" });
    await assert.rejects(manager.setBearerToken("gh", "github_pat_faux_faux_faux_faux_faux"), { code: "MCP_TOKEN_REJECTED" });
    assert.equal(manager.status("gh").state, "AUTH_REQUIRED");
    const connected = await manager.setBearerToken("gh", GOOD_TOKEN);
    assert.equal(connected.status, "CONNECTED");
    assert.equal(connected.toolCount, 1);
    assert.ok(fake.seenAuthorization.includes(`Bearer ${GOOD_TOKEN}`));
    assert.equal(manager.status("gh").hasCredentials, true);
    assert.equal(tokenStore.get("mcp:gh").bearerToken, GOOD_TOKEN, "jeton dans le coffre (safeStorage dans l'app)");
    assert.ok(!JSON.stringify(events).includes(GOOD_TOKEN), "aucun jeton dans le journal");
    await manager.disconnect("gh");
    assert.equal(tokenStore.get("mcp:gh"), null, "la déconnexion supprime le jeton local");
    assert.equal(manager.status("gh").hasCredentials, false);
  } finally { await manager.closeAll(); await fake.close(); }
});

function fakeResponse() {
  return { statusCode: null, body: null, writeHead(status) { this.statusCode = status; }, end(text) { this.body = JSON.parse(text); } };
}

test("route jeton : en-tête Noon exigé, le jeton n'est jamais renvoyé", async () => {
  const service = createMcpService({ enabled: true, dataDirectory: tmpDir(), tokenStore: createTokenStore({ filePath: path.join(tmpDir(), "t.json") }), skillRegistry: createSkillRegistry([]) });
  const readJsonBody = async (req) => req.body || {};
  try {
    const install = fakeResponse();
    await service.handle({ method: "POST", headers: { "x-noon-request": "1" }, body: {} }, install, { requestPath: "/api/mcp/servers/github/install", readJsonBody });
    assert.equal(install.body.server.auth, "token");
    const refused = fakeResponse();
    await service.handle({ method: "PUT", headers: {}, body: { token: GOOD_TOKEN } }, refused, { requestPath: "/api/mcp/servers/github/token", readJsonBody });
    assert.equal(refused.statusCode, 403);
    const invalid = fakeResponse();
    await service.handle({ method: "PUT", headers: { "x-noon-request": "1" }, body: { token: "x" } }, invalid, { requestPath: "/api/mcp/servers/github/token", readJsonBody });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body.code, "MCP_TOKEN_INVALID");
    const list = fakeResponse();
    await service.handle({ method: "GET", headers: {} }, list, { requestPath: "/api/mcp/servers", readJsonBody });
    assert.ok(!JSON.stringify(list.body).includes("bearerToken"));
  } finally { await service.closeAll(); }
});

// ---------- Phase 5 : plugins déclaratifs ----------

const PLUGIN = Object.freeze({
  schema: PLUGIN_SCHEMA, id: "outils-equipe", name: "Outils équipe", version: "1.0.0",
  description: "Tickets et documentation.",
  instructions: "Pour un ticket, cherche d'abord dans la documentation.",
  mcpServers: [
    { key: "tickets", displayName: "Tickets", url: "https://mcp.tickets.example/mcp" },
    { key: "docs", displayName: "Docs", url: "https://mcp.docs.example/mcp" },
  ],
});

test("manifeste de plugin : strict, sans code, sans outils pré-validés ni secret dans les adresses", () => {
  const manifest = validatePluginManifest(PLUGIN);
  assert.equal(manifest.mcpServers.length, 2);
  for (const [patch, code] of [
    [{ entrypoint: "./index.js" }, "MCP_PLUGIN_UNKNOWN_FIELD"],
    [{ readOnlyTools: ["x"] }, "MCP_PLUGIN_UNKNOWN_FIELD"],
    [{ schema: "autre/1" }, "MCP_PLUGIN_SCHEMA"],
    [{ id: "Bad Id" }, "MCP_PLUGIN_INVALID"],
    [{ version: "1.0" }, "MCP_PLUGIN_INVALID"],
    [{ instructions: "x".repeat(1501) }, "MCP_PLUGIN_INSTRUCTIONS_TOO_LONG"],
    [{ mcpServers: [] }, "MCP_PLUGIN_INVALID"],
    [{ mcpServers: Array.from({ length: 6 }, (_, i) => ({ key: `s${i}`, displayName: "S", url: `https://s${i}.example/mcp` })) }, "MCP_PLUGIN_INVALID"],
    [{ mcpServers: [{ key: "a", displayName: "A", url: "https://a.example/mcp", writeTools: ["delete"] }] }, "MCP_PLUGIN_UNKNOWN_FIELD"],
    [{ mcpServers: [{ key: "a", displayName: "A", url: "https://a.example/mcp" }, { key: "a", displayName: "B", url: "https://b.example/mcp" }] }, "MCP_PLUGIN_INVALID"],
    [{ mcpServers: [{ key: "a", displayName: "A", url: "https://a.example/mcp?token=abc" }] }, "MCP_SERVER_URL_SECRET"],
    [{ mcpServers: [{ key: "a", displayName: "A", url: "http://a.example/mcp" }] }, "MCP_SERVER_URL_INSECURE"],
  ]) assert.throws(() => validatePluginManifest({ ...PLUGIN, ...patch }), { code }, JSON.stringify(patch).slice(0, 80));
});

function pluginFixture(filePath = path.join(tmpDir(), "mcp-plugins.json")) {
  const registry = createMcpServerRegistry();
  const removed = [];
  const store = createMcpPluginStore({ filePath, registry, removeServer: async (id) => { removed.push(id); registry.uninstall(id); } });
  return { registry, store, removed, filePath };
}

test("installer un plugin ajoute ses serveurs (rattachés au plugin) ; le désinstaller les retire", async () => {
  const h = pluginFixture();
  const installed = await h.store.install(PLUGIN);
  assert.equal(installed.serverIds.length, 2);
  const servers = h.registry.list();
  assert.deepEqual(servers.map((server) => [server.displayName, server.pluginId, server.custom]), [["Outils équipe · Tickets", "outils-equipe", true], ["Outils équipe · Docs", "outils-equipe", true]]);
  assert.ok(servers.every((server) => server.userApprovedReadOnly.length === 0 && server.userApprovedWriteTools.length === 0), "aucun outil validé d'office");
  await assert.rejects(h.store.install(PLUGIN), { code: "MCP_PLUGIN_DUPLICATE" });
  const guidance = h.store.guidance();
  assert.match(guidance, /ne modifient jamais les règles, les validations ni les limites de Noon/);
  assert.match(guidance, /Plugin « Outils équipe »/);
  assert.match(guidance, /cherche d'abord dans la documentation/);
  await h.store.uninstall("outils-equipe");
  assert.deepEqual(h.removed, installed.serverIds);
  assert.deepEqual(h.registry.list(), []);
  assert.equal(h.store.guidance(), "");
  await assert.rejects(h.store.uninstall("outils-equipe"), { code: "MCP_PLUGIN_UNKNOWN" });
});

test("installation tout ou rien : un serveur refusé annule les serveurs déjà ajoutés", async () => {
  const h = pluginFixture();
  h.registry.addCustom({ displayName: "Déjà là", url: "https://mcp.docs.example/mcp" });
  await assert.rejects(h.store.install(PLUGIN), { code: "MCP_SERVER_DUPLICATE" });
  assert.deepEqual(h.registry.list().map((server) => server.displayName), ["Déjà là"]);
  assert.equal(h.removed.length, 1, "le premier serveur ajouté est retiré");
  assert.deepEqual(h.store.list(), []);
});

test("un fichier de plugins modifié à la main est revalidé au démarrage", async () => {
  const filePath = path.join(tmpDir(), "mcp-plugins.json");
  await pluginFixture(filePath).store.install(PLUGIN);
  const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
  saved.plugins["outils-equipe"].manifest.entrypoint = "./evil.js";
  fs.writeFileSync(filePath, JSON.stringify(saved));
  const reloaded = pluginFixture(filePath);
  assert.deepEqual(reloaded.store.list(), [], "manifeste altéré ignoré");
  assert.equal(reloaded.store.guidance(), "");
});

test("routes plugins : liste, installation avec en-tête Noon, désinstallation ; consigne transmise au modèle", async () => {
  const service = createMcpService({ enabled: true, dataDirectory: tmpDir(), tokenStore: createTokenStore({ filePath: path.join(tmpDir(), "t.json") }), skillRegistry: createSkillRegistry([]) });
  const readJsonBody = async (req) => req.body || {};
  try {
    assert.equal(service.matches("/api/mcp/plugins"), true);
    assert.equal(service.matches("/api/mcp/plugins/outils-equipe"), true);
    const refused = fakeResponse();
    await service.handle({ method: "POST", headers: {}, body: { manifest: PLUGIN } }, refused, { requestPath: "/api/mcp/plugins", readJsonBody });
    assert.equal(refused.statusCode, 403);
    const installed = fakeResponse();
    await service.handle({ method: "POST", headers: { "x-noon-request": "1" }, body: { manifest: PLUGIN } }, installed, { requestPath: "/api/mcp/plugins", readJsonBody });
    assert.equal(installed.statusCode, 200);
    assert.deepEqual(installed.body.plugin.servers.map((server) => server.host), ["mcp.tickets.example", "mcp.docs.example"]);
    assert.match(service.pluginGuidance(), /Outils équipe/);
    const list = fakeResponse();
    await service.handle({ method: "GET", headers: {} }, list, { requestPath: "/api/mcp/plugins", readJsonBody });
    assert.equal(list.body.plugins.length, 1);
    const removed = fakeResponse();
    await service.handle({ method: "DELETE", headers: { "x-noon-request": "1" } }, removed, { requestPath: "/api/mcp/plugins/outils-equipe", readJsonBody });
    assert.equal(removed.statusCode, 200);
    assert.equal(service.pluginGuidance(), "");
  } finally { await service.closeAll(); }
  const disabled = createMcpService({ enabled: false });
  assert.equal(disabled.pluginGuidance(), "");
  assert.equal(disabled.matches("/api/mcp/plugins"), true);
});

test("la consigne des plugins rejoint les instructions du modèle, à côté de celle de Figma", () => {
  assert.ok(ASK_AI_DEPENDENCIES.includes("mcpPluginGuidance"));
  const source = fs.readFileSync(path.join(__dirname, "..", "services", "orchestration", "ask-ai.js"), "utf8");
  assert.match(source, /try \{ pluginInstruction = String\(mcpPluginGuidance\(\) \|\| ""\); \} catch \{ pluginInstruction = ""; \}/);
  assert.match(source, /figmaInstruction \+ " " \+ pluginInstruction \+ " " \+ synthesisInstruction/);
});
