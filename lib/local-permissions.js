"use strict";

// Registre des dossiers accordés à Noon en lecture seule ou en lecture et création.

const fs = require("fs");
const path = require("path");

function atomicWrite(filePath, value) {
  const temporary = `${filePath}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function normalizePermission(permission) {
  const requested = path.resolve(String(permission?.path || ""));
  if (!path.isAbsolute(requested) || !fs.existsSync(requested)) throw new Error("Dossier local indisponible.");
  const realPath = fs.realpathSync(requested);
  if (!fs.statSync(realPath).isDirectory()) throw new Error("Le chemin sélectionné n’est pas un dossier.");
  return { path: realPath, mode: permission?.mode === "read-write" ? "read-write" : "read-only", output: permission?.output === true, addedAt: permission?.addedAt || new Date().toISOString() };
}

function createLocalPermissionStore(filePath) {
  function load() {
    try {
      const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return { version: 1, roots: (Array.isArray(saved?.roots) ? saved.roots : []).map((item) => { try { return normalizePermission(item); } catch { return null; } }).filter(Boolean) };
    } catch { return { version: 1, roots: [] }; }
  }
  function save(state) { atomicWrite(filePath, { version: 1, roots: state.roots }); }
  function add(permission) { const state = load(); const normalized = normalizePermission(permission); state.roots = [normalized, ...state.roots.filter((item) => item.path !== normalized.path)]; save(state); return normalized; }
  function remove(targetPath) { const state = load(); const requested = path.resolve(String(targetPath || "")); let resolved = requested; try { resolved = fs.realpathSync(requested); } catch {} state.roots = state.roots.filter((item) => item.path !== resolved); save(state); }
  function roots(mode = "read-only") { return load().roots.filter((item) => mode !== "read-write" || item.mode === "read-write").map((item) => item.path); }
  return { load, add, remove, roots };
}

module.exports = { createLocalPermissionStore, normalizePermission };
