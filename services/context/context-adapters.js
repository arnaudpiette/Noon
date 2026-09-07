"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function safeExplicitFileRef(filePath, allowedRoots = []) {
  const realPath = fs.realpathSync(filePath);
  const allowed = allowedRoots.some((root) => {
    const realRoot = fs.realpathSync(root);
    return realPath === realRoot || realPath.startsWith(`${realRoot}${path.sep}`);
  });
  if (!allowed) throw Object.assign(new Error("Fichier hors des racines autorisées."), { code: "AMBIENT_ROOT_ESCAPE" });
  const stat = fs.statSync(realPath);
  if (!stat.isFile()) throw Object.assign(new Error("La référence ne désigne pas un fichier."), { code: "AMBIENT_FILE_INVALID" });
  return Object.freeze({ path: realPath, name: path.basename(realPath), size: stat.size, mtimeMs: stat.mtimeMs,
    fingerprint: crypto.createHash("sha256").update(`${realPath}:${stat.size}:${stat.mtimeMs}`).digest("hex") });
}

function assertFilePrecondition(reference) {
  const stat = fs.statSync(reference.path);
  if (stat.mtimeMs !== reference.mtimeMs || stat.size !== reference.size) {
    throw Object.assign(new Error("Le fichier a changé depuis son partage."), { code: "AMBIENT_FILE_STALE" });
  }
  return true;
}

function createActiveApplicationAdapter({ provider, enabled = false } = {}) {
  return { async read() {
    if (!enabled || typeof provider !== "function") return null;
    const raw = await provider();
    if (!raw) return null;
    return { applicationId: String(raw.bundleId || raw.applicationId || "unknown").slice(0, 160),
      applicationName: String(raw.applicationName || "Application").slice(0, 80) };
  } };
}

function createStructuredApplicationAdapter({ id, enabled = false, permission = false } = {}) {
  return { id, available: () => enabled && permission, normalize(payload = {}) {
    if (!enabled || !permission) return null;
    return { adapter: id, workspaceId: payload.workspaceId || null, documentId: payload.documentId || null,
      documentName: payload.documentName ? String(payload.documentName).slice(0, 120) : null };
  } };
}

module.exports = { assertFilePrecondition, createActiveApplicationAdapter, createStructuredApplicationAdapter, safeExplicitFileRef };
