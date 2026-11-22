"use strict";

// V3-L5a — l'exécutant externe travaille dans un worktree détaché : le dossier de travail
// d'Arnaud reste intact (prouvé), le diff est récupéré en patch, le worktree est supprimé.
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createExecutorWorktreeManager, parseNameStatus, remapContractToWorktree } = require("../services/delegation/executor-worktree");
const { createDevDelegationRunner } = require("../services/delegation/dev-delegation-runner");
const { assertSpecialistAgentAdapter } = require("../services/delegation/specialist-agent-adapter");

const git = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
function repository() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "noon-exec-repo-")));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "value.js"), "module.exports = 1;\n");
  fs.writeFileSync(path.join(root, "user.txt"), "base\n");
  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");
  fs.mkdirSync(path.join(root, "node_modules", "dep"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", "dep", "index.js"), "module.exports = 'dep';\n");
  git(root, ["init", "-q"]); git(root, ["config", "user.email", "fixture@example.test"]); git(root, ["config", "user.name", "Fixture"]);
  git(root, ["add", "."]); git(root, ["commit", "-qm", "fixture"]);
  // Travail local non commité d'Arnaud : ne doit jamais être touché ni vu par l'exécutant.
  fs.writeFileSync(path.join(root, "user.txt"), "travail local en cours\n");
  fs.writeFileSync(path.join(root, "notes-locales.md"), "brouillon\n");
  return root;
}
const managerFor = () => createExecutorWorktreeManager({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "noon-exec-wt-")), cloneDirectory: (source, destination) => fs.cpSync(source, destination, { recursive: true }) });
const task = (root, overrides = {}) => ({ taskId: "mission-1", objective: "Passer la valeur à 2.", workspaceAuthorized: true, workspaceId: "fixture", workspaceRoots: [root], repositoryRoot: root, allowedPaths: [path.join(root, "src")], validationCommands: ["npm test"], ...overrides });
const adapter = (execute) => assertSpecialistAgentAdapter({ id: "mock", name: "Mock", async isAvailable() { return true; }, getCapabilities() { return {}; }, executeTask: execute, async cancelTask() { return true; }, async getTaskStatus() { return "UNKNOWN"; } });
const passValidation = async (command, cwd) => ({ command, status: "PASS", durationMs: 1, cwd });
const sourceState = (root) => ({ status: git(root, ["status", "--porcelain=v1"]), user: fs.readFileSync(path.join(root, "user.txt"), "utf8"), value: fs.readFileSync(path.join(root, "src", "value.js"), "utf8"), head: git(root, ["rev-parse", "HEAD"]), branches: git(root, ["branch", "--list"]) });

test("prepare : worktree détaché depuis HEAD, hors du dépôt, node_modules cloné, sans les changements locaux", () => {
  const root = repository(); const manager = managerFor();
  const before = sourceState(root);
  const handle = manager.prepare({ repositoryRoot: root, taskId: "mission-1" });
  assert.equal(path.dirname(handle.path), fs.realpathSync(manager.rootDir));
  assert.equal(handle.baseCommit, before.head.trim());
  assert.equal(handle.sourceUncommitted, 2);
  assert.equal(handle.dependencies.node_modules, "cloned");
  assert.equal(fs.lstatSync(path.join(handle.path, "node_modules")).isSymbolicLink(), false, "jamais un lien vers l'original");
  assert.equal(fs.readFileSync(path.join(handle.path, "user.txt"), "utf8"), "base\n", "l'exécutant part de HEAD");
  assert.equal(fs.existsSync(path.join(handle.path, "notes-locales.md")), false);
  assert.equal(git(handle.path, ["branch", "--show-current"]).trim(), "", "worktree détaché, aucune branche créée");
  assert.deepEqual(sourceState(root), before);
  assert.throws(() => manager.prepare({ repositoryRoot: root, taskId: "mission-1" }), (error) => error.code === "EXECUTOR_WORKTREE_EXISTS");
  assert.throws(() => manager.prepare({ repositoryRoot: root, taskId: "../evil" }), (error) => error.code === "EXECUTOR_TASK_ID_INVALID");
  assert.equal(manager.resolveSource(handle.path), root, "worktree actif → dépôt d'origine");
  assert.equal(manager.resolveSource(root), null);
  assert.equal(manager.resolveSource(path.join(handle.path, "src")), null, "seule la racine du worktree est reconnue");
  assert.equal(manager.dispose(handle), true);
  assert.equal(manager.resolveSource(handle.path), null, "plus reconnu après suppression");
  assert.deepEqual(sourceState(root), before);
});

