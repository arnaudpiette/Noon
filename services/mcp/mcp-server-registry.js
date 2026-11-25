"use strict";

// Registre local des serveurs MCP installés. Aucun jeton ici : seulement l'état
// d'installation, le projet visé (Supabase) et les outils que l'utilisateur a validés :
// en lecture seule, ou en écriture (chaque appel d'écriture exige ensuite une approbation exacte).
// Installation depuis le catalogue relu, ou (phase 3) serveur ajouté par URL par l'utilisateur :
// HTTPS (ou loopback), aucun secret dans l'URL, aucun outil considéré en lecture seule par Noon
// (seule l'annotation du serveur, validée par l'utilisateur, peut en faire un outil de lecture).

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { catalogEntry } = require("./mcp-catalog");

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

const TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_CUSTOM_SERVERS = 10;
// Paramètres d'URL qui ressemblent à un secret : refusés, l'URL étant stockée en clair.
const SECRET_PARAM = /key|token|secret|auth|pass|sig|credential|session/i;
const MAX_WRITE_TOOLS = 50;

function registryError(code, message) { return Object.assign(new Error(message), { code }); }

// Serveur limité à un projet : l'identifiant, validé par le motif du catalogue, est ajouté à l'URL.
function projectRefFor(entry, value) {
  if (!entry.projectRef) return null;
  const ref = String(value ?? "").trim();
  if (!new RegExp(entry.projectRef.pattern).test(ref)) throw registryError("MCP_PROJECT_REF_INVALID", "Identifiant de projet invalide.");
  return ref;
}

function urlFor(entry, projectRef) {
  if (!entry.projectRef) return entry.url;
  const url = new URL(entry.url);
  url.searchParams.set(entry.projectRef.param, projectRef);
  return url.toString();
}

function assertAllowedUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw registryError("MCP_SERVER_URL_INVALID", "URL de serveur MCP invalide."); }
  if (url.username || url.password) throw registryError("MCP_SERVER_URL_INVALID", "URL de serveur MCP invalide.");
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return url;
  throw registryError("MCP_SERVER_URL_INSECURE", "Un serveur MCP distant doit utiliser HTTPS.");
}

function customEntry(id, custom) {
  const url = assertAllowedUrl(custom.url);
  return Object.freeze({
    id, displayName: custom.displayName, url: url.toString(), custom: true, pluginId: custom.pluginId || null,
    auth: LOOPBACK_HOSTS.has(url.hostname) ? "none" : "oauth",
    remoteCapability: "REMOTE_MCP_CUSTOM", dataClass: "PRIVATE", readOnlyTools: Object.freeze([]),
    note: "Serveur ajouté par URL. N'ajoute que des serveurs de confiance : il reçoit ce que Noon lui envoie.",
  });
}

function validateCustomServer({ displayName, url } = {}) {
  const name = String(displayName ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!name) throw registryError("MCP_SERVER_NAME_REQUIRED", "Nom du serveur requis.");
  const parsed = assertAllowedUrl(String(url ?? "").trim());
  if (parsed.hash) throw registryError("MCP_SERVER_URL_INVALID", "URL de serveur MCP invalide.");
  if ([...parsed.searchParams.keys()].some((key) => SECRET_PARAM.test(key))) {
    throw registryError("MCP_SERVER_URL_SECRET", "L'URL semble contenir un secret : utilise plutôt l'autorisation OAuth du serveur.");
  }
  return { displayName: name, url: parsed.toString() };
}

