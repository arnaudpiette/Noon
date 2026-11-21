"use strict";

// SelfDev V1 — SD-1 : politique de chemins, worktree isolé, cible. Dépôts Git temporaires,
// aucun modèle, aucune donnée utilisateur.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const {
  SELFDEV_FORBIDDEN_GLOBS, checkSelfDevDiff, classifySelfDevPath, contractForbiddenPaths,
  createSelfDevWorktreeService, createSelfDevTargetStore,
} = require("../services/selfdev");

const tmp = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const gitIn = (cwd, ...args) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function makeRepo({ hook = false } = {}) {
  const root = tmp("noon-sd1-repo-");
  gitIn(root, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "noon", version: "0.0.0" }));
  fs.mkdirSync(path.join(root, "lib"));
  fs.writeFileSync(path.join(root, "lib", "feature.js"), "module.exports = 1;\n");
  fs.mkdirSync(path.join(root, "test"));
  fs.writeFileSync(path.join(root, "test", "feature.test.js"), "// existant\n");
  fs.mkdirSync(path.join(root, "services", "security"), { recursive: true });
  fs.writeFileSync(path.join(root, "services", "security", "policy.js"), "// sécurité\n");
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# règles\n");
  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-q", "-m", "base");
  fs.mkdirSync(path.join(root, "node_modules", "dep"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", "dep", "index.js"), "module.exports = 'dep';\n");
  if (hook) {
    const marker = path.join(root, "HOOK_RAN");
    fs.writeFileSync(path.join(root, ".git", "hooks", "post-checkout"), `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
  }
  return root;
}

const copyClone = (source, destination) => fs.cpSync(source, destination, { recursive: true });

function makeService(extra = {}) {
  return createSelfDevWorktreeService({ container: tmp("noon-sd1-wt-"), stateDirectory: tmp("noon-sd1-state-"), cloneNodeModules: copyClone, ...extra });
}

// ---------- Politique de chemins ----------

test("politique : zones de sécurité, gouvernance, outillage et secrets refusées, insensible à la casse", () => {
  for (const relative of ["services/security/redaction.js", "Services/Security/x.js", "services/approvals/approval-engine.js",
    "services/goals/goal-mode-dev-dispatch-service.js", "services/selfdev/selfdev-path-policy.js", "AGENTS.md", "lib/sub/AGENTS.md",
    "package.json", "package-lock.json", "scripts/release.js", "services/config/feature-flag-registry.js", ".env", "data/x.sqlite", "node_modules/a/index.js"]) {
    assert.equal(classifySelfDevPath(relative).forbidden, true, relative);
  }
  for (const relative of ["lib/feature.js", "public/app.js", "services/goals/goal-strategy-engine.js", "test/new-case.test.js", "server.js"]) {
    assert.equal(classifySelfDevPath(relative).forbidden, false, relative);
  }
  for (const bad of ["/etc/passwd", "../outside.js", "a/../../b", "", "a\nb"]) assert.throws(() => classifySelfDevPath(bad), { code: "SELFDEV_PATH_INVALID" }, bad);
  assert.ok(SELFDEV_FORBIDDEN_GLOBS.includes("services/selfdev/**"), "la politique se protège elle-même");
});

test("politique : un test peut être ajouté, jamais modifié, supprimé ou renommé", () => {
  const baseTestFiles = ["test/feature.test.js"];
  assert.equal(checkSelfDevDiff({ baseTestFiles, entries: [{ status: "M", path: "lib/feature.js" }, { status: "?", path: "test/repro.test.js" }] }).ok, true);
  for (const status of ["M", "D", "T"]) {
    const result = checkSelfDevDiff({ baseTestFiles, entries: [{ status, path: "test/feature.test.js" }] });
    assert.deepEqual(result.violations.map((item) => item.code), ["SELFDEV_EXISTING_TEST_CHANGED"], status);
  }
  const renamed = checkSelfDevDiff({ baseTestFiles, entries: [{ status: "D", path: "test/feature.test.js" }, { status: "A", path: "test/renamed.test.js" }] });
  assert.equal(renamed.ok, false);
  assert.equal(checkSelfDevDiff({ entries: [{ status: "R", path: "lib/x.js" }] }).violations[0].code, "SELFDEV_DIFF_STATUS_UNSUPPORTED");
  const scoped = checkSelfDevDiff({ allowedPrefixes: ["lib"], entries: [{ status: "M", path: "lib/feature.js" }, { status: "M", path: "public/app.js" }] });
  assert.deepEqual(scoped.violations.map((item) => item.path), ["public/app.js"]);
});

test("politique : forbiddenPaths concrets pour le contrat Native DEV", () => {
  const root = makeRepo();
  const paths = contractForbiddenPaths(root);
  assert.ok(paths.includes(path.join(root, "services", "security")));
  assert.ok(paths.includes(path.join(root, "AGENTS.md")));
  assert.ok(paths.includes(path.join(root, "package.json")));
  assert.equal(paths.some((item) => item.endsWith(path.join("lib", "feature.js"))), false);
});

// ---------- Worktree isolé ----------

test("worktree : créé depuis la base, working tree utilisateur intact, hooks non exécutés, node_modules cloné", () => {
  const root = makeRepo({ hook: true });
  fs.writeFileSync(path.join(root, "lib", "feature.js"), "module.exports = 2; // modification locale non commitée\n");
  fs.writeFileSync(path.join(root, "notes-locales.txt"), "brouillon\n");
  const service = makeService();
  const before = service.userTreeFingerprint(root);
  const created = service.create({ repositoryRoot: root, baseRef: "main" });
  assert.equal(service.userTreeFingerprint(root), before, "working tree utilisateur inchangé");
  assert.equal(fs.readFileSync(path.join(root, "lib", "feature.js"), "utf8").includes("modification locale"), true);
  assert.equal(fs.existsSync(path.join(root, "HOOK_RAN")), false, "aucun hook exécuté");
  assert.match(created.branch, /^selfdev\/\d{8}-[0-9a-f]{8}$/);
  assert.equal(created.baseCommit, gitIn(root, "rev-parse", "main").trim());
  assert.equal(fs.readFileSync(path.join(created.worktreePath, "lib", "feature.js"), "utf8"), "module.exports = 1;\n", "patch calculé sur la base, sans les changements locaux");
  assert.equal(fs.existsSync(path.join(created.worktreePath, "notes-locales.txt")), false);
  const cloned = path.join(created.worktreePath, "node_modules");
  assert.equal(fs.lstatSync(cloned).isSymbolicLink(), false, "node_modules cloné, jamais lié");
  fs.writeFileSync(path.join(cloned, "dep", "index.js"), "// écrit dans la copie\n");
  assert.equal(fs.readFileSync(path.join(root, "node_modules", "dep", "index.js"), "utf8"), "module.exports = 'dep';\n", "les node_modules utilisateur restent intacts");
  assert.deepEqual(service.diffEntries(created.id), [], "copie propre au départ");
});

test("worktree : le diff réel est contrôlé (chemin protégé, test existant, ajout autorisé)", () => {
  const root = makeRepo();
  const service = makeService();
  const created = service.create({ repositoryRoot: root });
  fs.writeFileSync(path.join(created.worktreePath, "lib", "feature.js"), "module.exports = 3;\n");
  fs.writeFileSync(path.join(created.worktreePath, "test", "repro.test.js"), "// reproduction\n");
  assert.equal(service.check(created.id).ok, true);
  fs.writeFileSync(path.join(created.worktreePath, "test", "feature.test.js"), "// test affaibli\n");
  fs.writeFileSync(path.join(created.worktreePath, "services", "security", "policy.js"), "// contournement\n");
  const result = service.check(created.id);
  assert.equal(result.ok, false);
  assert.deepEqual(result.violations.map((item) => item.code).sort(), ["SELFDEV_EXISTING_TEST_CHANGED", "SELFDEV_FORBIDDEN_PATH"]);
});

test("worktree : base invalide ou option injectée refusées ; cible hors racine refusée", () => {
  const root = makeRepo();
  const service = makeService();
  for (const baseRef of ["--upload-pack=evil", "nope-does-not-exist", "a b", ""]) {
    assert.throws(() => service.create({ repositoryRoot: root, baseRef }), { code: "SELFDEV_BASE_INVALID" }, baseRef);
  }
  assert.throws(() => service.create({ repositoryRoot: path.join(root, "lib") }), { code: "SELFDEV_TARGET_INVALID" });
  assert.throws(() => createSelfDevWorktreeService({ container: path.join(root, "wt"), stateDirectory: tmp("noon-sd1-state-") }).create({ repositoryRoot: root }), { code: "SELFDEV_CONFIG_INVALID" });
  const shared = tmp("noon-sd1-shared-");
  assert.throws(() => createSelfDevWorktreeService({ container: shared, stateDirectory: path.join(shared, "state") }), { code: "SELFDEV_CONFIG_INVALID" });
});

test("worktree : échec du clone de node_modules → arrêt complet, sans worktree ni branche résiduels", () => {
  const root = makeRepo();
  const service = makeService({ cloneNodeModules: () => { throw new Error("pas d'APFS"); } });
  assert.throws(() => service.create({ repositoryRoot: root }), { code: "SELFDEV_NODE_MODULES_CLONE_FAILED" });
  assert.equal(gitIn(root, "branch", "--list", "selfdev/*").trim(), "");
  assert.equal(gitIn(root, "worktree", "list").trim().split("\n").length, 1);
  assert.deepEqual(service.list(), []);
});

test("worktree : suppression explicite, refusée s'il reste des changements non abandonnés, branche gardée si commits", () => {
  const root = makeRepo();
  const service = makeService();
  const created = service.create({ repositoryRoot: root });
  fs.writeFileSync(path.join(created.worktreePath, "lib", "feature.js"), "module.exports = 4;\n");
  assert.equal(service.list()[0].changedFiles, 1);
  assert.throws(() => service.remove(created.id), { code: "SELFDEV_WORKTREE_HAS_CHANGES" });
  const before = service.userTreeFingerprint(root);
  assert.deepEqual(service.remove(created.id, { discardChanges: true }), { removed: created.id, branchKept: false });
  assert.equal(service.userTreeFingerprint(root), before);
  assert.equal(fs.existsSync(created.worktreePath), false);
  assert.equal(gitIn(root, "branch", "--list", created.branch).trim(), "");
  assert.deepEqual(service.list(), []);

  const second = service.create({ repositoryRoot: root });
  fs.writeFileSync(path.join(second.worktreePath, "lib", "feature.js"), "module.exports = 5;\n");
  gitIn(second.worktreePath, "commit", "-q", "-am", "commit de l'utilisateur");
  assert.equal(service.remove(second.id).branchKept, true, "une branche portant des commits n'est jamais supprimée");
  assert.notEqual(gitIn(root, "branch", "--list", second.branch).trim(), "");
});

test("worktree : nettoyage proposé après 14 jours, jamais automatique ; identifiant invalide refusé", () => {
  const root = makeRepo();
  let clock = new Date("2026-11-01T10:00:00Z");
  const service = makeService({ now: () => clock });
  const created = service.create({ repositoryRoot: root });
  clock = new Date("2026-11-16T10:00:00Z");
  const [item] = service.list();
  assert.equal(item.ageDays, 15);
  assert.equal(item.cleanupSuggested, true);
  assert.equal(fs.existsSync(created.worktreePath), true, "rien n'est supprimé automatiquement");
  assert.throws(() => service.remove("../../etc"), { code: "SELFDEV_ID_INVALID" });
});

// ---------- Cible ----------

test("cible : seul le dépôt Noon à sa racine est accepté, avec un conteneur hors dépôt et autorisé ; revalidée à chaque lecture", () => {
  const root = makeRepo();
  const container = tmp("noon-sd1-container-");
  let writable = [container];
  const store = createSelfDevTargetStore({ filePath: path.join(tmp("noon-sd1-target-"), "selfdev-target.json"), writableRootsProvider: () => writable });
  assert.equal(store.get(), null);
  const target = store.register({ repositoryRoot: root, baseBranch: "main", worktreeContainer: container });
  assert.equal(target.repositoryRoot, root);
  assert.equal(store.get().worktreeContainer, container);
  assert.throws(() => store.register({ repositoryRoot: path.join(root, "lib"), baseBranch: "main", worktreeContainer: container }), { code: "SELFDEV_TARGET_INVALID" });
  for (const baseBranch of ["-x", "a..b", "main/", "a b"]) assert.throws(() => store.register({ repositoryRoot: root, baseBranch, worktreeContainer: container }), { code: "SELFDEV_BASE_INVALID" }, baseBranch);
  fs.mkdirSync(path.join(root, "copies"));
  assert.throws(() => store.register({ repositoryRoot: root, baseBranch: "main", worktreeContainer: path.join(root, "copies") }), { code: "SELFDEV_CONTAINER_INVALID" });
  assert.throws(() => store.register({ repositoryRoot: root, baseBranch: "main", worktreeContainer: path.join(container, "absent") }), { code: "SELFDEV_CONTAINER_INVALID" });
  writable = [];
  assert.throws(() => store.register({ repositoryRoot: root, baseBranch: "main", worktreeContainer: container }), { code: "SELFDEV_CONTAINER_NOT_AUTHORIZED" });
  writable = [container];
  const other = makeRepo();
  fs.writeFileSync(path.join(other, "package.json"), JSON.stringify({ name: "autre" }));
  assert.throws(() => store.register({ repositoryRoot: other, baseBranch: "main", worktreeContainer: container }), { code: "SELFDEV_TARGET_NOT_NOON" });
  fs.rmSync(root, { recursive: true, force: true });
  const unavailable = store.get();
  assert.equal(unavailable.unavailable, true, "un dépôt disparu n'est plus une cible");
  assert.equal(unavailable.worktreeContainer, container, "le conteneur reste connu pour protéger les worktrees");
  assert.equal(store.clear(), true);
});

test("contrat source : aucun commit, push, merge, reset, stash ou checkout dans SelfDev SD-1", () => {
  const dir = path.join(__dirname, "..", "services", "selfdev");
  for (const name of fs.readdirSync(dir)) {
    const source = fs.readFileSync(path.join(dir, name), "utf8");
    assert.equal(/["'](commit|push|merge|reset|stash|checkout|rebase|clean)["']/.test(source), false, name);
  }
});
