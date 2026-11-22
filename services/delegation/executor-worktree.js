"use strict";

// V3-L5a — worktree isolé pour l'exécutant externe (D.1, docs/ROADMAP.md).
// L'exécutant (Codex CLI, plus tard Claude Code) travaille dans un worktree Git DÉTACHÉ créé
// depuis HEAD, rangé hors du dépôt. Le dossier de travail d'Arnaud n'est jamais modifié :
// aucune branche créée, aucun checkout, aucun stash. À la fin, Noon récupère le diff (patch)
// puis supprime le worktree, sauf demande de conservation.
// Les changements non commités d'Arnaud ne sont PAS visibles de l'exécutant : c'est signalé.
// Protections reprises de SelfDev (services/selfdev/selfdev-worktree-service.js, à faire converger
// en D.5) : hooks Git désactivés, node_modules cloné en APFS (jamais lié : l'exécutant ne peut pas
// modifier l'original), empreinte du dossier de travail comparée avant/après.

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { isPathInsideRoots } = require("../../lib/path-utils");
const { snapshotRepository } = require("./repository-preflight");

const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const DEPENDENCY_DIRS = Object.freeze(["node_modules"]);
const EXCLUDE_PATHSPECS = DEPENDENCY_DIRS.map((name) => `:(exclude)${name}`);
const MAX_PATCH_BYTES = 20 * 1024 * 1024;

const fail = (code, message) => Object.assign(new Error(message), { code });

function defaultGit(cwd, args, { maxBuffer = MAX_PATCH_BYTES + 1024 } = {}) {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8", timeout: 60_000, maxBuffer, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
}

// Copie APFS (copie à la demande, rapide) ; échec explicite plutôt qu'un lien vers l'original.
function cloneDirectoryApfs(source, destination) {
  execFileSync("/bin/cp", ["-cR", source, destination], { stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });
}

function parseNameStatus(output) {
  return String(output || "").split("\n").filter(Boolean).map((line) => {
    const [status, ...paths] = line.split("\t");
    return { status: status.charAt(0), path: paths.at(-1), ...(paths.length > 1 ? { from: paths[0] } : {}) };
  });
}

