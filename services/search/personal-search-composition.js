"use strict";

// V3-L7 — assemblage de la recherche personnelle (adaptateurs conversation, mémoire, projets,
// fichiers, médias, notes, rappels, email, agenda) et de la synthèse multi-sources, sorti de
// server.js. Bloc déplacé tel quel. server.js l'appelle au même endroit qu'avant. Les dépendances
// déjà initialisées sont lues une fois ; `multimodalEngine` (variable réaffectée de server.js)
// est relu à chaque usage, par accesseur (`deps.multimodalEngine`).

const { createPersonalSearchEngine } = require("./personal-search-engine");
const { createMultiSourceSynthesisEngine } = require("../synthesis/multi-source-synthesis-engine");
const { createFileSearchAdapter } = require("./file-search-adapter");
const {
  createCalendarAdapter,
  createConversationAdapter,
  createEmailAdapter,
  createMemoryAdapter,
  createProjectAdapter,
  createSimpleLocalAdapter,
} = require("./source-adapters");

const DEPENDENCIES = Object.freeze(["GOOGLE_ACCOUNT_EMAIL","calendarConnector","conversationSummaries","createConversationKey","getAllowedDirectories","getConversationIndex","getConversationTranscript","getValidRegisteredProjects","gmailConnector","isExcluded","isPathAllowed","memoryEngine","metricsService","multimodalEngine","notesConnector","projectIntelligenceService","reliabilityEngine","remindersConnector","toolAuditLog"]);

function createPersonalSearchComposition(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  const {
    GOOGLE_ACCOUNT_EMAIL,
    calendarConnector,
    conversationSummaries,
    createConversationKey,
    getAllowedDirectories,
    getConversationIndex,
    getConversationTranscript,
    getValidRegisteredProjects,
    gmailConnector,
    isExcluded,
    isPathAllowed,
    memoryEngine,
    metricsService,
    notesConnector,
    projectIntelligenceService,
    reliabilityEngine,
    remindersConnector,
    toolAuditLog,
  } = deps;

  const personalSearchEngine = createPersonalSearchEngine({
    adapters: {
      conversation: createConversationAdapter({
        indexProvider: () => getConversationIndex(),
        transcriptProvider: (conversationId) =>
          getConversationTranscript(createConversationKey({ sessionId: conversationId })),
        summaryProvider: (conversationId) =>
          conversationSummaries.get(createConversationKey({ sessionId: conversationId })) || "",
      }),
      memory: createMemoryAdapter({ memoryEngine }),
      project: createProjectAdapter({
        projectsProvider: () => {
          const projects = [...projectIntelligenceService.listWithSignals()];
          const known = new Set(projects.map((project) => project.id || project.rootPath || project.name));
          for (const project of getValidRegisteredProjects()) {
            const key = project.id || project.rootPath || project.name;
            if (!known.has(key)) projects.push(project);
          }
          return projects;
        },
      }),
      file: createFileSearchAdapter({
        rootsProvider: getAllowedDirectories,
        isExcluded,
      }),
      document: createFileSearchAdapter({
        rootsProvider: getAllowedDirectories,
        isExcluded,
      }),
      media: {
        version: () => `multimodal-${deps.multimodalEngine.listAssets().length}`,
        search: (request) => deps.multimodalEngine.search({
          query: request.query,
          workspaceId: request.workspaceId,
          sourceScope: request.privacyContext?.sourceScope,
          limit: request.resultsPerSource,
        }),
      },
      note: createSimpleLocalAdapter({
        sourceType: "note",
        list: () => notesConnector.listRecentNotes(),
      }),
      reminder: createSimpleLocalAdapter({
        sourceType: "reminder",
        list: () => remindersConnector.listIncompleteReminders(),
        content: "title",
        timestamp: "dueAt",
      }),
      email: createEmailAdapter({ connector: gmailConnector, account: GOOGLE_ACCOUNT_EMAIL }),
      calendar: createCalendarAdapter({ connector: calendarConnector }),
    },
    metrics: metricsService,
    reliability: reliabilityEngine,
    audit: (event, metadata) => toolAuditLog.append(event, metadata),
  });
  const multiSourceSynthesisEngine = createMultiSourceSynthesisEngine({
    metrics: metricsService,
    audit: (event, metadata) => toolAuditLog.append(event, metadata),
    permissionValidator: (evidence, options) => {
      if (options.profileScope && evidence.profileScope !== options.profileScope) return false;
      if (evidence.locator?.path && !isPathAllowed(evidence.locator.path)) return false;
      if (evidence.sourceType === "email" && !gmailConnector.connected) return false;
      if (evidence.sourceType === "calendar" && !calendarConnector.connected) return false;
      return true;
    },
  });

  return { personalSearchEngine, multiSourceSynthesisEngine };
}

module.exports = { DEPENDENCIES, createPersonalSearchComposition };
