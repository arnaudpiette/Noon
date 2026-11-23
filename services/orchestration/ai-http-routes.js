"use strict";

// V3-L7 : POST /ai et /ai/stream, déplacés tels quels depuis server.js.
// Bloc déplacé tel quel depuis server.js ; ses dépendances sont lues à chaque requête
// (accesseurs), ce qui préserve les variables initialisées plus tard au démarrage.

const { NOT_HANDLED } = require("../http/route-result");

const DEPENDENCIES = Object.freeze(["WEB_SEARCH_DAILY_LIMIT","askAI","attachmentResolver","autonomousMemoryPipeline","buildIntentContext","chatProgressRequestContext","createConversationKey","executeExplicitConversationMemoryCommand","featureFlags","getConversationHistory","getErrorHeader","intentCommandEngine","internetDecisionRouter","memoryEngine","metricsService","normalizeFocusName","normalizeFocusPath","normalizeIntelligenceProfile","normalizeNoonMode","normalizeSessionId","readJsonBody","recentAutomaticMemoryIds","recentAutomaticMemoryReports","refreshDailyWebSearchUsage","rememberConversation","resolveChatResearchPlan","resolveFocusCatalogSelection","sessionContinuityEngine","toChatProgressEvent","touchConversation","validateAttachment","workspaceEngine"]);

