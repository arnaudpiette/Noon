"use strict";

function createIntentContextBuilder(dependencies) {
  const { approvalManager, intentCommandEngine, sessionContinuityEngine } = dependencies;

  return function buildIntentContext({ sessionId, conversationId = null, workspaceId = null, ttsActive = false, activeExecutionId = null } = {}) {
    let continuity = null;
    if (sessionId) {
      try { continuity = sessionContinuityEngine.getSession(sessionId); } catch {}
    }
    const effectiveConversationId = conversationId || continuity?.conversationId || sessionId;
    for (const ref of continuity?.recentEntityRefs || []) {
      if (Date.parse(ref.expiresAt) > Date.now()) {
        intentCommandEngine.rememberEntity(sessionId, {
          type: ref.entityType, id: ref.entityId, label: ref.label,
          workspaceId: ref.workspaceId,
        });
      }
    }
    return {
      activeWorkspaceId: workspaceId || continuity?.workspaceId || dependencies.workspaceEngine.active()?.id || null,
      activeProjectId: continuity?.projectId || (workspaceId ? dependencies.workspaceEngine.context(workspaceId).activeProject?.id || null : null),
      activeConversationId: effectiveConversationId || null,
      pendingApprovalIds: continuity?.pendingApprovalIds?.length
        ? continuity.pendingApprovalIds
        : approvalManager.listPending().map((approval) => approval.id),
      activeExecutionId: activeExecutionId || continuity?.activeExecutionId || null,
      continuationAvailable: Boolean(
        continuity?.resumeCheckpoint ||
        continuity?.currentTaskRef ||
        continuity?.currentPlanRef ||
        continuity?.currentArtifactRef ||
        continuity?.currentSearchRef ||
        continuity?.pendingApprovalIds?.length ||
        dependencies.getConversationHistory(
          dependencies.createConversationKey({
            sessionId: effectiveConversationId,
          }),
        ).length
      ),
      ttsActive,
    };
  };
}

module.exports = { createIntentContextBuilder };
