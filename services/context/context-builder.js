"use strict";

// Le Context Builder orchestre les sources existantes. Il ne stocke aucune
// donnée et ne contourne jamais MemoryEngine pour consulter une mémoire.

const { createContextCache } = require("./context-cache");

const DEFAULT_TOKEN_BUDGETS = Object.freeze({
  chat: 6000,
  live_voice: 1600,
  brief: 8000,
  background: 5000,
  project: 6000,
});

function textValue(value) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value ?? ""); } catch { return ""; }
}

function estimateTokens(value) {
  return Math.ceil(textValue(value).length / 4);
}

function normalize(value) {
  return textValue(value)
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function inferPeopleIds(query, requested = []) {
  const ids = new Set((requested || []).map(String));
  const text = normalize(query);
  if (/\barnaud\b/.test(text)) ids.add("arnaud");
  if (/\b(alexandra|alex)\b/.test(text)) ids.add("alexandra");
  if (/\bsinan\b/.test(text)) ids.add("sinan");
  if (/\bkaan\b/.test(text)) ids.add("kaan");
  if (/\b(foyer|famille)\b/.test(text)) ids.add("household");
  if (/\bnoon\b/.test(text)) ids.add("noon");
  return [...ids];
}

function deduplicate(items, keyOf, seen, metadata) {
  const kept = [];
  for (const item of items || []) {
    const key = normalize(keyOf(item));
    if (!key) continue;
    const duplicate = [...seen].some((existing) =>
      existing === key || (key.length > 30 && (existing.includes(key) || key.includes(existing)))
    );
    if (duplicate) {
      metadata.deduplicated += 1;
      continue;
    }
    seen.add(key);
    kept.push(item);
  }
  return kept;
}

function createContextBuilder({
  personalityProvider,
  hardRulesRegistry,
  memoryEngine,
  conversationProvider = null,
  workspaceProvider = null,
  ambientContextProvider = null,
  goalContextProvider = null,
  permissionsProvider = () => [],
  cache = createContextCache(),
  debug = null,
} = {}) {
  if (typeof personalityProvider !== "function") throw new TypeError("personalityProvider est requis.");
  if (!hardRulesRegistry?.getRulesForContext) throw new TypeError("hardRulesRegistry est requis.");
  if (!memoryEngine?.getRelevantContext) throw new TypeError("memoryEngine est requis.");

  function buildContext(input = {}) {
    const startedAt = performance.now();
    const query = String(input.query || "").trim();
    const channel = String(input.channel || "chat");
    const intent = String(input.intent || hardRulesRegistry.inferIntent(query, input.projectId));
    const peopleIds = inferPeopleIds(query, input.peopleIds);
    const requestedTools = [...new Set((input.requestedTools || []).map(String))];
    const workspaceContext = input.workspaceContext || (
      input.workspaceId && typeof workspaceProvider === "function"
        ? workspaceProvider(input.workspaceId)
        : null
    );
    const maxContextTokens = Math.max(
      256,
      Math.min(32_000, Number(input.maxContextTokens) || DEFAULT_TOKEN_BUDGETS[channel] || 6000)
    );
    const versions = {
      static: String(input.hardRulesVersion || hardRulesRegistry.version?.() || "rules-1"),
      session: String(input.sessionVersion || "0"),
      project: String(input.workspaceVersion || input.projectVersion || workspaceContext?.workspace?.updatedAt || "0"),
      memory: String(input.memoryVersion || "0"),
      permissions: String(input.permissionsVersion || "0"),
      tools: String(input.toolsVersion || "0"),
    };
    const cacheEvents = {};
    function cached(segment, descriptor, build, options) {
      try {
        const result = cache.getOrCreate(segment, descriptor, build, options);
        cacheEvents[segment] = {
          hit: result.hit,
          keyHash: result.keyHash,
          ageMs: result.ageMs,
          buildMs: result.buildMs,
        };
        return result.value;
      } catch (error) {
        cacheEvents[segment] = { hit: false, fallback: true, code: String(error?.code || error?.name || "CACHE_ERROR").slice(0, 60) };
        return build();
      }
    }
    const memoryStartedAt = performance.now();
    const memoryDescriptor = {
      query: normalize(query), intent, projectId: input.projectId || null, peopleIds,
      conversationId: input.conversationId || null,
      confirmedMemoryIds: [...(input.confirmedMemoryIds || [])].map(String).sort(),
      includePrivate: input.includePrivate !== false,
      includeConversation: input.includeConversation !== false,
      purpose: input.purpose || "remote_model", channel, maxContextTokens,
      versions: { memory: versions.memory, session: versions.session, project: versions.project },
    };
    const cachedMemoryResult = cached("memory", memoryDescriptor, () => memoryEngine.getRelevantContext({
      query,
      intent,
      projectId: input.projectId || null,
      peopleIds,
      conversationId: input.conversationId || null,
      confirmedMemoryIds: input.confirmedMemoryIds || [],
      includePrivate: input.includePrivate !== false,
      includeConversation: conversationProvider ? false : input.includeConversation !== false,
      includeHardRules: false,
      purpose: input.purpose || "remote_model",
      channel,
      maxItems: channel === "live_voice" ? 5 : 12,
      maxCharacters: Math.max(800, Math.floor(maxContextTokens * 2.4)),
      conversationLimit: channel === "live_voice" ? 4 : 12,
    }), {
      ttlMs: Math.max(100, Math.min(10_000, Number(input.memoryCacheTtlMs) || 1500)),
      copyOnRead: false,
      scope: { sessionId: input.conversationId || null, projectId: input.projectId || null, profileIds: peopleIds },
    });
    let conversationContext = cachedMemoryResult.conversationContext || [];
    if (conversationProvider && input.includeConversation !== false && input.conversationId) {
      try {
        conversationContext = (conversationProvider({
          conversationId: input.conversationId,
          limit: channel === "live_voice" ? 4 : 12,
        }) || []).slice(-(channel === "live_voice" ? 4 : 12)).map((message, index) => ({
          id: message.id || `${input.conversationId}:${index}`,
          value: message.content,
          role: message.role,
          source: "conversation_memory",
          updatedAt: message.updatedAt || null,
          allowedForRemoteModel: true,
        }));
      } catch {
        conversationContext = [];
      }
    }
    const memoryResult = { ...cachedMemoryResult, conversationContext };
    const memoryRetrievalMs = performance.now() - memoryStartedAt;
    const staticStartedAt = performance.now();
    const staticSegment = cached("static", {
      version: versions.static, channel, intent, mode: input.mode || null,
      project: Boolean(input.projectId), tools: requestedTools,
    }, () => ({
      hardRules: hardRulesRegistry.getRulesForContext({
        intent, tools: requestedTools, mode: input.mode, projectId: input.projectId, channel,
      }),
      personality: String(personalityProvider({ channel, intent, mode: input.mode }) || "").trim(),
    }), { scope: { version: versions.static }, copyOnRead: false });
    const hardRules = staticSegment.hardRules;
    const personality = staticSegment.personality;
    const hardRulesResolveMs = performance.now() - staticStartedAt;
    const permissions = cached("dynamic", {
      intent, requestedTools, projectId: input.projectId || null,
      conversationId: input.conversationId || null, version: versions.permissions,
    }, () => permissionsProvider({
      intent, requestedTools, projectId: input.projectId || null,
    }) || [], {
      ttlMs: Math.max(100, Math.min(5_000, Number(input.dynamicCacheTtlMs) || 500)),
      copyOnRead: false,
      scope: { sessionId: input.conversationId || null, projectId: input.projectId || null },
    });
    const toolSegment = requestedTools.length > 0
      ? cached("tools", {
        intent, channel, mode: input.mode || null, requestedTools, version: versions.tools,
      }, () => ({ requested: requestedTools }), { scope: { sessionId: input.conversationId || null }, copyOnRead: false })
      : (cacheEvents.tools = { skipped: true }, { requested: [] });
    const hasSessionState = Boolean(
      input.conversationId || input.mode || input.projectId || input.modelProfile || input.sessionContext
    );
    const continuity = input.sessionContext && typeof input.sessionContext === "object"
      ? input.sessionContext
      : {};
    const sessionSegment = hasSessionState ? cached("session", {
      conversationId: input.conversationId || null,
      version: versions.session,
      mode: input.mode || null,
      channel,
      purpose: input.purpose || "remote_model",
      modelProfile: input.modelProfile || null,
      projectId: input.projectId || null,
      continuityVersion: Number(input.sessionContext?.version || input.sessionVersion) || 0,
      checkpointId: input.sessionContext?.checkpointId || null,
      summaryVersion: Number(input.sessionContext?.summaryVersion) || 0,
    }, () => ({
      mode: input.mode || null,
      channel,
      purpose: input.purpose || "remote_model",
      modelProfile: input.modelProfile || null,
      sessionId: continuity.sessionId || null,
      currentTask: continuity.currentTask || null,
      currentArtifact: continuity.currentArtifact || null,
      currentSearch: continuity.currentSearch || null,
      currentPlan: continuity.currentPlan || null,
      recentEntities: Array.isArray(continuity.recentEntities)
        ? continuity.recentEntities.slice(0, 10)
        : [],
      summary: typeof continuity.summary === "string" ? continuity.summary : null,
      summaryVersion: Number(continuity.summaryVersion) || 0,
      checkpointId: continuity.checkpointId || null,
    }), { scope: { sessionId: input.conversationId || null, projectId: input.projectId || null }, copyOnRead: false })
      : (cacheEvents.session = { skipped: true }, {
        mode: null, channel, purpose: input.purpose || "remote_model", modelProfile: null,
      });
    // Le contexte ambiant est éphémère et optionnel. Il est demandé au moteur
    // central à chaque construction et n'entre jamais dans le cache mémoire.
    let ambient = null;
    if (typeof ambientContextProvider === "function") {
      try {
        ambient = ambientContextProvider({
          query,
          remote: (input.purpose || "remote_model") === "remote_model",
          explicitWorkspaceId: input.workspaceId || input.projectId || null,
          explicitMode: input.mode || null,
        });
      } catch {
        ambient = null;
      }
    }
    const metadata = {
      intent,
      channel,
      ruleIds: hardRules.map((rule) => rule.id),
      memoryIds: [],
      projectIds: [],
      workspaceId: workspaceContext?.workspace?.id || input.workspaceId || null,
      people: [],
      conversationIds: [],
      sources: [],
      inclusionReasons: [],
      exclusionReasons: [],
      filteredPrivate: memoryResult.metadata?.counts?.excludedPrivacy || 0,
      localOnly: memoryResult.localOnlyContext?.length || 0,
      deduplicated: memoryResult.metadata?.counts?.deduplicated || 0,
      estimatedTokens: 0,
      budgetTokens: maxContextTokens,
      truncated: Boolean(memoryResult.metadata?.truncated),
      durationMs: 0,
      memoryRetrievalMs,
      memorySourcesQueried: memoryResult.metadata?.sourcesUsed?.length || 0,
      memoryItemsFound: (memoryResult.metadata?.counts?.private || 0) +
        (memoryResult.metadata?.counts?.structured || 0) +
        (memoryResult.metadata?.counts?.legacy || 0),
      memoryItemsReturned: memoryResult.metadata?.remoteMemoryIds?.length || 0,
      memoryItemsDeduplicated: memoryResult.metadata?.counts?.deduplicated || 0,
      memoryPrivateFiltered: memoryResult.metadata?.counts?.excludedPrivacy || 0,
      hardRulesResolveMs,
      hardRulesApplied: hardRules.length,
      cache: cacheEvents,
      cacheHits: Object.values(cacheEvents).filter((event) => event.hit).length,
      cacheMisses: Object.values(cacheEvents).filter((event) => event.hit === false).length,
      cacheHitRate: 0,
      cacheEntries: 0,
      cacheMemoryBytesEstimate: 0,
      tokensBefore: 0,
      tokensAfter: 0,
      tokensSaved: 0,
      complexityHints: {
        hasTools: requestedTools.length > 0,
        hasFiles: Boolean(input.hasFiles),
        requiresReasoning: ["analysis", "development", "project", "memory"].includes(intent),
      },
      ambientSignalIds: ambient?.signalIds || [],
    };
    metadata.inclusionReasons.push(
      { id: "noon.personality", source: "personality", reason: "system_identity" },
      ...hardRules.map((rule) => ({ id: rule.id, source: "hard_rules", reason: "applicable_rule" }))
    );

    const seen = new Set(hardRules.map((rule) => normalize(rule.statement)).filter(Boolean));
    const projects = deduplicate(memoryResult.projectContext, (item) => item.value, seen, metadata);
    const projectItems = projects.length > 0 || input.projectId ? cached("project", {
      projectId: input.projectId || null,
      version: versions.project,
      items: projects.map((item) => [item.id, item.updatedAt || null]),
    }, () => projects, { scope: { projectId: input.projectId || null }, copyOnRead: false })
      : (cacheEvents.project = { skipped: true }, projects);
    const remoteMemories = deduplicate(memoryResult.remoteContext, (item) => item.value, seen, metadata);
    // GoalStrategyEngine reste la source de vérité stratégique. Le builder ne
    // reçoit qu'une vue compacte et filtrée, jamais le registre complet.
    let relevantGoals = [];
    if (typeof goalContextProvider === "function") {
      try {
        relevantGoals = (goalContextProvider({
          query,
          projectId: input.projectId || null,
          workspaceId: input.workspaceId || null,
          profileScope: input.profileScope || peopleIds[0] || "arnaud",
          remote: (input.purpose || "remote_model") === "remote_model",
          limit: channel === "live_voice" ? 2 : 5,
        }) || []).slice(0, channel === "live_voice" ? 2 : 5);
      } catch {
        relevantGoals = [];
      }
    }
    const localOnly = deduplicate(memoryResult.localOnlyContext, (item) => item.value, new Set(seen), metadata);
    metadata.exclusionReasons.push(...localOnly.map((item) => ({
      id: item.id || null,
      source: item.source || "memory",
      reason: item.apiPolicy === "confirm_each_use" ? "confirmation_required" : "local_only",
    })));
    const conversationItems = memoryResult.conversationContext || [];
    const summaryItem = conversationItems.find((item) => item.role === "system");
    const recentMessages = conversationItems
      .filter((item) => item !== summaryItem && ["user", "assistant"].includes(item.role))
      .map((item) => ({ id: item.id, role: item.role, content: item.value, source: item.source }));

    // Les règles sont incompressibles. Le reste est ajouté dans l'ordre de
    // priorité documenté et les éléments secondaires sont supprimés d'abord.
    let usedTokens = estimateTokens(personality) + hardRules.reduce((sum, rule) => sum + estimateTokens(rule.statement), 0);
    metadata.tokensBefore = usedTokens +
      projectItems.reduce((sum, item) => sum + estimateTokens(item.value), 0) +
      relevantGoals.reduce((sum, item) => sum + estimateTokens(item), 0) +
      remoteMemories.reduce((sum, item) => sum + estimateTokens(item.value), 0) +
      recentMessages.reduce((sum, item) => sum + estimateTokens(item.content), 0) +
      (summaryItem ? estimateTokens(summaryItem.value) : 0);
    function keepWithinBudget(items, valueOf, reason, idTarget) {
      const kept = [];
      for (const item of items) {
        const cost = estimateTokens(valueOf(item));
        if (usedTokens + cost > maxContextTokens) {
          metadata.truncated = true;
          metadata.exclusionReasons.push({ id: item.id || null, reason: "context_budget" });
          continue;
        }
        usedTokens += cost;
        kept.push(item);
        if (item.id) idTarget.push(item.id);
        metadata.inclusionReasons.push({ id: item.id || null, source: item.source || reason, reason });
      }
      return kept;
    }

    const newestConversationFirst = [...recentMessages].reverse();
    const keptConversation = keepWithinBudget(
      newestConversationFirst,
      (item) => item.content,
      "recent_conversation",
      metadata.conversationIds
    ).reverse();
    let summary = null;
    const sessionSummary = sessionSegment.summary
      ? { id: `session-summary:${sessionSegment.summaryVersion}`, value: sessionSegment.summary, source: "session_summary" }
      : summaryItem;
    if (sessionSummary) {
      const cost = estimateTokens(sessionSummary.value);
      if (usedTokens + cost <= maxContextTokens) {
        summary = sessionSummary.value;
        usedTokens += cost;
        metadata.inclusionReasons.push({ id: sessionSummary.id, source: sessionSummary.source, reason: "conversation_summary" });
      } else {
        metadata.truncated = true;
        metadata.exclusionReasons.push({ id: sessionSummary.id, reason: "context_budget" });
      }
    }
    const keptProjects = keepWithinBudget(projectItems, (item) => item.value, "active_project", metadata.projectIds);
    const goalIds = [];
    const keptGoals = keepWithinBudget(relevantGoals.map((item) => ({ ...item, id: item.goalId })), (item) => item, "relevant_goal", goalIds)
      .map(({ id: _id, ...item }) => item);
    const keptMemories = keepWithinBudget(remoteMemories, (item) => item.value, "relevant_memory", metadata.memoryIds);

    metadata.people = [...new Set(keptMemories.map((item) => item.profileId).filter(Boolean))];
    metadata.sources = [...new Set([
      ...keptProjects, ...keptMemories, ...keptConversation,
    ].map((item) => item.source).filter(Boolean))];
    metadata.estimatedTokens = usedTokens;
    metadata.tokensAfter = usedTokens;
    metadata.tokensSaved = Math.max(0, metadata.tokensBefore - metadata.tokensAfter);
    const cacheStats = cache.stats();
    metadata.cacheHits = Object.values(cacheEvents).filter((event) => event.hit).length;
    metadata.cacheMisses = Object.values(cacheEvents).filter((event) => event.hit === false).length;
    metadata.cacheHitRate = metadata.cacheHits + metadata.cacheMisses
      ? metadata.cacheHits / (metadata.cacheHits + metadata.cacheMisses)
      : 0;
    metadata.cacheEntries = cacheStats.entries;
    metadata.cacheMemoryBytesEstimate = cacheStats.memoryBytesEstimate;
    metadata.contextFingerprint = cache.fingerprint({
      ruleIds: metadata.ruleIds,
      memoryIds: metadata.memoryIds,
      projectIds: metadata.projectIds,
      goalIds,
      conversationIds: metadata.conversationIds,
      versions,
    });
    metadata.durationMs = performance.now() - startedAt;

    const userContext = {
      memories: keptMemories,
      people: keptMemories.filter((item) => item.profileId && !String(item.profileId).startsWith("project:")),
      projects: keptProjects,
      relevantGoals: keptGoals,
      workspace: workspaceContext,
    };
    const conversation = { recentMessages: keptConversation, summary };
    const runtime = {
      mode: sessionSegment.mode,
      channel: sessionSegment.channel,
      tools: toolSegment.requested,
      permissions,
      purpose: sessionSegment.purpose,
      modelProfile: sessionSegment.modelProfile,
      session: {
        sessionId: sessionSegment.sessionId,
        currentTask: sessionSegment.currentTask,
        currentArtifact: sessionSegment.currentArtifact,
        currentSearch: sessionSegment.currentSearch,
        currentPlan: sessionSegment.currentPlan,
        recentEntities: sessionSegment.recentEntities,
        summaryVersion: sessionSegment.summaryVersion,
        checkpointId: sessionSegment.checkpointId,
      },
      ambient: ambient ? {
        sessionId: ambient.sessionId,
        mode: ambient.mode,
        signals: ambient.signals,
        ambientAuthority: false,
      } : null,
      decision: input.decisionContext ? {
        decisionId: input.decisionContext.decisionId || null,
        optionRefs: (input.decisionContext.optionRefs || []).slice(0, 20),
        criterionRefs: (input.decisionContext.criterionRefs || []).slice(0, 30),
        contextFingerprint: input.decisionContext.contextFingerprint || null,
      } : null,
    };
    const system = { personality, hardRules };
    const localContext = {
      memories: [...keptMemories, ...localOnly],
      localOnly,
      projects: keptProjects,
      relevantGoals: keptGoals,
      conversation,
      workspace: workspaceContext,
    };
    const remoteModelContext = { system, userContext, conversation, runtime };
    const segments = {
      static: system,
      session: { conversation, mode: runtime.mode, channel: runtime.channel },
      project: { projects: keptProjects, workspace: workspaceContext },
      memory: { remote: keptMemories, localOnly },
      dynamic: { permissions },
      tools: toolSegment,
      ambient: ambient || { signals: [], signalIds: [], ambientAuthority: false },
      decision: runtime.decision || null,
      goals: keptGoals,
    };

    debug?.("context-builder.summary", {
      intent,
      channel,
      rules: hardRules.length,
      memories: keptMemories.length,
      projects: keptProjects.length,
      people: metadata.people.length,
      conversationMessages: keptConversation.length,
      estimatedTokens: metadata.estimatedTokens,
      budget: maxContextTokens,
      filteredPrivate: metadata.filteredPrivate,
      localOnly: metadata.localOnly,
      deduplicated: metadata.deduplicated,
      truncated: metadata.truncated,
      cacheHits: metadata.cacheHits,
      cacheMisses: metadata.cacheMisses,
      cacheEntries: metadata.cacheEntries,
      tokensSaved: metadata.tokensSaved,
    });

    return { system, userContext, conversation, runtime, localContext, remoteModelContext, segments, metadata };
  }

  function renderRemoteSystemContext(context) {
    const remote = context.remoteModelContext;
    const sections = [remote.system.personality];
    if (remote.system.hardRules.length) {
      sections.push(`Règles permanentes applicables : ${remote.system.hardRules.map((rule) => rule.statement).join(" ")}`);
    }
    if (remote.runtime?.session) {
      const session = remote.runtime.session;
      const compactState = {
        sessionId: session.sessionId || null,
        currentTask: session.currentTask || null,
        currentArtifact: session.currentArtifact || null,
        currentSearch: session.currentSearch || null,
        currentPlan: session.currentPlan || null,
        recentEntities: (session.recentEntities || []).slice(0, 10),
        checkpointId: session.checkpointId || null,
      };
      sections.push(`Continuité de session : ${JSON.stringify(compactState)}`);
    }
    if (remote.runtime?.ambient?.signals?.length) {
      sections.push(`Contexte de travail explicitement partagé (indice non autoritaire) : ${JSON.stringify(remote.runtime.ambient.signals)}`);
    }
    if (remote.runtime?.decision) sections.push(`Décision en cours (références uniquement) : ${JSON.stringify(remote.runtime.decision)}`);
    if (remote.conversation.summary) sections.push(String(remote.conversation.summary));
    if (remote.userContext.projects.length) {
      sections.push(`Projet actif : ${remote.userContext.projects.map((item) => textValue(item.value)).join(" | ")}`);
    }
    if (remote.userContext.relevantGoals?.length) {
      sections.push(`Objectifs pertinents (contexte stratégique, sans autorité d'action) : ${JSON.stringify(remote.userContext.relevantGoals)}`);
    }
    if (remote.userContext.workspace) {
      const workspace = remote.userContext.workspace;
      sections.push(`Espace de travail actif : ${workspace.workspace.name} (${workspace.workspace.type}). Projets : ${workspace.projects.map((item) => item.name || item.id).join(", ") || "aucun"}. Racines locales autorisées : ${workspace.roots.map((item) => item.path).join(", ") || "aucune"}.`);
    }
    if (remote.userContext.memories.length) {
      sections.push(`Contexte mémorisé pertinent : ${remote.userContext.memories.map((item) => textValue(item.value)).join(" | ")}`);
    }
    return sections.filter(Boolean).join(" ");
  }

  // La synthèse multi-source entre comme un bloc structuré compact. Les
  // passages bruts restent dans le moteur de synthèse pour le drill-down.
  function renderStructuredSynthesis(synthesis = {}) {
    return {
      synthesisId: synthesis.synthesisId || null,
      mode: synthesis.mode || "SUMMARY",
      answer: String(synthesis.answer || "").slice(0, 8000),
      keyPoints: (synthesis.keyPoints || []).slice(0, 12),
      conflicts: (synthesis.conflicts || []).slice(0, 12),
      timeline: (synthesis.timeline || []).slice(0, 20),
      currentState: synthesis.currentState || null,
      citations: (synthesis.citations || []).slice(0, 30),
      sourceCoverage: (synthesis.sourceCoverage || []).slice(0, 20),
      confidence: synthesis.confidence || "low",
      limitations: (synthesis.limitations || []).slice(0, 10),
    };
  }

  function clearContextCache() { return cache.clear(); }
  function invalidateStatic() { return cache.invalidate("static"); }
  function invalidateSession(id) {
    return ["session", "memory", "dynamic", "tools"]
      .reduce((sum, segment) => sum + cache.invalidate(segment, (scope) => !id || scope.sessionId === id), 0);
  }
  function invalidateProject(id) {
    return ["project", "memory", "dynamic"]
      .reduce((sum, segment) => sum + cache.invalidate(segment, (scope) => !id || scope.projectId === id), 0);
  }
  function invalidateProfile(id) {
    return cache.invalidate("memory", (scope) => !id || scope.profileIds?.includes(id));
  }
  function invalidateMemory() { return cache.invalidate("memory"); }

  return {
    buildContext, renderRemoteSystemContext, renderStructuredSynthesis, clearContextCache,
    invalidateMemory, invalidateProfile, invalidateProject, invalidateSession, invalidateStatic,
    cacheStats: () => cache.stats(), cacheInspection: () => cache.inspect(),
  };
}

module.exports = {
  DEFAULT_TOKEN_BUDGETS,
  createContextBuilder,
  estimateTokens,
  inferPeopleIds,
};
