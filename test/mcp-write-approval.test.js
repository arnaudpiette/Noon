"use strict";

// Connecteurs MCP, phase 2 : écritures avec approbation exacte.
// Critère de fin : une écriture refusée ne part pas, une écriture approuvée part une seule fois,
// la même approbation rejouée est refusée, et des arguments modifiés exigent une nouvelle approbation.

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
const { createMcpToolBridge } = require("../services/mcp/mcp-tool-bridge");
const { createMcpService } = require("../services/mcp");
const { catalogEntry } = require("../services/mcp/mcp-catalog");
const { createApprovalEngine } = require("../services/approvals/approval-engine");

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "noon-mcp-write-"));

async function startFakeServer() {
  const calls = [];
  const transports = new Map();
  function buildServer() {
    const server = new Server({ name: "fake-db", version: "1.0.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
      { name: "list_tables", description: "Liste les tables", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
      { name: "insert_row", description: "Ajoute une ligne", inputSchema: { type: "object", properties: { table: { type: "string" }, value: { type: "string" } }, required: ["table", "value"] } },
      { name: "apply_migration", description: "Applique une migration", inputSchema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] }, annotations: { readOnlyHint: false } },
      { name: "drop_table", description: "Supprime une table", inputSchema: { type: "object", properties: { table: { type: "string" } }, required: ["table"] }, annotations: { destructiveHint: true } },
    ] }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      calls.push(request.params);
      return { content: [{ type: "text", text: `ok ${request.params.name}` }] };
    });
    return server;
  }
  const httpServer = http.createServer(async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    let transport = sessionId ? transports.get(sessionId) : null;
    if (!transport) {
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID(), onsessioninitialized: (id) => transports.set(id, transport) });
      await buildServer().connect(transport);
    }
    await transport.handleRequest(req, res);
  });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${httpServer.address().port}/mcp`;
  return { url, calls, close: async () => { for (const t of transports.values()) await t.close().catch(() => {}); await new Promise((resolve) => httpServer.close(resolve)); } };
}

async function connectedFixture() {
  const fake = await startFakeServer();
  const skillRegistry = createSkillRegistry([]);
  const tokenStore = createTokenStore({ filePath: path.join(tmpDir(), "t.json") });
  const registry = createMcpServerRegistry({ catalog: (id) => (id === "fake-db" ? { id, displayName: "Base test", url: fake.url, auth: "none", dataClass: "PRIVATE", readOnlyTools: [] } : null) });
  registry.install("fake-db");
  let manager;
  const events = [];
  const bridge = createMcpToolBridge({ skillRegistry, registry, getManager: () => manager, observability: (event, metadata) => events.push([event, metadata]) });
  manager = createMcpClientManager({ registry, tokenStore, onToolsChanged: async (id, tools) => { bridge.sync(id, tools); } });
  assert.equal((await manager.connect("fake-db")).status, "CONNECTED");
  const toolName = (name) => skillRegistry.getToolDefinitions().find((definition) => definition.name.includes(`_${name}_`))?.name;
  return { fake, skillRegistry, registry, bridge, manager, events, toolName, close: async () => { await manager.closeAll(); await fake.close(); } };
}

test("un outil d'écriture reste masqué tant que l'utilisateur ne l'a pas coché ; un outil destructif l'est toujours", async () => {
  const h = await connectedFixture();
  try {
    const before = h.bridge.sync("fake-db");
    assert.deepEqual(before.exposed, []);
    assert.deepEqual(before.hidden.map((tool) => [tool.name, tool.level, tool.reason]), [
      ["list_tables", "WRITE", "READ_ONLY_NOT_APPROVED_BY_USER"],
      ["insert_row", "WRITE", "WRITE_NOT_APPROVED_BY_USER"],
      ["apply_migration", "WRITE", "WRITE_NOT_APPROVED_BY_USER"],
      ["drop_table", "DESTRUCTIVE", "DESTRUCTIVE_HINT"],
    ]);
    h.registry.setUserApprovedWriteTools("fake-db", ["insert_row", "drop_table"]);
    const after = h.bridge.sync("fake-db");
    assert.deepEqual(after.exposed.map((tool) => [tool.name, tool.level]), [["insert_row", "WRITE"]]);
    assert.ok(after.hidden.some((tool) => tool.name === "drop_table" && tool.level === "DESTRUCTIVE"), "cocher un outil destructif ne l'expose pas");
    const skill = h.skillRegistry.getSkillByName(h.toolName("insert_row"));
    assert.equal(skill.permissions.level, "external");
    assert.equal(skill.permissions.explicitOrderRequired, true);
    assert.equal(skill.permissions.confirmationRequired, true);
    assert.match(skill.definition.description, /écriture validée/);
  } finally { await h.close(); }
});

test("sans confirmation, l'écriture ne part pas, même appelée directement", async () => {
  const h = await connectedFixture();
  try {
    h.registry.setUserApprovedWriteTools("fake-db", ["insert_row"]);
    h.bridge.sync("fake-db");
    const name = h.toolName("insert_row");
    assert.equal(h.skillRegistry.authorize(name, { table: "t", value: "v" }, { explicitOrder: true }).code, "CONFIRMATION_REQUIRED");
    await assert.rejects(h.skillRegistry.executeSkill(name, { table: "t", value: "v" }, { explicitOrder: true }), { code: "CONFIRMATION_REQUIRED" });
    await assert.rejects(h.skillRegistry.executeSkill(name, { table: "t", value: "v" }, { confirmed: true }), { code: "EXPLICIT_ORDER_REQUIRED" });
    assert.deepEqual(h.fake.calls, [], "aucun appel n'a atteint le serveur MCP");
  } finally { await h.close(); }
});

test("critère de fin : refusée ne part pas, approuvée part une fois, rejouée est refusée", async () => {
  const h = await connectedFixture();
  const approvals = createApprovalEngine();
  try {
    h.registry.setUserApprovedWriteTools("fake-db", ["insert_row"]);
    h.bridge.sync("fake-db");
    const name = h.toolName("insert_row");
    const skill = h.skillRegistry.getSkillByName(name);
    const args = { table: "clients", value: "Corsaire" };
    const prepare = () => {
      const display = skill.approvalDisplay(args);
      return approvals.prepareAction({ executionId: "exec_1", toolCallId: "call_1", skillName: name, operation: name, normalizedArgs: args, target: "", title: display.title, sanitizedSummary: display.summary, details: display.details, permissionLevel: "external" });
    };
    const execute = (approvedArgs) => h.skillRegistry.executeSkill(name, approvedArgs, { explicitOrder: true, confirmed: true });
    const exactAction = { skillName: name, operation: name, target: "", normalizedArgs: args };

    // La carte montre le serveur, l'outil et les arguments exacts.
    const refusedCard = prepare();
    assert.equal(refusedCard.title, "Base test — insert_row");
    assert.deepEqual(refusedCard.details.map((item) => item.label), ["Serveur", "Outil", "Arguments"]);
    assert.deepEqual(JSON.parse(refusedCard.details[2].value), args);

    // Refusée : rien ne part.
    const rejected = await approvals.resumeApprovedAction({ approvalId: refusedCard.id, resumeToken: refusedCard.resumeToken, decision: "reject", execute });
    assert.equal(rejected.status, "rejected");
    assert.deepEqual(h.fake.calls, []);

    // Approuvée : part une seule fois, avec exactement les arguments approuvés.
    const card = prepare();
    const consumed = await approvals.resumeApprovedAction({ approvalId: card.id, resumeToken: card.resumeToken, decision: "approve", exactAction, execute });
    assert.equal(consumed.status, "consumed");
    assert.deepEqual(h.fake.calls, [{ name: "insert_row", arguments: args }]);
    assert.equal(consumed.result.provenance.trust, "mcp_data_untrusted");

    // Rejouée : refusée, aucun second appel.
    await assert.rejects(approvals.resumeApprovedAction({ approvalId: card.id, resumeToken: card.resumeToken, decision: "approve", exactAction, execute }), { code: "APPROVAL_CONSUMED" });
    assert.equal(h.fake.calls.length, 1);

    // Arguments modifiés après la carte : nouvelle approbation exigée.
    const changed = prepare();
    await assert.rejects(approvals.resumeApprovedAction({ approvalId: changed.id, resumeToken: changed.resumeToken, decision: "approve", exactAction: { ...exactAction, normalizedArgs: { ...args, value: "Autre" } }, execute }), { code: "APPROVAL_ACTION_CHANGED" });
    assert.equal(h.fake.calls.length, 1);

    // Journal : outil et serveur seulement, jamais les arguments.
    const written = h.events.filter(([event]) => event === "mcp.write_tool_called");
    assert.deepEqual(written, [["mcp.write_tool_called", { serverId: "fake-db", tool: "insert_row", isError: false }]]);
  } finally { await h.close(); }
});

test("Supabase n'est installable que limité à un projet ; Vercel est listé indisponible", async () => {
  const supabase = catalogEntry("supabase");
  assert.equal(supabase.url, "https://mcp.supabase.com/mcp");
  assert.equal(supabase.remoteCapability, "REMOTE_SUPABASE");
  assert.ok(!supabase.readOnlyTools.includes("execute_sql"), "une requête SQL peut écrire");
  assert.equal(catalogEntry("vercel").unavailable.code, "MCP_CLIENT_NOT_ACCEPTED");

  const registry = createMcpServerRegistry({ filePath: path.join(tmpDir(), "mcp-servers.json") });
  assert.throws(() => registry.install("supabase"), { code: "MCP_PROJECT_REF_INVALID" });
  assert.throws(() => registry.install("supabase", { projectRef: "abc&read_only=false" }), { code: "MCP_PROJECT_REF_INVALID" });
  const server = registry.install("supabase", { projectRef: "abcdefghijklmnopqrst" });
  assert.equal(server.url, "https://mcp.supabase.com/mcp?project_ref=abcdefghijklmnopqrst");
  assert.equal(server.projectRef, "abcdefghijklmnopqrst");
  assert.deepEqual(server.userApprovedWriteTools, []);
  assert.throws(() => registry.setUserApprovedWriteTools("supabase", ["bad name"]), { code: "MCP_TOOL_NAME_INVALID" });
  assert.deepEqual(registry.setUserApprovedWriteTools("supabase", ["apply_migration", "apply_migration"]).userApprovedWriteTools, ["apply_migration"]);
});

test("un serveur installé avant la phase 2 se relit sans erreur (aucun outil d'écriture)", () => {
  const filePath = path.join(tmpDir(), "mcp-servers.json");
  fs.writeFileSync(filePath, JSON.stringify({ servers: { "figma-desktop": { installedAt: "2026-11-22T10:00:00.000Z", userApprovedReadOnly: ["get_metadata"] } } }));
  const server = createMcpServerRegistry({ filePath }).get("figma-desktop");
  assert.deepEqual(server.userApprovedReadOnly, ["get_metadata"]);
  assert.deepEqual(server.userApprovedWriteTools, []);
});

function fakeResponse() {
  return { statusCode: null, body: null, writeHead(status) { this.statusCode = status; }, end(text) { this.body = JSON.parse(text); } };
}

test("routes : installation avec projet et choix des outils d'écriture, en-tête Noon exigé", async () => {
  const service = createMcpService({ enabled: true, dataDirectory: tmpDir(), tokenStore: createTokenStore({ filePath: path.join(tmpDir(), "t.json") }), skillRegistry: createSkillRegistry([]) });
  const readJsonBody = async (req) => req.body || {};
  try {
    const list = fakeResponse();
    await service.handle({ method: "GET", headers: {} }, list, { requestPath: "/api/mcp/servers", readJsonBody });
    assert.equal(list.body.catalog.find((entry) => entry.id === "supabase").projectRef.pattern, "^[a-z]{20}$");
    const installed = fakeResponse();
    await service.handle({ method: "POST", headers: { "x-noon-request": "1" }, body: { projectRef: "abcdefghijklmnopqrst" } }, installed, { requestPath: "/api/mcp/servers/supabase/install", readJsonBody });
    assert.equal(installed.statusCode, 200);
    assert.equal(installed.body.server.projectRef, "abcdefghijklmnopqrst");
    const refused = fakeResponse();
    await service.handle({ method: "PUT", headers: {}, body: { tools: ["apply_migration"] } }, refused, { requestPath: "/api/mcp/servers/supabase/write-tools", readJsonBody });
    assert.equal(refused.statusCode, 403);
    const saved = fakeResponse();
    await service.handle({ method: "PUT", headers: { "x-noon-request": "1" }, body: { tools: ["apply_migration"] } }, saved, { requestPath: "/api/mcp/servers/supabase/write-tools", readJsonBody });
    assert.equal(saved.statusCode, 200);
    assert.deepEqual(saved.body.server.userApprovedWriteTools, ["apply_migration"]);
  } finally { await service.closeAll(); }
});
