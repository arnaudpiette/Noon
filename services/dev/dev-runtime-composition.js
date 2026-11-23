"use strict";

const path = require("node:path");
const { createGoalDevExecutionService } = require("../goals/goal-dev-execution-service");
const { createGoalDevEvaluatedExecutionService } = require("../goals/goal-dev-evaluated-execution-service");
const { createGoalDevRetryRuntime } = require("../goals/goal-dev-retry-runtime");
const { createGoalModeDevRuntime } = require("../goals/goal-mode-dev-runtime");
const { createGoalModeDevHttpHandler } = require("../goals/goal-mode-dev-http-routes");
const { createGoalModeDevLockMaintenance } = require("../goals/goal-mode-dev-lock-maintenance");
const { createNativeDevCoordinator } = require("./native-dev-coordinator");
const { createNativeDevOrchestrator } = require("./native-dev-orchestrator");
const { createNativeDevOrchestratorFacade } = require("./native-dev-orchestrator-facade");
const { createNativeDevUiExecutionService } = require("./native-dev-ui-execution-service");
const { createDevTaskJournal } = require("./dev-task-journal");
const { createNativeDevReasoner } = require("./native-dev-reasoner");

function createNativeDevComposition(dependencies) {
  const {
    DATA_DIRECTORY,
    approvalManager,
    authorizeOpenAIPrivacy,
    devCostBudgetService,
    devProjectRuleResolver,
    estimateModelCost,
    featureFlags,
    getValidRegisteredProjects,
    goalStrategyEngine,
    interventionPermissionEngine,
    openAIProviderAdapter,
    operationalSecurityPolicy,
    personalDatabase,
    runtimeConfig,
    sandboxDevValidationExecutor,
    selectConfiguredModelRoute,
    skillRegistry,
    toolAuditLog,
    trackUsage,
    transactionalExecutionEngine,
    userProgressAdapter,
    workspaceEngine,
  } = dependencies;

  const nativeDevReasoner = createNativeDevReasoner({
    featureFlags,
    budgetService: devCostBudgetService,
    selectModelRoute: selectConfiguredModelRoute,
    estimateCost: estimateModelCost,
    authorizePrivacy: authorizeOpenAIPrivacy,
    providerAdapter: openAIProviderAdapter,
    trackUsage,
  });
  const nativeDevJournal = createDevTaskJournal({ directory: path.join(DATA_DIRECTORY, "dev-task-journal") });
  const nativeDevCoordinator = createNativeDevCoordinator({
    workspaceEngine, transactionalExecutionEngine, operationalSecurityPolicy, skillRegistry, reasoner: nativeDevReasoner, journal: nativeDevJournal,
    featureMode: (input) => featureFlags.evaluate("dev.native-core", { workspaceId: input.workspaceId, sessionId: input.sessionId }).mode,
    qualityEscalationMode: (input) => featureFlags.evaluate("dev.quality-escalation", { workspaceId: input.workspaceId, sessionId: input.sessionId }).mode,
    sameTierRepairAttempts: (input) => runtimeConfig.get("devBudget.sameTierRepairAttempts", { workspaceId: input.workspaceId, sessionId: input.sessionId }).value,
    observability: (event, metadata) => toolAuditLog.append(`dev.${event}`, metadata),
  });

  const nativeDevB3Orchestrator = createNativeDevOrchestrator({
    workspaceEngine,
    transactionalExecutionEngine,
    operationalSecurityPolicy,
    skillRegistry,
    reasoner: nativeDevReasoner,
    journal: nativeDevJournal,
    validationRunner: sandboxDevValidationExecutor,
    qualityEscalationMode: (input) => featureFlags.evaluate("dev.quality-escalation", {
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
    }).mode,
    sameTierRepairAttempts: (input) => runtimeConfig.get("devBudget.sameTierRepairAttempts", {
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
    }).value,
    observability: (event, metadata) => {
      toolAuditLog.append(`dev.b3.${event}`, metadata);
      userProgressAdapter.nativeDev(event, metadata);
    },
  });

  const nativeDevB3Facade = createNativeDevOrchestratorFacade({
    orchestrator: nativeDevB3Orchestrator,
    journal: nativeDevJournal,
    featureMode: (input) => featureFlags.evaluate("dev.native-core", {
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
    }).mode,
  });

  const goalDevExecutionCoreService = createGoalDevExecutionService({
    goalStrategyEngine,
    nativeDevFacade: nativeDevB3Facade,
    workspaceEngine,
    projectRuleResolver: devProjectRuleResolver,
    budgetService: devCostBudgetService,
    observability: (event, metadata) => toolAuditLog.append(`goals.dev.${event}`, metadata),
  });
  const goalDevExecutionService = createGoalDevEvaluatedExecutionService({
    goalExecutionService: goalDevExecutionCoreService,
    evaluationEngineProvider: dependencies.evaluationEngineProvider,
    observability: (event, metadata) => toolAuditLog.append(`goals.dev-evaluation.${event}`, metadata),
  });
  const goalDevRetryRuntime = createGoalDevRetryRuntime({
    database: personalDatabase,
    approvalEngine: approvalManager,
    operationalSecurityPolicy,
    interventionPermissionEngine,
    goalDevExecutionService,
    workspaceEngine,
    projectProvider: () => getValidRegisteredProjects(),
    profileScopeProvider: () => "arnaud",
    observability: (event, metadata) => toolAuditLog.append(`goals.dev-retry.${event}`, metadata),
  });

  return {
    goalDevExecutionService,
    goalDevRetryRuntime,
    nativeDevB3Facade,
    nativeDevCoordinator,
    nativeDevJournal,
  };
}

