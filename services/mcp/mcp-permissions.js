"use strict";

// Classement d'un outil MCP dans les niveaux de permission Noon.
// Les annotations viennent du serveur distant : elles ne suffisent jamais seules.
// Un outil n'est READ que si l'utilisateur l'a validé ET que le serveur
// (readOnlyHint) ou le catalogue relu dans Noon le déclare en lecture seule.
// Tout le reste est WRITE (ou DESTRUCTIVE si le serveur l'annonce ainsi).

const LEVELS = Object.freeze({ READ: "READ", WRITE: "WRITE", DESTRUCTIVE: "DESTRUCTIVE" });

function classifyMcpTool(tool, { userApprovedReadOnly = [], catalogReadOnly = [] } = {}) {
  const name = String(tool?.name || "");
  const annotations = tool?.annotations && typeof tool.annotations === "object" ? tool.annotations : {};
  if (annotations.destructiveHint === true) return { level: LEVELS.DESTRUCTIVE, reason: "DESTRUCTIVE_HINT" };
  const declaredReadOnly = annotations.readOnlyHint === true || (annotations.readOnlyHint !== false && catalogReadOnly.includes(name));
  if (!declaredReadOnly) return { level: LEVELS.WRITE, reason: annotations.readOnlyHint === false ? "SERVER_DECLARES_WRITE" : "NOT_DECLARED_READ_ONLY" };
  if (!userApprovedReadOnly.includes(name)) return { level: LEVELS.WRITE, reason: "READ_ONLY_NOT_APPROVED_BY_USER" };
  return { level: LEVELS.READ, reason: annotations.readOnlyHint === true ? "SERVER_HINT_AND_USER_APPROVAL" : "CATALOG_AND_USER_APPROVAL" };
}

module.exports = { LEVELS, classifyMcpTool };
