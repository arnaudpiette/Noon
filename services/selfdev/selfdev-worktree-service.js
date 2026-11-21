"use strict";

// SelfDev V1 (SD-1) — copie isolée du dépôt Noon (git worktree), sans modèle.
// Garanties : le working tree de l'utilisateur n'est jamais modifié (empreinte
// vérifiée avant/après) ; hooks Git désactivés ; node_modules cloné (APFS), jamais
// lié ; manifestes stockés hors du worktree ; suppression seulement explicite.
// Voir docs/SELFDEV_V1_DESIGN.md §4.1.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { isPathInsideRoots } = require("../../lib/path-utils");
const { checkSelfDevDiff, contractForbiddenPaths, TEST_DIRECTORY } = require("./selfdev-path-policy");

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{5,47}$/;
const BRANCH_PREFIX = "selfdev/";
const GIT_TIMEOUT_MS = 60_000;
const RETENTION_DAYS = 14;

function serviceError(code, message) { return Object.assign(new Error(message), { code }); }

function realDirectory(value, code) {
  try {
    const resolved = fs.realpathSync(path.resolve(String(value || "")));
    if (!fs.statSync(resolved).isDirectory()) throw new Error("not-directory");
    return resolved;
  } catch { throw serviceError(code, "Dossier introuvable."); }
}

// node_modules : clone APFS (copie à la demande). Échec explicite si le clone est impossible.
function cloneNodeModulesApfs(source, destination) {
  execFileSync("/bin/cp", ["-cR", source, destination], { stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });
}

