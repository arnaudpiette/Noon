"use strict";

// SelfDev V1 (SD-1) — cible SelfDev : le dépôt de développement de Noon, enregistré
// explicitement par l'utilisateur. Sans cible (par exemple dans Noon.app packagée),
// SelfDev est indisponible. Aucun secret n'est stocké ici.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const BRANCH_PATTERN = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,120}$/;

function storeError(code, message) { return Object.assign(new Error(message), { code }); }

function createSelfDevTargetStore({ filePath, gitExecutable = "git", expectedPackageName = "noon", now = () => new Date() } = {}) {
  if (!filePath) throw storeError("SELFDEV_CONFIG_INVALID", "Fichier de cible requis.");

  function validate({ repositoryRoot, baseBranch }) {
    let root;
    try { root = fs.realpathSync(path.resolve(String(repositoryRoot || ""))); } catch { throw storeError("SELFDEV_TARGET_INVALID", "Dépôt introuvable."); }
    let top = "";
    try {
      top = execFileSync(gitExecutable, ["-c", "core.hooksPath=/dev/null", "-C", root, "rev-parse", "--show-toplevel"], { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch { /* traité ci-dessous */ }
    if (!top || fs.realpathSync(top) !== root) throw storeError("SELFDEV_TARGET_INVALID", "La cible doit être la racine d'un dépôt Git.");
    let name = null;
    try { name = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).name; } catch { /* traité ci-dessous */ }
    if (name !== expectedPackageName) throw storeError("SELFDEV_TARGET_NOT_NOON", "Ce dépôt n'est pas celui de Noon.");
    const branch = String(baseBranch || "");
    if (!BRANCH_PATTERN.test(branch) || branch.endsWith("/") || branch.endsWith(".lock")) throw storeError("SELFDEV_BASE_INVALID", "Branche de base invalide.");
    return { repositoryRoot: root, baseBranch: branch };
  }

  function register(input = {}) {
    const target = { version: 1, ...validate(input), registeredAt: now().toISOString() };
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(target, null, 2), { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, filePath);
    return Object.freeze(target);
  }

  // Relit et revalide à chaque lecture : un dépôt déplacé ou remplacé n'est plus une cible.
  function get() {
    let saved;
    try { saved = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
    try { return Object.freeze({ ...saved, ...validate(saved) }); }
    catch (error) { return Object.freeze({ unavailable: true, code: error.code }); }
  }

  function clear() { fs.rmSync(filePath, { force: true }); return true; }

  return Object.freeze({ register, get, clear });
}

module.exports = { createSelfDevTargetStore };
