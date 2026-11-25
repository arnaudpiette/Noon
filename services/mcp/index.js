"use strict";

// Assemblage du client MCP de Noon, derrière le flag `connectors.mcp` (OFF par défaut).
// Serveurs du catalogue uniquement. Phase 1 : outils en lecture seule validés par l'utilisateur.
// Phase 2 : outils d'écriture choisis par l'utilisateur, chaque appel soumis à approbation exacte.

const path = require("node:path");
const { MCP_CATALOG } = require("./mcp-catalog");
const { createMcpServerRegistry } = require("./mcp-server-registry");
const { createMcpClientManager } = require("./mcp-client-manager");
const { createMcpToolBridge } = require("./mcp-tool-bridge");

const ROUTE = /^\/api\/mcp\/servers(?:\/([a-z0-9-]{1,40})(?:\/(install|connect|disconnect|read-only-tools|write-tools))?)?$/;

function createMcpService({ enabled = false, dataDirectory = null, tokenStore, skillRegistry, observability = () => {}, clientVersion = "1.0.0", isRemoteAllowed = () => false, managerOptions = {} } = {}) {
  if (!enabled) {
    return { enabled: false, startup: async () => {}, closeAll: async () => {}, matches: (requestPath) => ROUTE.test(requestPath),
      async handle(req, res) { res.writeHead(404, { "Cache-Control": "no-store" }); res.end(JSON.stringify({ status: "error", code: "MCP_DISABLED", message: "Connecteurs MCP désactivés." })); } };
  }
  const registry = createMcpServerRegistry({ filePath: dataDirectory ? path.join(dataDirectory, "mcp-servers.json") : null });
  let manager = null;
  const bridge = createMcpToolBridge({ skillRegistry, registry, getManager: () => manager, observability });
  manager = createMcpClientManager({ registry, tokenStore, clientVersion, observability, isRemoteAllowed, onToolsChanged: async (serverId, tools) => { bridge.sync(serverId, tools); }, ...managerOptions });

  function describe(server) {
    return { id: server.id, displayName: server.displayName, url: server.url, auth: server.auth, dataClass: server.dataClass, note: server.note, unavailable: server.unavailable || null,
      projectRef: server.projectRef || null,
      readOnlyTools: [...server.readOnlyTools], userApprovedReadOnly: [...server.userApprovedReadOnly], userApprovedWriteTools: [...(server.userApprovedWriteTools || [])],
      status: manager.status(server.id), tools: bridge.exposure(server.id) };
  }

  async function startup() {
    for (const server of registry.list()) {
      if (server.auth !== "none" && !manager.status(server.id).hasCredentials) continue;
      try { await manager.connectSilently(server.id); }
      catch (error) { try { observability("mcp.startup_connect_skipped", { serverId: server.id, errorCode: String(error.code || "MCP_ERROR").slice(0, 80) }); } catch {} }
    }
  }

  async function handle(req, res, { requestPath, readJsonBody }) {
    const send = (status, payload) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(payload)); };
    const match = ROUTE.exec(requestPath);
    if (!match) return send(404, { status: "error", code: "MCP_ROUTE_UNKNOWN" });
    const [, serverId, action] = match;
    try {
      if (req.method === "GET" && !serverId) {
        return send(200, { status: "ok", catalog: MCP_CATALOG.map(({ id, displayName, url, auth, dataClass, note, unavailable, projectRef }) => ({ id, displayName, url, auth, dataClass, note, unavailable: unavailable || null, projectRef: projectRef ? { label: projectRef.label, pattern: projectRef.pattern } : null, installed: Boolean(registry.get(id)) })), servers: registry.list().map(describe) });
      }
      if (req.headers["x-noon-request"] !== "1") return send(403, { status: "error", code: "MCP_REQUEST_REFUSED", message: "Requête Noon refusée." });
      if (req.method === "POST" && action === "install") {
        const body = await readJsonBody(req, 4 * 1024);
        return send(200, { status: "ok", server: describe(registry.install(serverId, { projectRef: body?.projectRef })) });
      }
      if (req.method === "POST" && action === "connect") return send(200, { status: "ok", ...(await manager.connect(serverId)), server: describe(registry.get(serverId)) });
      if (req.method === "POST" && action === "disconnect") { await manager.disconnect(serverId); return send(200, { status: "ok", server: describe(registry.get(serverId)) }); }
      if (req.method === "PUT" && action === "read-only-tools") {
        const body = await readJsonBody(req, 16 * 1024);
        const server = registry.setUserApprovedReadOnly(serverId, body?.tools);
        bridge.sync(serverId);
        observability("mcp.read_only_tools_approved", { serverId, count: server.userApprovedReadOnly.length });
        return send(200, { status: "ok", server: describe(server) });
      }
      if (req.method === "PUT" && action === "write-tools") {
        const body = await readJsonBody(req, 16 * 1024);
        const server = registry.setUserApprovedWriteTools(serverId, body?.tools);
        bridge.sync(serverId);
        observability("mcp.write_tools_approved", { serverId, count: server.userApprovedWriteTools.length });
        return send(200, { status: "ok", server: describe(server) });
      }
      if (req.method === "DELETE" && serverId && !action) {
        if (registry.get(serverId)) await manager.disconnect(serverId);
        registry.uninstall(serverId); bridge.sync(serverId, []);
        return send(200, { status: "ok", uninstalled: serverId });
      }
      return send(405, { status: "error", code: "MCP_METHOD_NOT_ALLOWED" });
    } catch (error) {
      const known = /^MCP_/.test(String(error.code || ""));
      return send(error.code === "MCP_REMOTE_BLOCKED" ? 409 : known ? 400 : 500, { status: "error", code: known ? error.code : "MCP_ERROR", message: known ? error.message : "Erreur du connecteur MCP." });
    }
  }

  return { enabled: true, registry, manager, bridge, startup, handle, matches: (requestPath) => ROUTE.test(requestPath), closeAll: () => manager.closeAll() };
}

module.exports = { createMcpService };
