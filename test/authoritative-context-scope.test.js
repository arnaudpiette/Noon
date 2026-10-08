"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createAuthoritativeContextScopeProvider } = require("../services/context/authoritative-context-scope");

test("la composition isolée attend la session persistée puis valide le workspace canonique", () => {
  let sessionEngine = null;
  let workspaceEngine = null;
  const provider = createAuthoritativeContextScopeProvider({
    getSession: (id) => sessionEngine?.getSession(id),
    getWorkspaceContext: (id) => workspaceEngine?.context(id),
  });
  const input = { sessionContext: { sessionId: "session-a" } };
  assert.equal(provider({ input }), null, "la composition incomplète ne fabrique aucune portée");

  workspaceEngine = {
    context: (id) => id === "workspace-a" ? { workspace: { profileScope: "arnaud" } } : null,
  };
  sessionEngine = {
    getSession: (id) => id === "session-a" ? {
      id, profileScope: "arnaud", conversationId: "conversation-a",
      workspaceId: "workspace-a", projectId: "project-a", status: "active",
    } : null,
  };
  assert.deepEqual(provider({ input }), {
    profileScope: "arnaud", workspaceId: "workspace-a", projectId: "project-a",
    sessionId: "session-a", conversationId: "conversation-a",
  });
  workspaceEngine.context = () => ({ workspace: { profileScope: "other" } });
  assert.equal(provider({ input }), null, "un workspace d'un autre profil invalide la portée");
});