function createSelfDevWorktreeService({
  container, stateDirectory, gitExecutable = "git",
  cloneNodeModules = cloneNodeModulesApfs, now = () => new Date(),
  randomId = () => crypto.randomBytes(4).toString("hex"),
} = {}) {
  if (!container || !stateDirectory) throw serviceError("SELFDEV_CONFIG_INVALID", "Conteneur et dossier d'état requis.");
  fs.mkdirSync(container, { recursive: true, mode: 0o700 });
  fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  const containerRoot = realDirectory(container, "SELFDEV_CONFIG_INVALID");
  const stateRoot = realDirectory(stateDirectory, "SELFDEV_CONFIG_INVALID");
  if (isPathInsideRoots(stateRoot, [containerRoot]) || isPathInsideRoots(containerRoot, [stateRoot])) {
    throw serviceError("SELFDEV_CONFIG_INVALID", "Le dossier d'état doit être hors du conteneur des worktrees.");
  }

  // Hooks désactivés et aucune invite : aucun script du dépôt ne s'exécute ici.
  function git(cwd, args, { allowFailure = false } = {}) {
    try {
      return execFileSync(gitExecutable, ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-C", cwd, ...args], {
        encoding: "utf8", timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
      });
    } catch (error) {
      if (allowFailure) return null;
      throw serviceError("SELFDEV_GIT_FAILED", `Commande Git refusée ou en échec (${args[0]}).`);
    }
  }

  // Empreinte du working tree utilisateur : HEAD, statut et contenu des fichiers modifiés.
  function userTreeFingerprint(repositoryRoot) {
    const head = (git(repositoryRoot, ["rev-parse", "HEAD"], { allowFailure: true }) || "").trim();
    const status = git(repositoryRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    const diff = git(repositoryRoot, ["diff", "--binary", "HEAD"], { allowFailure: true }) || "";
    const hash = crypto.createHash("sha256");
    hash.update(head).update("\0").update(status).update("\0").update(diff);
    for (const record of status.split("\0").filter(Boolean)) {
      if (!record.startsWith("??")) continue;
      const relative = record.slice(3);
      try { const stat = fs.lstatSync(path.join(repositoryRoot, relative)); if (stat.isFile()) hash.update(relative).update(fs.readFileSync(path.join(repositoryRoot, relative))); } catch { hash.update(relative).update("missing"); }
    }
    return hash.digest("hex");
  }

  function manifestPath(id) {
    if (!ID_PATTERN.test(String(id))) throw serviceError("SELFDEV_ID_INVALID", "Identifiant SelfDev invalide.");
    return path.join(stateRoot, `${id}.json`);
  }

  function writeManifest(manifest) {
    const target = manifestPath(manifest.id);
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2), { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, target);
  }

  function readManifest(id) {
    try { return JSON.parse(fs.readFileSync(manifestPath(id), "utf8")); }
    catch (error) { if (error.code === "SELFDEV_ID_INVALID") throw error; throw serviceError("SELFDEV_WORKTREE_UNKNOWN", "Proposition SelfDev introuvable."); }
  }

  function resolveRepository(repositoryRoot) {
    const root = realDirectory(repositoryRoot, "SELFDEV_TARGET_INVALID");
    const top = (git(root, ["rev-parse", "--show-toplevel"], { allowFailure: true }) || "").trim();
    if (!top || fs.realpathSync(top) !== root) throw serviceError("SELFDEV_TARGET_INVALID", "La cible doit être la racine d'un dépôt Git.");
    if (isPathInsideRoots(containerRoot, [root]) || isPathInsideRoots(root, [containerRoot])) {
      throw serviceError("SELFDEV_CONFIG_INVALID", "Le conteneur des worktrees doit être hors du dépôt cible.");
    }
    return root;
  }

  function create({ repositoryRoot, baseRef = "HEAD" } = {}) {
    const root = resolveRepository(repositoryRoot);
    if (typeof baseRef !== "string" || !baseRef || baseRef.startsWith("-") || /[\0\s]/.test(baseRef)) throw serviceError("SELFDEV_BASE_INVALID", "Base invalide.");
    const baseCommit = (git(root, ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`], { allowFailure: true }) || "").trim();
    if (!/^[0-9a-f]{40,64}$/.test(baseCommit)) throw serviceError("SELFDEV_BASE_INVALID", "Base introuvable.");
    const createdAt = now();
    const id = `${createdAt.toISOString().slice(0, 10).replace(/-/g, "")}-${randomId()}`;
    manifestPath(id);
    const branch = `${BRANCH_PREFIX}${id}`;
    const worktreePath = path.join(containerRoot, id);
    if (fs.existsSync(worktreePath)) throw serviceError("SELFDEV_WORKTREE_EXISTS", "Un worktree porte déjà cet identifiant.");
    if (git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { allowFailure: true })) throw serviceError("SELFDEV_WORKTREE_EXISTS", "La branche SelfDev existe déjà.");

    const before = userTreeFingerprint(root);
    git(root, ["worktree", "add", "--quiet", "-b", branch, worktreePath, baseCommit]);
    let manifest;
    try {
      const sourceModules = path.join(root, "node_modules");
      let nodeModules = "absent";
      if (fs.existsSync(sourceModules)) {
        if (fs.lstatSync(sourceModules).isSymbolicLink()) throw serviceError("SELFDEV_NODE_MODULES_UNSUPPORTED", "node_modules du dépôt est un lien : clone refusé.");
        try { cloneNodeModules(sourceModules, path.join(worktreePath, "node_modules")); }
        catch { throw serviceError("SELFDEV_NODE_MODULES_CLONE_FAILED", "Clone de node_modules impossible : SelfDev s'arrête."); }
        const cloned = path.join(worktreePath, "node_modules");
        if (!fs.existsSync(cloned) || fs.lstatSync(cloned).isSymbolicLink()) throw serviceError("SELFDEV_NODE_MODULES_CLONE_FAILED", "Clone de node_modules invalide.");
        nodeModules = "cloned";
      }
      const baseTestFiles = git(worktreePath, ["ls-tree", "-r", "-z", "--name-only", baseCommit, "--", TEST_DIRECTORY])
        .split("\0").filter(Boolean);
      manifest = {
        version: 1, id, repositoryRoot: root, worktreePath, branch, baseRef, baseCommit,
        createdAt: createdAt.toISOString(), nodeModules, baseTestFiles,
      };
      writeManifest(manifest);
    } catch (error) {
      git(root, ["worktree", "remove", "--force", worktreePath], { allowFailure: true });
      git(root, ["branch", "-D", branch], { allowFailure: true });
      throw error;
    }
    if (userTreeFingerprint(root) !== before) throw serviceError("SELFDEV_USER_TREE_CHANGED", "Le working tree de l'utilisateur a changé pendant la création.");
    return publicView(manifest);
  }

  function publicView(manifest) {
    return Object.freeze({
      id: manifest.id, worktreePath: manifest.worktreePath, branch: manifest.branch,
      baseRef: manifest.baseRef, baseCommit: manifest.baseCommit, createdAt: manifest.createdAt,
      nodeModules: manifest.nodeModules,
    });
  }

  // Diff réel du worktree depuis la base : modifications suivies et fichiers non suivis.
  // --no-renames : un renommage apparaît en D + A (un test existant renommé est donc refusé).
  function diffEntries(id) {
    const manifest = readManifest(id);
    if (!fs.existsSync(manifest.worktreePath)) throw serviceError("SELFDEV_WORKTREE_MISSING", "Worktree SelfDev absent.");
    const tracked = git(manifest.worktreePath, ["diff", "--name-status", "-z", "--no-renames", manifest.baseCommit, "--"]).split("\0").filter(Boolean);
    const entries = [];
    for (let index = 0; index + 1 < tracked.length; index += 2) entries.push({ status: tracked[index].slice(0, 1), path: tracked[index + 1] });
    for (const relative of git(manifest.worktreePath, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean)) {
      entries.push({ status: "?", path: relative });
    }
    return Object.freeze(entries);
  }

  function check(id, { allowedPrefixes = null } = {}) {
    const manifest = readManifest(id);
    return checkSelfDevDiff({ entries: diffEntries(id), baseTestFiles: manifest.baseTestFiles, allowedPrefixes });
  }

  function list() {
    const items = [];
    for (const name of fs.readdirSync(stateRoot)) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      if (!ID_PATTERN.test(id)) continue;
      let manifest;
      try { manifest = readManifest(id); } catch { continue; }
      const exists = fs.existsSync(manifest.worktreePath);
      let changed = null;
      if (exists) { try { changed = diffEntries(id).length; } catch { changed = null; } }
      const ageDays = Math.floor((now().getTime() - Date.parse(manifest.createdAt)) / 86_400_000);
      items.push(Object.freeze({ ...publicView(manifest), exists, changedFiles: changed, ageDays, cleanupSuggested: ageDays >= RETENTION_DAYS }));
    }
    return Object.freeze(items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  // Suppression uniquement explicite ; refusée si des changements n'ont pas été acceptés
  // comme perdus. La branche n'est supprimée que si elle ne porte aucun commit propre.
  function remove(id, { discardChanges = false } = {}) {
    const manifest = readManifest(id);
    const root = resolveRepository(manifest.repositoryRoot);
    if (fs.existsSync(manifest.worktreePath)) {
      // Seules les modifications non commitées seraient perdues : un commit sur la branche
      // SelfDev est conservé avec la branche (voir branchKept).
      const uncommitted = git(manifest.worktreePath, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0").filter(Boolean);
      if (uncommitted.length && discardChanges !== true) throw serviceError("SELFDEV_WORKTREE_HAS_CHANGES", "La proposition contient des modifications non commitées : confirme leur abandon.");
      const before = userTreeFingerprint(root);
      git(root, ["worktree", "remove", "--force", manifest.worktreePath]);
      if (userTreeFingerprint(root) !== before) throw serviceError("SELFDEV_USER_TREE_CHANGED", "Le working tree de l'utilisateur a changé pendant la suppression.");
    } else {
      git(root, ["worktree", "prune"], { allowFailure: true });
    }
    const tip = (git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${manifest.branch}`], { allowFailure: true }) || "").trim();
    let branchKept = false;
    if (tip && tip === manifest.baseCommit) git(root, ["branch", "-D", manifest.branch]);
    else if (tip) branchKept = true;
    fs.rmSync(manifestPath(id), { force: true });
    return Object.freeze({ removed: id, branchKept });
  }

  // Lecture interne (SD-2) : copie figée du manifeste, sans écriture possible.
  function describe(id) {
    const manifest = readManifest(id);
    return Object.freeze({ ...manifest, baseTestFiles: Object.freeze([...(manifest.baseTestFiles || [])]) });
  }

  // Sonde jetable : worktree détaché au commit de base (aucune branche), node_modules cloné,
  // dans laquelle SD-2 copie uniquement les nouveaux tests pour prouver qu'ils échouent sur la base.
  function createProbe(id) {
    const manifest = readManifest(id);
    const root = resolveRepository(manifest.repositoryRoot);
    const probePath = path.join(containerRoot, `${id}-probe-${randomId()}`);
    if (fs.existsSync(probePath)) throw serviceError("SELFDEV_WORKTREE_EXISTS", "Sonde déjà présente.");
    const before = userTreeFingerprint(root);
    git(root, ["worktree", "add", "--quiet", "--detach", probePath, manifest.baseCommit]);
    try {
      const sourceModules = path.join(root, "node_modules");
      if (fs.existsSync(sourceModules)) {
        if (fs.lstatSync(sourceModules).isSymbolicLink()) throw serviceError("SELFDEV_NODE_MODULES_UNSUPPORTED", "node_modules du dépôt est un lien : clone refusé.");
        try { cloneNodeModules(sourceModules, path.join(probePath, "node_modules")); }
        catch { throw serviceError("SELFDEV_NODE_MODULES_CLONE_FAILED", "Clone de node_modules impossible : SelfDev s'arrête."); }
      }
    } catch (error) {
      git(root, ["worktree", "remove", "--force", probePath], { allowFailure: true });
      throw error;
    }
    if (userTreeFingerprint(root) !== before) throw serviceError("SELFDEV_USER_TREE_CHANGED", "Le working tree de l'utilisateur a changé pendant la création de la sonde.");
    return Object.freeze({ probePath, baseCommit: manifest.baseCommit });
  }

  function removeProbe(id, probePath) {
    const manifest = readManifest(id);
    const root = resolveRepository(manifest.repositoryRoot);
    const resolved = path.resolve(String(probePath || ""));
    if (path.dirname(resolved) !== containerRoot || !path.basename(resolved).startsWith(`${id}-probe-`)) throw serviceError("SELFDEV_PROBE_INVALID", "Sonde invalide.");
    git(root, ["worktree", "remove", "--force", resolved], { allowFailure: true });
    if (fs.existsSync(resolved)) fs.rmSync(resolved, { recursive: true, force: true });
    git(root, ["worktree", "prune"], { allowFailure: true });
    return true;
  }

  // SD-3 : retrouve la proposition dont le worktree est exactement ce dossier (null sinon).
  function findByPath(directory) {
    let resolved;
    try { resolved = fs.realpathSync(path.resolve(String(directory || ""))); } catch { return null; }
    for (const name of fs.readdirSync(stateRoot)) {
      const id = name.endsWith(".json") ? name.slice(0, -5) : "";
      if (!ID_PATTERN.test(id)) continue;
      try { const manifest = readManifest(id); if (manifest.worktreePath === resolved) return describe(id); } catch { /* manifeste illisible ignoré */ }
    }
    return null;
  }

  // SD-3 : forbiddenPaths concrets pour le contrat Native DEV d'un worktree SelfDev :
  // zones protégées présentes, chaque test existant de la base, chaque AGENTS.md suivi.
  function contractPolicyPaths(id) {
    const manifest = readManifest(id);
    if (!fs.existsSync(manifest.worktreePath)) throw serviceError("SELFDEV_WORKTREE_MISSING", "Worktree SelfDev absent.");
    const root = fs.realpathSync(manifest.worktreePath);
    const paths = new Set(contractForbiddenPaths(root));
    for (const relative of manifest.baseTestFiles || []) paths.add(path.join(root, relative));
    for (const relative of git(root, ["ls-files", "-z", "--", ":(glob)**/AGENTS.md", ":(glob)**/agents.md"]).split("\0").filter(Boolean)) {
      paths.add(path.join(root, relative));
    }
    return Object.freeze([...paths].sort());
  }

  return Object.freeze({ containerRoot, create, list, diffEntries, check, remove, userTreeFingerprint, describe, createProbe, removeProbe, findByPath, contractPolicyPaths });
}

module.exports = { createSelfDevWorktreeService, cloneNodeModulesApfs, RETENTION_DAYS, BRANCH_PREFIX };
