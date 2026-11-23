"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { isPathInsideRoots } = require("../../lib/path-utils");
const { findCodexExecutable, runCodexAnalysis } = require("../../lib/codex-bridge");
const { createCodexSpecialistAgent } = require("../delegation/codex-specialist-agent");
const { createDevDelegationRunner } = require("../delegation/dev-delegation-runner");
const { createClaudeCodeSpecialistAgent, createExecutorSelector } = require("../delegation/claude-code-specialist-agent");
const { createDevMissionService } = require("../delegation/dev-mission-service");
const { createDevMissionHttpRoutes } = require("../delegation/dev-mission-http-routes");
const {
  createSelfDevEvidenceService,
  createSelfDevPathPolicyProvider,
  createSelfDevTargetStore,
  createSelfDevWorktreeService,
} = require("../selfdev");
const { createSelfDevReviewService } = require("../selfdev/selfdev-review-service");
const { createSelfDevHttpRoutes } = require("../selfdev/selfdev-http-routes");
const { createBenchmarkRuntime } = require("./benchmark/benchmark-runtime");
const { createBenchmarkControlPlane } = require("./benchmark/benchmark-control-plane");

function createSelfDevComposition(dependencies) {
  const {
    DATA_DIRECTORY,
    UI_VALIDATION_MODE,
    featureFlags,
    localIntelligenceRuntime,
    localPermissionStore,
    sandboxDevValidationExecutor,
    toolAuditLog,
    workspaceEngine,
  } = dependencies;
  const stateDirectory = path.join(DATA_DIRECTORY, "selfdev");
  const targetStore = createSelfDevTargetStore({
    filePath: path.join(stateDirectory, "selfdev-target.json"),
    writableRootsProvider: () => localPermissionStore.roots("read-write"),
  });
  let serviceCache = { key: null, value: null };

  function resolveWorkspaceIds(worktreePath) {
    const ids = [];
    for (const workspace of workspaceEngine.list() || []) {
      try {
        const roots = (workspaceEngine.context(workspace.id).roots || []).filter((root) => root.mode === "read-write");
        if (roots.some((root) => worktreePath === root.path || worktreePath.startsWith(`${root.path}${path.sep}`))) ids.push(workspace.id);
      } catch { /* workspace illisible ignoré */ }
    }
    return ids;
  }

  function services() {
    const target = targetStore.get();
    const container = target?.worktreeContainer;
    if (!container || !fs.existsSync(container)) return { targetStore, worktreeService: null, evidenceService: null };
    if (serviceCache.key !== container) {
      const worktreeStateDirectory = path.join(stateDirectory, "worktrees");
      const worktreeService = createSelfDevWorktreeService({ container, stateDirectory: worktreeStateDirectory });
      const evidenceService = createSelfDevEvidenceService({
        worktreeService,
        executeValidation: sandboxDevValidationExecutor,
        stateDirectory: worktreeStateDirectory,
      });
      const reviewService = findCodexExecutable() ? createSelfDevReviewService({
        worktreeService,
        evidenceService,
        stateDirectory: worktreeStateDirectory,
        runReview: ({ worktreePath, question, signal }) => runCodexAnalysis({ question, projectPath: worktreePath, signal }),
        isRemoteAllowed: () => localIntelligenceRuntime.preflight({ requiredCapabilities: ["REMOTE_REASONING"] }).status === "AVAILABLE",
      }) : null;
      serviceCache = { key: container, value: { worktreeService, evidenceService, reviewService } };
    }
    return { targetStore, resolveWorkspaceIds, ...serviceCache.value };
  }

  const selfDevPathPolicyProvider = createSelfDevPathPolicyProvider({ getContext: services });
  const selfDevHttpRoutes = createSelfDevHttpRoutes({
    isEnabled: () => featureFlags.evaluate("selfdev.v1", {}).mode !== "OFF" &&
      !UI_VALIDATION_MODE && process.env.NOON_SMOKE_TEST !== "1" && process.env.NOON_SAFE_MODE !== "1",
    services,
    observability: (event, metadata) => toolAuditLog.append(event, metadata),
  });
  return { selfDevHttpRoutes, selfDevPathPolicyProvider };
}

