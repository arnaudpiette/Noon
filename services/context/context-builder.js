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

function safeDiagnosticReasonCode(value) {
  const code = String(value || "");
  return /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : null;
}

function safeDiagnosticSystemPermission(value) {
  return value === "TCC_UNVERIFIED" ? value : null;
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
  entityResolver = null,
  authorizedContextSources = null,
  ambientContextProvider = null,
  goalContextProvider = null,
  permissionsProvider = () => [],
  privacyClassifier = null,
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
    let entityResolution = { status: "NOT_FOUND", query, candidates: [] };
    if (entityResolver?.resolveEntity) {
      try {
        entityResolution = entityResolver.resolveEntity({
          query, expectedType: "PROJECT", projectId: input.projectId || null,
          workspaceId: input.workspaceId || null, conversationId: input.conversationId || null,
          recentEntities: input.sessionContext?.recentEntities || [],
        });
      } catch {
        entityResolution = { status: "NOT_FOUND", query, candidates: [] };
      }
    }
    const projectId = entityResolution.status === "RESOLVED" && entityResolution.entity?.type === "PROJECT"
      ? entityResolution.entity.id : input.projectId || null;
    const intent = String(input.intent || hardRulesRegistry.inferIntent(query, projectId));
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
      query: normalize(query), intent, projectId, peopleIds,
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
      projectId,
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
      scope: { sessionId: input.conversationId || null, projectId, profileIds: peopleIds },
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
      project: Boolean(projectId), tools: requestedTools,
    }, () => ({
      hardRules: hardRulesRegistry.getRulesForContext({
        intent, tools: requestedTools, mode: input.mode, projectId, channel,
      }),
      personality: String(personalityProvider({ channel, intent, mode: input.mode }) || "").trim(),
    }), { scope: { version: versions.static }, copyOnRead: false });
    const hardRules = staticSegment.hardRules;
    const personality = staticSegment.personality;
    const hardRulesResolveMs = performance.now() - staticStartedAt;
    // Une permission peut être révoquée hors de ce processus (notamment par
    // Electron). Relire la vue bornée avant de consulter le cache évite qu'une
    // entrée dynamique encore valide réintroduise une autorisation révoquée.
    let permissionSnapshot = [];
    try {
      permissionSnapshot = permissionsProvider({
        intent, requestedTools, projectId,
      }) || [];
    } catch {
      permissionSnapshot = [];
    }
    const permissions = cached("dynamic", {
      intent, requestedTools, projectId,
      conversationId: input.conversationId || null, version: versions.permissions,
      permissions: permissionSnapshot,
    }, () => permissionSnapshot, {
      ttlMs: Math.max(100, Math.min(5_000, Number(input.dynamicCacheTtlMs) || 500)),
      copyOnRead: false,
      scope: { sessionId: input.conversationId || null, projectId },
    });
    const toolSegment = requestedTools.length > 0
      ? cached("tools", {
        intent, channel, mode: input.mode || null, requestedTools, version: versions.tools,
      }, () => ({ requested: requestedTools }), { scope: { sessionId: input.conversationId || null }, copyOnRead: false })
      : (cacheEvents.tools = { skipped: true }, { requested: [] });
    const hasSessionState = Boolean(
      input.conversationId || input.mode || projectId || input.modelProfile || input.sessionContext
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
      projectId,
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
    }), { scope: { sessionId: input.conversationId || null, projectId }, copyOnRead: false })
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
          explicitWorkspaceId: input.workspaceId || projectId || null,
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
    const projectItems = projects.length > 0 || projectId ? cached("project", {
      projectId,
      version: versions.project,
      items: projects.map((item) => [item.id, item.updatedAt || null]),
    }, () => projects, { scope: { projectId }, copyOnRead: false })
      : (cacheEvents.project = { skipped: true }, projects);
    const remoteMemories = deduplicate(memoryResult.remoteContext, (item) => item.value, seen, metadata);
    // GoalStrategyEngine reste la source de vérité stratégique. Le builder ne
    // reçoit qu'une vue compacte et filtrée, jamais le registre complet.
    let relevantGoals = [];
    if (typeof goalContextProvider === "function") {
      try {
        relevantGoals = (goalContextProvider({
          query,
          projectId,
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

    const classifyPrivacy = (fragment) => {
      if (typeof privacyClassifier === "function") return privacyClassifier(fragment);
      return {
        source: fragment.source,
        classification: fragment.classification,
        localOnly: fragment.localOnly === true,
        providerRestrictions: [...(fragment.providerRestrictions || [])],
        secretDetected: false,
        redactionRequired: fragment.redactionRequired === true,
      };
    };
    const privacyInputs = [
      { source: "personality", classification: "PUBLIC", content: personality },
      ...hardRules.map((rule) => ({ source: "hard_rules", classification: "PUBLIC", content: rule.statement })),
      ...keptConversation.map((item) => ({ source: item.source || "conversation", classification: "PERSONAL", content: item.content })),
      ...(summary ? [{ source: "session_summary", classification: "PERSONAL", content: summary }] : []),
      ...keptProjects.map((item) => ({ source: item.source || "project", classification: "PRIVATE", content: item.value })),
      ...keptGoals.map((item) => ({ source: "goals", classification: "PERSONAL", content: item })),
      ...keptMemories.map((item) => ({
        source: item.source || "memory",
        classification: item.classification || "PRIVATE",
        content: item.value,
        providerRestrictions: item.providerRestrictions || [],
      })),
      ...(workspaceContext ? [{ source: "workspace", classification: "PRIVATE", content: workspaceContext }] : []),
    ];
    metadata.privacy = {
      fragments: privacyInputs.filter((item) => item.content !== null && item.content !== undefined && item.content !== "").map(classifyPrivacy),
    };
    metadata.privacy.classificationCounts = metadata.privacy.fragments.reduce((counts, item) => {
      const key = item.classification || "UNKNOWN";
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});

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

    // Contrat A1 : ces projections ne contiennent jamais les valeurs des
    // sources. Les champs historiques restent inchangés pour les consommateurs
    // existants; les consommateurs nouveaux peuvent s'appuyer sur cette vue
    // stable et observable.
    const privacyBySource = new Map();
    for (const fragment of metadata.privacy.fragments) {
      if (!privacyBySource.has(fragment.source)) privacyBySource.set(fragment.source, fragment.classification || "UNKNOWN");
    }
    const sources = [
      ...metadata.inclusionReasons.map((item) => ({
        source: item.source || "unknown", sourceId: item.id || null, included: true,
        reason: item.reason, privacyClassification: privacyBySource.get(item.source) || "UNKNOWN",
      })),
      ...metadata.exclusionReasons.map((item) => ({
        source: item.source || "memory", sourceId: item.id || null, included: false,
        reason: item.reason, privacyClassification: privacyBySource.get(item.source) || (item.reason === "local_only" ? "LOCAL_ONLY" : "UNKNOWN"),
      })),
    ];
    const budget = Object.freeze({
      maximumTokens: maxContextTokens, usedTokens: metadata.estimatedTokens,
      tokensBeforePruning: metadata.tokensBefore, tokensSaved: metadata.tokensSaved,
      truncated: metadata.truncated,
    });
    const privacy = Object.freeze({
      classificationCounts: { ...metadata.privacy.classificationCounts },
      filteredPrivateCount: metadata.filteredPrivate, localOnlyCount: metadata.localOnly,
    });
    const cacheView = Object.freeze({
      hits: metadata.cacheHits, misses: metadata.cacheMisses, hitRate: metadata.cacheHitRate,
      entries: metadata.cacheEntries, events: { ...metadata.cache },
    });
    const entityResolutionDiagnostic = {
      status: entityResolution.status,
      type: entityResolution.entity?.type || null,
      entityId: entityResolution.entity?.id || null,
      method: entityResolution.matchedBy || null,
      source: entityResolution.sources?.[0] || null,
      confidence: entityResolution.confidence ?? null,
      candidateCount: entityResolution.candidates?.length || 0,
    };
    const diagnostics = Object.freeze({
      contractVersion: 1, intent, channel, durationMs: metadata.durationMs,
      sourceCount: sources.length, includedCount: sources.filter((item) => item.included).length,
      excludedCount: sources.filter((item) => !item.included).length,
      entityResolution: entityResolutionDiagnostic,
    });
    metadata.contractVersion = 1;
    return {
      system, userContext, conversation, runtime, localContext, remoteModelContext, segments, metadata,
      sources, included: sources.filter((item) => item.included), excluded: sources.filter((item) => !item.included),
      budget, privacy, cache: cacheView, diagnostics,
    };
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
    if (remote.userContext.authorizedSources?.length) {
      sections.push(`Sources opérationnelles autorisées : ${JSON.stringify(remote.userContext.authorizedSources)}`);
    }
    return sections.filter(Boolean).join(" ");
  }

  // Les connecteurs sont potentiellement asynchrones. Cette API complète le
  // contrat synchrone historique sans le casser : aucun adapter n'est appelé
  // avant la sélection déterministe faite par la façade A3.
  async function buildContextAsync(input = {}) {
    const context = buildContext(input);
    if (!authorizedContextSources?.collect) return context;
    const sourceResult = await authorizedContextSources.collect({
      query: String(input.query || "").trim(), intent: context.metadata.intent,
      projectId: context.diagnostics.entityResolution.entityId || input.projectId || null,
      workspaceId: input.workspaceId || null, conversationId: input.conversationId || null,
      entityStatus: context.diagnostics.entityResolution.status,
      timeRange: input.timeRange || null, permissions: context.runtime.permissions,
    });
    const maximumTokens = context.budget.maximumTokens;
    let usedTokens = context.budget.usedTokens;
    const localItems = []; const remoteItems = []; let truncated = context.budget.truncated;
    for (const item of sourceResult.items || []) {
      const cost = estimateTokens(item.payload);
      if (usedTokens + cost > maximumTokens) { truncated = true; continue; }
      usedTokens += cost; localItems.push(item);
      const classified = typeof privacyClassifier === "function" ? privacyClassifier({
        source: item.sourceType, classification: item.privacyClass, content: item.payload,
        localOnly: item.localOnly, providerRestrictions: item.providerRestrictions || [],
      }) : { localOnly: item.localOnly, classification: item.privacyClass };
      if (item.allowedForRemoteModel === true && classified.localOnly !== true && classified.redactionRequired !== true) remoteItems.push(item);
    }
    const sourceDiagnostics = Object.fromEntries(Object.entries(sourceResult.diagnostics || {}).map(([source, detail]) => [source, {
      selected: detail.selected === true, status: detail.status, count: Number(detail.count) || 0,
      truncated: detail.truncated === true, durationMs: Number(detail.durationMs) || 0,
      reasonCode: safeDiagnosticReasonCode(detail.reasonCode),
      systemPermission: safeDiagnosticSystemPermission(detail.systemPermission),
    }]));
    const metadata = {
      ...context.metadata,
      estimatedTokens: usedTokens, tokensAfter: usedTokens,
      tokensSaved: Math.max(0, context.metadata.tokensBefore - usedTokens),
      truncated, sourceDiagnostics,
    };
    const localContext = { ...context.localContext, authorizedSources: localItems };
    const userContext = { ...context.userContext, authorizedSources: remoteItems };
    const remoteModelContext = { ...context.remoteModelContext, userContext };
    const segments = { ...context.segments, authorizedSources: { local: localItems, remote: remoteItems, diagnostics: sourceDiagnostics } };
    const sourceEntries = Object.entries(sourceDiagnostics).map(([source, detail]) => ({
      source, sourceId: null, included: detail.status === "AVAILABLE" && detail.count > 0,
      reason: detail.selected ? "authorized_context_source" : "skipped_not_relevant",
      privacyClassification: "UNKNOWN",
    }));
    const sources = [...context.sources, ...sourceEntries];
    const budget = Object.freeze({ ...context.budget, usedTokens, tokensSaved: metadata.tokensSaved, truncated });
    const diagnostics = Object.freeze({ ...context.diagnostics,
      durationMs: context.diagnostics.durationMs + Object.values(sourceDiagnostics).reduce((sum, item) => sum + item.durationMs, 0),
      sourceCount: sources.length, includedCount: sources.filter((item) => item.included).length,
      excludedCount: sources.filter((item) => !item.included).length, sourceDiagnostics,
    });
    return { ...context, metadata, localContext, userContext, remoteModelContext, segments, sources,
      included: sources.filter((item) => item.included), excluded: sources.filter((item) => !item.included), budget, diagnostics };
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
  function invalidatePermissions() { return ["dynamic", "tools"].reduce((sum, segment) => sum + cache.invalidate(segment), 0); }
  function invalidatePrivacy() { return ["memory", "dynamic", "project"].reduce((sum, segment) => sum + cache.invalidate(segment), 0); }

  return {
    buildContext, buildContextAsync, renderRemoteSystemContext, renderStructuredSynthesis, clearContextCache,
    invalidateMemory, invalidatePermissions, invalidatePrivacy, invalidateProfile, invalidateProject, invalidateSession, invalidateStatic,
    cacheStats: () => cache.stats(), cacheInspection: () => cache.inspect(),
  };
}

module.exports = {
  DEFAULT_TOKEN_BUDGETS,
  createContextBuilder,
  estimateTokens,
  inferPeopleIds,
};
