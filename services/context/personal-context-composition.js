"use strict";

const path = require("node:path");
const { inspectGitStatus } = require("../../lib/git-status");
const { updateConversationSummary } = require("../../lib/noon-intelligence");
const { noonPersonality, setCharacterProvider } = require("../../lib/noon-system-prompt");
const { renderCharacterInstructions } = require("../character/character-charter");
const { createCharacterStore } = require("../character/character-store");
const { createSessionContinuityEngine } = require("../sessions/session-continuity-engine");
const { createAuthoritativeContextScopeProvider } = require("./authoritative-context-scope");
const { createAuthorizedContextSources, SOURCE_STATUSES } = require("./authorized-context-sources");
const { createCanonicalEntityResolver } = require("./canonical-entity-resolver");
const { createContextBuilder } = require("./context-builder");

function createPersonalContextComposition(dependencies) {
  const {
    DATA_DIRECTORY,
    ambientContextEngine,
    buildFocusCatalog,
    featureFlags,
    getAllowedDirectories,
    goalStrategyEngine,
    hardRulesRegistry,
    localPermissionStore,
    memoryEngine,
    providerPrivacyPolicy,
    toolAuditLog,
  } = dependencies;

  const canonicalEntityResolver = createCanonicalEntityResolver({
    projectProvider: () => dependencies.getValidRegisteredProjects(),
    focusProvider: () => buildFocusCatalog(getAllowedDirectories()),
    workspaceProvider: () => dependencies.workspaceEngine?.list?.() || [],
    observability: (event, metadata) => toolAuditLog.append(`context.${event}`, metadata),
  });
  function connectorContextStatus(connector, { local = false } = {}) {
    const status = connector?.status;
    if (local) return process.platform === "darwin"
      ? { status: SOURCE_STATUSES.AVAILABLE, systemPermission: "TCC_UNVERIFIED" }
      : SOURCE_STATUSES.UNAVAILABLE;
    if (status?.authState === "NOT_CONFIGURED") return SOURCE_STATUSES.NOT_CONFIGURED;
    if (status?.authState === "AUTH_REQUIRED" || status?.authState === "PERMISSION_DENIED") return SOURCE_STATUSES.UNAUTHORIZED;
    return connector?.connected ? SOURCE_STATUSES.AVAILABLE : SOURCE_STATUSES.UNAVAILABLE;
  }
  function projectPathForContext(projectId) {
    return dependencies.getValidRegisteredProjects().find((project) => project.id === projectId)?.rootPath || null;
  }
  const authorizedContextSources = createAuthorizedContextSources({
    adapters: {
      notes: {
        status: () => connectorContextStatus(dependencies.notesConnector, { local: true }),
        read: async (request) => {
          const notes = await dependencies.notesConnector.searchNotes(request.query, {
            limit: request.limit,
            includeBody: false,
            searchScope: "title",
            signal: request.signal,
            timeoutMs: request.timeoutMs,
          });
          return notes.map((item) => ({ sourceId: item.id, timestamp: item.modifiedAt, relevance: item.relevance,
            privacyClass: "PRIVATE", localOnly: true, payload: { title: item.title, excerpt: item.excerpt } }));
        },
      },
      reminders: {
        status: () => connectorContextStatus(dependencies.remindersConnector, { local: true }),
        read: async (request) => {
          const reminders = await dependencies.remindersConnector.listIncompleteRemindersForContext({ limit: request.limit, now: request.now, signal: request.signal, timeoutMs: request.timeoutMs });
          return reminders
            .map((item) => ({ sourceId: item.id, timestamp: item.dueAt, relevance: item.dueAt ? 0.9 : 0.6,
              privacyClass: "PRIVATE", localOnly: true, payload: { summary: item.title, dueAt: item.dueAt, status: "active" } }));
        },
      },
      calendar: {
        status: () => connectorContextStatus(dependencies.calendarConnector),
        read: async (request) => {
          const start = request.timeRange?.from ? new Date(request.timeRange.from) : new Date();
          const end = request.timeRange?.to ? new Date(request.timeRange.to) : new Date(start.getTime() + 26 * 60 * 60 * 1000);
          const data = await dependencies.calendarConnector.listCalendarEvents({ timeMin: start.toISOString(), timeMax: end.toISOString(), maxResults: request.limit });
          return (data.items || []).slice(0, request.limit).map((item) => ({ sourceId: item.id,
            timestamp: item.start?.dateTime || item.start?.date || null, relevance: 0.9, privacyClass: "PRIVATE", localOnly: true,
            payload: { start: item.start?.dateTime || item.start?.date || null, end: item.end?.dateTime || item.end?.date || null,
              availability: item.transparency === "transparent" ? "free" : "busy", title: item.summary || null, calendarId: "primary" } }));
        },
      },
      gmail: {
        status: () => connectorContextStatus(dependencies.gmailConnector),
        read: async (request) => {
          const result = await dependencies.personalSearchEngine.search({ query: request.query, sourceScopes: ["email"],
            maxResults: request.limit, resultsPerSource: request.limit, allowExpansion: false });
          return result.results.map((item) => ({ sourceId: item.sourceId, timestamp: item.timestamp, relevance: item.score,
            privacyClass: "PRIVATE", localOnly: true, payload: { threadId: item.locator?.threadId || null, subject: item.title, excerpt: item.snippet } }));
        },
      },
      files: {
        status: () => getAllowedDirectories().length ? SOURCE_STATUSES.AVAILABLE : SOURCE_STATUSES.UNAUTHORIZED,
        read: async (request) => {
          const result = await dependencies.personalSearchEngine.search({ query: request.query, sourceScopes: ["file"], projectId: request.projectId || null,
            projectPath: projectPathForContext(request.projectId), maxResults: request.limit, resultsPerSource: request.limit, allowExpansion: false,
            fileSearchMode: "metadata", contentReadBudget: 12 });
          return result.results.map((item) => ({ sourceId: item.sourceId, projectId: item.projectId, timestamp: item.timestamp, relevance: item.score,
            privacyClass: "PRIVATE", localOnly: true, payload: { name: item.title, excerpt: item.snippet } }));
        },
      },
      git: {
        status: (request) => projectPathForContext(request?.projectId) ? SOURCE_STATUSES.AVAILABLE : SOURCE_STATUSES.UNAVAILABLE,
        read: async (request) => {
          const projectPath = projectPathForContext(request.projectId); if (!projectPath) return [];
          const status = await inspectGitStatus(projectPath);
          return status.available ? [{ sourceId: request.projectId, projectId: request.projectId, relevance: 1, privacyClass: "PRIVATE",
            allowedForRemoteModel: true, payload: { repositoryDetected: true, branch: status.branch, dirty: status.modified + status.untracked > 0,
              modifiedFilesCount: status.modified, untrackedCount: status.untracked, ahead: status.ahead, behind: status.behind,
              latestCommit: status.lastCommit ? { hash: status.lastCommit.hash, date: status.lastCommit.date } : null } }] : [];
        },
      },
      execution: {
        status: () => SOURCE_STATUSES.AVAILABLE,
        read: async (request) => {
          const items = dependencies.executionTrackingEngine.list({
            subjectScope: "arnaud",
            projectId: request.projectId || undefined,
            limit: request.limit,
          });
          const counts = items.reduce((result, item) => ({ ...result, [item.status]: (result[item.status] || 0) + 1 }), {});
          return [{ sourceId: "execution-summary", projectId: request.projectId || null, relevance: 0.9, privacyClass: "PRIVATE",
            allowedForRemoteModel: true, payload: { pendingActions: (counts.planned || 0) + (counts.delayed || 0), runningActions: counts.in_progress || 0,
              blockedActions: counts.blocked || 0, deferredActions: counts.deferred || 0 } }];
        },
      },
    },
    observability: (event, metadata) => toolAuditLog.append(event, metadata),
  });
  // V3-L1 : charte de caractère + cadrans réglés par Arnaud (flag character.charter, ON ;
  // OFF = personnalité de base seule). Un changement de cadran invalide le contexte statique.
  const characterStore = createCharacterStore({
    filePath: path.join(DATA_DIRECTORY, "character-preferences.json"),
    onChange: () => contextBuilder.invalidateStatic(),
  });
  setCharacterProvider(() => (featureFlags.evaluate("character.charter", {}).enabled ? renderCharacterInstructions(characterStore.get().dials) : ""));
  const contextBuilder = createContextBuilder({
    personalityProvider: () => noonPersonality(),
    hardRulesRegistry,
    memoryEngine,
    conversationProvider: ({ conversationId }) =>
      dependencies.getConversationHistory(dependencies.createConversationKey({ sessionId: conversationId })),
    workspaceProvider: (workspaceId) => dependencies.workspaceEngine?.context(workspaceId) || null,
    entityResolver: canonicalEntityResolver,
    authorizedContextSources,
    ambientContextProvider: (input) => ambientContextEngine.buildContext(input),
    goalContextProvider: (input) => goalStrategyEngine.relevantGoals(input),
    permissionsProvider: () => localPermissionStore.load().roots.map((entry) => ({
      mode: entry.mode,
      output: entry.output === true,
    })),
    authoritativeScopeProvider: createAuthoritativeContextScopeProvider({
      getSession: (sessionId) => dependencies.sessionContinuityEngine.getSession(sessionId),
      getWorkspaceContext: (workspaceId) => dependencies.workspaceEngine?.context(workspaceId) || null,
    }),
    privacyClassifier: (fragment) => providerPrivacyPolicy.inspectContextFragment(fragment),
    debug: (event, metadata) => toolAuditLog.append(event, metadata),
  });

  return { characterStore, contextBuilder };
}

function createPersonalSessionContinuity(dependencies) {
  const {
    approvalManager,
    contextBuilder,
    sessionContinuityRepository,
    toolAuditLog,
    workspaceEngine,
  } = dependencies;

  return createSessionContinuityEngine({
    repository: sessionContinuityRepository,
    workspaceEngine,
    approvalProvider: ({ executionId = null } = {}) =>
      approvalManager.listPending({ executionId }),
    historyTailProvider: (conversationId, limit) =>
      dependencies.getConversationTranscript(dependencies.createConversationKey({ sessionId: conversationId })).slice(-limit),
    summaryUpdater: updateConversationSummary,
    contextInvalidator: (conversationId, oldWorkspaceId, newWorkspaceId) => {
      contextBuilder.invalidateSession(conversationId);
      if (oldWorkspaceId) contextBuilder.invalidateProject(oldWorkspaceId);
      if (newWorkspaceId) contextBuilder.invalidateProject(newWorkspaceId);
    },
    observability: (event, metadata) => toolAuditLog.append(event, metadata),
  });
}

module.exports = { createPersonalContextComposition, createPersonalSessionContinuity };