function createDevDelegationComposition(dependencies) {
  const {
    UI_VALIDATION_MODE,
    approvalManager,
    executorWorktreeManager,
    featureFlags,
    operationalSecurityPolicy,
    sandboxDevValidationExecutor,
    toolAuditLog,
    workspaceEngine,
  } = dependencies;
  const codexSpecialistAgent = createCodexSpecialistAgent({ observability: (event, metadata) => toolAuditLog.append(`dev.${event}`, metadata) });
  const claudeCodeSpecialistAgent = createClaudeCodeSpecialistAgent({ observability: (event, metadata) => toolAuditLog.append(`dev.${event}`, metadata) });
  const devExecutorSelector = createExecutorSelector({
    agents: { "codex-cli": codexSpecialistAgent, "claude-code": claudeCodeSpecialistAgent },
    defaultId: "codex-cli",
  });
  const devDelegationRunner = createDevDelegationRunner({
    specialistAgent: devExecutorSelector,
    worktreeManager: executorWorktreeManager,
    workspaceEngine,
    operationalSecurityPolicy,
    validationExecutor: sandboxDevValidationExecutor,
    observability: (event, metadata) => toolAuditLog.append(`delegation.${event}`, metadata),
  });
  const devMissionsEnabled = () => featureFlags.evaluate("dev.missions", {}).enabled &&
    process.env.NOON_SAFE_MODE !== "1" && !UI_VALIDATION_MODE;
  const devMissionService = createDevMissionService({
    runner: devDelegationRunner,
    approvals: approvalManager,
    isEnabled: devMissionsEnabled,
    listExecutors: () => devExecutorSelector.list(),
    listRepositories: () => {
      const seen = new Set(); const repositories = [];
      for (const workspace of workspaceEngine.list() || []) {
        let roots;
        try { roots = (workspaceEngine.context(workspace.id).roots || []).filter((item) => item.mode === "read-write"); } catch { continue; }
        for (const root of roots) {
          let repositoryRoot; try { repositoryRoot = fs.realpathSync(root.path); } catch { continue; }
          if (!fs.existsSync(path.join(repositoryRoot, ".git")) || seen.has(`${workspace.id}\0${repositoryRoot}`)) continue;
          seen.add(`${workspace.id}\0${repositoryRoot}`);
          repositories.push({ workspaceId: workspace.id, workspaceName: String(workspace.name || workspace.id).slice(0, 120), repositoryRoot, name: path.basename(repositoryRoot) });
        }
      }
      return repositories;
    },
    authorizeRepository: (workspaceId, repositoryRoot) => {
      try {
        const workspace = workspaceEngine.context(workspaceId);
        const roots = (workspace.relevantRoots || workspace.roots || [])
          .filter((item) => item.mode === "read-write")
          .map((item) => { try { return fs.realpathSync(item.path); } catch { return null; } })
          .filter(Boolean);
        return roots.length > 0 && isPathInsideRoots(repositoryRoot, roots);
      } catch { return false; }
    },
    observability: (event, metadata) => toolAuditLog.append(`dev.${event}`, metadata),
  });
  const devMissionHttpRoutes = createDevMissionHttpRoutes({ isEnabled: devMissionsEnabled, service: devMissionService });
  return { codexSpecialistAgent, devDelegationRunner, devMissionHttpRoutes };
}

function createBenchmarkComposition(dependencies) {
  const {
    DATA_DIRECTORY,
    codexSpecialistAgent,
    featureFlags,
    nativeDevCoordinator,
    operationalSecurityPolicy,
    personalDatabase,
    runtimeConfig,
    toolAuditLog,
  } = dependencies;
  const benchmarkDevDelegationRunner = createDevDelegationRunner({
    specialistAgent: codexSpecialistAgent,
    operationalSecurityPolicy,
    observability: (event, metadata) => toolAuditLog.append(`delegation.${event}`, metadata),
  });
  let benchmarkControlPlane = null;
  try {
    const benchmarkRuntime = createBenchmarkRuntime({
      database: personalDatabase,
      runtimeConfig,
      benchmarkWorkspaceRoot: path.join(DATA_DIRECTORY, "benchmark-workspaces"),
      nativeDevCoordinator,
      devDelegationRunner: benchmarkDevDelegationRunner,
      featureMode: (context = {}) => featureFlags.evaluate("dev.benchmark", context).mode,
      observability: (event, metadata) => toolAuditLog.append(`dev.${event}`, metadata),
    });
    benchmarkControlPlane = createBenchmarkControlPlane({
      runtime: benchmarkRuntime,
      featureMode: (context = {}) => featureFlags.evaluate("dev.benchmark", context).mode,
    });
  } catch (error) {
    toolAuditLog.append("dev.benchmark_service_unavailable", {
      code: String(error.code || error.name || "INITIALIZATION_FAILED").slice(0, 80),
    });
  }
  return { benchmarkControlPlane };
}

module.exports = {
  createBenchmarkComposition,
  createDevDelegationComposition,
  createSelfDevComposition,
};