function createMcpServerRegistry({ filePath = null, catalog = catalogEntry, now = () => new Date().toISOString(), randomId = () => crypto.randomBytes(4).toString("hex") } = {}) {
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
    const custom = state.servers[id]?.custom;
    if (custom && !catalog(id)) return customEntry(id, custom);
    const entry = catalog(id);
    if (!entry) throw registryError("MCP_SERVER_UNKNOWN", "Serveur MCP inconnu du catalogue.");
    assertAllowedUrl(entry.url);
    return entry;
  }
  function view(id) {
    const entry = definition(id); const saved = state.servers[id];
    if (!saved) return null;
    let projectRef;
    try { projectRef = projectRefFor(entry, saved.projectRef); } catch { projectRef = null; }
    return {
      ...entry, url: projectRef ? urlFor(entry, projectRef) : entry.url, projectRef, installed: true, installedAt: saved.installedAt,
      // Sans projet valide, un serveur limité à un projet reste inutilisable (jamais tout le compte).
      ...(entry.projectRef && !projectRef ? { unavailable: { code: "MCP_PROJECT_REF_INVALID", message: "Projet Supabase manquant : désinstalle puis réinstalle en indiquant l'identifiant du projet." } } : {}),
      userApprovedReadOnly: [...(saved.userApprovedReadOnly || [])],
      userApprovedWriteTools: [...(saved.userApprovedWriteTools || [])],
    };
  }
  return {
    install(id, { projectRef = null } = {}) {
      const entry = definition(id);
      if (!state.servers[id]) {
        const ref = projectRefFor(entry, projectRef);
        state.servers[id] = { installedAt: now(), userApprovedReadOnly: [], userApprovedWriteTools: [], ...(ref ? { projectRef: ref } : {}) };
        persist();
      }
      return view(id);
    },
    uninstall(id) { const existed = Boolean(state.servers[id]); delete state.servers[id]; persist(); return existed; },
    get: (id) => (state.servers[id] ? view(id) : null),
    list: () => Object.keys(state.servers).filter((id) => catalog(id) || state.servers[id]?.custom).flatMap((id) => {
      try { return [view(id)]; } catch { return []; }
    }),
    addCustom(input) {
      const custom = validateCustomServer(input);
      // Serveur apporté par un plugin : rattaché à lui, retiré avec lui.
      if (input?.pluginId) custom.pluginId = String(input.pluginId);
      const customIds = Object.keys(state.servers).filter((id) => state.servers[id]?.custom);
      if (customIds.length >= MAX_CUSTOM_SERVERS) throw registryError("MCP_CUSTOM_LIMIT", `Au plus ${MAX_CUSTOM_SERVERS} serveurs ajoutés par URL.`);
      if (customIds.some((id) => state.servers[id].custom.url === custom.url)) throw registryError("MCP_SERVER_DUPLICATE", "Ce serveur est déjà ajouté.");
      let id;
      do { id = `custom-${randomId()}`; } while (state.servers[id] || catalog(id));
      state.servers[id] = { installedAt: now(), custom, userApprovedReadOnly: [], userApprovedWriteTools: [] };
      persist();
      return view(id);
    },
    setUserApprovedReadOnly(id, toolNames) {
      if (!state.servers[id]) throw registryError("MCP_SERVER_NOT_INSTALLED", "Serveur MCP non installé.");
      const entry = definition(id);
      const names = [...new Set((Array.isArray(toolNames) ? toolNames : []).map(String))];
      // Serveur ajouté par URL : pas de liste relue ; seul un outil annoncé readOnlyHint par le serveur
      // deviendra lecture seule (le classement l'impose), le nom doit seulement être valide.
      const outside = entry.custom
        ? names.filter((name) => !TOOL_NAME.test(name))
        : names.filter((name) => !entry.readOnlyTools.includes(name));
      if (outside.length) throw registryError("MCP_TOOL_NOT_READ_ONLY", `Outil non reconnu comme lecture seule : ${outside[0]}.`);
      state.servers[id].userApprovedReadOnly = names; persist();
      return view(id);
    },
    // Outils d'écriture rendus visibles au modèle. Le pont ne les expose que s'ils existent sur le
    // serveur et ne sont ni lecture seule ni destructifs ; chaque appel reste soumis à approbation.
    setUserApprovedWriteTools(id, toolNames) {
      if (!state.servers[id]) throw registryError("MCP_SERVER_NOT_INSTALLED", "Serveur MCP non installé.");
      const names = [...new Set((Array.isArray(toolNames) ? toolNames : []).map(String))];
      if (names.length > MAX_WRITE_TOOLS) throw registryError("MCP_TOOL_LIST_TOO_LONG", `Au plus ${MAX_WRITE_TOOLS} outils d'écriture.`);
      const invalid = names.find((name) => !TOOL_NAME.test(name));
      if (invalid !== undefined) throw registryError("MCP_TOOL_NAME_INVALID", "Nom d'outil MCP invalide.");
      state.servers[id].userApprovedWriteTools = names; persist();
      return view(id);
    },
  };
}

module.exports = { createMcpServerRegistry, assertAllowedUrl, validateCustomServer, MAX_CUSTOM_SERVERS };