test("prepare refuse un dossier de worktrees placé dans le dépôt et un dépôt sans commit", () => {
  const root = repository();
  const nested = createExecutorWorktreeManager({ rootDir: path.join(root, ".noon-worktrees") });
  assert.throws(() => nested.prepare({ repositoryRoot: root, taskId: "mission-1" }), (error) => error.code === "EXECUTOR_WORKTREE_NESTED");
  const empty = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "noon-exec-empty-")));
  git(empty, ["init", "-q"]);
  assert.throws(() => managerFor().prepare({ repositoryRoot: empty, taskId: "mission-1" }), (error) => error.code === "EXECUTOR_NO_COMMIT");
});

test("collect : patch des fichiers modifiés et nouveaux, sans node_modules, appliquable sur la base", () => {
  const root = repository(); const manager = managerFor();
  const handle = manager.prepare({ repositoryRoot: root, taskId: "mission-2" });
  fs.writeFileSync(path.join(handle.path, "src", "value.js"), "module.exports = 2;\n");
  fs.writeFileSync(path.join(handle.path, "src", "extra.js"), "module.exports = 'nouveau';\n");
  fs.writeFileSync(path.join(handle.path, "node_modules", "dep", "index.js"), "piraté\n");
  const collected = manager.collect(handle);
  assert.deepEqual(collected.files, [{ status: "A", path: "src/extra.js" }, { status: "M", path: "src/value.js" }]);
  assert.equal(collected.committedByExecutor, false);
  assert.equal((fs.statSync(collected.patchPath).mode & 0o777).toString(8), "600");
  assert.doesNotMatch(fs.readFileSync(collected.patchPath, "utf8"), /node_modules/);
  manager.dispose(handle);
  assert.equal(fs.readFileSync(path.join(root, "node_modules", "dep", "index.js"), "utf8"), "module.exports = 'dep';\n", "l'original n'a pas bougé");
  const check = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "noon-exec-apply-")));
  git(root, ["worktree", "add", "--detach", "-q", check, handle.baseCommit]);
  git(check, ["apply", "--check", collected.patchPath]);
  git(root, ["worktree", "remove", "--force", check]);
});

test("runner isolé : PASS, diff en patch, dossier de travail intact et prouvé, worktree supprimé", async () => {
  const root = repository(); const manager = managerFor();
  const before = sourceState(root);
  const cwds = [];
  const runner = createDevDelegationRunner({
    worktreeManager: manager,
    validationExecutor: async (command, cwd) => { cwds.push(cwd); return passValidation(command, cwd); },
    specialistAgent: adapter(async (contract) => {
      assert.notEqual(contract.repositoryRoot, root, "l'exécutant reçoit le worktree");
      assert.equal(contract.allowedPaths[0], path.join(contract.repositoryRoot, "src"));
      fs.writeFileSync(path.join(contract.repositoryRoot, "src", "value.js"), "module.exports = 2;\n");
      return { taskId: contract.taskId, agent: "mock", status: "SUCCESS", summary: "done", iterations: 1 };
    }),
  });
  const result = await runner.runDevTask(task(root));
  assert.equal(result.finalVerdict, "PASS");
  assert.deepEqual(result.changedFiles, ["src/value.js"]);
  assert.equal(result.isolation.mode, "worktree");
  assert.equal(result.isolation.sourceRepositoryUntouched, true);
  assert.equal(result.isolation.sourceUncommittedChanges, 2);
  assert.deepEqual(result.isolation.files, [{ status: "M", path: "src/value.js" }]);
  assert.equal(result.isolation.disposed, true);
  assert.equal(result.isolation.worktreePath, null);
  assert.ok(cwds.length > 0 && cwds.every((cwd) => cwd !== root), "les validations tournent dans le worktree");
  assert.deepEqual(sourceState(root), before);
  assert.equal(git(root, ["worktree", "list"]).trim().split("\n").length, 1);
});

