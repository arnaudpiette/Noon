"use strict";

// Façade de lecture commune aux mémoires existantes. Elle ne possède aucun
// stockage et ne migre aucune donnée : chaque source conserve son cycle de vie.

const SOURCE_PRIORITY = Object.freeze({
  private_memory: 400,
  structured_memory: 300,
  project_memory: 250,
  legacy_memory: 200,
  conversation_memory: 100,
});

const REMOTE_BLOCKED_POLICIES = new Set(["local_only", "confirm_each_use"]);
const REMOTE_BLOCKED_STATUSES = new Set([
  "candidate", "pending_review", "historical", "superseded", "deleted",
  "inferred", "rejected", "expired", "blocked",
]);
const FAMILY_PROFILE_IDS = new Set(["alexandra", "sinan", "kaan", "household"]);

function textValue(value) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value ?? ""); } catch { return ""; }
}

function normalizeForDeduplication(value) {
  return textValue(value)
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scalarValues(value, output = []) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    output.push(String(value));
  } else if (Array.isArray(value)) {
    for (const entry of value) scalarValues(entry, output);
  } else if (value && typeof value === "object") {
    for (const entry of Object.values(value)) scalarValues(entry, output);
  }
  return output;
}

function deduplicationKey(item) {
  const scalar = scalarValues(item?.value)
    .map(normalizeForDeduplication)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)[0];
  return scalar || normalizeForDeduplication(item?.label || item?.value);
}

function tokens(value) {
  return new Set(normalizeForDeduplication(value).match(/[a-z0-9]{3,}/g) || []);
}

function relevanceScore(queryTokens, value, fallback = 0) {
  const itemTokens = tokens(value);
  let score = 0;
  for (const token of queryTokens) if (itemTokens.has(token)) score += 1;
  return score || fallback;
}

function isExpired(item, now) {
  return Boolean(item?.expiresAt && new Date(item.expiresAt) <= now);
}

