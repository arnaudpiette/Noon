"use strict";

// V3-L7 — éléments partagés par le service de terminal du workspace DEV et ses modules :
// l'erreur typée et le nettoyage de texte, sortis tels quels de workspace-terminal-service.js.

class DevWorkspaceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DevWorkspaceError";
    this.code = code;
  }
}

function clean(value, max = 200) {
  return String(value || "")
    .replace(/[\0\r\n]+/g, " ")
    .trim()
    .slice(0, max);
}

module.exports = { DevWorkspaceError, clean };
