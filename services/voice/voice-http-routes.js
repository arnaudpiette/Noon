"use strict";

// V3-L7 — routes vocales, sorties de server.js : session Realtime, usage, tours, outils,
// budget, identité vocale et synthèse (TTS).
// Bloc déplacé tel quel depuis server.js ; ses dépendances sont lues à chaque requête
// (accesseurs), ce qui préserve les variables initialisées plus tard au démarrage.

const { NOT_HANDLED } = require("../http/route-result");
const { CHILD_ALLOWED_TOOLS, createLiveSpeakerRegistry } = require("./live-speakers");

const DEPENDENCIES = Object.freeze(["REALTIME_IDLE_TIMEOUT_MS","REALTIME_MAX_SESSION_MS","REALTIME_MODELS","WEB_SEARCH_DAILY_LIMIT","WEB_SEARCH_MAX_PER_REQUEST","askAI","assertRemoteVoiceAvailable","autonomousMemoryPipeline","buildIntentContext","createConversationKey","crypto","executeExplicitConversationMemoryCommand","getBudgetStatus","getConversationHistory","getValidRegisteredProjects","getVoiceBudgetStatus","intentCommandEngine","localIntelligenceRuntime","memoryEngine","modelForQuality","normalizeAccent","normalizeFocusName","normalizeFocusPath","normalizeLanguage","normalizeNoonMode","normalizeSessionId","normalizeVoiceQuality","readJsonBody","readTextBody","realtimeVoiceConfig","recentAutomaticMemoryIds","recentAutomaticMemoryReports","refreshDailyWebSearchUsage","registerRealtimeUsage","rememberConversation","rememberedRealtimeTurns","resolveFocusCatalogSelection","resolveFocusProject","resolveProject","scanRegisteredProjects","sessionContinuityEngine","touchConversation","voiceIdentity","workspaceEngine"]);

