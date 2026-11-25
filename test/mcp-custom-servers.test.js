"use strict";

// Connecteurs MCP, phase 3 : serveur ajouté par URL, outils différés derrière tool_search.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSkillRegistry } = require("../skills/registry");
const { createTokenStore } = require("../services/security/token-store");
const { createMcpServerRegistry, MAX_CUSTOM_SERVERS } = require("../services/mcp/mcp-server-registry");
const { createMcpToolBridge, DEFER_THRESHOLD } = require("../services/mcp/mcp-tool-bridge");
const { createMcpService } = require("../services/mcp");

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "noon-mcp-custom-"));

test("un serveur ajouté par URL : HTTPS, sans secret, nom requis, sans doublon, 10 au plus", () => {
  let counter = 0;
  const registry = createMcpServerRegistry({ filePath: path.join(tmpDir(), "mcp-servers.json"), randomId: () => String(counter++).padStart(8, "0") });
  const server = registry.addCustom({ displayName: "  Linear   test ", url: "https://mcp.linear.app/mcp" });
  assert.equal(server.id, "custom-00000000");
  assert.equal(server.displayName, "Linear test");
  assert.equal(server.auth, "oauth");
  assert.equal(server.custom, true);
  assert.equal(server.remoteCapability, "REMOTE_MCP_CUSTOM");
  assert.deepEqual(server.readOnlyTools, [], "aucun outil réputé lecture seule par Noon");
  assert.equal(registry.addCustom({ displayName: "Local", url: "http://127.0.0.1:4100/mcp" }).auth, "none");
  for (const [input, code] of [
    [{ displayName: "", url: "https://x.example/mcp" }, "MCP_SERVER_NAME_REQUIRED"],
    [{ displayName: "X", url: "http://x.example/mcp" }, "MCP_SERVER_URL_INSECURE"],
    [{ displayName: "X", url: "ftp://x.example/mcp" }, "MCP_SERVER_URL_INSECURE"],
    [{ displayName: "X", url: "https://user:pw@x.example/mcp" }, "MCP_SERVER_URL_INVALID"],
    [{ displayName: "X", url: "https://x.example/mcp#frag" }, "MCP_SERVER_URL_INVALID"],
    [{ displayName: "X", url: "https://x.example/mcp?api_key=abc" }, "MCP_SERVER_URL_SECRET"],
    [{ displayName: "X", url: "https://x.example/mcp?access_token=abc" }, "MCP_SERVER_URL_SECRET"],
    [{ displayName: "X", url: "pas une url" }, "MCP_SERVER_URL_INVALID"],
    [{ displayName: "Doublon", url: "https://mcp.linear.app/mcp" }, "MCP_SERVER_DUPLICATE"],
  ]) assert.throws(() => registry.addCustom(input), { code }, JSON.stringify(input));
  assert.equal(registry.addCustom({ displayName: "Projet", url: "https://x.example/mcp?project=demo" }).url, "https://x.example/mcp?project=demo");
  while (registry.list().filter((item) => item.custom).length < MAX_CUSTOM_SERVERS) registry.addCustom({ displayName: "S", url: `https://s${counter}.example/mcp` });
  assert.throws(() => registry.addCustom({ displayName: "Trop", url: "https://trop.example/mcp" }), { code: "MCP_CUSTOM_LIMIT" });
});

test("un serveur ajouté par URL survit au redémarrage et disparaît entièrement à la désinstallation", () => {
  const filePath = path.join(tmpDir(), "mcp-servers.json");
  const first = createMcpServerRegistry({ filePath });
  const { id } = first.addCustom({ displayName: "Notion", url: "https://mcp.notion.com/mcp" });
  const reloaded = createMcpServerRegistry({ filePath });
  assert.equal(reloaded.get(id).url, "https://mcp.notion.com/mcp");
  assert.ok(reloaded.list().some((server) => server.id === id));
  reloaded.uninstall(id);
  assert.equal(createMcpServerRegistry({ filePath }).get(id), null);
});

