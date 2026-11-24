"use strict";

// V3-L7 — assemblage des services d'intelligence personnelle, sorti de server.js : profil
// opérationnel, projets, inbox, capture rapide, « Où j'en étais ? », premier pas, déduplication,
// relances, métriques, créneaux, planning du jour, proactivité, suivi d'exécution, revues,
// migration des anciennes données, analyses de fond et gestionnaires de jobs. Bloc déplacé tel
// quel. server.js l'appelle au même endroit qu'avant : la migration, `ensurePermanentRules()`
// et l'enregistrement des gestionnaires de jobs ont donc lieu au même moment du démarrage. Les
// dépendances déjà initialisées sont lues une fois ; `resolveFocusCatalogSelection`, déclarée
// plus loin dans server.js, est relue à chaque appel (`deps.resolveFocusCatalogSelection`).

const path = require("path");
const { noonPersonality } = require("../../lib/noon-system-prompt");
const { localDayRange } = require("../connectors/google-calendar");
const { inspectGitStatus } = require("../../lib/git-status");
const { migrateLegacyPersonalData } = require("../persistence/migrations/legacy-personal-data");
const { createOperationalProfileService } = require("./operational-profile");
const { createProjectIntelligenceService } = require("./project-intelligence");
const { createInboxService } = require("./inbox-service");
const { createQuickCaptureService } = require("../capture/quick-capture-service");
const { createResumeBriefingService } = require("../resume/resume-briefing-service");
const { createFirstStepService } = require("../first-step/first-step-service");
const { createDeduplicationService } = require("./deduplication-service");
const { createFollowUpService } = require("./follow-up-service");
const { createMetricsService } = require("./metrics-service");
const { createTimeSlotService } = require("../scheduling/time-slot-service");
const { createProactiveEngine } = require("../proactive/proactive-engine");
const { createDailyPlanningEngine } = require("../planning/daily-planning-engine");
const { createExecutionTrackingEngine } = require("../tracking/execution-tracking-engine");
const { createReviewLearningEngine } = require("../review/review-learning-engine");
const { createBackgroundAnalysisService } = require("../openai/background-analysis");

const DEPENDENCIES = Object.freeze(["DATA_DIRECTORY","approvalManager","authorizeOpenAIPrivacy","backgroundJobEngine","calendarConnector","dailyPlanStore","executionTrackingRepository","getBudgetStatus","getOpenAIClient","hardRulesRegistry","jobRegistry","localIntelligenceRuntime","memoryEngine","personalRepository","planningPreferenceStore","priorityEngine","publicResearchEngine","resolveFocusCatalogSelection","reviewLearningRepository","sessionContinuityEngine","toolAuditLog","trackUsage"]);

