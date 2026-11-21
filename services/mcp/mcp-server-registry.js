"use strict";

// Registre local des serveurs MCP installés. Aucun jeton ici : seulement l'état
// d'installation et les outils que l'utilisateur a validés en lecture seule.
// Phase 1 : installation limitée au catalogue relu (pas d'URL arbitraire).

const fs = require("node:fs");
const path = require("node:path");
const { catalogEntry } = require("./mcp-catalog");

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function registryError(code, message) { return Object.assign(new Error(message), { code }); }

function assertAllowedUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw registryError("MCP_SERVER_URL_INVALID", "URL de serveur MCP invalide."); }
  if (url.username || url.password) throw registryError("MCP_SERVER_URL_INVALID", "URL de serveur MCP invalide.");
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return url;
  throw registryError("MCP_SERVER_URL_INSECURE", "Un serveur MCP distant doit utiliser HTTPS.");
}

function createMcpServerRegistry({ filePath = null, catalog = catalogEntry, now = () => new Date().toISOString() } = {}) {
  let state = { servers: {} };
  if (filePath) {
    try { const raw = JSON.parse(fs.readFileSync(filePath, "utf8")); if (raw && typeof raw.servers === "object") state = { servers: raw.servers }; } catch { /* Registre absent ou illisible : on repart vide. */ }
  }
  function persist() {
    if (!filePath) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, filePath);
  }
  function definition(id) {
    const entry = catalog(id);
    if (!entry) throw registryError("MCP_SERVER_UNKNOWN", "Serveur MCP inconnu du catalogue.");
    assertAllowedUrl(entry.url);
    return entry;
  }
  function view(id) {
    const entry = definition(id); const saved = state.servers[id];
    return saved ? { ...entry, installed: true, installedAt: saved.installedAt, userApprovedReadOnly: [...saved.userApprovedReadOnly] } : null;
  }
  return {
    install(id) {
      definition(id);
      if (!state.servers[id]) { state.servers[id] = { installedAt: now(), userApprovedReadOnly: [] }; persist(); }
      return view(id);
    },
    uninstall(id) { const existed = Boolean(state.servers[id]); delete state.servers[id]; persist(); return existed; },
    get: (id) => (state.servers[id] ? view(id) : null),
    list: () => Object.keys(state.servers).filter((id) => catalog(id)).map(view),
    setUserApprovedReadOnly(id, toolNames) {
      if (!state.servers[id]) throw registryError("MCP_SERVER_NOT_INSTALLED", "Serveur MCP non installé.");
      const entry = definition(id);
      const names = [...new Set((Array.isArray(toolNames) ? toolNames : []).map(String))];
      const outside = names.filter((name) => !entry.readOnlyTools.includes(name));
      if (outside.length) throw registryError("MCP_TOOL_NOT_READ_ONLY", `Outil non reconnu comme lecture seule : ${outside[0]}.`);
      state.servers[id].userApprovedReadOnly = names; persist();
      return view(id);
    },
  };
}

module.exports = { createMcpServerRegistry, assertAllowedUrl };
