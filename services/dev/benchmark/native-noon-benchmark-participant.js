"use strict";

const {
  CONTEXT_MANIFEST_EXPERIMENT,
  normalizeContextManifestMode,
} = require("./context-manifest-experiment");
function executionNotReached() { return Object.assign(new Error("Session benchmark canonique requise."), { code: "EXECUTION_NOT_REACHED" }); }
function createNativeNoonBenchmarkParticipant({ coordinator } = {}) { if (!coordinator?.runTask) throw new TypeError("NativeDevCoordinator requis."); return { async isAvailable() { return true; }, prepare: (context) => ({ ...context, executionMode: "NATIVE_NOON", model: "AUTO", codexFallback: false }), async execute(context) { const benchmarkSessionId=String(context?.benchmarkSessionId||""); if(!benchmarkSessionId||benchmarkSessionId!==context?.benchmarkBudget?.id)throw executionNotReached(); const result = await coordinator.runTask({
    [CONTEXT_MANIFEST_EXPERIMENT]:
      normalizeContextManifestMode(
        context.contextManifestMode
      ), taskId: context.runId, sessionId: benchmarkSessionId, workspaceId: context.runId, workspaceAuthorized: true, workspaceRoots: [context.workspace], repositoryRoot: context.workspace, objective: context.objective, allowedPaths: context.allowedPaths, forbiddenPaths: context.forbiddenPaths, requiredQuality: context.requiredQuality, maxDuration: context.timeout, maxIterations: context.maxIterations, benchmark: context.benchmarkBudget }); if (result.metrics?.backendReached !== true) throw Object.assign(new Error("Backend Native non atteint."), { code: result.failureCategory === "PERMISSION_DENIED" ? "POLICY_BLOCKED" : "EXECUTION_NOT_REACHED" }); return { reportedStatus: result.status, iterations: result.metrics?.iterations ?? null,
    repairCycles: result.metrics?.repairCycles ?? null,
    inputTokens: result.metrics?.inputTokens ?? null,
    outputTokens: result.metrics?.outputTokens ?? null,
    contextEvaluation: result.metrics?.contextEvaluation ?? null,
    provider: result.metrics?.providerCalls?.[0]?.provider ?? null, initialModel: result.metrics?.providerCalls?.[0]?.model ?? null, finalModel: result.metrics?.providerCalls?.at(-1)?.model ?? null, estimatedCost: result.metrics?.estimatedCost ?? null, calculatedActualCost: result.metrics?.actualCost ?? null, failureCategory: result.failureCategory ?? null, backendReached: true, changedFilesCount: result.metrics?.fileCount ?? 0 }; }, cancel: (runId) => coordinator.cancelTask(runId) }; }
module.exports={createNativeNoonBenchmarkParticipant};