function createGoalModeDevComposition(dependencies) {
  const {
    DATA_DIRECTORY,
    approvalManager,
    authorizeOpenAIPrivacy,
    createAuditLog,
    dataDirectoryLock,
    devCostBudgetService,
    devProjectRuleResolver,
    estimateModelCost,
    featureFlags,
    goalStrategyEngine,
    nativeDevB3Facade,
    nativeDevJournal,
    openAIProviderAdapter,
    operationalSecurityPolicy,
    personalDatabase,
    readJsonBody,
    runtimeConfig,
    selectConfiguredModelRoute,
    selfDevPathPolicyProvider,
    toolAuditLog,
    trackUsage,
    workspaceEngine,
  } = dependencies;

  let goalModeDevRuntime = null;
  try {
    if (featureFlags.evaluate("goals.mode-dev", {}).mode !== "OFF") {
      goalModeDevRuntime = createGoalModeDevRuntime({
        database: personalDatabase,
        goalStrategyEngine,
        workspaceEngine,
        devBudgetService: devCostBudgetService,
        devTaskJournal: nativeDevJournal,
        approvalEngine: approvalManager,
        operationalSecurityPolicy,
        projectRuleResolver: devProjectRuleResolver,
        nativeDevFacade: nativeDevB3Facade,
        featureMode: (flagId, context = {}) => featureFlags.evaluate(flagId, context).mode,
        selectModelRoute: selectConfiguredModelRoute,
        estimateCost: estimateModelCost,
        authorizePrivacy: authorizeOpenAIPrivacy,
        providerAdapter: openAIProviderAdapter,
        trackUsage,
        dataDirectoryLock,
        pathPolicyProvider: selfDevPathPolicyProvider,
        observability: (event, metadata) => toolAuditLog.append(`goals.mode-dev.${event}`, metadata),
      });
    }
    toolAuditLog.append("goals.mode-dev.runtime_status", { composed: goalModeDevRuntime !== null });
  } catch (error) {
    goalModeDevRuntime = null;
    toolAuditLog.append("goals.mode-dev.runtime_unavailable", {
      code: String(error?.code || error?.name || "COMPOSITION_FAILED").slice(0, 80),
    });
  }

  let goalModeDevLockMaintenance = null;
  try {
    if (goalModeDevRuntime) {
      const goalModeDevLockDiagnosticsLog = createAuditLog(path.join(DATA_DIRECTORY, "goal-mode-dev-lock-diagnostics.json"), 200);
      goalModeDevLockMaintenance = createGoalModeDevLockMaintenance({
        lock: dataDirectoryLock,
        runtime: goalModeDevRuntime,
        audit: (event, metadata) => toolAuditLog.append(event, metadata),
        diagnostics: (event, metadata) => goalModeDevLockDiagnosticsLog.append(event, metadata),
      });
    }
  } catch (error) {
    goalModeDevLockMaintenance = null;
    toolAuditLog.append("goals.mode-dev.lock_maintenance_unavailable", {
      code: String(error?.code || error?.name || "COMPOSITION_FAILED").slice(0, 80),
    });
  }

  const goalModeDevHttp = createGoalModeDevHttpHandler({
    runtime: goalModeDevRuntime,
    goalStrategyEngine,
    enabled: () => goalModeDevRuntime !== null && featureFlags.evaluate("goals.mode-dev", {}).mode !== "OFF",
    requireTrustedUi: (req) => {
      if (req.headers["x-noon-request"] !== "1") {
        throw Object.assign(new Error("Requête Noon refusée."), { statusCode: 403, code: "TRUSTED_UI_REQUIRED" });
      }
    },
    readJsonBody,
    executionPreference: () => runtimeConfig.get("runtime.executionPreference", {}).value,
    audit: (event, metadata) => toolAuditLog.append(event, metadata),
    lockMaintenance: goalModeDevLockMaintenance,
  });

  return { goalModeDevHttp, goalModeDevLockMaintenance, goalModeDevRuntime };
}

function createNativeDevUiComposition(dependencies) {
  const {
    devProjectRuleResolver,
    devWorkspaceTerminalService,
    featureFlags,
    nativeDevB3Facade,
    toolAuditLog,
    workspaceEngine,
  } = dependencies;

  return createNativeDevUiExecutionService({
    terminalService: devWorkspaceTerminalService,
    nativeDevFacade: nativeDevB3Facade,
    workspaceEngine,
    projectRuleResolver: devProjectRuleResolver,
    featureMode: ({ workspaceId, sessionId }) => featureFlags.evaluate("dev.native-core", {
      workspaceId,
      sessionId,
    }).mode,
    observability: (event, metadata) => toolAuditLog.append(`dev.native-ui.${event}`, metadata),
  });
}

module.exports = {
  createGoalModeDevComposition,
  createNativeDevComposition,
  createNativeDevUiComposition,
};