test("lecture seule d'un serveur ajouté par URL : seulement si le serveur l'annonce ET que l'utilisateur valide", () => {
  const registry = createMcpServerRegistry();
  const { id } = registry.addCustom({ displayName: "Docs", url: "https://docs.example/mcp" });
  const skillRegistry = createSkillRegistry([]);
  const bridge = createMcpToolBridge({ skillRegistry, registry, getManager: () => null });
  const tools = [
    { name: "search", inputSchema: { type: "object", properties: { q: { type: "string" } } }, annotations: { readOnlyHint: true } },
    { name: "publish", inputSchema: { type: "object", properties: {} } },
  ];
  assert.deepEqual(bridge.sync(id, tools).exposed, []);
  registry.setUserApprovedReadOnly(id, ["search", "publish"]);
  const report = bridge.sync(id, tools);
  assert.deepEqual(report.exposed.map((tool) => [tool.name, tool.level]), [["search", "READ"]]);
  assert.deepEqual(report.hidden.map((tool) => [tool.name, tool.reason]), [["publish", "WRITE_NOT_APPROVED_BY_USER"]], "valider « publish » en lecture ne le rend pas lisible");
  assert.throws(() => registry.setUserApprovedReadOnly(id, ["bad name"]), { code: "MCP_TOOL_NOT_READ_ONLY" });
});

test("au-delà du seuil, les outils d'un serveur sont différés derrière tool_search", () => {
  const registry = createMcpServerRegistry();
  const { id } = registry.addCustom({ displayName: "Gros serveur", url: "https://big.example/mcp" });
  const skillRegistry = createSkillRegistry([]);
  const bridge = createMcpToolBridge({ skillRegistry, registry, getManager: () => null });
  const tools = Array.from({ length: DEFER_THRESHOLD + 1 }, (_, index) => ({ name: `read_${index}`, inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }));
  registry.setUserApprovedReadOnly(id, tools.slice(0, DEFER_THRESHOLD).map((tool) => tool.name));
  assert.ok(bridge.sync(id, tools).exposed.every((tool) => tool.deferred === false), "au seuil : chargés directement");
  assert.ok(skillRegistry.getToolDefinitions({ deferRare: true }).every((definition) => definition.defer_loading !== true));
  registry.setUserApprovedReadOnly(id, tools.map((tool) => tool.name));
  assert.ok(bridge.sync(id, tools).exposed.every((tool) => tool.deferred === true));
  const definitions = skillRegistry.getToolDefinitions({ deferRare: true });
  assert.equal(definitions.length, DEFER_THRESHOLD + 1);
  assert.ok(definitions.every((definition) => definition.defer_loading === true));
  assert.ok(skillRegistry.getToolDefinitions({ deferRare: false }).every((definition) => definition.defer_loading === undefined), "sans tool_search, tout reste chargé");
});

function fakeResponse() {
  return { statusCode: null, body: null, writeHead(status) { this.statusCode = status; }, end(text) { this.body = JSON.parse(text); } };
}

test("route : ajout par POST avec en-tête Noon ; l'adresse n'apparaît pas dans le journal", async () => {
  const events = [];
  const service = createMcpService({ enabled: true, dataDirectory: tmpDir(), tokenStore: createTokenStore({ filePath: path.join(tmpDir(), "t.json") }), skillRegistry: createSkillRegistry([]), observability: (event, metadata) => events.push([event, metadata]) });
  const readJsonBody = async (req) => req.body || {};
  try {
    const refused = fakeResponse();
    await service.handle({ method: "POST", headers: {}, body: { displayName: "X", url: "https://x.example/mcp" } }, refused, { requestPath: "/api/mcp/servers", readJsonBody });
    assert.equal(refused.statusCode, 403);
    const secret = fakeResponse();
    await service.handle({ method: "POST", headers: { "x-noon-request": "1" }, body: { displayName: "X", url: "https://x.example/mcp?token=abc" } }, secret, { requestPath: "/api/mcp/servers", readJsonBody });
    assert.equal(secret.statusCode, 400);
    assert.equal(secret.body.code, "MCP_SERVER_URL_SECRET");
    const added = fakeResponse();
    await service.handle({ method: "POST", headers: { "x-noon-request": "1" }, body: { displayName: "Linear", url: "https://mcp.linear.app/mcp" } }, added, { requestPath: "/api/mcp/servers", readJsonBody });
    assert.equal(added.statusCode, 200);
    assert.equal(added.body.server.custom, true);
    assert.match(added.body.server.id, /^custom-[0-9a-f]{8}$/);
    const list = fakeResponse();
    await service.handle({ method: "GET", headers: {} }, list, { requestPath: "/api/mcp/servers", readJsonBody });
    assert.ok(list.body.servers.some((server) => server.id === added.body.server.id));
    assert.ok(!JSON.stringify(events).includes("linear.app"), "aucune adresse dans le journal");
  } finally { await service.closeAll(); }
});
