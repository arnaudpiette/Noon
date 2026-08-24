"use strict";
const fs = require("fs");
const path = require("path");
function safeBaseName(value) { return String(value || "Livrable").normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "Livrable"; }
function nextVersionedPath(directory, project, deliverable, extension, now = new Date()) {
  fs.mkdirSync(directory, { recursive: true });
  const date = now.toISOString().slice(0, 10);
  const prefix = `${safeBaseName(project)}_${safeBaseName(deliverable)}_v`;
  const existing = fs.readdirSync(directory).filter((name) => name.startsWith(prefix));
  const version = String(existing.reduce((max, name) => Math.max(max, Number(name.match(/_v(\d+)/)?.[1] || 0)), 0) + 1).padStart(3, "0");
  return path.join(directory, `${prefix}${version}_${date}.${String(extension).replace(/^\./, "")}`);
}
module.exports = { safeBaseName, nextVersionedPath };