function createPersonalIntelligenceComposition(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  const {
    DATA_DIRECTORY,
    approvalManager,
    authorizeOpenAIPrivacy,
    backgroundJobEngine,
    calendarConnector,
    dailyPlanStore,
    executionTrackingRepository,
    getBudgetStatus,
    getOpenAIClient,
    hardRulesRegistry,
    jobRegistry,
    localIntelligenceRuntime,
    memoryEngine,
    personalRepository,
    planningPreferenceStore,
    priorityEngine,
    publicResearchEngine,
    reviewLearningRepository,
    sessionContinuityEngine,
    toolAuditLog,
    trackUsage,
  } = deps;

  const operationalProfileService = createOperationalProfileService(personalRepository);
  const projectIntelligenceService = createProjectIntelligenceService(personalRepository);
  const personalInboxService = createInboxService(personalRepository);
  const quickCaptureService = createQuickCaptureService({ inboxService: personalInboxService });
  // V3-L2b : « Où j'en étais ? », assemblé localement (aucun appel au modèle).
  const resumeBriefingService = createResumeBriefingService({
    getActiveSession: () => sessionContinuityEngine.getActiveSession({}),
    resolveFocus: (focusId, focusPath) => deps.resolveFocusCatalogSelection(focusId, focusPath),
    inspectGit: (projectPath) => inspectGitStatus(projectPath),
    listProjects: () => personalRepository.listProjects(),
    recentCaptures: (limit) => quickCaptureService.recent(limit),
  });
  // V3-L2c : « Je dois faire X » → une première action de 2 à 5 min (petit modèle + charte).
  const FIRST_STEP_MODEL = "gpt-5.6-luna";
  const firstStepService = createFirstStepService({
    personality: () => noonPersonality(),
    generate: async ({ instructions, input }) => {
      if (localIntelligenceRuntime.snapshot({ internetAvailable: true }).state === "LOCAL_ONLY") {
        throw Object.assign(new Error("Mode local uniquement : je ne contacte pas le modèle pour proposer un premier pas."), { code: "FIRST_STEP_REMOTE_FORBIDDEN", statusCode: 409 });
      }
      authorizeOpenAIPrivacy([{ source: "first_step", classification: "PERSONAL", content: input }]);
      const response = await getOpenAIClient().responses.create({ model: FIRST_STEP_MODEL, instructions, input, store: false, max_output_tokens: 400 });
      trackUsage(response);
      return response.output_text || "";
    },
    listProjects: () => personalRepository.listProjects(),
    saveProject: (project) => personalRepository.upsertProject(project),
    capture: (item) => quickCaptureService.capture(item),
  });
  const deduplicationService = createDeduplicationService(personalRepository);
  const followUpService = createFollowUpService(personalRepository);
  const metricsService = createMetricsService(personalRepository);
  const timeSlotService = createTimeSlotService(calendarConnector);
  const dailyPlanningEngine = createDailyPlanningEngine({
    priorityEngine,
    timeSlotService,
    hardRulesRegistry,
    store: dailyPlanStore,
    settingsProvider: () => planningPreferenceStore.load().settings,
    learningHintsProvider: () => reviewLearningRepository.list({
      reviewType: "weekly", subjectScope: "arnaud", limit: 1,
    })[0]?.planningHints || {},
    approvalEngine: approvalManager,
    calendarReader: async (date, calendarId) => {
      if (!calendarConnector.connected) return null;
      const result = await calendarConnector.listCompleteCalendarEvents({
        calendarId,
        ...localDayRange(new Date(`${date}T12:00:00Z`)),
      });
      if (!result.complete) throw Object.assign(new Error("Agenda incomplet : validation du planning impossible."), { code: "CALENDAR_INCOMPLETE" });
      return result.items || [];
    },
    metrics: metricsService,
    audit: (event, metadata) => toolAuditLog.append(event, metadata),
  });
  const proactiveEngine = createProactiveEngine({
    priorityEngine,
    deduplicationService,
    repository: personalRepository,
    metrics: metricsService,
    approvalEngine: approvalManager,
    hardRulesRegistry,
    timeSlotService,
    planningEngine: dailyPlanningEngine,
    maxNotificationsPerDay: Math.max(1, Math.min(10,
      Number(process.env.NOON_MAX_PROACTIVE_NOTIFICATIONS) || 3)),
    audit: (event, metadata) => toolAuditLog.append(event, metadata),
  });
  const executionTrackingEngine = createExecutionTrackingEngine({
    repository: executionTrackingRepository,
    proactiveEngine,
    planningEngine: dailyPlanningEngine,
    metrics: metricsService,
    memoryEngine,
    audit: (event, metadata) => toolAuditLog.append(event, metadata),
  });
  const reviewLearningEngine = createReviewLearningEngine({
    repository: reviewLearningRepository,
    trackingProvider: ({ subjectScope }) => executionTrackingEngine.list({ subjectScope }),
    planProvider: (date) => dailyPlanStore.get(date),
    recommendationProvider: ({ start, end, subjectScope }) => personalRepository.listRecommendations({
      start: start.toISOString(), end: end.toISOString(), subjectScope, limit: 500,
    }),
    feedbackProvider: ({ start, end, subjectScope }) => personalRepository.listFeedbackEvents({
      start: start.toISOString(), end: end.toISOString(), subjectScope, limit: 500,
    }),
    memoryEngine,
    proactiveEngine,
    subjectScope: "arnaud",
    metrics: metricsService,
    audit: (event, metadata) => toolAuditLog.append(event, metadata),
  });
  const personalMigration = migrateLegacyPersonalData({
    repository: personalRepository, dataDirectory: DATA_DIRECTORY,
    logger: (level, event, code) => toolAuditLog.append(event, { level, code }),
  });
  operationalProfileService.ensurePermanentRules();
  const backgroundAnalysisService = createBackgroundAnalysisService({
    client: {
      responses: {
        create: (options, ...args) => {
          authorizeOpenAIPrivacy([
            { source: "background_analysis", classification: "PERSONAL", content: options?.input || "" },
          ]);
          return getOpenAIClient().responses.create({ ...options, store: false }, ...args);
        },
        retrieve: (...args) => getOpenAIClient().responses.retrieve(...args),
        cancel: (...args) => getOpenAIClient().responses.cancel(...args),
      },
    },
    stateFile: path.join(DATA_DIRECTORY, "background-analyses.json"),
    logger: (level, event, code) => toolAuditLog.append(event, { level, code }),
  });
  if (backgroundJobEngine) {
    jobRegistry.registerHandler("PUBLIC_RESEARCH", async ({ job, signal, reportProgress }) => {
      reportProgress({ percent: 10, stage: "planning" });
      const pack = await publicResearchEngine.research({
        query: String(job.inputRef.query || "").slice(0, 2000),
        mode: job.inputRef.mode || "STANDARD",
        freshnessRequirement: job.inputRef.freshnessRequirement || "CURRENT",
        scope: "PUBLIC",
        budgetMode: getBudgetStatus().mode,
        signal,
      });
      if (pack.state === "CANCELLED") throw Object.assign(new Error("Recherche annulée."), { name: "AbortError" });
      if (pack.state === "FAILED") throw Object.assign(new Error("Recherche publique indisponible."), { code: "SERVICE_UNAVAILABLE", transient: true });
      reportProgress({ percent: 90, stage: "finalizing" });
      return { outputRef: { evidencePackId: pack.evidencePackId, researchId: pack.researchId, state: pack.state } };
    });
    jobRegistry.registerHandler("MAINTENANCE", async ({ job }) => ({ outputRef: { taskRef: job.inputRef.taskRef, completed: true } }));
  }

  return {
    operationalProfileService,
    projectIntelligenceService,
    personalInboxService,
    quickCaptureService,
    resumeBriefingService,
    FIRST_STEP_MODEL,
    firstStepService,
    followUpService,
    metricsService,
    timeSlotService,
    dailyPlanningEngine,
    proactiveEngine,
    executionTrackingEngine,
    reviewLearningEngine,
    personalMigration,
    backgroundAnalysisService,
  };
}

module.exports = { DEPENDENCIES, createPersonalIntelligenceComposition };