test("runner isolé : changement hors périmètre, commit de l'exécutant ou dossier source modifié → FAIL", async () => {
  const outOfScope = repository();
  const scoped = await createDevDelegationRunner({ worktreeManager: managerFor(), validationExecutor: passValidation, specialistAgent: adapter(async (contract) => { fs.writeFileSync(path.join(contract.repositoryRoot, "outside.js"), "x\n"); return { taskId: contract.taskId, agent: "mock", status: "SUCCESS", summary: "done" }; }) }).runDevTask(task(outOfScope));
  assert.equal(scoped.finalVerdict, "FAIL");
  assert.equal(scoped.failureCategory, "OUT_OF_SCOPE_CHANGE");

  const committing = repository();
  const committed = await createDevDelegationRunner({ worktreeManager: managerFor(), validationExecutor: passValidation, specialistAgent: adapter(async (contract) => {
    fs.writeFileSync(path.join(contract.repositoryRoot, "src", "value.js"), "module.exports = 2;\n");
    git(contract.repositoryRoot, ["-c", "user.email=a@b.test", "-c", "user.name=A", "commit", "-qam", "agent"]);
    return { taskId: contract.taskId, agent: "mock", status: "SUCCESS", summary: "done" };
  }) }).runDevTask(task(committing));
  assert.equal(committed.finalVerdict, "FAIL");
  assert.equal(git(committing, ["log", "--oneline"]).trim().split("\n").length, 1, "aucun commit dans le dépôt d'Arnaud");

  const escaping = repository();
  const escaped = await createDevDelegationRunner({ worktreeManager: managerFor(), validationExecutor: passValidation, specialistAgent: adapter(async (contract) => {
    fs.writeFileSync(path.join(escaping, "user.txt"), "écrasé par l'exécutant\n");
    return { taskId: contract.taskId, agent: "mock", status: "SUCCESS", summary: "done" };
  }) }).runDevTask(task(escaping));
  assert.equal(escaped.isolation.sourceRepositoryUntouched, false);
  assert.equal(escaped.finalVerdict, "FAIL");
  assert.equal(escaped.failureCategory, "OUT_OF_SCOPE_CHANGE");
});

test("keepWorktree conserve le worktree ; isolation in-place garde l'ancien comportement", async () => {
  const root = repository(); const manager = managerFor();
  const ok = adapter(async (contract) => { fs.writeFileSync(path.join(contract.repositoryRoot, "src", "value.js"), "module.exports = 2;\n"); return { taskId: contract.taskId, agent: "mock", status: "SUCCESS", summary: "done" }; });
  const kept = await createDevDelegationRunner({ worktreeManager: manager, validationExecutor: passValidation, specialistAgent: ok }).runDevTask(task(root, { keepWorktree: true }));
  assert.ok(kept.isolation.worktreePath && fs.existsSync(kept.isolation.worktreePath));
  assert.equal(kept.isolation.kept, true);
  manager.dispose({ repositoryRoot: root, path: kept.isolation.worktreePath });
  const inPlace = await createDevDelegationRunner({ worktreeManager: manager, validationExecutor: passValidation, specialistAgent: ok }).runDevTask(task(root, { taskId: "mission-3", isolation: "in-place", allowedPaths: [path.join(root, "src")] }));
  assert.equal(inPlace.isolation, undefined);
});

test("utilitaires : parseNameStatus et remapContractToWorktree", () => {
  assert.deepEqual(parseNameStatus("M\tsrc/a.js\nR100\told.js\tnew.js\n"), [{ status: "M", path: "src/a.js" }, { status: "R", path: "new.js", from: "old.js" }]);
  const remapped = remapContractToWorktree({ repositoryRoot: "/repo", branch: "main", allowedPaths: ["/repo/src"], forbiddenPaths: ["/repo/src/secret"], objective: "x" }, "/wt/m1");
  assert.deepEqual([remapped.repositoryRoot, remapped.branch, remapped.allowedPaths, remapped.forbiddenPaths, remapped.objective], ["/wt/m1", null, ["/wt/m1/src"], ["/wt/m1/src/secret"], "x"]);
});
