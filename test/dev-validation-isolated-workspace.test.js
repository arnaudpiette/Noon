"use strict";

// V3-L5a — validations d'une mission isolée : le bac à sable vérifie l'autorisation sur le
// dépôt d'origine (résolu depuis le worktree actif), jamais sur un chemin arbitraire.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createSandboxDevValidationExecutor } = require("../services/security/dev-validation-runner");

const dir = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const context = { taskId: "task-1", workspaceId: "workspace-1", sessionId: "session-1", permissions: ["TERMINAL_SAFE"] };

function harness({ source, worktree, resolver }) {
  const policyPaths = []; const runs = [];
  const executor = createSandboxDevValidationExecutor({
    workspaceEngine: { context: () => ({ roots: [{ path: source, mode: "read-write" }] }) },
    operationalSecurityPolicy: {
      evaluate(request) {
        policyPaths.push(request.actionRequest.args.path);
        const allowed = request.actionRequest.args.path === source;
        return { outcome: allowed ? "ALLOW" : "DENY", policyVersion: "test", decisionId: "d" };
      },
    },
    isolatedWorkspaceResolver: resolver,
    createContract: (input) => ({ ...input }),
    createRunner: (options) => ({
      async run(contract) {
        const resolved = await options.resolveContext({ workspaceId: contract.workspaceId, workspaceSessionId: contract.workspaceSessionId, canonicalWorkspaceRoot: contract.canonicalWorkspaceRoot });
        runs.push(resolved.canonicalWorkspaceRoot);
        return { status: "PASS", exitCode: 0, durationMs: 1, outputTail: "", outputTruncated: false, cleanupConfirmed: true, isolation: { level: "APPLICATION_CONSTRAINED" } };
      },
    }),
  });
  return { executor, policyPaths, runs, worktree };
}

test("worktree d'une mission active : autorisation sur le dépôt d'origine, exécution dans le worktree", async () => {
  const source = dir("noon-iso-source-"); const worktree = dir("noon-iso-wt-");
  const h = harness({ source, worktree, resolver: (root) => (root === worktree ? source : null) });
  const result = await h.executor("npm test", worktree, 5_000, null, context);
  assert.equal(result.status, "PASS");
  assert.deepEqual(h.policyPaths, [source]);
  assert.deepEqual(h.runs, [worktree], "la commande tourne dans le worktree");
});

test("sans résolveur, ou chemin inconnu du résolveur : refus comme avant", async () => {
  const source = dir("noon-iso-source-"); const worktree = dir("noon-iso-wt-");
  const none = harness({ source, worktree, resolver: null });
  assert.notEqual((await none.executor("npm test", worktree, 5_000, null, context)).status, "PASS");
  const unknown = harness({ source, worktree, resolver: () => null });
  assert.notEqual((await unknown.executor("npm test", worktree, 5_000, null, context)).status, "PASS");
  assert.deepEqual(unknown.runs, []);
});

test("dépôt d'origine retiré du workspace : le worktree n'est plus autorisé", async () => {
  const source = dir("noon-iso-source-"); const other = dir("noon-iso-other-"); const worktree = dir("noon-iso-wt-");
  const h = harness({ source, worktree, resolver: (root) => (root === worktree ? other : null) });
  const result = await h.executor("npm test", worktree, 5_000, null, context);
  assert.notEqual(result.status, "PASS");
  assert.deepEqual(h.runs, []);
});
