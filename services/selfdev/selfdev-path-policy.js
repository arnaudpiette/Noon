"use strict";

// SelfDev V1 (SD-1) — chemins que Noon ne peut jamais modifier dans son propre dépôt.
// Appliqué deux fois : contrat Native DEV (forbiddenPaths concrets) et diff réel du
// worktree après le run. Voir docs/SELFDEV_V1_DESIGN.md §4.2.

const fs = require("node:fs");
const path = require("node:path");
const { PROTECTED_TARGET_GLOBS } = require("../goals/goal-mode-dev-dispatch-service");

// Zones propres à Noon : sécurité, autorité, budgets, flags, gouvernance, outillage.
const SELFDEV_FORBIDDEN_GLOBS = Object.freeze([
  "services/security/**",
  "services/approvals/**",
  "services/goals/goal-mode-dev-*",
  "services/selfdev/**",
  "services/delegation/dev-command-policy.js",
  "services/delegation/dev-task-contract.js",
  "skills/registry.js",
  "services/config/feature-flag-registry.js",
  "services/dev/dev-cost-budget-service.js",
  "config.js",
  "AGENTS.md",
  "**/AGENTS.md",
  "AGENTS_ARCHITECTURE.md",
  "PERMISSIONS_AND_APPROVALS.md",
  "PRIVACY_AND_PERMISSIONS.md",
  "package.json",
  "package-lock.json",
  "scripts/**",
  "forge.config.js",
  "electron/production-hardening.js",
  "docs/SELFDEV_V1_DESIGN.md",
]);

const TEST_DIRECTORY = "test/";

function globToRegExp(glob, flags = "") {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (glob.startsWith("**/", index)) { source += "(?:.*/)?"; index += 2; }
    else if (glob.startsWith("/**", index) && index + 3 === glob.length) { source += "/.*"; index += 2; }
    else if (char === "*") source += "[^/]*";
    else source += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, flags);
}

const RULES = Object.freeze([
  ...PROTECTED_TARGET_GLOBS.map((glob) => ({ glob, pattern: globToRegExp(glob, "i"), code: "SELFDEV_PROTECTED_TARGET" })),
  ...SELFDEV_FORBIDDEN_GLOBS.map((glob) => ({ glob, pattern: globToRegExp(glob, "i"), code: "SELFDEV_FORBIDDEN_PATH" })),
]);

function policyError(code, message) { return Object.assign(new Error(message), { code }); }

// Chemin relatif POSIX normalisé ; refuse absolu, remontée et caractères de contrôle.
function normalizeRelativePath(value) {
  const raw = String(value ?? "");
  if (!raw || raw.includes("\0") || /[\r\n]/.test(raw)) throw policyError("SELFDEV_PATH_INVALID", "Chemin invalide.");
  const posix = raw.replace(/\\/g, "/");
  if (posix.startsWith("/")) throw policyError("SELFDEV_PATH_INVALID", "Chemin absolu refusé.");
  const normalized = path.posix.normalize(posix);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) throw policyError("SELFDEV_PATH_INVALID", "Chemin hors du dépôt.");
  return normalized;
}

function classifySelfDevPath(value) {
  const relative = normalizeRelativePath(value);
  // Motifs insensibles à la casse : le système de fichiers macOS l'est par défaut.
  for (const rule of RULES) {
    if (rule.pattern.test(relative)) {
      return Object.freeze({ path: relative, forbidden: true, code: rule.code, rule: rule.glob });
    }
  }
  return Object.freeze({ path: relative, forbidden: false, code: null, rule: null });
}

function isExistingTestPath(relative, baseTestFiles) {
  return relative.startsWith(TEST_DIRECTORY) && baseTestFiles.has(relative);
}

/**
 * Contrôle du diff réel d'un worktree SelfDev.
 * entries : [{ status: "A"|"M"|"D"|"T"|"?", path }] (renommages exprimés en D + A).
 * baseTestFiles : fichiers présents sous test/ dans le commit de base.
 * allowedPrefixes : facultatif, préfixes relatifs autorisés par le plan.
 */
function checkSelfDevDiff({ entries = [], baseTestFiles = [], allowedPrefixes = null } = {}) {
  const tests = new Set([...baseTestFiles].map(normalizeRelativePath));
  const prefixes = Array.isArray(allowedPrefixes) ? allowedPrefixes.map((item) => normalizeRelativePath(item).replace(/\/?$/, "/")) : null;
  const violations = [];
  const changed = [];
  for (const entry of entries) {
    const status = String(entry?.status || "").toUpperCase();
    if (!["A", "M", "D", "T", "?"].includes(status)) {
      violations.push({ path: String(entry?.path || ""), code: "SELFDEV_DIFF_STATUS_UNSUPPORTED" });
      continue;
    }
    let classification;
    try { classification = classifySelfDevPath(entry.path); }
    catch (error) { violations.push({ path: String(entry?.path || ""), code: error.code || "SELFDEV_PATH_INVALID" }); continue; }
    const relative = classification.path;
    changed.push({ status, path: relative });
    if (classification.forbidden) { violations.push({ path: relative, code: classification.code, rule: classification.rule }); continue; }
    if (status !== "A" && status !== "?" && isExistingTestPath(relative, tests)) {
      violations.push({ path: relative, code: "SELFDEV_EXISTING_TEST_CHANGED" });
      continue;
    }
    if (prefixes && !prefixes.some((prefix) => `${relative}/`.startsWith(prefix) || relative.startsWith(prefix))) {
      violations.push({ path: relative, code: "SELFDEV_OUTSIDE_ALLOWED_PATHS" });
    }
  }
  return Object.freeze({ ok: violations.length === 0, violations: Object.freeze(violations), changed: Object.freeze(changed) });
}

// forbiddenPaths concrets pour le contrat Native DEV : fichiers exacts et dossiers « x/** »
// présents dans le worktree. Les motifs génériques (**/AGENTS.md, test/ existants) sont
// couverts par checkSelfDevDiff après le run.
function contractForbiddenPaths(worktreeRoot) {
  const root = fs.realpathSync(worktreeRoot);
  const result = new Set();
  for (const glob of SELFDEV_FORBIDDEN_GLOBS) {
    if (glob.startsWith("**/")) continue;
    const literal = glob.endsWith("/**") ? glob.slice(0, -3) : glob;
    if (literal.includes("*")) {
      const directory = path.posix.dirname(literal);
      const pattern = globToRegExp(path.posix.basename(literal));
      const absoluteDirectory = path.join(root, directory);
      if (!fs.existsSync(absoluteDirectory)) continue;
      for (const name of fs.readdirSync(absoluteDirectory)) if (pattern.test(name)) result.add(path.join(absoluteDirectory, name));
      continue;
    }
    const absolute = path.join(root, literal);
    if (fs.existsSync(absolute)) result.add(absolute);
  }
  return Object.freeze([...result].sort());
}

module.exports = {
  SELFDEV_FORBIDDEN_GLOBS, TEST_DIRECTORY,
  checkSelfDevDiff, classifySelfDevPath, contractForbiddenPaths, normalizeRelativePath,
};
