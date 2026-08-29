"use strict";

// Journal d’audit local des actions sensibles, enregistré sans exposer les secrets manipulés.

const fs = require("fs");
const path = require("path");
const { sanitizeAuditDetails } = require("./redaction");

function createAuditLog(filePath, maxEntries = 500) {
  function read() {
    try { const value = JSON.parse(fs.readFileSync(filePath, "utf8")); return Array.isArray(value) ? value : []; }
    catch { return []; }
  }
  function append(event, details = {}) {
    const entries = read();
    entries.push({ at: new Date().toISOString(), event: String(event).slice(0, 100), details: sanitizeAuditDetails(details) });
    const temporary = `${filePath}.tmp`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(entries.slice(-maxEntries), null, 2), { mode: 0o600 });
    fs.renameSync(temporary, filePath);
  }
  return { read, append };
}

module.exports = { createAuditLog };
