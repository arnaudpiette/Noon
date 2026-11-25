"use strict";

// Catalogue relu dans Noon des serveurs MCP proposés par défaut.
// readOnlyTools liste les outils que Noon considère en lecture seule ; ils restent
// invisibles tant que l'utilisateur ne les a pas validés un par un.

const FIGMA_READ_ONLY_TOOLS = Object.freeze([
  "whoami", "create_session", "get_metadata", "get_design_context", "get_screenshot",
  "get_variable_defs", "get_figjam", "get_libraries", "search_design_system", "get_comments",
]);

// Outils Supabase sans effet (documentation, lecture de schéma, journaux, conseils). execute_sql
// n'y figure pas : une requête SQL peut écrire, elle reste donc un outil d'écriture validé.
const SUPABASE_READ_ONLY_TOOLS = Object.freeze([
  "search_docs", "list_tables", "list_extensions", "list_migrations", "get_logs", "get_advisors",
  "get_project_url", "generate_typescript_types", "list_edge_functions", "get_edge_function", "list_branches",
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
  // Phase 2 : Supabase accepte l'enregistrement dynamique de client (vérifié le 25/11/2026 dans sa
  // documentation). Toujours limité à UN projet (project_ref) : les outils de gestion du compte
  // (créer, mettre en pause un projet) disparaissent alors côté serveur.
  Object.freeze({
    id: "supabase", displayName: "Supabase", url: "https://mcp.supabase.com/mcp", auth: "oauth",
    remoteCapability: "REMOTE_SUPABASE",
    dataClass: "PRIVATE", readOnlyTools: SUPABASE_READ_ONLY_TOOLS,
    projectRef: Object.freeze({ param: "project_ref", pattern: "^[a-z]{20}$", label: "Identifiant du projet Supabase (20 lettres, visible dans l'URL du tableau de bord)" }),
    note: "Serveur distant officiel de Supabase, limité à un seul projet. Préfère un projet de développement : chaque écriture demande ta validation exacte.",
  }),
  // Phase 6 (migration progressive) : serveur MCP officiel de GitHub, à côté du connecteur natif
  // qui reste en place. Vérifié le 25/11/2026 : jeton d'accès personnel accepté de tout client,
  // enregistrement dynamique OAuth non proposé. Les outils de lecture portent readOnlyHint.
  Object.freeze({
    id: "github", displayName: "GitHub (MCP officiel)", url: "https://api.githubcopilot.com/mcp/", auth: "token",
    remoteCapability: "REMOTE_GITHUB", dataClass: "PRIVATE", readOnlyTools: Object.freeze([]),
    tokenHelp: "Crée un jeton « fine-grained » sur github.com (Settings → Developer settings), limité aux dépôts utiles et en lecture seule si tu n'as besoin que de lire.",
    note: "Serveur MCP officiel de GitHub. Le connecteur GitHub natif de Noon reste disponible.",
  }),
  // Vérifié le 25/11/2026 : Vercel n'accepte que les clients qu'il a validés, ou ceux qui publient un
  // document d'identité de client (CIMD) sur une URL HTTPS. Noon n'a ni l'un ni l'autre aujourd'hui.
  Object.freeze({
    id: "vercel", displayName: "Vercel", url: "https://mcp.vercel.com", auth: "oauth",
    remoteCapability: "REMOTE_VERCEL", dataClass: "PRIVATE", readOnlyTools: Object.freeze([]),
    note: "Serveur distant officiel de Vercel.",
    unavailable: Object.freeze({
      code: "MCP_CLIENT_NOT_ACCEPTED",
      message: "Indisponible : Vercel n'accepte que les applications qu'il a validées ou qui publient une identité de client (CIMD) en ligne, et Noon n'en a pas encore.",
    }),
  }),
]);

function catalogEntry(id) { return MCP_CATALOG.find((entry) => entry.id === id) || null; }

module.exports = { MCP_CATALOG, FIGMA_READ_ONLY_TOOLS, SUPABASE_READ_ONLY_TOOLS, catalogEntry };
