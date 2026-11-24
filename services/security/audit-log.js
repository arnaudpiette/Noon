"use strict";

// Journal d’audit local des actions sensibles, enregistré sans exposer les secrets manipulés.
// L’audit est au mieux (comme dans ApprovalEngine) : un échec d’écriture (disque plein,
// permission) ne fait jamais échouer l’action ou la requête qui l’appelle. Il est compté,
// signalé une fois par code dans les journaux et exposé par `health()`.

const fs = require("fs");
const path = require("path");
const { sanitizeAuditDetails } = require("./redaction");

function createAuditLog(filePath, maxEntries = 500, { warn = (message) => console.warn(message) } = {}) {
  let failures = 0;
  let lastErrorCode = null;
  let lastFailureAt = null;
  const reportedCodes = new Set();

  function read() {
    try { const value = JSON.parse(fs.readFileSync(filePath, "utf8")); return Array.isArray(value) ? value : []; }
    catch { return []; }
  }
  function append(event, details = {}) {
    const temporary = `${filePath}.tmp`;
    try {
      const entries = read();
      entries.push({ at: new Date().toISOString(), event: String(event).slice(0, 100), details: sanitizeAuditDetails(details) });
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(temporary, JSON.stringify(entries.slice(-maxEntries), null, 2), { mode: 0o600 });
      fs.renameSync(temporary, filePath);
      return true;
    } catch (error) {
      failures += 1;
      lastErrorCode = String(error?.code || error?.name || "ERROR").slice(0, 80);
      lastFailureAt = new Date().toISOString();
      try { fs.rmSync(temporary, { force: true }); } catch {}
      if (!reportedCodes.has(lastErrorCode)) {
        reportedCodes.add(lastErrorCode);
        try { warn(`[audit] écriture du journal d’audit impossible (${lastErrorCode}) ; l’action continue.`); } catch {}
      }
      return false;
    }
  }
  function health() {
    return { failures, lastErrorCode, lastFailureAt };
  }
  return { read, append, health };
}

module.exports = { createAuditLog };
