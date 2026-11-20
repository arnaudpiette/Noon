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
    dataClass: "PRIVATE", readOnlyTools: FIGMA_READ_ONLY_TOOLS,
    note: "Serveur distant officiel. L'enregistrement OAuth dynamique reste à vérifier sur le Mac.",
  }),
  Object.freeze({
    id: "figma-desktop", displayName: "Figma (application de bureau)", url: "http://127.0.0.1:3845/mcp", auth: "none",
    dataClass: "PRIVATE", readOnlyTools: FIGMA_READ_ONLY_TOOLS,
    note: "Serveur local de l'application Figma (Dev Mode). Aucun jeton : à activer dans Figma.",
  }),
]);

function catalogEntry(id) { return MCP_CATALOG.find((entry) => entry.id === id) || null; }

module.exports = { MCP_CATALOG, FIGMA_READ_ONLY_TOOLS, catalogEntry };