function createMemoryEngine({
  privateMemoryService = null,
  privateContextBuilder = null,
  structuredRepository = null,
  legacyStore = null,
  conversationProvider = null,
  projectProvider = null,
  hardRulesRegistry = null,
  debug = null,
  now = () => new Date(),
} = {}) {
  let lastUsage = {
    sourcesUsed: [], memoryIds: [], truncated: false, durationMs: 0,
    counts: {},
  };

  // Les apprentissages statistiques entrent uniquement comme hypothèses
  // inactives. Ils ne deviennent utilisables qu'après validation explicite.
  function proposeCandidate(input = {}) {
    if (!structuredRepository?.upsertMemory || !structuredRepository?.getMemory) {
      return { status: "unavailable" };
    }
    const scope = String(input.scope || "arnaud").slice(0, 80);
    const type = String(input.type || "planning_preference").slice(0, 80);
    const id = `review_candidate_${require("crypto").createHash("sha256")
      .update(`${scope}:${type}`).digest("hex").slice(0, 24)}`;
    const existing = structuredRepository.getMemory(id);
    const versionHistory = [...(existing?.metadata?.versions || [])];
    if (existing && JSON.stringify(existing.value) !== JSON.stringify(input.statement)) {
      versionHistory.push({
        statement: existing.value,
        confidence: existing.confidence,
        evidenceSummary: existing.metadata?.evidenceSummary || null,
        supersededAt: new Date().toISOString(),
      });
    }
    const candidate = structuredRepository.upsertMemory({
      id, type: "work_preference", subject: `Tendance de planification — ${scope}`,
      value: String(input.statement || "").slice(0, 1000),
      sourceType: "review_learning", sourceReference: input.sourceReference || null,
      status: "inferred", confidence: Math.max(0, Math.min(0.95, Number(input.confidence) || 0)),
      expiresAt: input.expiresAt || null, sensitivity: "normal", useAllowed: false,
      metadata: {
        candidateType: type, scope, candidate: true,
        evidenceSummary: String(input.evidenceSummary || "").slice(0, 1000),
        sampleCount: Math.max(0, Number(input.sampleCount) || 0),
        observedFrom: input.observedFrom || null, proposedAt: input.proposedAt || new Date().toISOString(),
        versions: versionHistory.slice(-10), apiPolicy: "local_only",
      },
    });
    debug?.("memory-engine.candidate", { id, scope, type, sampleCount: candidate.metadata?.sampleCount || 0 });
    return { status: existing ? "updated" : "created", candidate };
  }

  // Recherche locale dédiée : elle expose aussi les états non actifs avec leur
  // statut explicite, sans les présenter comme des vérités confirmées.
  function search(input = {}) {
    const query = String(input.query || "").trim();
    const profileScope = String(input.profileScope || "arnaud");
    const includeHistorical = input.includeHistorical === true;
    const output = [];
    if (structuredRepository?.searchMemories) {
      for (const item of structuredRepository.searchMemories(query, { limit: input.limit || 20 })) {
        const itemScope = item.metadata?.profileId || "arnaud";
        if (itemScope !== profileScope) continue;
        const mappedStatus = item.status === "inferred" ? "candidate" : item.status;
        if (!includeHistorical && ["historical", "expired", "rejected", "blocked"].includes(mappedStatus)) continue;
        output.push({
          id: item.id, statement: textValue(item.value), status: mappedStatus,
          source: item.sourceType, version: item.metadata?.versions?.length
            ? item.metadata.versions.length + 1 : 1,
          profileScope: itemScope, sensitivity: item.sensitivity,
          timestamp: item.updatedAt, localOnly: item.metadata?.apiPolicy === "local_only",
          derivedFrom: item.sourceReference || item.metadata?.derivedFrom || null,
          allowedForRemoteModel: item.metadata?.apiPolicy !== "local_only" &&
            !["candidate", "pending_review", "historical"].includes(mappedStatus),
        });
      }
    }
    if (input.includePrivate !== false && privateMemoryService?.available) {
      try {
        const queryTokens = tokens(query);
        const metaStopWords = new Set(["memorise", "memorisees", "enregistre", "enregistrees", "souvenir", "souvenirs", "quelles", "quelle", "informations", "information", "partir", "dossier", "document", "fichier", "retrouve", "montre", "hier", "aujourd", "hui"]);
        const significantTokens = [...queryTokens].filter((t) => !metaStopWords.has(t));
        const tokensToMatch = significantTokens.length ? significantTokens : [...queryTokens];
        for (const item of privateMemoryService.listMemories({ subjectId: profileScope, includeDeleted: false })) {
          const haystack = normalizeForDeduplication(`${item.category} ${item.statement} ${item.sourceReference || ""} ${item.payload?.sourceFilename || ""}`);
          if (tokensToMatch.length && !tokensToMatch.some((token) => haystack.includes(token))) continue;
          if (!includeHistorical && item.status === "historical") continue;
          output.push({
            id: item.id, statement: item.statement, status: item.status,
            source: item.sourceType, version: item.version || 1,
            profileScope: item.subjectId, sensitivity: item.sensitivity,
            timestamp: item.updatedAt, localOnly: item.apiPolicy === "local_only",
            derivedFrom: item.sourceReference || item.payload?.sourceFilename || null,
            allowedForRemoteModel: item.status === "confirmed" && item.apiPolicy !== "local_only" &&
              item.apiPolicy !== "confirm_each_use" && (!item.consentRequired || item.consentStatus === "granted"),
          });
        }
      } catch {}
    }
    return output.slice(0, Math.max(1, Math.min(50, Number(input.limit) || 20)));
  }

  function report(counts, metadata) {
    const payload = { ...counts, returned: metadata.memoryIds.length };
    if (typeof debug === "function") debug("memory-engine.summary", payload);
  }

  function safeRead(source, operation, counts) {
    try {
      const value = operation();
      counts.queried.push(source);
      return Array.isArray(value) ? value : [];
    } catch (error) {
      counts.errors.push({ source, code: String(error?.code || error?.name || "ERROR").slice(0, 60) });
      return [];
    }
  }

  function privateItems(options, queryTokens, counts) {
    if (!options.includePrivate || !privateMemoryService?.available) return [];
    let settings;
    try {
      settings = privateMemoryService.settings();
      if (settings.enabled === false) return [];
    } catch (error) {
      counts.errors.push({ source: "private_memory", code: String(error?.code || error?.name || "ERROR").slice(0, 60) });
      return [];
    }
    if (["project", "projects", "files", "development"].includes(options.intent) && options.peopleIds.length === 0) return [];

    let selectedRemoteIds = new Set();
    try {
      selectedRemoteIds = new Set(privateContextBuilder?.build({
        question: options.query,
        focus: options.projectId,
        confirmedIds: options.confirmedMemoryIds,
      })?.memoryIds || []);
    } catch (error) {
      counts.errors.push({ source: "private_context", code: String(error?.code || error?.name || "ERROR").slice(0, 60) });
    }
    const explicitlyConfirmed = new Set(options.confirmedMemoryIds);

    return safeRead("private_memory", () => privateMemoryService.listMemories({ includeDeleted: false }), counts)
      .filter((item) => {
        if (options.peopleIds.length > 0 && !options.peopleIds.includes(item.subjectId)) return false;
        // Un profil familial n'est jamais chargé implicitement. Il faut que la
        // personne soit explicitement identifiée par le Context Builder.
        if (options.peopleIds.length === 0 && FAMILY_PROFILE_IDS.has(item.subjectId)) return false;
        if (!privateMemoryService.isProfileEnabled(item.subjectId)) return false;
        if (item.status !== "confirmed" || isExpired(item, now())) return false;
        if (item.consentRequired && item.consentStatus !== "granted") return false;
        const score = relevanceScore(queryTokens, `${item.category} ${item.statement} ${(item.tags || []).join(" ")}`);
        if (score === 0) { counts.excludedIrrelevant += 1; return false; }
        return true;
      })
      .map((item) => {
        const registryDecision = hardRulesRegistry?.canUseMemoryRemotely(
          item,
          options.confirmedMemoryIds
        );
        const sensitiveBlocked = ["high", "restricted"].includes(item.sensitivity) && !settings.sensitiveApiAllowed;
        const allowedForRemoteModel = (registryDecision
          ? registryDecision.allowed
          : item.apiPolicy !== "local_only" &&
            (item.apiPolicy !== "confirm_each_use" || explicitlyConfirmed.has(item.id))) &&
          !sensitiveBlocked && selectedRemoteIds.has(item.id);
        if (!allowedForRemoteModel) counts.excludedPrivacy += 1;
        return {
          id: item.id,
          value: item.statement,
          source: "private_memory",
          profileId: item.subjectId,
          category: item.category,
          confidence: item.confidence,
          status: item.status,
          updatedAt: item.updatedAt,
          apiPolicy: item.apiPolicy,
          usableLocally: true,
          allowedForRemoteModel,
          relevance: relevanceScore(queryTokens, item.statement),
          priority: SOURCE_PRIORITY.private_memory,
        };
      });
  }

  function structuredItems(options, queryTokens, counts) {
    if (!structuredRepository) return [];
    return safeRead("structured_memory", () => structuredRepository.searchMemories(options.query, { limit: options.sourceLimit }), counts)
      .filter((item) => {
        // Les anciennes contraintes restent stockées pour compatibilité, mais
        // ne sont plus traitées comme souvenirs lorsqu'elles ont un équivalent canonique.
        if (hardRulesRegistry?.matchesLegacyMemory(item)) return false;
        const usable = item.useAllowed !== false && !REMOTE_BLOCKED_STATUSES.has(item.status) && !isExpired(item, now());
        if (!usable) counts.excludedPrivacy += 1;
        return usable;
      })
      .map((item) => ({
        id: item.id,
        value: item.value,
        label: item.subject,
        source: "structured_memory",
        profileId: item.metadata?.profileId || null,
        category: item.type,
        confidence: item.confidence,
        status: item.status,
        updatedAt: item.updatedAt,
        apiPolicy: item.metadata?.apiPolicy || "contextual",
        usableLocally: true,
        allowedForRemoteModel: hardRulesRegistry
          ? hardRulesRegistry.canUseMemoryRemotely({
            id: item.id,
            apiPolicy: item.metadata?.apiPolicy || "contextual",
            consentRequired: item.metadata?.consentRequired === true,
            consentStatus: item.metadata?.consentStatus,
          }, options.confirmedMemoryIds).allowed
          : !REMOTE_BLOCKED_POLICIES.has(item.metadata?.apiPolicy),
        relevance: relevanceScore(queryTokens, `${item.subject} ${textValue(item.value)}`, 0.25),
        priority: SOURCE_PRIORITY.structured_memory,
      }));
  }

  function legacyItems(options, queryTokens, counts) {
    if (!legacyStore) return [];
    return safeRead("legacy_memory", () => legacyStore.relevant(options.query, options.sourceLimit), counts)
      .filter((item) => {
        const score = relevanceScore(queryTokens, `${item.text} ${(item.tags || []).join(" ")}`);
        if (score === 0) { counts.excludedIrrelevant += 1; return false; }
        return true;
      })
      .map((item) => ({
        id: item.id,
        value: item.text,
        source: "legacy_memory",
        profileId: null,
        category: "legacy",
        confidence: null,
        status: "confirmed",
        updatedAt: item.updatedAt,
        apiPolicy: "contextual",
        usableLocally: true,
        allowedForRemoteModel: true,
        relevance: relevanceScore(queryTokens, `${item.text} ${(item.tags || []).join(" ")}`),
        priority: SOURCE_PRIORITY.legacy_memory,
      }));
  }

  function projectItems(options, queryTokens, counts) {
    if (!projectProvider || (!options.projectId && options.intent !== "project")) return [];
    return safeRead("project_memory", () => projectProvider(options), counts)
      .filter((project) => !options.projectId || [project.id, project.name].includes(options.projectId))
      .map((project) => ({
        id: project.id,
        value: {
          name: project.name, objective: project.objective, currentState: project.currentState,
          nextAction: project.nextAction, blockers: project.blockers || [],
        },
        source: "project_memory",
        profileId: `project:${project.id}`,
        category: "project",
        confidence: 1,
        status: project.status,
        updatedAt: project.updatedAt,
        apiPolicy: "contextual",
        usableLocally: true,
        allowedForRemoteModel: true,
        relevance: relevanceScore(queryTokens, `${project.name} ${project.objective} ${project.nextAction}`, 1),
        priority: SOURCE_PRIORITY.project_memory,
      }));
  }

  function conversationItems(options, counts) {
    if (!conversationProvider || !options.includeConversation || !options.conversationId) return [];
    return safeRead("conversation_memory", () => conversationProvider(options), counts)
      .slice(-options.conversationLimit)
      .map((message, index) => ({
        id: message.id || `${options.conversationId}:${index}`,
        value: message.content,
        role: message.role,
        source: "conversation_memory",
        profileId: null,
        category: "conversation",
        confidence: 1,
        status: "active",
        updatedAt: message.updatedAt || null,
        apiPolicy: "contextual",
        usableLocally: true,
        allowedForRemoteModel: true,
        relevance: 1,
        priority: SOURCE_PRIORITY.conversation_memory,
      }));
  }

  function deduplicate(items, counts) {
    const kept = new Map();
    for (const item of items.sort((left, right) =>
      right.priority - left.priority || right.relevance - left.relevance ||
      String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))) {
      const key = deduplicationKey(item);
      if (!key) continue;
      if (kept.has(key)) { counts.deduplicated += 1; continue; }
      kept.set(key, item);
    }
    return [...kept.values()];
  }

  function applyBudget(items, options, counts) {
    const kept = [];
    let characters = 0;
    for (const item of items) {
      const size = textValue(item.value).length;
      if (kept.length >= options.maxItems || characters + size > options.maxCharacters) {
        counts.truncated += 1;
        continue;
      }
      kept.push(item);
      characters += size;
    }
    return kept;
  }

  function getRelevantContext(input = {}) {
    const startedAt = Date.now();
    const options = {
      query: String(input.query || "").trim(),
      intent: String(input.intent || hardRulesRegistry?.inferIntent(input.query, input.projectId) || "general"),
      projectId: input.projectId || null,
      peopleIds: Array.isArray(input.peopleIds) ? input.peopleIds.map(String) : [],
      conversationId: input.conversationId || null,
      confirmedMemoryIds: Array.isArray(input.confirmedMemoryIds) ? input.confirmedMemoryIds.map(String) : [],
      includePrivate: input.includePrivate !== false,
      includeConversation: input.includeConversation !== false,
      includeHardRules: input.includeHardRules !== false,
      purpose: String(input.purpose || "remote_model"),
      channel: String(input.channel || "chat"),
      maxItems: Math.max(1, Math.min(100, Number(input.maxItems) || 12)),
      maxCharacters: Math.max(200, Math.min(100_000, Number(input.maxCharacters) || 6000)),
      sourceLimit: Math.max(1, Math.min(100, Number(input.sourceLimit) || 20)),
      conversationLimit: Math.max(1, Math.min(60, Number(input.conversationLimit) || 12)),
    };
    const queryTokens = tokens(`${options.query} ${options.projectId || ""}`);
    const counts = {
      queried: [], errors: [], excludedPrivacy: 0, excludedIrrelevant: 0,
      deduplicated: 0, truncated: 0,
    };

    const privateContext = privateItems(options, queryTokens, counts);
    const structured = structuredItems(options, queryTokens, counts);
    const legacy = legacyItems(options, queryTokens, counts);
    const projects = projectItems(options, queryTokens, counts);
    const conversation = conversationItems(options, counts);
    const memories = applyBudget(deduplicate([...privateContext, ...structured, ...legacy], counts), options, counts);
    const projectContext = applyBudget(projects, options, counts);
    const conversationContext = applyBudget(conversation, options, counts);
    const hardRules = options.includeHardRules && hardRulesRegistry
      ? hardRulesRegistry.getRulesForContext({
        intent: options.intent,
        projectId: options.projectId,
        channel: options.channel,
      })
      : options.includeHardRules && privateMemoryService?.available
        ? safeRead("private_hard_rules", () => privateMemoryService.hardRules(), counts)
          .map((rule) => ({ ...rule, source: "private_hard_rules" }))
        : [];
    const allReturned = [...memories, ...projectContext, ...conversationContext];
    const sourcesUsed = [...new Set(allReturned.map((item) => item.source))];
    const metadata = {
      sourcesUsed,
      memoryIds: allReturned.map((item) => item.id),
      remoteMemoryIds: allReturned.filter((item) => item.allowedForRemoteModel).map((item) => item.id),
      truncated: counts.truncated > 0,
      durationMs: Date.now() - startedAt,
      counts: {
        private: privateContext.length, structured: structured.length, legacy: legacy.length,
        project: projects.length, conversation: conversation.length,
        deduplicated: counts.deduplicated, excludedPrivacy: counts.excludedPrivacy,
        excludedIrrelevant: counts.excludedIrrelevant, errors: counts.errors.length,
        // Lecture en parallèle conservée pendant la transition. Ces métriques
        // permettent de retirer les stores legacy seulement après validation.
        canonicalReadHits: privateContext.length,
        legacyReadHits: structured.length + legacy.length,
        shadowReadDifferences: Math.abs(privateContext.length - (structured.length + legacy.length)),
      },
      errors: counts.errors,
    };
    lastUsage = metadata;
    report(counts, metadata);

    return {
      hardRules,
      profileContext: memories.filter((item) => Boolean(item.profileId)),
      relevantMemories: memories,
      projectContext,
      conversationContext,
      privateContext: memories.filter((item) => item.source === "private_memory"),
      localOnlyContext: memories.filter((item) => !item.allowedForRemoteModel),
      remoteContext: memories.filter((item) => item.allowedForRemoteModel),
      metadata,
    };
  }

  return { getRelevantContext, lastUsage: () => structuredClone(lastUsage), proposeCandidate, search };
}

module.exports = {
  SOURCE_PRIORITY,
  createMemoryEngine,
  normalizeForDeduplication,
};
