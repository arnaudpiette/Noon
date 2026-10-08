"use strict";

function text(value) {
  return value == null ? null : String(value).trim() || null;
}

// The persisted continuity session is the authority for an offload reference.
// Request fields are deliberately not used to establish this scope.
function createAuthoritativeContextScopeProvider({ getSession, getWorkspaceContext } = {}) {
  if (typeof getSession !== "function") throw new TypeError("getSession est requis.");
  return ({ input = {} } = {}) => {
    const sessionId = text(input.sessionContext?.sessionId || input.sessionId);
    if (!sessionId) return null;
    let session;
    try { session = getSession(sessionId); } catch { return null; }
    if (!session || session.status === "closed") return null;
    const profileScope = text(session.profileScope);
    const conversationId = text(session.conversationId);
    if (!profileScope || !conversationId) return null;
    const workspaceId = text(session.workspaceId);
    if (workspaceId && typeof getWorkspaceContext === "function") {
      let workspace;
      try { workspace = getWorkspaceContext(workspaceId); } catch { return null; }
      if (!workspace || text(workspace.workspace?.profileScope) !== profileScope) return null;
    }
    return {
      profileScope,
      workspaceId,
      projectId: text(session.projectId),
      sessionId: text(session.id),
      conversationId,
    };
  };
}

module.exports = { createAuthoritativeContextScopeProvider };
