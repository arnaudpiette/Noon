"use strict";

// V3-L7 — découpe de workspace-terminal-service.js : l'erreur typée reste la même classe pour
// les appelants, les projections et complétions sont des fonctions sans état, et les
// opérations de diff git utilisent la session et les événements du service qui les construit.
const assert = require("node:assert/strict");
const test = require("node:test");
const service = require("../services/dev/workspace-terminal-service");
const shared = require("../services/dev/workspace-terminal-shared");
const projections = require("../services/dev/workspace-terminal-projections");
const completions = require("../services/dev/workspace-terminal-completions");
const { createWorkspaceGitDiffOperations } = require("../services/dev/workspace-terminal-git-diff");

test("l'erreur typée exportée par le service est celle du module partagé", () => {
  assert.equal(service.DevWorkspaceError, shared.DevWorkspaceError);
  const error = new service.DevWorkspaceError("CODE", "message");
  assert.equal(error instanceof Error, true);
  assert.equal(error.name, "DevWorkspaceError");
  assert.equal(shared.clean("  a\nb\0c  ", 3), "a b");
});

test("projections et complétions exportées, sans état partagé entre appels", () => {
  for (const name of ["emptyProblems", "publicProblems", "emptyGitDiff", "publicGitDiff", "publicTerminal", "publicSession", "refreshExecutionState", "terminalFor", "assertTerminalOrigin"]) assert.equal(typeof projections[name], "function", name);
  for (const name of ["completionEntryAllowed", "realPathInsideRepository", "readPackageScripts", "listRepositoryCompletions"]) assert.equal(typeof completions[name], "function", name);
  const first = projections.emptyGitDiff();
  first.mutated = true;
  assert.equal(projections.emptyGitDiff().mutated, undefined);
});

test("diff git : session demandée au service, aucune inspection si la session est refusée", async () => {
  const events = [];
  let inspected = false;
  const { inspectGitDiff, readGitDiff } = createWorkspaceGitDiffOperations({
    emit: (event) => events.push(event),
    gitDiffService: { inspect: async () => { inspected = true; return {}; }, read: async () => ({}) },
    requireSession: (id) => { throw new shared.DevWorkspaceError("SESSION_NOT_FOUND", `session ${id}`); },
  });
  await assert.rejects(() => inspectGitDiff({ sessionId: "absente" }), { code: "SESSION_NOT_FOUND" });
  await assert.rejects(() => readGitDiff({ sessionId: "absente" }), { code: "SESSION_NOT_FOUND" });
  assert.equal(inspected, false);
});
