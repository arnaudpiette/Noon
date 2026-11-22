"use strict";

// V3-L1 — réglages des cadrans de caractère, stockés localement (aucun secret) dans
// DATA_DIRECTORY/character-preferences.json. Écriture atomique ; lecture tolérante.
const fs = require("node:fs");
const path = require("node:path");
const { CHARTER_VERSION, normalizeDials, validateDials } = require("./character-charter");

function createCharacterStore({ filePath, now = () => new Date().toISOString(), onChange = () => {} } = {}) {
  if (!filePath) throw new TypeError("filePath requis.");
  let cache = null;

  function read() {
    if (cache) return cache;
    let raw;
    try { raw = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { raw = null; }
    cache = Object.freeze({ dials: Object.freeze(normalizeDials(raw?.dials)), updatedAt: raw?.updatedAt || null, charterVersion: CHARTER_VERSION });
    return cache;
  }

  // Mise à jour explicite par Arnaud (Réglages) : seules des valeurs valides sont acceptées.
  function update(partial) {
    const changes = validateDials(partial);
    const dials = { ...read().dials, ...changes };
    const record = { dials, updatedAt: now(), charterVersion: CHARTER_VERSION };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, filePath);
    cache = null;
    const saved = read();
    try { onChange(saved); } catch { /* l'invalidation du cache de contexte reste facultative */ }
    return saved;
  }

  return Object.freeze({ get: read, update });
}

module.exports = { createCharacterStore };
