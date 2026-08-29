"use strict";

const crypto = require("crypto");

class OrchestratorError extends Error {
  constructor(type, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "OrchestratorError";
    this.type = type;
    this.code = String(cause?.code || type).slice(0, 100);
    this.status = cause?.status;
  }
}

function executionId() {
  return `exec_${crypto.randomUUID()}`;
}

function parseToolArguments(toolCall) {
  try {
    return JSON.parse(toolCall.arguments || "{}");
  } catch (error) {
    throw new OrchestratorError("tool_error", `Arguments invalides pour ${toolCall.name}.`, error);
  }
}

function approvalInput(toolCall, args) {
  return {
    provider: "skill",
    action: String(toolCall.name),
    target: String(args.path || args.outputDirectory || args.to || args.target || "").slice(0, 500),
    payload: args,
  };
}

function classifyError(error) {
  if (error?.name === "AbortError") return "timeout";
  if (error?.type) return error.type;
  if (String(error?.code || "").includes("PERMISSION") || String(error?.code || "").includes("CONFIRMATION")) return "permission_error";
  if (["ETIMEDOUT", "ECONNRESET", "ENOTFOUND"].includes(error?.code)) return "network_error";
  return "model_error";
}

function createNoonOrchestrator({
  contextBuilder,
  selectModel,
  modelFallbacks,
  clientProvider,
  skillRegistry,
  priorityEngine = null,
  approvalManager = null,
  getTools,
  buildSkillContext = () => ({}),
  applyRequestOptions = (options) => options,
  sanitizeResponseOutput = (item) => item,
  isCompactionCompatibilityError = () => false,
  isToolSearchCompatibilityError = () => false,
  enableToolSearch = true,
  onModelResponse = null,
  onToolResult = null,
  onFinalRound = null,
  audit = null,
  observability = null,
  captureApprovalPreconditions = () => ({}),
  recheckHardRules = () => true,
  recheckConnector = () => true,
  recheckApprovalPreconditions = (_record, original) => original,
  reliabilityEngine = null,
  operationalSecurityPolicy = null,
  transactionalExecutionEngine = null,
  now = () => Date.now(),
} = {}) {
  if (!contextBuilder?.buildContext) throw new TypeError("Context Builder requis.");
  if (typeof selectModel !== "function") throw new TypeError("Model Router requis.");
  if (typeof modelFallbacks !== "function") throw new TypeError("Fallbacks modèle requis.");
  if (typeof clientProvider !== "function") throw new TypeError("Client Responses requis.");
  if (!skillRegistry?.executeSkill) throw new TypeError("Skill Registry requis.");
  if (typeof getTools !== "function") throw new TypeError("Sélecteur d'outils requis.");

  const pending = new Map();
  const resumeOperations = new Map();
  const resumeResults = new Map();

  function cleanupPending(exceptExecutionId = null) {
    for (const [id, workflow] of pending) {
      if (id !== exceptExecutionId && Date.parse(workflow.expiresAt || 0) <= now()) {
        try { approvalManager?.get(workflow.approvalId); } catch {}
        observability?.recordApproval(workflow.state.executionId, {
          approvalId: workflow.approvalId, status: "expired", waitMs: 0,
        });
        pending.delete(id);
      }
    }
  }

  function trace(event, state, metadata = {}) {
    audit?.(`orchestrator.${event}`, {
      executionId: state.executionId,
      channel: state.request.channel || "chat",
      ...metadata,
    });
  }

  function buildOptions(state, round) {
    const isFinalRound = round === state.maxRounds - 1;
    const toolSearchEnabled = enableToolSearch && !isFinalRound;
    let options = {
      model: state.route.model,
      input: state.input,
      store: false,
      reasoning: { effort: state.route.effort, context: "auto" },
      text: { verbosity: state.route.verbosity },
    };
    options = applyRequestOptions(options);
    options.tools = getTools({
      webSearchEnabled: state.request.webSearchEnabled === true,
      toolSearchEnabled,
      context: state.context,
    });
    options.tool_choice = isFinalRound && !state.request.webSearchEnabled ? "none" : "auto";
    if (state.request.webSearchEnabled) {
      options.max_tool_calls = Math.max(1, Number(state.request.maxWebToolCalls) || 1);
    }
    return { options, isFinalRound, toolSearchEnabled };
  }

  async function callModel(state, round) {
    const { options, isFinalRound, toolSearchEnabled } = buildOptions(state, round);
    if (isFinalRound) onFinalRound?.(state.request);
    let lastError;
    const availableModels = modelFallbacks(state.route.model).filter((model) => {
      if (!reliabilityEngine) return true;
      try {
        const health = reliabilityEngine.snapshot(model);
        return !["UNAVAILABLE", "MISCONFIGURED"].includes(health.state) && health.circuitState !== "open";
      } catch { return true; }
    });
    for (const model of availableModels.length ? availableModels : modelFallbacks(state.route.model)) {
      let attemptOptions = { ...options, model };
      try {
        for (let compatibilityAttempt = 0; compatibilityAttempt < 3; compatibilityAttempt += 1) {
          const attemptStarted = now();
          try {
            let streamChunks = 0;
            let firstTokenMs = null;
            let response;
            if (typeof state.request.onTextDelta === "function") {
              const stream = clientProvider().responses.stream(
                attemptOptions,
                state.request.signal ? { signal: state.request.signal } : undefined
              );
              stream.on("response.output_text.delta", (event) => {
                streamChunks += 1;
                if (state.metrics.timeToFirstTokenMs === null) {
                  state.metrics.timeToFirstTokenMs = now() - attemptStarted;
                  firstTokenMs = state.metrics.timeToFirstTokenMs;
                }
                state.request.onTextDelta(event.delta);
              });
              response = await stream.finalResponse();
            } else {
              response = await clientProvider().responses.create(
                attemptOptions,
                state.request.signal ? { signal: state.request.signal } : undefined
              );
            }
            const modelTotalMs = now() - attemptStarted;
            state.metrics.modelMs += modelTotalMs;
            state.modelUsed = model;
            response.noonModel = model;
            if (model !== state.route.model) state.metrics.fallbackCount += 1;
            observability?.recordModelCall(state.executionId, {
              index: state.modelCallIndex++, round, model,
              modelRequestMs: modelTotalMs,
              modelTotalMs,
              timeToFirstTokenMs: firstTokenMs,
              streamDurationMs: streamChunks > 0 ? modelTotalMs : 0,
              streamChunks,
              usage: response.usage || null,
            });
            if (model !== state.route.model) {
              observability?.recordFallback(state.executionId, {
                component: "model", from: state.route.model, to: model, reason: "primary_model_error",
              });
              try { reliabilityEngine?.recordFallback(model, { from: state.route.model, to: model, quality: "degraded", reasonCode: "PRIMARY_MODEL_ERROR" }); } catch {}
            }
            onModelResponse?.(response, state);
            try { reliabilityEngine?.recordSuccess(model, { latencyMs: modelTotalMs }); reliabilityEngine?.recordSuccess("openai-models", { latencyMs: modelTotalMs }); } catch {}
            return response;
          } catch (error) {
            const failedModelMs = now() - attemptStarted;
            try { reliabilityEngine?.recordFailure(model, error, { latencyMs: failedModelMs, executionId: state.executionId }); } catch {}
            observability?.recordModelCall(state.executionId, {
              index: state.modelCallIndex++, round, model,
              modelRequestMs: failedModelMs, modelTotalMs: failedModelMs,
              timeToFirstTokenMs: null, streamDurationMs: 0, streamChunks: 0,
              status: "failed", errorType: classifyError(error), usage: null,
            });
            if (attemptOptions.context_management && isCompactionCompatibilityError(error)) {
              attemptOptions = { ...attemptOptions };
              delete attemptOptions.context_management;
              trace("compaction.fallback", state, { feature: "compaction", model });
              observability?.recordFallback(state.executionId, {
                component: "compaction", from: "enabled", to: "disabled", reason: "compatibility_error",
              });
              continue;
            }
            if (toolSearchEnabled && isToolSearchCompatibilityError(error)) {
              attemptOptions = {
                ...attemptOptions,
                tools: getTools({
                  webSearchEnabled: state.request.webSearchEnabled === true,
                  toolSearchEnabled: false,
                  context: state.context,
                }),
              };
              trace("tool_search.fallback", state, { feature: "tool_search", model });
              observability?.recordFallback(state.executionId, {
                component: "tool_search", from: "enabled", to: "disabled", reason: "compatibility_error",
              });
              continue;
            }
            throw error;
          }
        }
      } catch (error) {
        lastError = error;
        if (![400, 403, 404].includes(error?.status) || model === "gpt-5.6-luna") break;
      }
    }
    throw new OrchestratorError("fallback_exhausted", "Tous les modèles disponibles ont échoué.", lastError);
  }

  function toolOutput(toolCall, result) {
    return {
      type: "function_call_output",
      call_id: toolCall.call_id,
      output: JSON.stringify(result),
    };
  }

  async function executeTool(state, toolCall, args, confirmed = false, approvedContext = null) {
    const started = now();
    try {
      const skill = skillRegistry.getSkillByName?.(toolCall.name);
      const skillContext = { ...buildSkillContext(state.request, state), confirmed };
      const legacyDecision = skillRegistry.authorize?.(toolCall.name, args, skillContext) || { allowed: true, code: "AUTHORIZED" };
      const evaluateCurrentPolicy = () => {
        if (!operationalSecurityPolicy) return null;
        const normalizedIntent = state.request.normalizedIntent || {};
        const origin = normalizedIntent.origin || (state.request.channel === "voice" ? "explicit_user_voice" : "explicit_user_chat");
        return operationalSecurityPolicy.evaluate({
          actionRequest: {
            intentId: normalizedIntent.intentId || null, executionId: state.executionId,
            actor: "user", origin, channel: state.request.channel || "chat",
            skillId: toolCall.name, operation: toolCall.name, args,
            targets: [args.path || args.outputDirectory || args.to || args.target || args.eventId]
              .filter(Boolean).map((target) => typeof target === "string" ? { id: target, path: /^(?:\/|[A-Za-z]:)/.test(target) ? target : undefined } : target),
            workspaceId: state.request.workspaceId || null, projectId: state.request.projectId || null,
            profileScope: state.request.profileScope || "arnaud",
            sourceProfileScope: state.request.sourceProfileScope || state.request.profileScope || "arnaud",
            explicitOrder: normalizedIntent.explicitOrder ?? skillContext.explicitOrder === true,
            negated: normalizedIntent.negated === true,
            hypothetical: normalizedIntent.action === "explain" && normalizedIntent.type === "ASK",
            localOnly: args.localOnly === true || args.apiPolicy === "local_only",
            hasLocalData: Boolean(args.path || args.outputDirectory || args.artifactId),
            overwriteExisting: args.overwrite === true || args.strategy === "OVERWRITE",
            targetCount: Array.isArray(args.items) ? args.items.length : Array.isArray(args.targets) ? args.targets.length : 1,
            safeMode: reliabilityEngine?.report?.().readiness === "NOT_READY",
          },
          skillPolicy: skill?.permissions || {}, currentPermissions: legacyDecision,
          permissionContext: skillContext, pendingApproval: { valid: confirmed },
        });
      };
      let policyDecision = null;
      if (operationalSecurityPolicy) {
        policyDecision = evaluateCurrentPolicy();
        operationalSecurityPolicy.compareLegacy(policyDecision, legacyDecision);
        if (policyDecision.outcome === "DENY") {
          throw Object.assign(new Error("Action refusée par la politique de sécurité opérationnelle."), { code: "SECURITY_POLICY_DENIED", policyDecision });
        }
        if (policyDecision.outcome === "UNAVAILABLE") {
          throw Object.assign(new Error("Le service requis n’est pas disponible pour cette action."), { code: "SECURITY_POLICY_UNAVAILABLE", policyDecision });
        }
        if (policyDecision.outcome === "REQUIRE_APPROVAL" && !confirmed) {
          throw Object.assign(new Error("Confirmation requise par la politique de sécurité."), { code: "CONFIRMATION_REQUIRED", policyDecision });
        }
      }
      let result;
      const mutating = ["WRITE", "EXECUTE", "DESTRUCTIVE"].includes(policyDecision?.actionClass) ||
        ["write", "external", "destructive"].includes(skill?.permissions?.level);
      if (transactionalExecutionEngine && mutating) {
        const transaction = await transactionalExecutionEngine.executeSingleStep({
          executionId: `${state.executionId}:${toolCall.call_id}`,
          intentId: state.request.normalizedIntent?.intentId || null,
          workspaceId: state.request.workspaceId || null,
          projectId: state.request.projectId || null,
          profileScope: state.request.profileScope || "arnaud",
          sessionId: state.request.sessionId || null,
          conversationId: state.request.conversationId || null,
          policyDecision,
          approvalRef: confirmed ? { valid: true, approvalId: approvedContext?.approvalId || null } : null,
          actionRequest: { actionFingerprint: policyDecision?.actionFingerprint || null },
          step: {
            stepId: String(toolCall.call_id), skillId: toolCall.name, operation: toolCall.name,
            args, actionClass: policyDecision?.actionClass || "WRITE",
            verificationLevel: "BASIC",
          },
          idempotent: skill?.execution?.idempotent === true,
          componentId: /gmail|email/i.test(toolCall.name) ? "gmail"
            : /calendar|agenda/i.test(toolCall.name) ? "google-calendar"
              : /artifact|image|document|presentation/i.test(toolCall.name) ? "artifacts"
                : /file|directory|folder/i.test(toolCall.name) ? "filesystem" : null,
          revalidate: () => evaluateCurrentPolicy(),
          checkPreconditions: async () => {
            if (!confirmed) return { valid: true };
            const current = await recheckApprovalPreconditions(null, approvedContext?.preconditions || {}, { state, toolCall, args, skill });
            return { valid: JSON.stringify(current || {}) === JSON.stringify(approvedContext?.preconditions || {}) };
          },
          executeStep: () => skillRegistry.executeSkill(toolCall.name, args, { ...skillContext, policyDecision }),
        });
        if (!transaction || transaction.status !== "SUCCEEDED") {
          throw Object.assign(new Error("L'exécution transactionnelle n'a pas produit un succès vérifié."), { code: transaction?.status || "EXECUTION_FAILED", executionResult: transaction });
        }
        result = transaction.result;
      } else {
        result = await skillRegistry.executeSkill(toolCall.name, args, { ...skillContext, policyDecision });
      }
      const toolMs = now() - started;
      state.metrics.toolExecutionMs += toolMs;
      state.toolCalls.push({ name: toolCall.name, callId: toolCall.call_id, status: "succeeded" });
      observability?.recordTool(state.executionId, {
        toolName: toolCall.name, toolMs, toolStatus: "succeeded",
        permissionLevel: confirmed ? "confirmed" : "standard", approvalRequired: confirmed,
      });
      onToolResult?.(null, toolCall, state);
      try {
        const componentId = /gmail|email/i.test(toolCall.name) ? "gmail"
          : /calendar|agenda/i.test(toolCall.name) ? "google-calendar"
            : /file|directory|folder/i.test(toolCall.name) ? "filesystem"
              : /artifact|image|document|presentation/i.test(toolCall.name) ? "artifacts" : null;
        if (componentId) reliabilityEngine?.recordSuccess(componentId, { latencyMs: toolMs });
      } catch {}
      return result;
    } catch (error) {
      const toolMs = now() - started;
      state.metrics.toolExecutionMs += toolMs;
      if (String(error?.code || "").includes("CONFIRMATION_REQUIRED") && approvalManager) {
        const exactInput = approvalInput(toolCall, args);
        const skill = skillRegistry.getSkillByName?.(toolCall.name);
        const preconditions = await captureApprovalPreconditions({ state, toolCall, args, skill });
        const approval = approvalManager.prepareAction({
          executionId: state.executionId,
          toolCallId: toolCall.call_id,
          skillName: toolCall.name,
          operation: toolCall.name,
          normalizedArgs: args,
          target: exactInput.target,
          permissionLevel: skill?.permissions?.level || "external",
          strengthened: skill?.permissions?.destructive === true,
          contextRef: { fingerprint: state.context.metadata?.contextFingerprint || null, policyVersion: error.policyDecision?.policyVersion || operationalSecurityPolicy?.version?.() || null },
          preconditions,
        });
        state.toolCalls.push({ name: toolCall.name, callId: toolCall.call_id, status: "approval_required" });
        pending.set(state.executionId, {
          state, toolCall, args, approvalId: approval.id, resumeToken: approval.resumeToken,
          exactInput, preconditions,
          expiresAt: approval.expiresAt, approvalStartedAt: now(),
        });
        observability?.recordTool(state.executionId, {
          toolName: toolCall.name, toolMs, toolStatus: "approval_required",
          permissionLevel: "sensitive", approvalRequired: true,
        });
        observability?.recordApproval(state.executionId, {
          approvalId: approval.id, status: "required", waitMs: 0,
        });
        trace("approval_required", state, { approvalId: approval.id, tool: toolCall.name });
        return { __approvalRequired: true, approval };
      }
      state.toolCalls.push({ name: toolCall.name, callId: toolCall.call_id, status: "failed", errorType: classifyError(error) });
      observability?.recordTool(state.executionId, {
        toolName: toolCall.name, toolMs, toolStatus: "failed",
        permissionLevel: "standard", approvalRequired: false,
        errorType: classifyError(error),
      });
      onToolResult?.(error, toolCall, state);
      try {
        const componentId = /gmail|email/i.test(toolCall.name) ? "gmail"
          : /calendar|agenda/i.test(toolCall.name) ? "google-calendar"
            : /file|directory|folder/i.test(toolCall.name) ? "filesystem"
              : /artifact|image|document|presentation/i.test(toolCall.name) ? "artifacts" : null;
        if (componentId) reliabilityEngine?.recordFailure(componentId, error, { latencyMs: toolMs, executionId: state.executionId });
      } catch {}
      if (confirmed) throw error;
      if (error.policyDecision) {
        return {
          ok: false,
          error: error.policyDecision.outcome === "UNAVAILABLE"
            ? "Le service requis n’est pas disponible pour cette action."
            : "Cette action a été bloquée par la politique de sécurité de Noon.",
          type: "security_policy",
          decisionId: error.policyDecision.decisionId,
          reasonCodes: error.policyDecision.reasons,
          retryable: false,
          userActionRequired: error.policyDecision.outcome === "UNAVAILABLE",
        };
      }
      const normalized = error.normalized || reliabilityEngine?.classifyFailure?.(error);
      return {
        ok: false,
        error: normalized?.safeMessage || "La source demandée n’a pas pu être vérifiée.",
        type: normalized?.category || classifyError(error),
        retryable: normalized?.retryable === true,
        userActionRequired: normalized?.userActionRequired === true,
        recoveryAction: normalized?.recoveryAction || null,
      };
    }
  }

  function finalResult(state, response, text) {
    state.metrics.totalMs = now() - state.startedAt;
    const result = {
      status: "completed",
      text: text || "Je n'ai pas réussi à produire une réponse exploitable.",
      executionId: state.executionId,
      requestedModel: state.route.model,
      modelUsed: state.modelUsed || state.route.model,
      route: state.route,
      toolCalls: state.toolCalls,
      approvals: [],
      usage: response?.usage || null,
      latency: { ...state.metrics },
      metadata: {
        context: state.context.metadata,
        priorities: state.priorities.map(({ id, score, priorityLevel, scoringVersion }) => ({ id, score, priorityLevel, scoringVersion })),
        toolRounds: state.metrics.toolRounds,
        fallbackCount: state.metrics.fallbackCount,
      },
      response,
    };
    trace("completed", state, {
      modelUsed: result.modelUsed,
      toolRounds: result.metadata.toolRounds,
      fallbackCount: result.metadata.fallbackCount,
      totalMs: result.latency.totalMs,
    });
    observability?.completeExecution(state.executionId, {
      status: "completed",
      toolRounds: state.metrics.toolRounds,
      wallClockTotalMs: state.metrics.totalMs,
      technicalExecutionMs: Math.max(0, state.metrics.totalMs - state.metrics.approvalWaitMs),
    });
    return result;
  }

  async function continueExecution(state, startRound = 0) {
    for (let round = startRound; round < state.maxRounds; round += 1) {
      if (state.request.signal?.aborted) {
        const error = new Error("Demande interrompue.");
        error.name = "AbortError";
        throw error;
      }
      const response = await callModel(state, round);
      const toolCalls = (response.output || []).filter((item) => item.type === "function_call");
      if (toolCalls.length === 0) return finalResult(state, response, response.output_text?.trim());
      state.metrics.toolRounds += 1;
      state.input.push(...(response.output || []).map(sanitizeResponseOutput));
      for (const toolCall of toolCalls) {
        const args = parseToolArguments(toolCall);
        const result = await executeTool(state, toolCall, args, false);
        if (result?.__approvalRequired) {
          return {
            status: "approval_required",
            executionId: state.executionId,
            approval: result.approval,
            type: "approval",
            text: "Cette action nécessite votre confirmation.",
            metadata: { context: state.context.metadata, toolRounds: state.metrics.toolRounds },
          };
        }
        state.input.push(toolOutput(toolCall, result));
      }
    }
    return finalResult(state, null, "L'analyse s'est terminée sans réponse exploitable.");
  }

  async function run(request = {}) {
    cleanupPending();
    const state = {
      executionId: executionId(),
      request,
      startedAt: now(),
      input: [],
      context: null,
      route: null,
      modelUsed: null,
      toolCalls: [],
      modelCallIndex: 0,
      priorities: [],
      maxRounds: Math.max(1, Math.min(20, Number(request.maxRounds) || 3)),
      metrics: {
        contextBuildMs: 0, modelSelectMs: 0, modelMs: 0,
        timeToFirstTokenMs: null, toolExecutionMs: 0, totalMs: 0,
        fallbackCount: 0, toolRounds: 0, approvalWaitMs: 0,
      },
    };
    observability?.startExecution({
      executionId: state.executionId,
      channel: request.channel || "chat",
      intent: request.contextInput?.intent || request.intent || "general",
      mode: request.contextInput?.mode || request.mode || null,
    });
    trace("started", state);
    try {
      let started = now();
      state.context = contextBuilder.buildContext(request.contextInput || request);
      state.metrics.contextBuildMs = now() - started;
      observability?.recordContext(state.executionId, {
        contextBuildMs: state.metrics.contextBuildMs,
        contextEstimatedTokens: state.context.metadata?.estimatedTokens || 0,
        contextBudget: state.context.metadata?.budgetTokens || 0,
        contextTruncated: state.context.metadata?.truncated === true,
        rulesLoaded: state.context.metadata?.hardRulesApplied || state.context.metadata?.ruleIds?.length || 0,
        memoriesLoaded: state.context.metadata?.memoryIds?.length || 0,
        memoriesFiltered: state.context.metadata?.memoryPrivateFiltered || 0,
        projectsLoaded: state.context.metadata?.projectIds?.length || 0,
        peopleLoaded: state.context.metadata?.people?.length || 0,
        conversationMessagesLoaded: state.context.metadata?.conversationIds?.length || 0,
        memoryRetrievalMs: state.context.metadata?.memoryRetrievalMs || 0,
        memorySourcesQueried: state.context.metadata?.memorySourcesQueried || 0,
        memoryItemsFound: state.context.metadata?.memoryItemsFound || 0,
        memoryItemsReturned: state.context.metadata?.memoryItemsReturned || 0,
        memoryItemsDeduplicated: state.context.metadata?.memoryItemsDeduplicated || 0,
        memoryPrivateFiltered: state.context.metadata?.memoryPrivateFiltered || 0,
        hardRulesResolveMs: state.context.metadata?.hardRulesResolveMs || 0,
        hardRulesApplied: state.context.metadata?.hardRulesApplied || 0,
        contextCacheHits: state.context.metadata?.cacheHits || 0,
        contextCacheMisses: state.context.metadata?.cacheMisses || 0,
        contextCacheHitRate: state.context.metadata?.cacheHitRate || 0,
        contextCacheEntries: state.context.metadata?.cacheEntries || 0,
        contextCacheMemoryBytesEstimate: state.context.metadata?.cacheMemoryBytesEstimate || 0,
        contextTokensBefore: state.context.metadata?.tokensBefore || 0,
        contextTokensAfter: state.context.metadata?.tokensAfter || 0,
        contextTokensSaved: state.context.metadata?.tokensSaved || 0,
        contextFingerprint: state.context.metadata?.contextFingerprint || null,
        contextSegments: Object.fromEntries(Object.entries(state.context.metadata?.cache || {}).map(
          ([segment, event]) => [segment, { hit: event.hit === true, fallback: event.fallback === true, ageMs: event.ageMs || 0, buildMs: event.buildMs || 0 }]
        )),
      });
      const priorityIntent = ["planning", "calendar", "brief", "project", "projects", "organization", "tasks", "priorities"]
        .includes(state.context.metadata?.intent);
      if (priorityEngine && priorityIntent && Array.isArray(request.priorityActions) && request.priorityActions.length > 0) {
        const priorityStartedAt = now();
        state.priorities = priorityEngine.rank(request.priorityActions, { limit: request.priorityLimit || 15 });
        observability?.recordPriority(state.executionId, {
          priorityEngineMs: now() - priorityStartedAt,
          actionsScored: request.priorityActions.length,
        });
        state.context.runtime ||= {};
        state.context.runtime.priorityResults = state.priorities;
        trace("priorities_ranked", state, { count: state.priorities.length, scoringVersion: priorityEngine.scoringVersion });
      }
      started = now();
      state.route = selectModel({
        question: request.query,
        profile: request.modelProfile,
        budgetMode: request.budgetMode,
        attachments: request.attachmentsCount || 0,
        context: {
          estimatedTokens: state.context.metadata?.estimatedTokens || 0,
          sourceCount: state.context.metadata?.sources?.length || 0,
          memoryRequired: (state.context.metadata?.memoryIds?.length || 0) > 0,
          truncated: state.context.metadata?.truncated === true,
        },
        tools: {
          hasTools: state.context.metadata?.complexityHints?.hasTools === true,
          requestedCount: state.context.runtime?.tools?.length || 0,
        },
        output: { expectedLength: request.expectedOutputLength || "medium" },
        risk: { level: request.consequenceLevel || "low" },
      });
      state.metrics.modelSelectMs = now() - started;
      observability?.recordRouting(state.executionId, {
        requestedProfile: request.modelProfile || "balanced",
        selectedProfile: state.route.selectedProfile,
        selectedModel: state.route.model,
        routingMs: state.route.routingMs ?? state.metrics.modelSelectMs,
        routingPolicyVersion: state.route.routingPolicyVersion,
        routingScore: state.route.score,
        reasonCodes: state.route.reasonCodes,
        signals: state.route.signals,
        budgetMode: request.budgetMode || "NORMAL",
      });
      state.input = request.buildInput(state.context);
      return await continueExecution(state, 0);
    } catch (error) {
      trace("failed", state, { type: classifyError(error), code: String(error?.code || error?.name || "ERROR").slice(0, 100) });
      observability?.failExecution(state.executionId, error, {
        wallClockTotalMs: now() - state.startedAt,
        technicalExecutionMs: Math.max(0, now() - state.startedAt - state.metrics.approvalWaitMs),
      });
      if (error?.name === "AbortError" || error instanceof OrchestratorError) throw error;
      throw new OrchestratorError(classifyError(error), error.message, error);
    }
  }

  async function resumeWorkflow({ executionId: id, approvalId, approved, decision, resumeToken = null }) {
    cleanupPending(String(id));
    const workflow = pending.get(String(id));
    if (!workflow || workflow.approvalId !== approvalId) {
      throw new OrchestratorError("approval_required", "Workflow d'approbation absent ou expiré.");
    }
    const { state, toolCall, args, exactInput, preconditions } = workflow;
    const approvalWaitMs = Math.max(0, now() - (workflow.approvalStartedAt || now()));
    state.metrics.approvalWaitMs += approvalWaitMs;
    const normalizedDecision = decision || (approved ? "approve" : "reject");
    if (normalizedDecision !== "approve") {
      await approvalManager.resumeApprovedAction({
        approvalId,
        resumeToken: resumeToken || workflow.resumeToken,
        decision: "reject",
      });
      pending.delete(String(id));
      state.input.push(toolOutput(toolCall, { error: "Action refusée par l'utilisateur.", type: "permission_error" }));
      trace("approval_rejected", state, { approvalId, tool: toolCall.name });
      observability?.recordApproval(state.executionId, {
        approvalId, status: "rejected", waitMs: approvalWaitMs,
      });
      return continueExecution(state, state.metrics.toolRounds);
    }
    const resumedAt = now();
    let resumed;
    try {
      resumed = await approvalManager.resumeApprovedAction({
        approvalId,
        resumeToken: resumeToken || workflow.resumeToken,
        decision: "approve",
        exactAction: {
          skillName: toolCall.name,
          operation: toolCall.name,
          target: exactInput.target,
          normalizedArgs: args,
        },
        recheckHardRules: (record) => recheckHardRules({ record, state, toolCall, args }),
        recheckPermission: () => {
          const decisionResult = skillRegistry.authorize?.(
            toolCall.name,
            args,
            { ...buildSkillContext(state.request, state), confirmed: true }
          );
          return decisionResult ? decisionResult.allowed === true : true;
        },
        recheckConnector: (record) => recheckConnector({ record, state, toolCall, args }),
        recheckPreconditions: (record) => recheckApprovalPreconditions(record, preconditions, { state, toolCall, args }),
        execute: () => executeTool(state, toolCall, args, true, { approvalId, preconditions }),
      });
    } catch (error) {
      pending.delete(String(id));
      const status = error.code === "approval_expired" ? "expired"
        : error.code === "approval_stale" ? "stale" : "failed";
      observability?.recordApproval(state.executionId, {
        approvalId, status, waitMs: approvalWaitMs,
        approvalResumeMs: Math.max(0, now() - resumedAt),
      });
      trace(`approval_${status}`, state, { approvalId, tool: toolCall.name, code: error.code });
      throw error;
    }
    pending.delete(String(id));
    const result = resumed.result;
    state.input.push(toolOutput(toolCall, result));
    trace("approval_resumed", state, { approvalId, tool: toolCall.name });
    observability?.recordApproval(state.executionId, {
      approvalId, status: "accepted", waitMs: approvalWaitMs,
      approvalResumeMs: Math.max(0, now() - resumedAt),
    });
    observability?.recordApproval(state.executionId, {
      approvalId, status: "consumed", waitMs: 0,
    });
    return continueExecution(state, state.metrics.toolRounds);
  }

  async function resume(input = {}) {
    const key = String(input.approvalId || "");
    if (resumeResults.has(key)) return resumeResults.get(key);
    if (resumeOperations.has(key)) return resumeOperations.get(key);
    const operation = resumeWorkflow(input).then((result) => {
      resumeResults.set(key, result);
      if (resumeResults.size > 100) resumeResults.delete(resumeResults.keys().next().value);
      return result;
    });
    resumeOperations.set(key, operation);
    try { return await operation; }
    finally { resumeOperations.delete(key); }
  }

  return {
    run,
    resume,
    pendingExecutions: () => { cleanupPending(); return [...pending.keys()]; },
  };
}

module.exports = {
  OrchestratorError,
  approvalInput,
  classifyError,
  createNoonOrchestrator,
  executionId,
};
