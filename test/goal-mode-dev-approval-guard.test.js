"use strict";

// B3a : les approbations Goal Mode DEV n'apparaissent pas dans la liste
// générique et ne peuvent pas être reprises par POST /approvals/:id/*.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { ApprovalManager } = require("../services/approvals/approval-manager");
const {
  assertGenericApprovalAllowed, genericApprovals, isGoalModeDevApproval,
} = require("../services/approvals/goal-mode-dev-approval-guard");

const ROOT = path.join(__dirname, "..");

function prepare(manager, skillName, executionId) {
  return manager.prepareAction({
    executionId, skillName, operation: skillName === "goal_mode_dev" ? "dispatch_exact_contract" : "create_event",
    normalizedArgs: { value: executionId }, target: executionId, permissionLevel: "write",
    title: "Action", sanitizedSummary: "Résumé", riskLevel: "high",
  });
}

test("garde : liste générique sans Goal Mode DEV, reprise générique refusée en 409", () => {
  const manager = new ApprovalManager({});
  const generic = prepare(manager, "calendar", "exec-generic");
  const goal = prepare(manager, "goal_mode_dev", "goal-mode-dev:run-1:res-1");
  const pending = manager.listPending();
  assert.equal(pending.length, 2);
  assert.deepEqual(genericApprovals(pending).map((item) => item.id), [generic.id]);
  assert.equal(isGoalModeDevApproval(manager.get(goal.id)), true);
  assert.throws(() => assertGenericApprovalAllowed(manager.get(goal.id)), (error) => {
    assert.equal(error.statusCode, 409);
    assert.equal(error.code, "GOAL_MODE_DEV_APPROVAL_DEDICATED");
    return true;
  });
  // L'approbation Goal Mode reste en attente (aucune consommation par le garde).
  assert.equal(manager.get(goal.id).status, "pending");
  assert.equal(assertGenericApprovalAllowed(manager.get(generic.id)).id, generic.id);
  // provider seul (forme héritée) également reconnu ; entrées absentes sans effet.
  assert.equal(isGoalModeDevApproval({ provider: "goal_mode_dev" }), true);
  assert.equal(assertGenericApprovalAllowed(null), null);
  assert.deepEqual(genericApprovals(undefined), []);
});

test("garde : server.js l'applique à GET /approvals et à POST /approvals/:id/* avant resume", () => {
  const source = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  assert.match(source, /require\("\.\/services\/approvals\/goal-mode-dev-approval-guard"\)/);
  const list = source.slice(source.indexOf('req.url === "/approvals"'));
  assert.match(list.slice(0, 600), /approvals: genericApprovals\(approvalManager\.listPending\(\)\)/);
  const post = source.slice(source.indexOf('requestPath.startsWith("/approvals/")'));
  const guard = post.indexOf("assertGenericApprovalAllowed(approvalManager.get(");
  const resume = post.indexOf("noonOrchestrator.resume(");
  assert.ok(guard > 0 && resume > guard, "garde avant resume");
  // Aucune autre lecture brute de listPending exposée par la route générique.
  assert.equal(/approvals: approvalManager\.listPending\(\)/.test(source), false);
});
