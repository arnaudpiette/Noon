"use strict";

// Catalogue relu dans Noon des serveurs MCP proposés par défaut.
// readOnlyTools liste les outils que Noon considère en lecture seule ; ils restent
// invisibles tant que l'utilisateur ne les a pas validés un par un.

const FIGMA_READ_ONLY_TOOLS = Object.freeze([
  "whoami", "create_session", "get_metadata", "get_design_context", "get_screenshot",
  "get_variable_defs", "get_figjam", "get_libraries", "search_design_system", "get_comments",
]);

const MCP_CATALOG = Object.freeze([
  Object.freeze({
    id: "figma", displayName: "Figma", url: "https://mcp.figma.com/mcp", auth: "oauth",
    // Capacité soumise à la politique locale (mode local uniquement / hors ligne).
    remoteCapability: "REMOTE_FIGMA",
    dataClass: "PRIVATE", readOnlyTools: FIGMA_READ_ONLY_TOOLS,
    note: "Serveur distant officiel de Figma.",
    // Vérifié le 22/11/2026 : Figma n'accepte sur ce serveur que les clients de son catalogue MCP
    // (VS Code, Cursor, Claude Code…). Noon n'y figure pas : connexion refusée d'avance, sans appel.
    unavailable: Object.freeze({
      code: "MCP_CLIENT_NOT_ACCEPTED",
      message: "Indisponible : Figma n'accepte sur son serveur en ligne que les applications de son catalogue MCP, et Noon n'y figure pas. Utilise « Figma (application de bureau) ».",
    }),
  }),
  Object.freeze({
    id: "figma-desktop", displayName: "Figma (application de bureau)", url: "http://127.0.0.1:3845/mcp", auth: "none",
    dataClass: "PRIVATE", readOnlyTools: FIGMA_READ_ONLY_TOOLS,
    note: "Serveur local de l'application Figma (Dev Mode). Aucun jeton : à activer dans Figma.",
    unreachableMessage: "Serveur Figma introuvable sur ce Mac. Dans Figma : ouvre un fichier, passe en Dev Mode (Maj+D), puis « Enable desktop MCP server » (siège Dev ou Full requis).",
  }),
]);

function catalogEntry(id) { return MCP_CATALOG.find((entry) => entry.id === id) || null; }

module.exports = { MCP_CATALOG, FIGMA_READ_ONLY_TOOLS, catalogEntry };