function createAiHttpRoutes(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  return async function handle(req, res, requestPath) {
    const {
      WEB_SEARCH_DAILY_LIMIT,
      askAI,
      attachmentResolver,
      autonomousMemoryPipeline,
      buildIntentContext,
      chatProgressRequestContext,
      createConversationKey,
      executeExplicitConversationMemoryCommand,
      featureFlags,
      getConversationHistory,
      getErrorHeader,
      intentCommandEngine,
      internetDecisionRouter,
      memoryEngine,
      metricsService,
      normalizeFocusName,
      normalizeFocusPath,
      normalizeIntelligenceProfile,
      normalizeNoonMode,
      normalizeSessionId,
      readJsonBody,
      recentAutomaticMemoryIds,
      recentAutomaticMemoryReports,
      refreshDailyWebSearchUsage,
      rememberConversation,
      resolveChatResearchPlan,
      resolveFocusCatalogSelection,
      sessionContinuityEngine,
      toChatProgressEvent,
      touchConversation,
      validateAttachment,
      workspaceEngine,
    } = deps;

    // Confie la question à l'IA, qui peut appeler les outils locaux en lecture seule.
    if (req.method === "POST" && req.url.startsWith("/ai")) {
      const upstreamController = new AbortController();
      const requestStartedAt = Date.now();
      let streamRequested = false;

      const removeAbortListeners = () => {
        req.off("aborted", abortUpstream);
        res.off("close", abortUpstream);
        res.off("finish", removeAbortListeners);
      };

      const abortUpstream = () => {
        if (!res.writableEnded) {
          upstreamController.abort();
        }

        removeAbortListeners();
      };

      req.once("aborted", abortUpstream);
      res.once("close", abortUpstream);
      res.once("finish", removeAbortListeners);

      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        streamRequested = url.pathname === "/ai/stream";
        if (!new Set(["/ai", "/ai/stream"]).has(url.pathname)) {
          res.writeHead(404);
          return res.end(
            JSON.stringify({ status: "error", message: "Route introuvable." })
          );
        }

        const body = await readJsonBody(req);
        const question =
          typeof body.question === "string"
            ? body.question.trim()
            : "";
        let focus = normalizeFocusName(
          typeof body.focus === "string"
            ? body.focus.slice(0, 100)
            : null,
          body.runtimeNetworkState === "OFFLINE" ? "OFFLINE" : "ONLINE"
        );
        const visualDetail =
          body.visualDetail === "high" ? "high" : "low";
        const webSearchPreference = body.webSearchEnabled === true;
        const webSearchForbidden = body.webSearchForbidden === true;
        let webSearchEnabled = false;
        const intelligenceProfile = normalizeIntelligenceProfile(body.intelligenceProfile);
        let maxWebToolCalls = 0;

        let focusPath = normalizeFocusPath(body.focusPath);
        const catalogSelection = resolveFocusCatalogSelection(
          body.focusId,
          body.focusPath
        );
        if (body.focusId) {
          if (!catalogSelection) {
            const error = new Error("Le Focus demandé est indisponible.");
            error.statusCode = 400;
            throw error;
          }
          focus = catalogSelection.name;
          focusPath = catalogSelection.path;
        }
        const mode = normalizeNoonMode(
          body.mode
        );
        const sessionId = normalizeSessionId(
          body.sessionId
        );
        let workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim().slice(0, 160) : null;
        if (workspaceId) {
          workspaceEngine.get(workspaceId);
        } else if (body.focusId && focusPath) {
          workspaceId = workspaceEngine.ensureLegacy({
            legacyId: String(body.focusId),
            name: focus || String(body.focusId),
            rootPath: focusPath,
            type: String(body.focusId).startsWith("projet-") ? "learning" : "project",
          }).id;
          if (workspaceEngine.active()?.id !== workspaceId) workspaceEngine.activate(workspaceId);
        }
        const continuitySession = sessionContinuityEngine.resolveSession({
          conversationId: sessionId,
          workspaceId,
          projectId: focus || null,
          mode,
          channel: "chat",
          profileScope: "arnaud",
        });

        const rawAttachments = Array.isArray(body.attachments)
          ? body.attachments
          : body.attachment
            ? [body.attachment]
            : [];

        if (rawAttachments.length > 3) {
          const error = new Error("Maximum 3 fichiers par question.");
          error.statusCode = 400;
          throw error;
        }

        const attachmentsJsonSize = Buffer.byteLength(
          JSON.stringify(rawAttachments),
          "utf8"
        );

        if (attachmentsJsonSize > 7 * 1024 * 1024) {
          const error = new Error(
            "La taille totale des fichiers est trop importante."
          );
          error.statusCode = 413;
          throw error;
        }

        const attachments = rawAttachments.map(validateAttachment);
        const registeredAttachments = attachmentResolver.registerAttachments({
          conversationId: sessionId,
          sessionId: continuitySession.id,
          attachments,
        });

        const conversationKey = createConversationKey({
          sessionId,
          mode,
          focus,
          focusPath,
        });
        const history = getConversationHistory(
          conversationKey
        );

        if (!question && attachments.length === 0) {
          res.writeHead(400, {
            "Content-Type": "application/json",
          });
          return res.end(
            JSON.stringify({
              status: "error",
              message: "La question est obligatoire.",
            })
          );
        }

        const normalizedIntent = await intentCommandEngine.parse("chat", {
          text: question || "Analyse les fichiers joints.",
          conversationId: sessionId,
          sessionId: continuitySession.id,
          workspaceId,
          locale: body.locale || "fr-FR",
          metadata: { attachmentCount: attachments.length },
        }, buildIntentContext({ sessionId: continuitySession.id, conversationId: sessionId, workspaceId }), {
          allowSemanticFallback: body.allowIntentFallback === true,
          forceSemanticFallback: body.allowIntentFallback === true,
        });
        const internetDecision = internetDecisionRouter.decide({
          query: question || "Analyse les fichiers joints.",
          webAllowed: !webSearchForbidden,
          privacy: attachments.some((item) => item?.sensitivity === "LOCAL_ONLY") ? "LOCAL_ONLY" : "STANDARD",
        });
        const publicResearchFlag = featureFlags.evaluate("research.public.v1", {
          workspaceId, sessionId, channel: "chat",
        });
        const internetResearchPlan = resolveChatResearchPlan({
          internetDecision,
          webSearchPreference,
          publicResearchEnabled: publicResearchFlag.enabled,
          remainingWebCalls: WEB_SEARCH_DAILY_LIMIT - refreshDailyWebSearchUsage().calls,
        });
        webSearchEnabled = internetResearchPlan.execute === true;
        maxWebToolCalls = internetResearchPlan.maxWebToolCalls || 0;
        sessionContinuityEngine.applyIntent(continuitySession.id, normalizedIntent);
        const memoryCommand = executeExplicitConversationMemoryCommand(question, {
          conversationId: sessionId,
          sessionId: continuitySession.id,
          currentAttachments: registeredAttachments,
          projectId: focus || workspaceId || null,
          recentMemoryIds: recentAutomaticMemoryIds.get(sessionId) || [],
          recentMemoryReport: recentAutomaticMemoryReports.get(sessionId) || "",
        });
        if (memoryCommand) {
          const memoryContext = { sourcesUsed: ["structured_memory", "private_memory"], memoryIds: memoryCommand.memoryIds || [], truncated: false };
          sessionContinuityEngine.recordCompletedTurn(continuitySession.id, { channel: "chat", normalizedIntent, executionId: null, approvalIds: [], artifacts: [], messages: [{ role: "user", content: question, state: "completed" }, { role: "assistant", content: memoryCommand.answer, state: "completed" }], lastMessageId: null });
          const response = { status: "ok", assistant: "Noon", question, answer: memoryCommand.answer, workspaceId, sessionId: continuitySession.id, conversationId: sessionId, normalizedIntent, sources: [], artifacts: [], memoryContext, memoryReceipt: memoryCommand.receipt || null };
          if (streamRequested) {
            if (!res.headersSent) res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" });
            res.write(`event: final\ndata: ${JSON.stringify(response)}\n\n`);
            return res.end();
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify(response));
        }
        const continuityContext = {
          ...sessionContinuityEngine.contextForRequest(continuitySession.id),
          version: sessionContinuityEngine.getSession(continuitySession.id).version,
          // Identifiants opaques uniquement : leur source, leur portée et leurs
          // droits sont relus par ContextBuilder avant toute récupération.
          offloadRefIds: Array.isArray(body.offloadRefIds)
            ? [...new Set(body.offloadRefIds.map(String))]
              .filter((id) => /^offload_[a-f0-9]{32}$/.test(id))
              .slice(0, 20)
            : [],
        };

        const executeAskAI = () =>
          askAI(
          question,
          focus,
          focusPath,
          mode,
          history,
          sessionId,
          attachments,
          visualDetail,
          webSearchEnabled,
          maxWebToolCalls,
          intelligenceProfile,
          workspaceId,
          normalizedIntent,
          continuityContext,
          upstreamController.signal,
          streamRequested
            ? (delta) => {
                if (!res.headersSent) {
                  res.writeHead(200, {
                    "Content-Type": "text/event-stream; charset=utf-8",
                    "Cache-Control": "no-cache, no-transform",
                    Connection: "keep-alive",
                  });
                }
                res.write(`event: delta\ndata: ${JSON.stringify({ delta })}\n\n`);
              }
            : null,
          body.runtimeNetworkState === "OFFLINE" ? "OFFLINE" : "ONLINE",
          0,
          internetDecision,
          internetResearchPlan
        );

        const result =
          streamRequested
            ? await chatProgressRequestContext.run(
                {
                  writeProgress(event) {
                    if (
                      res.writableEnded ||
                      res.destroyed
                    ) {
                      return;
                    }

                    const progress =
                      toChatProgressEvent(
                        event
                      );

                    if (!progress) {
                      return;
                    }

                    if (!res.headersSent) {
                      res.writeHead(
                        200,
                        {
                          "Content-Type":
                            "text/event-stream; charset=utf-8",
                          "Cache-Control":
                            "no-cache, no-transform",
                          Connection:
                            "keep-alive",
                        }
                      );
                    }

                    res.write(
                      "event: progress\ndata: "
                      + JSON.stringify({
                        progress,
                      })
                      + "\n\n"
                    );
                  },
                },
                executeAskAI
              )
            : await executeAskAI();

        if (result.status !== "approval_required" && memoryEngine.privateStatus().available && memoryEngine.privateSettings().enabled) {
          const automaticMemory = autonomousMemoryPipeline.process({
            text: question,
            attachments: registeredAttachments,
            projectId: focus || workspaceId || null,
            projectName: focus || null,
          });
          result.memoryReceipt = automaticMemory.receipt;
          if (automaticMemory.notification) result.answer = `${result.answer}\n\n${automaticMemory.notification}`;
          if (automaticMemory.receipt.memoryIds.length) {
            recentAutomaticMemoryIds.set(sessionId, automaticMemory.receipt.memoryIds);
            if (automaticMemory.receipt.success && automaticMemory.notification) recentAutomaticMemoryReports.set(sessionId, automaticMemory.notification);
            memoryEngine.notifyChanged({ store: "private_memory", action: "automatic" });
          }
        }

        metricsService.record("response_time_ms", Date.now() - requestStartedAt, {
          category: "chat",
        });

        sessionContinuityEngine.recordCompletedTurn(continuitySession.id, {
          channel: "chat",
          normalizedIntent,
          executionId: result.executionId || result.execution?.id || null,
          approvalIds: result.approval?.id ? [result.approval.id] : [],
          artifacts: result.artifacts || [],
          messages: result.status === "approval_required" ? [] : [
            { role: "user", content: question, state: "completed" },
            { role: "assistant", content: result.answer, state: "completed" },
          ],
          lastMessageId: result.executionId || null,
        });

        if (result.status !== "approval_required") {
          rememberConversation(
            conversationKey,
            question,
            result.answer,
            result.artifacts || []
          );
          touchConversation(sessionId, question);
          if (workspaceId) {
            workspaceEngine.linkConversation(workspaceId, sessionId);
            for (const artifact of result.artifacts || []) {
              const artifactId = artifact.artifactId || artifact.id;
              if (artifactId) workspaceEngine.linkArtifact(workspaceId, artifactId, focus || null);
            }
          }
          for (const artifact of result.artifacts || []) {
            const artifactId = artifact.artifactId || artifact.id;
            if (artifactId) intentCommandEngine.rememberEntity(sessionId, { type: "artifact", id: artifactId, label: artifact.name || artifact.title || null, workspaceId });
          }
        }

        if (streamRequested) {
          if (!res.headersSent) res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" });
          const currentWebUsage = refreshDailyWebSearchUsage();
          res.write(`event: final\ndata: ${JSON.stringify({ status: result.status === "approval_required" ? "approval_required" : "ok", assistant: "Noon", question, answer: result.answer, workspaceId, sessionId: continuitySession.id, conversationId: sessionId, normalizedIntent, approval: result.approval || null, executionId: result.executionId || result.execution?.id || null, sources: result.sources, research: result.research || null, multimodal: result.multimodal || null, artifacts: result.artifacts || [], memoryContext: result.memoryContext, memoryReceipt: result.memoryReceipt || null, webSearchCalls: result.webSearchCalls, webSearchCostUsd: result.webSearchCostUsd, webSearchUsage: { used: currentWebUsage.calls, limit: WEB_SEARCH_DAILY_LIMIT, remaining: WEB_SEARCH_DAILY_LIMIT - currentWebUsage.calls } })}\n\n`);
          return res.end();
        }

        res.writeHead(200, {
          "Content-Type": "application/json",
        });
        return res.end(
          JSON.stringify(
            {
              status: result.status === "approval_required" ? "approval_required" : "ok",
              assistant: "Noon",
              question,
              answer: result.answer,
              workspaceId,
              sessionId: continuitySession.id,
              conversationId: sessionId,
              normalizedIntent,
              approval: result.approval || null,
              executionId: result.executionId || result.execution?.id || null,
              sources: result.sources,
              research: result.research || null,
              multimodal: result.multimodal || null,
              artifacts: result.artifacts || [],
              memoryContext: result.memoryContext,
              memoryReceipt: result.memoryReceipt || null,
              webSearchCalls: result.webSearchCalls,
              webSearchCostUsd: result.webSearchCostUsd,
              webSearchUsage: {
                used: refreshDailyWebSearchUsage().calls,
                limit: WEB_SEARCH_DAILY_LIMIT,
                remaining:
                  WEB_SEARCH_DAILY_LIMIT -
                  refreshDailyWebSearchUsage().calls,
              },
            },
            null,
            2
          )
        );
      } catch (error) {
        if (upstreamController.signal.aborted) {
          return;
        }

        const statusCode =
          Number(error.status) ||
          Number(error.statusCode) ||
          500;
        const errorCode = error.code || null;
        const permanentRateLimitCodes = [
          "credit_balance_exhausted",
          "organization_spend_limit_exceeded",
          "project_spend_limit_exceeded",
          "organization_usage_limit_exceeded",
          "WEB_SEARCH_DAILY_LIMIT",
        ];
        const isTemporaryRateLimit =
          statusCode === 429 &&
          !permanentRateLimitCodes.includes(errorCode);

        let retryAfter = null;

        if (isTemporaryRateLimit) {
          const retryAfterHeader =
            getErrorHeader(error, "retry-after");
          const parsedRetryAfter = Number(retryAfterHeader);

          retryAfter =
            Number.isFinite(parsedRetryAfter) &&
            parsedRetryAfter > 0
              ? Math.ceil(parsedRetryAfter)
              : 20;
        }

        if (streamRequested && res.headersSent) {
          res.write(`event: error\ndata: ${JSON.stringify({ message: error.message, errorCode, retryable: isTemporaryRateLimit, retryAfter })}\n\n`);
          return res.end();
        }

        const responseHeaders = {
          "Content-Type": "application/json",
        };

        if (retryAfter) {
          responseHeaders["Retry-After"] = String(retryAfter);
        }

        res.writeHead(statusCode, responseHeaders);
        return res.end(
          JSON.stringify({
            status: "error",
            message: error.message,
            errorCode,
            retryable: isTemporaryRateLimit,
            retryAfter,
          })
        );
      }
    }

    return NOT_HANDLED;
  };
}

module.exports = { DEPENDENCIES, createAiHttpRoutes };
