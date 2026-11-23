"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createAgentEvaluationEngine } = require("../evaluation/agent-evaluation-engine");
const { createAgentEvaluationRuntime } = require("../evaluation/agent-evaluation-runtime");
const {
  countWebSearchCalls,
  isToolSearchCompatibilityError,
  sanitizeResponseOutputForInput,
} = require("../models/model-response");
const { applyCompactionOptions, isCompactionCompatibilityError } = require("../openai/compaction-service");
const { createNoonOrchestrator } = require("./noon-orchestrator");

function createChatOrchestration(dependencies) {
  const {
    ENABLE_TOOL_SEARCH,
    WEB_SEARCH_PRICE_PER_CALL,
    approvalManager,
    contextBuilder,
    delegationEngine,
    geminiProviderAdapter,
    geminiShadowRunner,
    hardRulesRegistry,
    integrationTokenStore,
    interventionPermissionEngine,
    modelFallbacks,
    noonObservability,
    openAIProviderAdapter,
    operationalSecurityPolicy,
    orchestratorObservability,
    priorityEngine,
    providerPrivacyPolicy,
    registerWebSearchCalls,
    reliabilityEngine,
    selectConfiguredModelRoute,
    skillRegistry,
    toolAuditLog,
    trackUsage,
    transactionalExecutionEngine,
  } = dependencies;

  function buildNoonTools({ webSearchEnabled = false, toolSearchEnabled = ENABLE_TOOL_SEARCH } = {}) {
    const tools = skillRegistry.getToolDefinitions({ deferRare: toolSearchEnabled });
    if (toolSearchEnabled) tools.push({ type: "tool_search" });
    if (webSearchEnabled) tools.push({ type: "web_search" });
    return tools;
  }

  function captureActionPreconditions({ args = {} } = {}) {
    const requestedPath = args.path || args.outputDirectory;
    if (!requestedPath) return {};
    const resolved = path.resolve(String(requestedPath));
    try {
      const stat = fs.statSync(resolved);
      return { path: resolved, exists: true, mtimeMs: stat.mtimeMs, size: stat.size, ino: stat.ino };
    } catch {
      return { path: resolved, exists: false };
    }
  }

  const baseNoonOrchestrator = createNoonOrchestrator({
    interventionPermissionEngine,
    contextBuilder,
    reliabilityEngine,
    operationalSecurityPolicy,
    transactionalExecutionEngine,
    delegationEngine,
    selectModel: selectConfiguredModelRoute,
    modelFallbacks,
    providerAdapter: openAIProviderAdapter,
    providerAdapters: { openai: openAIProviderAdapter, google_ai: geminiProviderAdapter },
    providerConfiguration: (providerId) => providerId === "openai" ? Boolean(process.env.OPENAI_API_KEY) : providerId === "google_ai" ? Boolean(process.env.GEMINI_API_KEY) : false,
    providerPrivacyPolicy,
    providerShadowRunner: geminiShadowRunner,
    skillRegistry,
    approvalManager,
    captureApprovalPreconditions: captureActionPreconditions,
    recheckApprovalPreconditions: (_record, _original, details) =>
      captureActionPreconditions(details),
    recheckHardRules({ toolCall }) {
      const skill = skillRegistry.getSkillByName(toolCall.name);
      if (!skill) return false;
      if (skill.permissions.destructive) {
        return Boolean(hardRulesRegistry.getRule("security.destructive_confirmation")?.enabled);
      }
      if (["external", "write"].includes(skill.permissions.level)) {
        return Boolean(hardRulesRegistry.getRule("security.external_action_confirmation")?.enabled);
      }
      return true;
    },
    recheckConnector({ toolCall }) {
      const skill = skillRegistry.getSkillByName(toolCall.name);
      if (!skill) return false;
      if (!skill.permissions.networkAccess) return true;
      if (/gmail|email/i.test(toolCall.name)) return Boolean(integrationTokenStore.get("google"));
      return true;
    },
    priorityEngine,
    getTools: ({ webSearchEnabled, toolSearchEnabled }) =>
      buildNoonTools({ webSearchEnabled, toolSearchEnabled }),
    buildSkillContext: (request) => request.skillContext,
    applyRequestOptions: applyCompactionOptions,
    sanitizeResponseOutput: sanitizeResponseOutputForInput,
    isCompactionCompatibilityError,
    isToolSearchCompatibilityError,
    enableToolSearch: ENABLE_TOOL_SEARCH,
    onModelResponse(response, state) {
      trackUsage(response);
      const calls = countWebSearchCalls(response);
      if (calls > 0) registerWebSearchCalls(calls);
      if (calls > 0) {
        noonObservability.recordCost(
          state.executionId,
          "web",
          calls * WEB_SEARCH_PRICE_PER_CALL
        );
      }
    },
    onToolResult(error, toolCall) {
      dependencies.metricsService.record(
        error ? "tool_errors" : "tools_used",
        1,
        { tool: toolCall.name }
      );
    },
    onFinalRound(request) {
      dependencies.setSessionActivity(request.sessionId, "responding", "Rédaction de la réponse…");
    },
    audit: (event, metadata) => toolAuditLog.append(event, metadata),
    observability: orchestratorObservability,
  });
  const agentEvaluationEngine =
    createAgentEvaluationEngine();

  const noonOrchestrator =
    createAgentEvaluationRuntime({
      orchestrator:
        baseNoonOrchestrator,
      engine:
        agentEvaluationEngine,
      observability:
        (event, metadata) =>
          toolAuditLog.append(
            `agent-evaluation.${event}`,
            metadata
          ),
    });

  return { agentEvaluationEngine, noonOrchestrator };
}

module.exports = { createChatOrchestration };