function createVoiceHttpRoutes(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  // Personne déclarée dans chaque session Live (voir live-speakers.js) ; remise à zéro à chaque session.
  const liveSpeakers = createLiveSpeakerRegistry();
  return async function handle(req, res, requestPath) {
    const {
      REALTIME_IDLE_TIMEOUT_MS,
      REALTIME_MAX_SESSION_MS,
      REALTIME_MODELS,
      WEB_SEARCH_DAILY_LIMIT,
      WEB_SEARCH_MAX_PER_REQUEST,
      askAI,
      assertRemoteVoiceAvailable,
      autonomousMemoryPipeline,
      buildIntentContext,
      createConversationKey,
      crypto,
      executeExplicitConversationMemoryCommand,
      getBudgetStatus,
      getConversationHistory,
      getValidRegisteredProjects,
      getVoiceBudgetStatus,
      intentCommandEngine,
      localIntelligenceRuntime,
      memoryEngine,
      modelForQuality,
      normalizeAccent,
      normalizeFocusName,
      normalizeFocusPath,
      normalizeLanguage,
      normalizeNoonMode,
      normalizeSessionId,
      normalizeVoiceQuality,
      readJsonBody,
      readTextBody,
      realtimeVoiceConfig,
      recentAutomaticMemoryIds,
      recentAutomaticMemoryReports,
      refreshDailyWebSearchUsage,
      registerRealtimeUsage,
      rememberConversation,
      rememberedRealtimeTurns,
      resolveFocusCatalogSelection,
      resolveFocusProject,
      resolveProject,
      scanRegisteredProjects,
      sessionContinuityEngine,
      touchConversation,
      voiceIdentity,
      workspaceEngine,
    } = deps;

    // Indique l’état du serveur et du budget sans contacter OpenAI.
    if (
      req.method === "POST" &&
      req.url.startsWith("/realtime/session")
    ) {
      try {
        if (req.headers["x-noon-request"] !== "1") {
          const error = new Error("Requête Noon refusée.");
          error.statusCode = 403;
          throw error;
        }
        assertRemoteVoiceAvailable(localIntelligenceRuntime, "REMOTE_REALTIME");

        const voiceBudget = getVoiceBudgetStatus();
        if (voiceBudget.state === "BLOCKED") {
          const error = new Error(
            "Le budget vocal mensuel est atteint. Continue en mode texte."
          );
          error.statusCode = 429;
          error.code = "VOICE_BUDGET_BLOCKED";
          throw error;
        }

        const url = new URL(req.url, `http://${req.headers.host}`);
        const quality = normalizeVoiceQuality(url.searchParams.get("quality"));
        const model = modelForQuality(quality);
        const voiceSessionId = voiceIdentity.createSessionId();
        const generalBudget = getBudgetStatus();

        if (
          quality === "max" &&
          (generalBudget.mode !== "NORMAL" ||
            voiceBudget.state === "PROTECTION")
        ) {
          const error = new Error(
            "La Qualité Max est désactivée par le mode de protection budgétaire."
          );
          error.statusCode = 409;
          error.code = "VOICE_MAX_DISABLED";
          throw error;
        }

        if (
          quality === "max" &&
          url.searchParams.get("confirmMax") !== "true"
        ) {
          const error = new Error(
            "La Qualité Max doit être confirmée avant chaque session."
          );
          error.statusCode = 409;
          error.code = "VOICE_MAX_CONFIRMATION_REQUIRED";
          throw error;
        }

        const sessionId = normalizeSessionId(url.searchParams.get("sessionId"));
        liveSpeakers.start(sessionId);
        const mode = normalizeNoonMode(url.searchParams.get("mode"));
        let focus = normalizeFocusName(url.searchParams.get("focus"));
        let focusPath = normalizeFocusPath(url.searchParams.get("focusPath"));
        const catalogSelection = resolveFocusCatalogSelection(
          url.searchParams.get("focusId"),
          url.searchParams.get("focusPath")
        );
        if (url.searchParams.get("focusId")) {
          if (!catalogSelection) {
            const error = new Error("Le Focus demandé est indisponible.");
            error.statusCode = 400;
            throw error;
          }
          focus = catalogSelection.name;
          focusPath = catalogSelection.path;
        }
        let workspaceId = null;
        if (url.searchParams.get("focusId") && focusPath) {
          const focusId = String(url.searchParams.get("focusId"));
          workspaceId = workspaceEngine.ensureLegacy({
            legacyId: focusId,
            name: focus || focusId,
            rootPath: focusPath,
            type: focusId.startsWith("projet-") ? "learning" : "project",
          }).id;
        }
        const continuitySession = sessionContinuityEngine.resolveSession({
          conversationId: sessionId,
          workspaceId,
          projectId: focus || null,
          mode,
          channel: "voice",
          profileScope: "arnaud",
        });
        const language = normalizeLanguage(url.searchParams.get("language"));
        const accent = normalizeAccent(url.searchParams.get("accent"));
        const resolvedVoice = voiceIdentity.resolve({ pipeline: "realtime", language, accent, model });
        voiceIdentity.assertAvailable(resolvedVoice);
        const conversationKey = createConversationKey({
          sessionId,
          mode,
          focus,
          focusPath,
        });
        const history = getConversationHistory(conversationKey);
        const sdp = await readTextBody(req);

        if (!sdp.startsWith("v=0")) {
          const error = new Error("L’offre WebRTC est invalide.");
          error.statusCode = 400;
          throw error;
        }

        const sessionConfig = {
          type: "realtime",
          model,
          output_modalities: ["audio"],
          reasoning: { effort: "low" },
          audio: {
            input: {
              transcription: {
                model: "gpt-4o-mini-transcribe",
                ...(language === "auto" ? {} : { language }),
              },
              turn_detection: {
                type: "semantic_vad",
                eagerness: "auto",
                create_response: true,
                interrupt_response: true,
              },
            },
            output: { voice: resolvedVoice.voice },
          },
          instructions: realtimeVoiceConfig.buildInstructions({
            language,
            accent,
            mode,
            focus,
            focusPath,
            history,
          }),
          tools: realtimeVoiceConfig.tools,
          tool_choice: "auto",
          truncation: {
            type: "retention_ratio",
            retention_ratio: 0.8,
            token_limits: { post_instructions: 8000 },
          },
        };
        const form = new FormData();
        form.set("sdp", sdp);
        form.set("session", JSON.stringify(sessionConfig));
        const safetyIdentifier = crypto
          .createHash("sha256")
          .update(sessionId)
          .digest("hex");
        const upstream = await fetch(
          "https://api.openai.com/v1/realtime/calls",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              "OpenAI-Safety-Identifier": safetyIdentifier,
            },
            body: form,
          }
        );
        const answerSdp = await upstream.text();

        if (!upstream.ok) {
          const error = new Error("Impossible d’ouvrir la conversation Live.");
          error.statusCode = upstream.status;
          error.code = "PROVIDER_UNAVAILABLE";
          throw error;
        }

        res.writeHead(200, {
          "Content-Type": "application/sdp",
          "Cache-Control": "no-store",
          "X-Noon-Voice-Model": model,
          "X-Noon-Voice-Identity": resolvedVoice.identityId,
          "X-Noon-Voice": resolvedVoice.voice,
          "X-Noon-Voice-Status": resolvedVoice.status,
          "X-Noon-Voice-Session": voiceSessionId,
          "X-Noon-Session": continuitySession.id,
          "X-Noon-Conversation": sessionId,
          "X-Voice-Identity-Resolve-Ms": String(resolvedVoice.voiceIdentityResolveMs),
          "X-Noon-Max-Session-Ms": String(REALTIME_MAX_SESSION_MS),
          "X-Noon-Idle-Timeout-Ms": String(REALTIME_IDLE_TIMEOUT_MS),
        });
        return res.end(answerSdp);
      } catch (error) {
        res.writeHead(error.statusCode || 500, {
          "Content-Type": "application/json",
        });
        return res.end(JSON.stringify({
          status: "error",
          code: error.code || null,
          message: error.message,
        }));
      }
    }

    if (req.method === "POST" && req.url === "/realtime/usage") {
      try {
        if (req.headers["x-noon-request"] !== "1") {
          const error = new Error("Requête Noon refusée.");
          error.statusCode = 403;
          throw error;
        }
        const body = await readJsonBody(req, 128 * 1024);
        const sessionId = normalizeSessionId(body.sessionId);
        const model = [REALTIME_MODELS.mini, REALTIME_MODELS.max]
          .includes(body.model)
          ? body.model
          : REALTIME_MODELS.mini;
        const result = registerRealtimeUsage({
          sessionId,
          responseId: body.responseId,
          model,
          usage: body.usage || {},
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "ok", ...result }));
      } catch (error) {
        res.writeHead(error.statusCode || 400);
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (req.method === "POST" && req.url === "/realtime/turn") {
      try {
        if (req.headers["x-noon-request"] !== "1") {
          const error = new Error("Requête Noon refusée.");
          error.statusCode = 403;
          throw error;
        }
        const body = await readJsonBody(req, 64 * 1024);
        const turnId = String(body.turnId || "").slice(0, 120);
        const question = String(body.question || "").trim().slice(0, 4000);
        const answer = String(body.answer || "").trim().slice(0, 4000);

        if (!turnId || !question || !answer) {
          const error = new Error("Tour vocal incomplet.");
          error.statusCode = 400;
          throw error;
        }

        if (!rememberedRealtimeTurns.has(turnId)) {
          const sessionId = normalizeSessionId(body.sessionId);
          const mode = normalizeNoonMode(body.mode);
          let focus = normalizeFocusName(body.focus);
          let focusPath = normalizeFocusPath(body.focusPath);
          const catalogSelection = resolveFocusCatalogSelection(
            body.focusId,
            body.focusPath
          );
          if (catalogSelection) {
            focus = catalogSelection.name;
            focusPath = catalogSelection.path;
          }
          const key = createConversationKey({ sessionId, mode, focus, focusPath });
          rememberConversation(key, question, answer);
          touchConversation(sessionId, question);
          let workspaceId = null;
          if (body.focusId && focusPath) {
            const focusId = String(body.focusId);
            workspaceId = workspaceEngine.ensureLegacy({
              legacyId: focusId,
              name: focus || focusId,
              rootPath: focusPath,
              type: focusId.startsWith("projet-") ? "learning" : "project",
            }).id;
          }
          const continuitySession = sessionContinuityEngine.resolveSession({
            conversationId: sessionId,
            workspaceId,
            projectId: focus || null,
            mode,
            channel: "voice",
            profileScope: "arnaud",
          });
          sessionContinuityEngine.recordCompletedTurn(continuitySession.id, {
            channel: "voice",
            messages: [
              { role: "user", content: question, state: "completed" },
              { role: "assistant", content: answer, state: "completed" },
            ],
            lastMessageId: turnId,
          });
          rememberedRealtimeTurns.add(turnId);
          if (rememberedRealtimeTurns.size > 1000) {
            rememberedRealtimeTurns.delete(rememberedRealtimeTurns.values().next().value);
          }
        }

        res.writeHead(200);
        return res.end(JSON.stringify({ status: "ok" }));
      } catch (error) {
        res.writeHead(error.statusCode || 400);
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (req.method === "POST" && req.url === "/realtime/tool") {
      try {
        if (req.headers["x-noon-request"] !== "1") {
          const error = new Error("Requête Noon refusée.");
          error.statusCode = 403;
          throw error;
        }
        const body = await readJsonBody(req, 128 * 1024);
        const name = String(body.name || "");
        const args = body.arguments && typeof body.arguments === "object"
          ? body.arguments
          : {};
        const liveSessionId = normalizeSessionId(body.sessionId);

        // Un enfant parle : aucun outil ne touche aux données ou réglages d'Arnaud.
        if (liveSpeakers.isChildSession(liveSessionId) && !CHILD_ALLOWED_TOOLS.includes(name)) {
          res.writeHead(200);
          return res.end(JSON.stringify({
            status: "restricted",
            message: "Accès fermé : un enfant parle. Réponds sans aucune donnée privée d'Arnaud, avec des connaissances générales adaptées à son âge.",
          }));
        }

        if (name === "set_noon_speaker") {
          const declared = liveSpeakers.declare(liveSessionId, args.speaker);
          res.writeHead(200);
          return res.end(JSON.stringify({
            status: "ok",
            speaker: declared.label,
            say: declared.kept ? null : declared.greeting,
            restricted: declared.child,
            message: declared.kept
              ? "Un enfant a été identifié dans cette session : l'accès reste fermé jusqu'à la prochaine session Live."
              : declared.greeting ? "Prononce la phrase « say » mot pour mot." : "Personne enregistrée.",
            clientAction: declared.child
              ? {
                type: "restrictLiveSession",
                instructions: realtimeVoiceConfig.buildChildInstructions({ speaker: declared }),
                tools: realtimeVoiceConfig.childTools,
              }
              : null,
          }));
        }

        if (name === "set_noon_mode") {
          const mode = normalizeNoonMode(args.mode);
          await intentCommandEngine.parse("voice", { transcript: `mode ${mode}`, sessionId: body.sessionId, structured: { action: "set_mode", mode } }, buildIntentContext({ sessionId: normalizeSessionId(body.sessionId) }));
          res.writeHead(200);
          return res.end(JSON.stringify({
            status: "ok",
            message: `Mode ${mode} activé.`,
            clientAction: { type: "setMode", mode },
          }));
        }

        if (name === "set_noon_focus") {
          await intentCommandEngine.parse("voice", { transcript: args.clear ? "retire le focus" : `passe sur ${String(args.query || "")}`, sessionId: body.sessionId }, buildIntentContext({ sessionId: normalizeSessionId(body.sessionId) }));
          const result = args.clear
            ? { status: "cleared", project: null }
            : resolveFocusProject(args.query);
          res.writeHead(200);
          return res.end(JSON.stringify({
            status: "ok",
            result,
            clientAction:
              result.status === "resolved" || result.status === "cleared"
                ? { type: "setFocus", project: result.project }
                : null,
          }));
        }

        if (name === "set_noon_voice_style") {
          const language = normalizeLanguage(args.language);
          const accent = normalizeAccent(args.accent);
          res.writeHead(200);
          return res.end(JSON.stringify({
            status: "ok",
            message: "Style vocal mis à jour.",
            clientAction: { type: "setVoiceStyle", language, accent },
          }));
        }

        if (name === "manage_noon_projects") {
          const action = String(args.action || "");
          if (action === "scan") {
            const projects = scanRegisteredProjects();
            res.writeHead(200);
            return res.end(JSON.stringify({
              status: "ok",
              message: `${projects.length} projet(s) détecté(s).`,
              projects: projects.map(({ id, name, parentFocusName }) => ({ id, name, parentFocusName })),
              clientAction: { type: "refreshProjects" },
            }));
          }
          if (action === "list") {
            const projects = getValidRegisteredProjects();
            res.writeHead(200);
            return res.end(JSON.stringify({
              status: "ok",
              count: projects.length,
              projects: projects.map(({ id, name, parentFocusName }) => ({ id, name, parentFocusName })),
            }));
          }
          if (action === "find") {
            const result = resolveProject(args.query, getValidRegisteredProjects());
            res.writeHead(200);
            return res.end(JSON.stringify({ status: "ok", result }));
          }
          const error = new Error("Action projet non autorisée.");
          error.statusCode = 400;
          throw error;
        }

        if (name === "ask_noon_brain") {
          const question = String(args.question || "").trim().slice(0, 4000);
          if (!question) throw new Error("Question vocale vide.");
          const sessionId = normalizeSessionId(body.sessionId);
          const mode = normalizeNoonMode(body.mode);
          let focus = normalizeFocusName(body.focus);
          let focusPath = normalizeFocusPath(body.focusPath);
          const catalogSelection = resolveFocusCatalogSelection(
            body.focusId,
            body.focusPath
          );
          if (catalogSelection) {
            focus = catalogSelection.name;
            focusPath = catalogSelection.path;
          }
          const key = createConversationKey({ sessionId, mode, focus, focusPath });
          const history = getConversationHistory(key);
          const webSearchEnabled = args.webSearch === true;
          const currentWebUsage = refreshDailyWebSearchUsage();
          if (
            webSearchEnabled &&
            currentWebUsage.calls >= WEB_SEARCH_DAILY_LIMIT
          ) {
            const error = new Error(
              "La limite quotidienne de recherche Internet est atteinte."
            );
            error.statusCode = 429;
            throw error;
          }
          const maxWebCalls = webSearchEnabled
            ? Math.min(
                WEB_SEARCH_MAX_PER_REQUEST,
                WEB_SEARCH_DAILY_LIMIT - currentWebUsage.calls
              )
            : 0;
          let workspaceId = null;
          if (body.focusId && focusPath) {
            workspaceId = workspaceEngine.ensureLegacy({ legacyId: String(body.focusId), name: focus || String(body.focusId), rootPath: focusPath, type: String(body.focusId).startsWith("projet-") ? "learning" : "project" }).id;
          }
          const continuitySession = sessionContinuityEngine.resolveSession({
            conversationId: sessionId, workspaceId, projectId: focus || null,
            mode, channel: "voice", profileScope: "arnaud",
          });
          const normalizedIntent = await intentCommandEngine.parse("voice", {
            transcript: question, conversationId: sessionId,
            sessionId: continuitySession.id, workspaceId,
          }, buildIntentContext({ sessionId: continuitySession.id, conversationId: sessionId, workspaceId }));
          sessionContinuityEngine.applyIntent(continuitySession.id, normalizedIntent);
          const memoryCommand = executeExplicitConversationMemoryCommand(question, { projectId: focus || workspaceId || null, recentMemoryIds: recentAutomaticMemoryIds.get(sessionId) || [], recentMemoryReport: recentAutomaticMemoryReports.get(sessionId) || "" });
          if (memoryCommand) {
            const memoryContext = { sourcesUsed: ["private_memory"], memoryIds: memoryCommand.memoryIds || [], truncated: false };
            sessionContinuityEngine.recordCompletedTurn(continuitySession.id, { channel: "voice", normalizedIntent, executionId: null, approvalIds: [], artifacts: [], messages: [{ role: "user", content: question, state: "completed" }, { role: "assistant", content: memoryCommand.answer, state: "completed" }], lastMessageId: null });
            res.writeHead(200);
            return res.end(JSON.stringify({ status: "ok", answer: memoryCommand.answer, sessionId: continuitySession.id, conversationId: sessionId, sources: [], artifacts: [], memoryContext, memoryReceipt: memoryCommand.receipt || null, clientAction: { type: "brainAnswer", question, answer: memoryCommand.answer, sources: [], artifacts: [] } }));
          }
          const continuityContext = {
            ...sessionContinuityEngine.contextForRequest(continuitySession.id),
            version: sessionContinuityEngine.getSession(continuitySession.id).version,
          };
          const result = await askAI(
            question,
            focus,
            focusPath,
            mode,
            history,
            sessionId,
            [],
            "low",
            webSearchEnabled,
            maxWebCalls,
            "balanced",
            workspaceId,
            normalizedIntent,
            continuityContext
          );
          if (result.status !== "approval_required" && memoryEngine.privateStatus().available && memoryEngine.privateSettings().enabled) {
            const automaticMemory = autonomousMemoryPipeline.process({ text: question, projectId: focus || workspaceId || null, projectName: focus || null });
            result.memoryReceipt = automaticMemory.receipt;
            if (automaticMemory.notification) result.answer = `${result.answer}\n\n${automaticMemory.notification}`;
            if (automaticMemory.receipt.memoryIds.length) {
              recentAutomaticMemoryIds.set(sessionId, automaticMemory.receipt.memoryIds);
              if (automaticMemory.receipt.success && automaticMemory.notification) recentAutomaticMemoryReports.set(sessionId, automaticMemory.notification);
              memoryEngine.notifyChanged({ store: "private_memory", action: "automatic" });
            }
          }
          sessionContinuityEngine.recordCompletedTurn(continuitySession.id, {
            channel: "voice", normalizedIntent,
            executionId: result.executionId || null,
            approvalIds: result.approval?.id ? [result.approval.id] : [],
            artifacts: result.artifacts || [],
            messages: result.status === "approval_required" ? [] : [
              { role: "user", content: question, state: "completed" },
              { role: "assistant", content: result.answer, state: "completed" },
            ],
            lastMessageId: result.executionId || null,
          });
          res.writeHead(200);
          return res.end(JSON.stringify({
            status: result.status === "approval_required" ? "approval_required" : "ok",
            answer: result.answer,
            approval: result.approval || null,
            executionId: result.executionId || null,
            sessionId: continuitySession.id,
            conversationId: sessionId,
            sources: result.sources,
            artifacts: result.artifacts || [],
            memoryReceipt: result.memoryReceipt || null,
            clientAction: {
              type: "brainAnswer",
              question,
              answer: result.answer,
              sources: result.sources,
              artifacts: result.artifacts || [],
              approval: result.approval || null,
              executionId: result.executionId || null,
            },
          }));
        }

        const error = new Error("Outil vocal non autorisé.");
        error.statusCode = 400;
        throw error;
      } catch (error) {
        res.writeHead(error.statusCode || 500);
        return res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    }

    if (req.method === "GET" && req.url === "/realtime/budget") {
      res.writeHead(200, { "Cache-Control": "no-store" });
      return res.end(JSON.stringify({
        status: "ok",
        budget: getVoiceBudgetStatus(),
      }));
    }

    if (req.method === "GET" && req.url.startsWith("/voice/identity")) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pipeline = url.searchParams.get("pipeline") === "realtime" ? "realtime" : "tts";
      const language = normalizeLanguage(url.searchParams.get("language"));
      const accent = normalizeAccent(url.searchParams.get("accent"));
      const resolved = voiceIdentity.resolve({ pipeline, language, accent, model: url.searchParams.get("model") || null });
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ status: "ok", identity: voiceIdentity.publicConfig(), resolved }));
    }

    if (req.method === "POST" && req.url === "/tts") {
      try {
        if (req.headers["x-noon-request"] !== "1") {
          const error = new Error("Requête Noon refusée.");
          error.statusCode = 403;
          throw error;
        }
        assertRemoteVoiceAvailable(localIntelligenceRuntime, "REMOTE_REALTIME");
        const body = await readJsonBody(req, 32 * 1024);
        const input = String(body.text || "").trim().slice(0, 700);
        if (!input) {
          const error = new Error("Texte vocal vide.");
          error.statusCode = 400;
          throw error;
        }
        const language = normalizeLanguage(body.language, "fr-FR");
        const accent = normalizeAccent(body.accent);
        const mode = normalizeNoonMode(body.mode);
        const identityStartedAt = Date.now();
        const resolvedVoice = voiceIdentity.resolve({ pipeline: "tts", language, accent });
        voiceIdentity.assertAvailable(resolvedVoice);
        const instructions = [
          resolvedVoice.styleInstructions,
          mode === "DEV" ? "Ton technique mais chaleureux." : "Ton créatif, chaleureux et naturel.",
        ].join(" ");
        let upstream;
        let selectedAttempt = null;
        const ttsStartedAt = Date.now();

        for (const attempt of voiceIdentity.attempts(resolvedVoice)) {
          upstream = await fetch("https://api.openai.com/v1/audio/speech", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4o-mini-tts",
              voice: attempt.voice,
              input,
              instructions,
              response_format: "pcm",
            }),
          });
          if (upstream.ok) {
            selectedAttempt = attempt;
            if (attempt.fallback) voiceIdentity.traceFallback(resolvedVoice, "primary_provider_error");
            break;
          }
        }

        if (!upstream?.ok || !upstream.body) {
          const error = new Error("La voix OpenAI est indisponible.");
          error.statusCode = upstream?.status || 502;
          throw error;
        }

        res.writeHead(200, {
          "Content-Type": "audio/pcm",
          "Cache-Control": "no-store",
          "X-Audio-Sample-Rate": "24000",
          "X-Noon-Voice-Identity": resolvedVoice.identityId,
          "X-Noon-Voice": selectedAttempt.voice,
          "X-Noon-Voice-Fallback": String(selectedAttempt.fallback),
          "X-Voice-Identity-Resolve-Ms": String(Date.now() - identityStartedAt),
          "X-TTS-Start-Ms": String(Date.now() - ttsStartedAt),
        });
        const reader = upstream.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.write(Buffer.from(value))) {
            await new Promise((resolve) => res.once("drain", resolve));
          }
        }
        return res.end();
      } catch (error) {
        if (res.headersSent) return res.destroy();
        res.writeHead(error.statusCode || 500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ status: "error", code: error.code || null, message: error.message }));
      }
    }

    return NOT_HANDLED;
  };
}

module.exports = { DEPENDENCIES, createVoiceHttpRoutes };
