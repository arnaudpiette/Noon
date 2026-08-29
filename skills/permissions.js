"use strict";

const fs = require("fs");
const path = require("path");
const { isPathInsideRoots } = require("../lib/path-utils");

const LEVELS = new Set(["read", "draft", "write", "external", "destructive"]);

function authorizeSkill(skill, context = {}, args = {}) {
  const permissions = skill?.permissions || {};
  if (!LEVELS.has(permissions.level)) {
    return { allowed: false, code: "UNKNOWN_PERMISSION_LEVEL" };
  }
  if (permissions.explicitOrderRequired && context.explicitOrder !== true) {
    return { allowed: false, code: "EXPLICIT_ORDER_REQUIRED" };
  }
  if ((permissions.confirmationRequired || permissions.destructive) && context.confirmed !== true) {
    return { allowed: false, code: "CONFIRMATION_REQUIRED" };
  }
  const requestedPath = args.path || args.outputDirectory;
  if (requestedPath) {
    const roots = permissions.level === "write" ? context.allowedWriteRoots : context.allowedRoots;
    if (!Array.isArray(roots) || roots.length === 0) return { allowed: false, code: "NO_ALLOWED_ROOT" };
    const resolved = path.resolve(String(requestedPath));
    let checkedPath = resolved;
    try { if (fs.existsSync(resolved)) checkedPath = fs.realpathSync(resolved); } catch { return { allowed: false, code: "PATH_UNAVAILABLE" }; }
    if (!isPathInsideRoots(checkedPath, roots)) return { allowed: false, code: "PATH_OUTSIDE_ALLOWED_ROOTS" };
  }
  return { allowed: true, code: "AUTHORIZED" };
}

module.exports = { LEVELS, authorizeSkill };