function createExecutorWorktreeManager({ rootDir, git = defaultGit, cloneDependencies = true, cloneDirectory = cloneDirectoryApfs, now = () => new Date() } = {}) {
  if (!rootDir || !path.isAbsolute(rootDir)) throw new TypeError("rootDir absolu requis.");

  // Worktrees des missions en cours : chemin réel → dépôt d'origine. Sert au bac à sable des
  // validations, qui vérifie l'autorisation sur le dépôt d'origine (jamais sur un chemin arbitraire).
  const active = new Map();
  function resolveSource(candidate) {
    try { return active.get(fs.realpathSync(String(candidate || ""))) || null; } catch { return null; }
  }
  function release(handle) { active.delete(handle.path); }

  function fingerprint(repo) {
    const snapshot = snapshotRepository(repo);
    return { key: JSON.stringify({ status: snapshot.status, head: snapshot.head, fingerprints: snapshot.fingerprints }), files: snapshot.files.length };
  }

  function ensureRoot() {
    fs.mkdirSync(rootDir, { recursive: true, mode: 0o700 });
    return fs.realpathSync(rootDir);
  }

  function prepare({ repositoryRoot, taskId }) {
    if (!TASK_ID.test(String(taskId || ""))) throw fail("EXECUTOR_TASK_ID_INVALID", "Identifiant de mission invalide.");
    const repo = fs.realpathSync(repositoryRoot);
    const root = ensureRoot();
    if (isPathInsideRoots(root, [repo]) || isPathInsideRoots(repo, [root])) throw fail("EXECUTOR_WORKTREE_NESTED", "Le dossier des worktrees ne peut pas être dans le dépôt.");
    const top = git(repo, ["rev-parse", "--show-toplevel"]).trim();
    if (fs.realpathSync(top) !== repo) throw fail("EXECUTOR_NOT_REPOSITORY_ROOT", "Le dépôt doit être pris à sa racine Git.");
    let baseCommit;
    try { baseCommit = git(repo, ["rev-parse", "--verify", "HEAD^{commit}"]).trim(); } catch { throw fail("EXECUTOR_NO_COMMIT", "Le dépôt n'a encore aucun commit : impossible de créer un worktree."); }
    const worktreePath = path.join(root, taskId);
    if (fs.existsSync(worktreePath)) throw fail("EXECUTOR_WORKTREE_EXISTS", "Un worktree existe déjà pour cette mission.");
    // Empreinte du dossier d'Arnaud : statut Git, HEAD et contenu de chaque fichier modifié ou nouveau
    // (un fichier déjà modifié puis réécrit garde le même statut : seul le contenu le trahit).
    const sourceSnapshot = fingerprint(repo);
    git(repo, ["worktree", "add", "--detach", "--quiet", worktreePath, baseCommit]);
    const dependencies = {};
    if (cloneDependencies) for (const name of DEPENDENCY_DIRS) {
      const source = path.join(repo, name);
      const target = path.join(worktreePath, name);
      if (!fs.existsSync(source) || fs.existsSync(target)) continue;
      try { cloneDirectory(source, target); dependencies[name] = "cloned"; } catch { dependencies[name] = "clone_failed"; }
    }
    const realWorktree = fs.realpathSync(worktreePath);
    active.set(realWorktree, repo);
    return Object.freeze({
      taskId, repositoryRoot: repo, path: realWorktree, baseCommit, dependencies: Object.freeze(dependencies),
      sourceFingerprint: sourceSnapshot.key,
      createdAt: now().toISOString(),
      // Changements locaux d'Arnaud que l'exécutant ne verra pas (le worktree part de HEAD).
      sourceUncommitted: sourceSnapshot.files,
    });
  }

  // Diff complet du worktree par rapport au commit de base (fichiers suivis et nouveaux),
  // sans les liens de dépendances. L'index du worktree est le seul touché.
  function collect(handle, { patchDir = path.join(rootDir, "patches") } = {}) {
    // Exclusion par fichier (et non par pathspec : git add échoue si le chemin est déjà ignoré).
    const excludeFile = path.join(ensureRoot(), ".executor-exclude");
    fs.writeFileSync(excludeFile, DEPENDENCY_DIRS.map((name) => `/${name}`).join("\n") + "\n", { mode: 0o600 });
    git(handle.path, ["-c", `core.excludesFile=${excludeFile}`, "add", "-A", "--", "."]);
    const files = parseNameStatus(git(handle.path, ["diff", "--cached", "--name-status", "-M", handle.baseCommit, "--", ".", ...EXCLUDE_PATHSPECS]));
    const patch = git(handle.path, ["diff", "--cached", "--binary", "-M", handle.baseCommit, "--", ".", ...EXCLUDE_PATHSPECS]);
    if (Buffer.byteLength(patch) > MAX_PATCH_BYTES) throw fail("EXECUTOR_PATCH_TOO_LARGE", "Le diff de la mission est trop volumineux.");
    let patchPath = null;
    if (patch) {
      fs.mkdirSync(patchDir, { recursive: true, mode: 0o700 });
      patchPath = path.join(patchDir, `${handle.taskId}.patch`);
      fs.writeFileSync(patchPath, patch, { mode: 0o600 });
    }
    const headAfter = git(handle.path, ["rev-parse", "HEAD"]).trim();
    return Object.freeze({ baseCommit: handle.baseCommit, files: Object.freeze(files), patchPath, patchBytes: Buffer.byteLength(patch), committedByExecutor: headAfter !== handle.baseCommit });
  }

  // Ne supprime que des worktrees rangés sous rootDir et enregistrés par Git.
  function dispose(handle) {
    const root = ensureRoot();
    const target = path.resolve(handle.path);
    active.delete(target);
    if (!isPathInsideRoots(target, [root]) || target === root) throw fail("EXECUTOR_WORKTREE_OUTSIDE_ROOT", "Suppression refusée hors du dossier des worktrees.");
    try { git(handle.repositoryRoot, ["worktree", "remove", "--force", target]); }
    finally { try { git(handle.repositoryRoot, ["worktree", "prune"]); } catch {} }
    return !fs.existsSync(target);
  }

  // Preuve plutôt qu'affirmation : l'état Git du dossier de travail est-il identique à avant ?
  function sourceUntouched(handle) {
    try { return fingerprint(handle.repositoryRoot).key === handle.sourceFingerprint; } catch { return false; }
  }

  return Object.freeze({ prepare, collect, dispose, release, resolveSource, sourceUntouched, rootDir });
}

// Le contrat de mission pointe vers le worktree : mêmes chemins relatifs, même périmètre.
function remapContractToWorktree(contract, worktreePath) {
  const move = (item) => path.join(worktreePath, path.relative(contract.repositoryRoot, item));
  return Object.freeze({
    ...contract,
    repositoryRoot: worktreePath,
    branch: null,
    allowedPaths: Object.freeze(contract.allowedPaths.map(move)),
    forbiddenPaths: Object.freeze(contract.forbiddenPaths.map(move)),
  });
}

module.exports = { createExecutorWorktreeManager, parseNameStatus, remapContractToWorktree };
