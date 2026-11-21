"use strict";

// Sessions MCP (transport Streamable HTTP) pour les serveurs installés.
// OAuth : premier essai avec les jetons du coffre ; si le serveur exige une
// autorisation, on renvoie l'URL à ouvrir et un récepteur loopback termine l'échange.

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { UnauthorizedError } = require("@modelcontextprotocol/sdk/client/auth.js");
const { createMcpOAuthProvider, credentialKey } = require("./mcp-oauth-provider");
const { createMcpLoopbackReceiver } = require("./mcp-loopback");

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const DEFAULT_CALL_TIMEOUT_MS = 30_000;
const MAX_TOOL_PAGES = 10;

function managerError(code, message) { return Object.assign(new Error(message), { code }); }
function safeErrorCode(error) { return String(error?.code || error?.name || "MCP_ERROR").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80); }

function createMcpClientManager({
  registry, tokenStore, clientVersion = "1.0.0",
  clientFactory = () => new Client({ name: "noon", version: clientVersion }),
  transportFactory = (url, options) => new StreamableHTTPClientTransport(url, options),
  loopbackFactory = createMcpLoopbackReceiver,
  onToolsChanged = async () => {}, observability = () => {},
  callTimeoutMs = DEFAULT_CALL_TIMEOUT_MS,
  // (capabilityId) => boolean : politique locale (mode local uniquement / hors ligne).
  // Par défaut, tout serveur distant est refusé : le composant appelant doit l'autoriser.
  isRemoteAllowed = () => false,
} = {}) {
  const sessions = new Map();
  const status = new Map();
  const pendingAuth = new Map();
  const emit = (event, metadata) => { try { observability(event, metadata); } catch {} };
  const setStatus = (id, patch) => status.set(id, { ...(status.get(id) || { state: "NOT_CONNECTED", lastError: null, toolCount: 0 }), ...patch });

  function requireServer(id) {
    const server = registry.get(id);
    if (!server) throw managerError("MCP_SERVER_NOT_INSTALLED", "Serveur MCP non installé.");
    return server;
  }

  // Un serveur loopback reste sur le Mac ; tout autre serveur est un appel distant
  // soumis à la politique locale, y compris pour la reconnexion silencieuse.
  function assertRemoteAllowed(server) {
    if (LOOPBACK_HOSTS.has(new URL(server.url).hostname)) return;
    let allowed;
    try { allowed = Boolean(server.remoteCapability) && isRemoteAllowed(server.remoteCapability) === true; } catch { allowed = false; }
    if (!allowed) {
      emit("mcp.remote_blocked", { serverId: server.id });
      throw managerError("MCP_REMOTE_BLOCKED", "Serveur MCP distant bloqué par le mode local uniquement ou l'absence de réseau.");
    }
  }

  function savedRedirectUrl(id) {
    const info = tokenStore.get(credentialKey(id))?.clientInformation;
    return Array.isArray(info?.redirect_uris) ? info.redirect_uris[0] : null;
  }

  async function listAllTools(client) {
    const tools = []; let cursor;
    for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
      const result = await client.listTools(cursor ? { cursor } : undefined);
      tools.push(...(result?.tools || []));
      cursor = result?.nextCursor; if (!cursor) break;
    }
    return tools;
  }

  async function openSession(server, authProvider) {
    const client = clientFactory();
    const transport = transportFactory(new URL(server.url), authProvider ? { authProvider } : {});
    await client.connect(transport);
    return { client, transport };
  }

  async function activate(server, session) {
    const previous = sessions.get(server.id);
    sessions.set(server.id, session);
    if (previous && previous !== session) { try { await previous.client.close(); } catch {} }
    const tools = await listAllTools(session.client);
    setStatus(server.id, { state: "CONNECTED", lastError: null, toolCount: tools.length, connectedAt: new Date().toISOString() });
    emit("mcp.connected", { serverId: server.id, toolCount: tools.length });
    await onToolsChanged(server.id, tools);
    return tools;
  }

  // Reconnexion sans interaction : jetons du coffre (rafraîchis par le SDK) ou serveur sans auth.
  async function connectSilently(server) {
    assertRemoteAllowed(server);
    if (server.auth === "none") return activate(server, await openSession(server, null));
    const redirectUrl = savedRedirectUrl(server.id);
    if (!tokenStore.get(credentialKey(server.id))?.tokens || !redirectUrl) throw managerError("MCP_AUTH_REQUIRED", "Connexion au serveur MCP requise.");
    let authorizationRequested = false;
    const provider = createMcpOAuthProvider({ serverId: server.id, tokenStore, redirectUrl, onAuthorizationUrl: () => { authorizationRequested = true; } });
    try { return await activate(server, await openSession(server, provider)); }
    catch (error) {
      if (authorizationRequested || error instanceof UnauthorizedError) { setStatus(server.id, { state: "AUTH_REQUIRED", lastError: "AUTH_REQUIRED" }); throw managerError("MCP_AUTH_REQUIRED", "Connexion au serveur MCP requise."); }
      throw error;
    }
  }

  async function connect(id) {
    const server = requireServer(id);
    try { assertRemoteAllowed(server); }
    catch (error) { setStatus(id, { state: "BLOCKED", lastError: error.code }); throw error; }
    setStatus(id, { state: "CONNECTING", lastError: null });
    try {
      if (server.auth === "none") { const tools = await connectSilently(server); return { status: "CONNECTED", toolCount: tools.length }; }
      if (tokenStore.get(credentialKey(id))?.tokens) {
        try { const tools = await connectSilently(server); return { status: "CONNECTED", toolCount: tools.length }; }
        catch (error) { if (error.code !== "MCP_AUTH_REQUIRED") throw error; }
      }
      pendingAuth.get(id)?.close();
      let authorizationUrl = null;
      let provider = null;
      let transport = null;
      const loopback = await loopbackFactory({
        onCallback: async ({ code }) => {
          assertRemoteAllowed(server);
          await transport.finishAuth(code);
          pendingAuth.delete(id);
          const fresh = createMcpOAuthProvider({ serverId: id, tokenStore, redirectUrl: loopback.redirectUri });
          await activate(server, await openSession(server, fresh));
          emit("mcp.authorized", { serverId: id });
        },
      });
      provider = createMcpOAuthProvider({ serverId: id, tokenStore, redirectUrl: loopback.redirectUri, onAuthorizationUrl: (url) => { authorizationUrl = url; } });
      const client = clientFactory();
      transport = transportFactory(new URL(server.url), { authProvider: provider });
      try {
        await client.connect(transport);
        loopback.close();
        const tools = await activate(server, { client, transport });
        return { status: "CONNECTED", toolCount: tools.length };
      } catch (error) {
        if (!authorizationUrl) { loopback.close(); throw error; }
        loopback.setExpectedState(provider.expectedState());
        pendingAuth.set(id, loopback);
        setStatus(id, { state: "AUTH_REQUIRED", lastError: null });
        emit("mcp.authorization_required", { serverId: id });
        return { status: "AUTH_REQUIRED", authorizationUrl };
      }
    } catch (error) {
      setStatus(id, { state: "ERROR", lastError: safeErrorCode(error) });
      emit("mcp.connect_failed", { serverId: id, errorCode: safeErrorCode(error) });
      throw managerError(error.code === "MCP_AUTH_REQUIRED" ? "MCP_AUTH_REQUIRED" : "MCP_CONNECT_FAILED", "Connexion au serveur MCP impossible.");
    }
  }

  async function callTool(id, name, args, { signal } = {}) {
    const server = requireServer(id);
    assertRemoteAllowed(server);
    if (!sessions.has(id)) await connectSilently(server);
    const { client } = sessions.get(id);
    const started = Date.now();
    try {
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: callTimeoutMs, signal });
      emit("mcp.tool_succeeded", { serverId: id, tool: name, durationMs: Date.now() - started });
      return result;
    } catch (error) {
      emit("mcp.tool_failed", { serverId: id, tool: name, durationMs: Date.now() - started, errorCode: safeErrorCode(error) });
      throw managerError("MCP_TOOL_FAILED", "L'outil MCP a échoué.");
    }
  }

  async function disconnect(id) {
    pendingAuth.get(id)?.close(); pendingAuth.delete(id);
    const session = sessions.get(id); sessions.delete(id);
    if (session) { try { await session.client.close(); } catch {} }
    tokenStore.remove(credentialKey(id));
    setStatus(id, { state: "NOT_CONNECTED", lastError: null, toolCount: 0 });
    emit("mcp.disconnected", { serverId: id });
    await onToolsChanged(id, []);
    return { status: "disconnected", providerRevoked: false };
  }

  async function refreshTools(id) {
    const session = sessions.get(id);
    if (!session) return [];
    const tools = await listAllTools(session.client);
    setStatus(id, { toolCount: tools.length });
    await onToolsChanged(id, tools);
    return tools;
  }

  async function closeAll() {
    for (const loopback of pendingAuth.values()) loopback.close();
    pendingAuth.clear();
    for (const session of sessions.values()) { try { await session.client.close(); } catch {} }
    sessions.clear();
  }

  return {
    connect, connectSilently: (id) => connectSilently(requireServer(id)), callTool, disconnect, refreshTools, closeAll,
    status: (id) => ({ state: "NOT_CONNECTED", lastError: null, toolCount: 0, ...(status.get(id) || {}), hasCredentials: Boolean(tokenStore.get(credentialKey(id))?.tokens) }),
  };
}

module.exports = { createMcpClientManager };
