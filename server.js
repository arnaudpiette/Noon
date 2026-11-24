const {
  createInterventionPermissionEngine,
} = require("./services/security/intervention-permission-engine");
// Serveur local de Noon : API, mémoire, budget et outils en lecture seule.
// Le profil UI isolé ne doit jamais importer l'environnement du dépôt.
if (process.env.NOON_UI_VALIDATION !== "1") require("dotenv").config();
const { assertUiValidationDataDirectory, isUiValidationExternalRequest, isUiValidationWorkspaceId, resolveUiValidationFixtures } = require("./electron/ui-validation-mode");
const OpenAI = require("openai");
const { toFile } = require("openai");
const { GoogleGenAI } = require("@google/genai");

// Le client est créé au premier appel afin que l’application locale puisse
// démarrer et rester utile hors ligne même sans clé OpenAI configurée.
let openai = null;
let loadOpenAIKeyOnDemand = null;
function getOpenAIClient() {
  if (process.env.NOON_UI_VALIDATION === "1") {
    throw Object.assign(new Error("Le fournisseur OpenAI est désactivé pendant la validation UI isolée."), { code: "UI_VALIDATION_EXTERNAL_DISABLED", statusCode: 503 });
  }
  if (openai) return openai;
  if (!process.env.OPENAI_API_KEY && loadOpenAIKeyOnDemand) loadOpenAIKeyOnDemand();
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error("Clé OpenAI absente. Configurez-la dans Noon.");
    error.statusCode = 503;
    throw error;
  }
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}
let gemini = null;
let loadGeminiKeyOnDemand = null;
function getGeminiClient() {
  if (process.env.NOON_UI_VALIDATION === "1") {
    throw Object.assign(new Error("Le fournisseur Gemini est désactivé pendant la validation UI isolée."), { code: "UI_VALIDATION_EXTERNAL_DISABLED", statusCode: 503 });
  }
  if (gemini) return gemini;
  if (!process.env.GEMINI_API_KEY && loadGeminiKeyOnDemand) loadGeminiKeyOnDemand();
  if (!process.env.GEMINI_API_KEY) throw Object.assign(new Error("Credential Gemini absent."), { statusCode: 503 });
  gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return gemini;
}
// Chargeurs de clés fournis par Electron au démarrage (lus par les deux clients ci-dessus).
function setProviderKeyLoaders(loadOpenAIKey, loadGeminiKey) {
  loadOpenAIKeyOnDemand = typeof loadOpenAIKey === "function" ? loadOpenAIKey : null;
  loadGeminiKeyOnDemand = typeof loadGeminiKey === "function" ? loadGeminiKey : null;
}

const http = require("http");
const fs = require("fs");
const path = require("path");

const {
  ALLOWED_DIRECTORIES,
  PRIORITY_DIRECTORIES,
} = require("./config");
const {
  buildFocusCatalog,
} = require("./lib/focus-catalog");
const { modelFallbacks, normalizeIntelligenceProfile, selectLegacyModelRoute, selectModelRoute } = require("./lib/noon-intelligence");
const { buildNoonSystemPrompt, noonPersonality } = require("./lib/noon-system-prompt");
const { createCreativeBriefStore } = require("./lib/creative-brief");
const { redactSecrets } = require("./services/security/redaction");
const { createOperationalSecurityPolicy } = require("./services/security/operational-security-policy");
const { createLongTermMemoryStore } = require("./lib/long-term-memory");
const { createLocalPermissionStore } = require("./lib/local-permissions");
const {
  normalizeConversationStore,
} = require("./lib/conversation-index");
const { createTokenStore } = require("./services/security/token-store");
const { createGmailConnector } = require("./services/connectors/gmail");
const { createCalendarConnector, localDayRange } = require("./services/connectors/google-calendar");
const { createAppleConnector } = require("./services/connectors/apple-reminders");
const { createAppleNotesConnector } = require("./services/connectors/apple-notes");
const { createVoiceIdentity } = require("./services/voice/voice-identity");
const { createRealtimeVoiceConfig } = require("./services/voice/realtime-config");
const { createPlanningPreferenceStore } = require("./lib/planning-preferences");
const { SCHEMA_VERSION, createPersonalDatabase, loadSqlite } = require("./services/persistence/database");
const { createPersonalIntelligenceRepository } = require("./services/persistence/repositories/personal-intelligence-repository");
const { createGoalStrategyRepository } = require("./services/persistence/repositories/goal-strategy-repository");
const { createApprovalRepository } = require("./services/persistence/repositories/approval-repository");
const { createTransactionalExecutionRepository } = require("./services/persistence/repositories/transactional-execution-repository");
const { createExecutionTrackingRepository } = require("./services/persistence/repositories/execution-tracking-repository");
const { createReviewLearningRepository } = require("./services/persistence/repositories/review-learning-repository");
const { createModelPerformanceRepository } = require("./services/persistence/repositories/model-performance-repository");
const { createArtifactRepository } = require("./services/persistence/repositories/artifact-repository");
const { createWorkspaceRepository } = require("./services/persistence/repositories/workspace-repository");
const { createDevProjectRuleRepository } = require("./services/persistence/repositories/dev-project-rule-repository");
const { createDevProjectRuleResolver } = require("./services/dev/dev-project-rule-resolver");
const { executeTrustedDevProjectRuleMutation: executeDevProjectRuleCommand, listTrustedDevProjectRules } = require("./services/dev/dev-project-rule-command");
const { createSessionContinuityRepository } = require("./services/persistence/repositories/session-continuity-repository");
const { createWorkspaceEngine } = require("./services/workspaces/workspace-engine");
const { createIntentCommandEngine } = require("./services/intents/intent-command-engine");
const { createReliabilityEngine } = require("./services/reliability/reliability-engine");
const { migrateLegacyPersonalData } = require("./services/persistence/migrations/legacy-personal-data");
const { createOperationalProfileService } = require("./services/personal-intelligence/operational-profile");
const { createProjectIntelligenceService } = require("./services/personal-intelligence/project-intelligence");
const { createInboxService } = require("./services/personal-intelligence/inbox-service");
const { createQuickCaptureService } = require("./services/capture/quick-capture-service");
const { createResumeBriefingService } = require("./services/resume/resume-briefing-service");
const { createFirstStepService } = require("./services/first-step/first-step-service");
const { createStaticAssets } = require("./services/http/static-assets");
const { createSessionActivityAndTranscription } = require("./services/voice/session-activity-and-transcription");
const { createNoonHttpServer } = require("./services/http/noon-http-server");
const { createControlCenterComposition } = require("./services/control-center/control-center-composition");
const { createDailyBriefComposition } = require("./services/daily-brief/daily-brief-composition");
const { createConfiguredModelRoute } = require("./services/models/configured-model-route");
const { createGoogleAccount } = require("./services/connectors/google-account");
const { createConversationStore } = require("./services/sessions/conversation-store");
const { createLocalProjects } = require("./services/context/local-projects");
const { createUsageTracking } = require("./services/models/usage-tracking");
const { createAskAI } = require("./services/orchestration/ask-ai");
const { NOT_HANDLED } = require("./services/http/route-result");
const { createPriorityEngine } = require("./services/personal-intelligence/priority-engine");
const { createDeduplicationService } = require("./services/personal-intelligence/deduplication-service");
const { createFollowUpService } = require("./services/personal-intelligence/follow-up-service");
const { createMetricsService } = require("./services/personal-intelligence/metrics-service");
const { createMemoryHttpRoutes } = require("./services/memory/memory-http-routes");
const { createPersonalMemoryComposition } = require("./services/memory/personal-memory-composition");
const { createPersonalContextComposition, createPersonalSessionContinuity } = require("./services/context/personal-context-composition");
const { inspectGitStatus } = require("./lib/git-status");
const { createAmbientContextEngine } = require("./services/context/ambient-context-engine");
const { createDecisionSupportEngine } = require("./services/decision/decision-support-engine");
const { createDevDecisionConsumer } = require("./services/decision/dev-decision-consumer");
const { createGoalStrategyEngine } = require("./services/goals/goal-strategy-engine");
const { reportInterruptedNativeDevTasks } = require("./services/dev/native-dev-interrupted-report");
const { createDataDirectoryLock } = require("./services/runtime/data-directory-lock");
const { createGoalRegistry } = require("./services/goals/goal-registry");
const { createCapacityService, createPortfolioCapacityEngine } = require("./services/portfolio");
const { createChatOrchestration } = require("./services/orchestration/chat-orchestration-composition");
const { createIntentContextBuilder } = require("./services/intents/intent-context");
const { countWebSearchCalls, extractWebSources, sanitizeResponseOutputForInput } = require("./services/models/model-response");
const { createOpenAIProviderAdapter } = require("./services/models/providers/openai-provider");
const { createGeminiProviderAdapter } = require("./services/models/providers/gemini-provider");
const { createProviderShadowRunner } = require("./services/models/provider-shadow-runner");
const { MODEL_DEFINITIONS, PROVIDERS } = require("./services/models/model-registry");
const { createProviderPrivacyPolicy } = require("./services/security/provider-privacy-policy");
const { createSpecialistRegistry } = require("./services/delegation/specialist-registry");
const { createContextCapsuleBuilder } = require("./services/delegation/context-capsule-builder");
const { createChatDelegation } = require("./services/delegation/chat-delegation-composition");
const { createExecutorWorktreeManager } = require("./services/delegation/executor-worktree");
const { createFigmaBridge } = require("./services/figma-bridge/figma-bridge");
const { createFigmaBridgeHttpRoutes } = require("./services/figma-bridge/figma-bridge-http-routes");
const { registerFigmaSkills } = require("./services/figma-bridge/figma-skills");
const { createGoalModeDevComposition, createNativeDevComposition, createNativeDevUiComposition } = require("./services/dev/dev-runtime-composition");
const { createSandboxDevValidationExecutor } = require("./services/security/dev-validation-runner");
const { createDevWorkspaceTerminalService } = require("./services/dev/workspace-terminal-service");
const { createDevWorkspaceAgentExecutionLoop } = require("./services/dev/workspace-agent-execution-loop");
const { createDevCostBudgetService } = require("./services/dev/dev-cost-budget-service");
const { createBenchmarkComposition, createDevDelegationComposition, createSelfDevComposition } = require("./services/dev/dev-auxiliary-composition");
const { createTransactionalExecutionEngine } = require("./services/execution/transactional-execution-engine");
const { AsyncLocalStorage } = require("node:async_hooks");
const { createNoonObservability } = require("./services/observability/noon-observability");
const { createNoonHealthReport } = require("./services/observability/noon-health-report");
const { smallFirstDecision } = require("./services/models/small-first-policy");
const { toChatProgressEvent } = require("./services/observability/chat-progress-event");
const { createUserProgressEngine } = require("./services/observability/user-progress-engine");
const { createUserProgressAdapter } = require("./services/observability/user-progress-adapter");
const { createOrchestratorProgressObservability } = require("./services/observability/orchestrator-progress-observability");
const { createConfigRegistry } = require("./services/config/config-registry");
const { createRuntimeConfigService } = require("./services/config/runtime-config-service");
const { createFeatureFlagRegistry } = require("./services/config/feature-flag-registry");
const { createFeatureFlagService } = require("./services/config/feature-flag-service");
const { createShadowComparator } = require("./services/config/shadow-comparator");
const { createDurableStoreRegistry } = require("./services/lifecycle/durable-store-registry");
const { createBackupService } = require("./services/lifecycle/backup-service");
const { createUpdateJournal } = require("./services/lifecycle/update-journal");
const { createMigrationManager } = require("./services/lifecycle/migration-manager");
const { createUpdateRecoveryEngine } = require("./services/lifecycle/update-recovery-engine");
const {
  IMAGE_GENERATION_ESTIMATED_COST_USD,
  MODEL_PRICING,
  TRANSCRIPTION_PRICE_PER_MINUTE,
  WEB_SEARCH_PRICE_PER_CALL,
  estimateModelCost,
} = require("./services/observability/model-pricing");
const { ApprovalManager } = require("./services/approvals/approval-manager");
const { createPrivateSeedImporter, validateSeed } = require("./services/personal-memory/seed-importer");
const { readJsonBody } = require("./services/http/request-utils");
const { createTimeSlotService } = require("./services/scheduling/time-slot-service");
const { createProactiveEngine } = require("./services/proactive/proactive-engine");
const { createDailyPlanStore } = require("./services/planning/daily-plan-store");
const { createDailyPlanningEngine } = require("./services/planning/daily-planning-engine");
const { createExecutionTrackingEngine } = require("./services/tracking/execution-tracking-engine");
const { createReviewLearningEngine } = require("./services/review/review-learning-engine");
const { createModelPerformanceEngine } = require("./services/learning/model-performance-engine");
const { createAdaptiveRoutingService } = require("./services/learning/adaptive-routing-service");
const { createBackgroundAnalysisService } = require("./services/openai/background-analysis");
const { createJobRegistry } = require("./services/jobs/job-registry");
const { createJobStore } = require("./services/jobs/job-store");
const { createBackgroundJobEngine } = require("./services/jobs/background-job-engine");
const { createNotificationAttentionEngine, createNotificationStore } = require("./services/notifications");
const { createCapabilityRegistry, createLocalIntelligenceRuntime, createLocalModelAdapter } = require("./services/runtime");
const { createExtensionRegistry, createExtensionRuntime } = require("./services/extensions");
const { createMcpService } = require("./services/mcp");
const { createRemoteLanService } = require("./services/remote/remote-lan-service");
const { createRemoteLanHttpRoutes } = require("./services/remote/remote-lan-http-routes");
const noonExampleSearchExtension = require("./services/extensions/sample/noon-example-search");
const { createArtifactEngine } = require("./services/artifacts/artifact-engine");
const { createAuditLog } = require("./services/security/audit-log");
const { createSkillRegistry } = require("./skills/registry");
const { createPersonalSearchEngine } = require("./services/search/personal-search-engine");
const { createMultiSourceSynthesisEngine } = require("./services/synthesis/multi-source-synthesis-engine");
const { createFileSearchAdapter } = require("./services/search/file-search-adapter");
const { createOpenAIWebSearchAdapter } = require("./services/research/web-search-adapter");
const { createPublicResearchEngine } = require("./services/research/public-research-engine");
const { createInternetDecisionRouter } = require("./services/research/internet-decision-router");
const { createMultimodalEngine, createNativePdfAnalyzer } = require("./services/multimodal/multimodal-engine");
const { createOpenAIMediaAnalyzer } = require("./services/multimodal/openai-media-analyzer");
const {
  createCalendarAdapter,
  createConversationAdapter,
  createEmailAdapter,
  createMemoryAdapter,
  createProjectAdapter,
  createSimpleLocalAdapter,
} = require("./services/search/source-adapters");
const {
  GOOGLE_AUTH_LIBRARY_VERSION,
  createGoogleAuthorization,
  discardGoogleState,
  exchangeGoogleCode,
  normalizeGoogleTokenForPersistence,
  rejectGoogleAuthorization,
  inspectGoogleApiFailure,
  assertGoogleProfileResponse,
} = require("./services/connectors/google-auth");
const { createHttpRouteModules } = require("./services/http/route-modules-composition");

// Tous les chemins manipulés par les outils sont contrôlés par config.js.

const DEFAULT_PORT = Number(process.env.NOON_PORT || 3000);
const DEFAULT_HOST = "127.0.0.1";
const DATA_DIRECTORY = process.env.NOON_DATA_DIR || __dirname;
const UI_VALIDATION_MODE = process.env.NOON_UI_VALIDATION === "1";
assertUiValidationDataDirectory({ dataDirectory: DATA_DIRECTORY });
const uiValidationFixtures = UI_VALIDATION_MODE ? resolveUiValidationFixtures() : [];
fs.mkdirSync(DATA_DIRECTORY, { recursive: true });
const CREATIVE_IMAGE_PREVIEW_DIRECTORY = path.join(
  DATA_DIRECTORY,
  "creative-image-previews"
);
const ARTIFACT_PREVIEW_DIRECTORY = path.join(DATA_DIRECTORY, "artifact-previews");
const localPermissionStore = createLocalPermissionStore(path.join(DATA_DIRECTORY, "local-permissions.json"));
const toolAuditLog = createAuditLog(path.join(DATA_DIRECTORY, "tool-audit.json"));
const configRegistry = createConfigRegistry();
const runtimeConfig = createRuntimeConfigService({
  registry: configRegistry,
  filePath: path.join(DATA_DIRECTORY, "runtime-config.json"),
  environment: {
    "reliability.timeoutMs": process.env.NOON_CONNECTOR_TIMEOUT_MS,
  },
  observability: (event, metadata) => toolAuditLog.append(`config.${event}`, metadata),
});
if (UI_VALIDATION_MODE) {
  runtimeConfig.set("runtime.executionPreference", "LOCAL_ONLY", { scope: "USER", origin: "ui-validation" });
  runtimeConfig.set("offline.queueNetworkJobs", false, { scope: "USER", origin: "ui-validation" });
}
const featureFlagRegistry = createFeatureFlagRegistry();
const featureFlags = createFeatureFlagService({
  registry: featureFlagRegistry,
  runtimeConfig,
  observability: (event, metadata) => toolAuditLog.append(`features.${event}`, metadata),
  promotionGate: ({ criticalEvalsGreen = false, blockingRegressions = 0 }) => ({
    allowed: criticalEvalsGreen === true && Number(blockingRegressions) === 0,
  }),
});
const shadowComparator = createShadowComparator({
  observability: (event, metadata) => toolAuditLog.append(`features.${event}`, metadata),
});
const devCostBudgetService = createDevCostBudgetService({
  filePath: path.join(DATA_DIRECTORY, "dev-cost-ledger.json"),
  config: () => {
    const optionalLimit = (key) => {
      const value = Number(runtimeConfig.get(key).value);
      return value > 0 ? value : null;
    };
    return {
      enabled: runtimeConfig.get("devBudget.enabled").value,
      taskLimit: optionalLimit("devBudget.taskLimitUsd"),
      dailyLimit: optionalLimit("devBudget.dailyLimitUsd"),
      monthlyLimit: optionalLimit("devBudget.monthlyLimitUsd"),
    };
  },
  observability: (event, metadata) => toolAuditLog.append(`dev-budget.${event}`, metadata),
});
devCostBudgetService.recoverStale();

const { selectConfiguredModelRoute } = createConfiguredModelRoute({
  MODEL_DEFINITIONS,
  get adaptiveRoutingService() { return adaptiveRoutingService; },
  featureFlags,
  normalizeIntelligenceProfile,
  get reliabilityEngine() { return reliabilityEngine; },
  selectLegacyModelRoute,
  selectModelRoute,
  shadowComparator,
  smallFirstDecision,
  toolAuditLog,
});

const noonObservability = createNoonObservability({
  filePath: path.join(DATA_DIRECTORY, "noon-observability.jsonl"),
});
const providerPrivacyPolicy = createProviderPrivacyPolicy({
  providerRegistry: PROVIDERS,
  providerTiers: { google_ai: process.env.GEMINI_TIER === "PAID" ? "PAID" : "FREE" },
  observability: (event, metadata) => toolAuditLog.append(event, metadata),
});
function authorizeOpenAIPrivacy(fragments, requestPolicy = {}) {
  const decision = providerPrivacyPolicy.evaluateProviderAccess({
    provider: "openai",
    contextMetadata: {
      fragments: fragments.map((fragment) => providerPrivacyPolicy.inspectContextFragment(fragment)),
    },
    requestPolicy,
  });
  if (decision.decision !== "ALLOW") {
    const error = new Error("La politique de confidentialité interdit cet appel distant.");
    error.code = decision.reasonCodes[0] || "REMOTE_PROVIDER_POLICY_REQUIRED";
    throw error;
  }
  return decision.permissionToken;
}
const openAIProviderAdapter = createOpenAIProviderAdapter({
  clientProvider: getOpenAIClient,
  privacyPolicy: providerPrivacyPolicy,
});
const geminiProviderAdapter = createGeminiProviderAdapter({ clientProvider: getGeminiClient, privacyPolicy: providerPrivacyPolicy });
const geminiShadowRunner = createProviderShadowRunner({
  adapter: geminiProviderAdapter,
  privacyPolicy: providerPrivacyPolicy,
  model: "gemini-3.8-flash",
  enabled: Boolean(process.env.GEMINI_API_KEY) && process.env.NOON_GEMINI_ENABLED !== "false",
  rollout: process.env.GEMINI_API_KEY && process.env.NOON_GEMINI_ROLLOUT !== "OFF" ? "SHADOW" : "OFF",
  tier: process.env.GEMINI_TIER === "PAID" ? "PAID" : "FREE",
  configured: Boolean(process.env.GEMINI_API_KEY),
  observability: (event, metadata) => toolAuditLog.append(event, metadata),
});
const reliabilityEngine = createReliabilityEngine({
  observability: (event, metadata) => {
    toolAuditLog.append(`reliability.${event}`, metadata);
    metricsService?.record?.(event, 1, metadata);
  },
});
reliabilityEngine.register({
  componentId: "public-web-search", type: "remote_api", criticality: "optional",
  capabilities: ["search", "citations", "current_information"], ttlMs: 60_000,
  healthCheck: async () => ({ ok: Boolean(process.env.OPENAI_API_KEY) }),
  impact: "Les informations publiques actuelles ne peuvent pas être vérifiées ; les recherches personnelles restent disponibles.",
});
const publicWebSearchAdapter = createOpenAIWebSearchAdapter({
  client: { responses: { create: (...args) => {
    authorizeOpenAIPrivacy([{ source: "public_web_search", classification: "PUBLIC", content: args[0]?.input || "" }]);
    return getOpenAIClient().responses.create(...args);
  } } },
  modelRouter: selectConfiguredModelRoute,
  observability: (event, metadata) => {
    toolAuditLog.append(`research.${event}`, metadata);
    metricsService?.record?.(event, 1, metadata);
  },
  onResponse(response) {
    trackUsage(response);
    const calls = countWebSearchCalls(response);
    if (calls > 0) registerWebSearchCalls(calls);
  },
});
const publicResearchEngine = createPublicResearchEngine({
  adapter: publicWebSearchAdapter,
  reliability: reliabilityEngine,
  observability: (event, metadata) => {
    toolAuditLog.append(`research.${event}`, metadata);
    metricsService?.record?.(event, 1, metadata);
  },
});
const internetDecisionRouter = createInternetDecisionRouter();
const voiceIdentity = createVoiceIdentity({
  selectionPath: path.join(DATA_DIRECTORY, "voice-identity.json"),
  debug: (event, metadata) => {
    toolAuditLog.append(event, metadata);
    if (metadata?.executionId) noonObservability.recordVoice(metadata.executionId, metadata);
  },
});
const skillRegistry = createSkillRegistry(undefined, { auditLog: toolAuditLog });
skillRegistry.validateRegistry();
let personalSearchEngine = null;
let multiSourceSynthesisEngine = null;
let multimodalEngine = null;
const ENABLE_TOOL_SEARCH = process.env.ENABLE_TOOL_SEARCH !== "false";
function getAllowedDirectories() {
  return [...new Set([...ALLOWED_DIRECTORIES, ...localPermissionStore.roots()])];
}
const GOOGLE_ACCOUNT_EMAIL = "arno.piette@gmail.com";
const { getGoogleAccessToken, sendGoogleCallbackPage, completeGoogleOAuthCallback, createGoogleReadAuthorization, normalizeGmailMessage, searchAuthorizedGmail } = createGoogleAccount({
  GOOGLE_ACCOUNT_EMAIL,
  GOOGLE_AUTH_LIBRARY_VERSION,
  assertGoogleProfileResponse,
  get calendarConnector() { return calendarConnector; },
  createGoogleAuthorization,
  discardGoogleState,
  exchangeGoogleCode,
  get gmailConnector() { return gmailConnector; },
  http,
  inspectGoogleApiFailure,
  get integrationTokenStore() { return integrationTokenStore; },
  get localIntelligenceRuntime() { return localIntelligenceRuntime; },
  normalizeGoogleTokenForPersistence,
  rejectGoogleAuthorization,
  toolAuditLog,
});
let electronSafeStorage = null;
try {
  ({ safeStorage: electronSafeStorage } = require("electron"));
} catch {
  // Le serveur Node seul conserve alors le jeton uniquement en mémoire.
}
const runtimeSafeStorage = process.env.NOON_SMOKE_TEST === "1" || UI_VALIDATION_MODE
  ? null
  : electronSafeStorage;
const integrationTokenStore = createTokenStore({
  filePath: path.join(DATA_DIRECTORY, "integration-tokens.json"),
  safeStorage: runtimeSafeStorage,
});

const USAGE_FILE = path.join(DATA_DIRECTORY, "usage.json");
const MONTHLY_BUDGET_USD = 30;

// GPT-5.6 Luna — coût par million de tokens.
const LUNA_INPUT_PRICE = 0.20;
const LUNA_OUTPUT_PRICE = 1.20;
const MODEL_PRICES = Object.freeze(Object.fromEntries(
  Object.entries(MODEL_PRICING).map(([model, pricing]) => [model, {
    input: pricing.input,
    output: pricing.output,
  }])
));
const CACHED_INPUT_DISCOUNT = 0.1;
const WEB_SEARCH_MAX_PER_REQUEST = 2;
const WEB_SEARCH_DAILY_LIMIT = 10;
const WEB_SEARCH_USAGE_FILE = path.join(
  DATA_DIRECTORY,
  "web-search-usage.json"
);
const VOICE_BUDGET_USD = Number(
  process.env.NOON_VOICE_BUDGET_USD || 11
);
const VOICE_USAGE_FILE = path.join(DATA_DIRECTORY, "voice-usage.json");
const PROJECTS_REGISTRY_FILE = path.join(DATA_DIRECTORY, "projects-registry.json");
const REALTIME_MAX_SESSION_MS = Number(
  process.env.NOON_REALTIME_MAX_SESSION_MS || 20 * 60 * 1000
);
const REALTIME_IDLE_TIMEOUT_MS = Number(
  process.env.NOON_REALTIME_IDLE_TIMEOUT_MS || 2 * 60 * 1000
);
const rememberedRealtimeTurns = new Set();
const creativeBriefStore = createCreativeBriefStore(path.join(DATA_DIRECTORY, "creative-brief.json"));
const personalBriefStore = createCreativeBriefStore(path.join(DATA_DIRECTORY, "personal-brief.json"));
const planningPreferenceStore = createPlanningPreferenceStore(path.join(DATA_DIRECTORY, "planning-preferences.json"));
const dailyPlanStore = createDailyPlanStore(path.join(DATA_DIRECTORY, "daily-plans.json"));
const longTermMemoryStore = createLongTermMemoryStore(path.join(DATA_DIRECTORY, "long-term-memory.json"));
const personalDatabase = createPersonalDatabase(path.join(DATA_DIRECTORY, "personal-intelligence.sqlite"));
const modelPerformanceRepository = createModelPerformanceRepository(personalDatabase);
const modelPerformanceEngine = createModelPerformanceEngine({
  repository: modelPerformanceRepository,
});
noonObservability.attachModelPerformanceEngine(modelPerformanceEngine);

const chatProgressRequestContext =
  new AsyncLocalStorage();

const userProgressEngine =
  createUserProgressEngine({
    onEvent(event) {
      const scope =
        chatProgressRequestContext
          .getStore();

      if (
        !scope ||
        typeof scope.writeProgress !==
          "function"
      ) {
        return;
      }

      try {
        scope.writeProgress(event);
      } catch {
        /*
         * L'affichage Progress ne doit jamais
         * casser l'exécution métier.
         */
      }
    },
  });

const userProgressAdapter =
  createUserProgressAdapter({
    progressEngine:
      userProgressEngine,
  });

function publicDevProgress(
  executionId
) {
  const id =
    String(
      executionId || ""
    ).trim();

  if (!id) {
    return null;
  }

  try {
    return toChatProgressEvent(
      userProgressEngine.latest(
        id
      )
    );
  } catch {
    /*
     * La projection de progression
     * ne doit jamais casser l'API DEV.
     */
    return null;
  }
}

const orchestratorObservability =
  createOrchestratorProgressObservability({
    observability:
      noonObservability,
    progressAdapter:
      userProgressAdapter,
  });
const adaptiveRoutingService = createAdaptiveRoutingService({
  performanceEngine: modelPerformanceEngine,
  selectModelRoute,
  shadowComparator,
  audit: (event, metadata) => toolAuditLog.append(event, metadata),
});
const runtimeCapabilityRegistry = createCapabilityRegistry([
  { capabilityId: "DETERMINISTIC_INTENT", provider: "IntentCommandEngine", executionLocation: "LOCAL_DETERMINISTIC", availability: "AVAILABLE", qualityClass: "FULL", supportsLocalOnly: true },
  { capabilityId: "LOCAL_FILES", provider: "filesystem", executionLocation: "LOCAL_DETERMINISTIC", availability: "AVAILABLE", qualityClass: "FULL", supportsLocalOnly: true },
  { capabilityId: "LOCAL_SEARCH", provider: "PersonalSearchEngine", executionLocation: "LOCAL_DETERMINISTIC", availability: "AVAILABLE", qualityClass: "FULL", supportsLocalOnly: true },
  { capabilityId: "LOCAL_MEMORY", provider: "MemoryEngine", executionLocation: "LOCAL_DETERMINISTIC", availability: "AVAILABLE", qualityClass: "FULL", supportsLocalOnly: true },
  { capabilityId: "LOCAL_DATABASE", provider: "SQLite", executionLocation: "LOCAL_DETERMINISTIC", availability: "AVAILABLE", qualityClass: "FULL", supportsLocalOnly: true },
  { capabilityId: "LOCAL_WORKSPACE", provider: "WorkspaceEngine", executionLocation: "LOCAL_DETERMINISTIC", availability: "AVAILABLE", qualityClass: "FULL", supportsLocalOnly: true },
  { capabilityId: "LOCAL_ARTIFACT_BASIC", provider: "ArtifactEngine", executionLocation: "LOCAL_DETERMINISTIC", availability: "AVAILABLE", qualityClass: "GOOD", supportsLocalOnly: true },
  { capabilityId: "LOCAL_SCHEDULING", provider: "PlanningEngine", executionLocation: "LOCAL_DETERMINISTIC", availability: "AVAILABLE", qualityClass: "GOOD", supportsLocalOnly: true },
  { capabilityId: "LOCAL_PDF_TEXT", provider: "MultimodalEngine", executionLocation: "LOCAL_DETERMINISTIC", availability: "AVAILABLE", qualityClass: "GOOD", supportsLocalOnly: true },
  { capabilityId: "LOCAL_NOTIFICATIONS", provider: "NotificationAttentionEngine", executionLocation: "LOCAL_DETERMINISTIC", availability: "AVAILABLE", qualityClass: "FULL", supportsLocalOnly: true },
  { capabilityId: "LOCAL_MODEL_TEXT", provider: "NONE", executionLocation: "LOCAL_MODEL", availability: "UNAVAILABLE", qualityClass: "LIMITED", supportsLocalOnly: true, metadata: { alternativeFor: "REMOTE_REASONING" } },
  { capabilityId: "REMOTE_REASONING", provider: "OpenAI", executionLocation: "REMOTE_MODEL", availability: "AVAILABLE", qualityClass: "FULL", requiresNetwork: true, supportsLocalOnly: false },
  { capabilityId: "REMOTE_WEB_SEARCH", provider: "PublicResearchEngine", executionLocation: "REMOTE_SERVICE", availability: "AVAILABLE", qualityClass: "FULL", requiresNetwork: true, requiresRemoteData: true, supportsLocalOnly: false },
  { capabilityId: "REMOTE_GMAIL", provider: "Gmail", executionLocation: "REMOTE_SERVICE", availability: "AVAILABLE", qualityClass: "FULL", requiresNetwork: true, requiresRemoteData: true, supportsLocalOnly: false },
  { capabilityId: "REMOTE_GOOGLE_CALENDAR", provider: "GoogleCalendar", executionLocation: "REMOTE_SERVICE", availability: "AVAILABLE", qualityClass: "FULL", requiresNetwork: true, requiresRemoteData: true, supportsLocalOnly: false },
  { capabilityId: "REMOTE_GITHUB", provider: "GitHub", executionLocation: "REMOTE_SERVICE", availability: "AVAILABLE", qualityClass: "FULL", requiresNetwork: true, requiresRemoteData: true, supportsLocalOnly: false },
  { capabilityId: "REMOTE_FIGMA", provider: "Figma", executionLocation: "REMOTE_SERVICE", availability: "AVAILABLE", qualityClass: "FULL", requiresNetwork: true, requiresRemoteData: true, supportsLocalOnly: false },
  { capabilityId: "REMOTE_REALTIME", provider: "OpenAIRealtime", executionLocation: "REMOTE_SERVICE", availability: "AVAILABLE", qualityClass: "FULL", requiresNetwork: true, supportsLocalOnly: false },
  { capabilityId: "REMOTE_IMAGE_GENERATION", provider: "OpenAIImages", executionLocation: "REMOTE_SERVICE", availability: "AVAILABLE", qualityClass: "FULL", requiresNetwork: true, supportsLocalOnly: false },
  { capabilityId: "REMOTE_VISION", provider: "OpenAIVision", executionLocation: "REMOTE_MODEL", availability: "AVAILABLE", qualityClass: "FULL", requiresNetwork: true, supportsLocalOnly: false },
  { capabilityId: "REMOTE_TRANSCRIPTION", provider: "OpenAITranscription", executionLocation: "REMOTE_SERVICE", availability: "AVAILABLE", qualityClass: "FULL", requiresNetwork: true, supportsLocalOnly: false },
]);
const localModelAdapter = createLocalModelAdapter();
const localIntelligenceRuntime = createLocalIntelligenceRuntime({
  registry: runtimeCapabilityRegistry, localModel: localModelAdapter, reliability: reliabilityEngine, config: runtimeConfig,
  observability: (event, metadata) => toolAuditLog.append(`runtime.${event}`, metadata),
});
const notificationsFlag = featureFlags.evaluate("notifications.engine");
const notificationAttentionEngine = createNotificationAttentionEngine({
  store: createNotificationStore({ database: personalDatabase }),
  featureMode: notificationsFlag.mode,
  observability: (event, metadata) => toolAuditLog.append(`notifications.${event}`, metadata),
});
const jobRegistry = createJobRegistry();
const jobStore = personalDatabase.kind === "sqlite" ? createJobStore(personalDatabase) : null;
const jobsFlag = featureFlags.evaluate("jobs.engine");
const backgroundJobEngine = jobStore ? createBackgroundJobEngine({
  store: jobStore,
  registry: jobRegistry,
  mode: jobsFlag.mode,
  maxQueuedJobs: runtimeConfig.get("jobs.maxQueued").value,
  maxRunningJobs: runtimeConfig.get("jobs.maxRunning").value,
  leaseMs: runtimeConfig.get("jobs.leaseMs").value,
  observability: (event, metadata) => {
    toolAuditLog.append(
      `jobs.${event}`,
      metadata,
    );

    userProgressAdapter.backgroundJob(
      event,
      metadata,
    );
  },
  notify: async ({ jobId, type, state, sessionId }) => {
    toolAuditLog.append("jobs.notification", { jobId, type, state });
    await notificationAttentionEngine.submit({
      source: "BACKGROUND_JOB", type: state === "SUCCEEDED" ? "COMPLETION" : state === "FAILED" ? "FAILURE" : "STATUS_CHANGE",
      subjectRef: jobId, conversationId: sessionId || null, importance: state === "FAILED" ? "HIGH" : "NORMAL",
      interruptionLevel: state === "FAILED" ? "IMPORTANT" : "NORMAL", userActionRequired: state === "FAILED",
      preferredChannels: ["IN_APP", "MACOS_NOTIFICATION", "BADGE"], allowedChannels: ["IN_APP", "MACOS_NOTIFICATION", "BADGE"],
      dedupeKey: `background-job:${jobId}:${state}`, replaceKey: `background-job:${jobId}`, payloadRef: `job:${jobId}`,
      title: state === "SUCCEEDED" ? "Travail Noon terminé" : "État du travail Noon",
      summary: state === "SUCCEEDED" ? "Le résultat demandé est prêt dans Noon." : `Le travail est maintenant ${state}.`,
      genericSummary: "Un travail Noon a changé d’état.",
    }, { appFocused: false, preferences: { soundEnabled: false, voiceEnabled: false }, quietHours: {
      enabled: runtimeConfig.get("notifications.quietHoursEnabled").value,
      startTime: runtimeConfig.get("notifications.quietHoursStart").value,
      endTime: runtimeConfig.get("notifications.quietHoursEnd").value,
      timezone: "Europe/Paris",
    } });
    if (sessionId) setSessionActivity(sessionId, state === "SUCCEEDED" ? "done" : "idle", state === "SUCCEEDED" ? "Travail en arrière-plan prêt." : `Travail en arrière-plan : ${state}.`);
  },
}) : null;
reliabilityEngine.register({
  componentId: "local-intelligence-runtime", type: "local_service", criticality: "important",
  capabilities: ["capability_resolution", "offline_policy", "local_only"], ttlMs: 30_000,
  healthCheck: async () => ({ ok: localIntelligenceRuntime.health().status === "ok" }),
  impact: "Le cœur local reste disponible, mais le routage dégradé peut nécessiter une explication manuelle.",
});
reliabilityEngine.register({
  componentId: "notification-attention", type: "local_service", criticality: "important",
  capabilities: ["attention_policy", "notification_dedupe", "delivery_state"], ttlMs: 30_000,
  healthCheck: async () => ({ ok: notificationAttentionEngine.health().status === "ok" }),
  impact: "Les informations restent consultables dans Noon, mais les interruptions externes peuvent être différées.",
});
if (backgroundJobEngine) {
  for (const component of ["job-store", "job-queue", "job-worker", "job-scheduler"]) {
    reliabilityEngine.register({
      componentId: component,
      type: "local_service",
      criticality: component === "job-store" ? "important" : "optional",
      capabilities: ["background_jobs", "recovery"],
      ttlMs: 30_000,
      healthCheck: async () => ({ ok: Boolean(backgroundJobEngine.stats()) }),
      impact: "Les travaux longs restent disponibles en mode direct, sans reprise persistante.",
    });
  }
}
const personalRepository = createPersonalIntelligenceRepository(personalDatabase);
const goalStrategyRepository = createGoalStrategyRepository(personalDatabase);
const approvalRepository = createApprovalRepository(personalDatabase);
const transactionalExecutionRepository = createTransactionalExecutionRepository(personalDatabase);
const artifactRepository = createArtifactRepository(personalDatabase);
const workspaceRepository = createWorkspaceRepository(personalDatabase);
const devProjectRuleRepository = createDevProjectRuleRepository(personalDatabase);
const devProjectRuleResolver = createDevProjectRuleResolver({ repository: devProjectRuleRepository });
const sessionContinuityRepository = createSessionContinuityRepository(personalDatabase);
const executionTrackingRepository = createExecutionTrackingRepository(personalDatabase);
const reviewLearningRepository = createReviewLearningRepository(personalDatabase);
const {
  attachmentResolver,
  autonomousMemoryPipeline,
  executeExplicitConversationMemoryCommand,
  hardRulesRegistry,
  memoryEngine,
  privateMemoryCipher,
  privateMemoryService,
  recentAutomaticMemoryIds,
  recentAutomaticMemoryReports,
  runLegacyMemoryMigrationOnce,
} = createPersonalMemoryComposition({
  DATA_DIRECTORY,
  longTermMemoryStore,
  personalDatabase,
  personalRepository,
  runtimeSafeStorage,
  toolAuditLog,
  get contextBuilder() { return contextBuilder; },
  get createConversationKey() { return createConversationKey; },
  get getConversationHistory() { return getConversationHistory; },
  get multiSourceSynthesisEngine() { return multiSourceSynthesisEngine; },
  get operationalProfileService() { return operationalProfileService; },
  get personalSearchEngine() { return personalSearchEngine; },
});
const realtimeVoiceConfig = createRealtimeVoiceConfig({
  voiceIdentity,
  memoryEngine,
  buildSystemPrompt: buildNoonSystemPrompt,
  maxHistoryMessages: 60,
});
let workspaceEngine = null;
const ambientContextEngine = createAmbientContextEngine({
  featureMode: "SHADOW",
  audit: (event, metadata) => toolAuditLog.append(event, metadata),
});
const decisionSupportEngine = createDecisionSupportEngine({
  featureMode: "SHADOW",
  audit: (event, metadata) => toolAuditLog.append(event, metadata),
});
const goalStrategyEngine = createGoalStrategyEngine({
  registry: createGoalRegistry({
    repository: goalStrategyRepository,
  }),
  projectProvider: () => getValidRegisteredProjects(),
  workspaceProvider: () => workspaceEngine?.list?.() || [],
  featureMode: "LIMITED",
  observability: (event, metadata) => toolAuditLog.append(`goals.${event}`, metadata),
});
const capacityService = createCapacityService({
  cacheTtlMs: 60_000,
  audit: (event, metadata) => toolAuditLog.append(`portfolio.${event}`, metadata),
});
const portfolioCapacityEngine = createPortfolioCapacityEngine({
  capacityService,
  decisionSupportEngine,
  featureMode: "SHADOW",
  audit: (event, metadata) => toolAuditLog.append(`portfolio.${event}`, metadata),
});
const { characterStore, contextBuilder } = createPersonalContextComposition({
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
  get calendarConnector() { return calendarConnector; },
  get createConversationKey() { return createConversationKey; },
  get executionTrackingEngine() { return executionTrackingEngine; },
  get getConversationHistory() { return getConversationHistory; },
  get getValidRegisteredProjects() { return getValidRegisteredProjects; },
  get gmailConnector() { return gmailConnector; },
  get notesConnector() { return notesConnector; },
  get personalSearchEngine() { return personalSearchEngine; },
  get remindersConnector() { return remindersConnector; },
  get sessionContinuityEngine() { return sessionContinuityEngine; },
  get workspaceEngine() { return workspaceEngine; },
});
workspaceEngine = createWorkspaceEngine({
  repository: workspaceRepository,
  allowedRoots: (mode) => mode === "read-write"
    ? (UI_VALIDATION_MODE ? uiValidationFixtures.map((fixture) => fixture.rootPath) : localPermissionStore.roots("read-write"))
    : (UI_VALIDATION_MODE ? uiValidationFixtures.map((fixture) => fixture.rootPath) : getAllowedDirectories()),
  projectProvider: () => getValidRegisteredProjects(),
  conversationProvider: () => normalizeConversationStore(getConversationIndex()).conversations,
  artifactProvider: () => artifactRepository.listAll(100).map((artifact) => ({
    artifactId: artifact.artifact_id,
    version: artifact.version,
    title: artifact.title,
    type: artifact.artifact_type,
    format: artifact.output_format,
    state: artifact.state,
    updatedAt: artifact.updated_at,
  })),
  invalidateContext: (workspaceId) => contextBuilder.invalidateProject(workspaceId),
  observability: (event, metadata) => toolAuditLog.append(event, metadata),
});
async function classifyIntentWithModel({ text, channel, context }) {
  const budget = getBudgetStatus();
  const route = selectModelRoute({ question: text, profile: "economical", budgetMode: budget.mode, attachments: 0 });
  const privacyDecisionToken = authorizeOpenAIPrivacy([
    { source: "intent_request", classification: "PERSONAL", content: text },
    { source: "intent_context", classification: "PERSONAL", content: { channel, activeWorkspaceId: context.activeWorkspaceId } },
  ]);
  const response = await openAIProviderAdapter.execute({
    model: route.model,
    store: false,
    input: [{ role: "system", content: "Classe uniquement l’intention. Ne propose ni outil ni exécution." }, { role: "user", content: JSON.stringify({ text, channel, activeWorkspaceId: context.activeWorkspaceId }) }],
    text: { format: { type: "json_schema", name: "normalized_intent_hint", strict: true, schema: { type: "object", properties: { type: { type: "string", enum: ["ASK", "SEARCH", "CREATE", "UPDATE", "DELETE", "OPEN", "NAVIGATE", "PLAN", "REMIND", "SCHEDULE", "SUMMARIZE", "COMPARE", "GENERATE", "SWITCH_CONTEXT", "CONTROL", "CONFIRM", "REJECT", "CONTINUE", "CANCEL"] }, action: { type: "string" }, entities: { type: "object", properties: { title: { type: ["string", "null"] }, query: { type: ["string", "null"] }, format: { type: ["string", "null"] }, mode: { type: ["string", "null"] }, personName: { type: ["string", "null"] }, workspaceName: { type: ["string", "null"] } }, required: ["title", "query", "format", "mode", "personName", "workspaceName"], additionalProperties: false }, target: { type: "object", properties: { workspaceId: { type: ["string", "null"] }, projectId: { type: ["string", "null"] }, conversationId: { type: ["string", "null"] }, artifactId: { type: ["string", "null"] }, eventId: { type: ["string", "null"] }, approvalId: { type: ["string", "null"] }, executionId: { type: ["string", "null"] }, fileRef: { type: ["string", "null"] } }, required: ["workspaceId", "projectId", "conversationId", "artifactId", "eventId", "approvalId", "executionId", "fileRef"], additionalProperties: false }, confidence: { type: "string", enum: ["high", "medium", "low"] }, ambiguity: { type: "array", items: { type: "object", properties: { type: { type: "string" }, field: { type: "string" }, candidates: { type: "array", items: { type: "object", properties: { id: { type: ["string", "null"] }, label: { type: ["string", "null"] } }, required: ["id", "label"], additionalProperties: false } }, confidence: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] }, resolutionRequired: { type: "boolean" } }, required: ["type", "field", "candidates", "confidence", "resolutionRequired"], additionalProperties: false } } }, required: ["type", "action", "entities", "target", "confidence", "ambiguity"], additionalProperties: false } } },
  }, { privacyDecisionToken });
  trackUsage(response);
  return JSON.parse(response.text || "{}");
}
const intentCommandEngine = createIntentCommandEngine({
  workspaceEngine,
  semanticClassifier: classifyIntentWithModel,
  observability: (event, metadata) => toolAuditLog.append(event, metadata),
});
const priorityEngine = createPriorityEngine({
  debug: (event, metadata) => toolAuditLog.append(event, metadata),
});
const approvalManager = new ApprovalManager({
  auditLog: toolAuditLog,
  repository: approvalRepository,
  ttlMs: Number(process.env.NOON_APPROVAL_TTL_MS) || 5 * 60 * 1000,
});
const interventionPermissionEngine =
  createInterventionPermissionEngine();

const sessionContinuityEngine = createPersonalSessionContinuity({
  approvalManager,
  contextBuilder,
  sessionContinuityRepository,
  toolAuditLog,
  workspaceEngine,
  get createConversationKey() { return createConversationKey; },
  get getConversationTranscript() { return getConversationTranscript; },
});
const artifactEngine = createArtifactEngine({
  repository: artifactRepository,
  writableRoots: () => localPermissionStore.roots("read-write"),
  previewDirectory: ARTIFACT_PREVIEW_DIRECTORY,
  approvalEngine: approvalManager,
  observability: (event, metadata) => toolAuditLog.append(event, metadata),
});
artifactEngine.cleanupPreviews();
const externalCapabilityDisabled = UI_VALIDATION_MODE ? "Cette capacité externe est désactivée pendant la validation UI isolée." : null;
const remindersConnector = createAppleConnector({ reliability: reliabilityEngine, disabledReason: externalCapabilityDisabled });
const notesConnector = createAppleNotesConnector({ reliability: reliabilityEngine, disabledReason: externalCapabilityDisabled });
const gmailConnector = createGmailConnector({
  tokenStore: integrationTokenStore,
  getGoogleAccessToken,
  runtime: localIntelligenceRuntime,
  configured: () => Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET),
  approvals: approvalManager,
  reliability: reliabilityEngine, disabledReason: externalCapabilityDisabled,
});
const calendarConnector = createCalendarConnector({
  tokenStore: integrationTokenStore,
  getGoogleAccessToken,
  runtime: localIntelligenceRuntime,
  configured: () => Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET),
  approvals: approvalManager,
  reliability: reliabilityEngine, disabledReason: externalCapabilityDisabled,
});

reliabilityEngine.register({
  componentId: "sqlite", type: "storage", criticality: "critical",
  capabilities: ["read", "write", "schema"], ttlMs: 30_000,
  healthCheck: async ({ deep }) => {
    if (personalDatabase.kind !== "sqlite") {
      const error = new Error("SQLite indisponible : fallback local actif.");
      error.code = "SQLITE_FALLBACK"; throw error;
    }
    personalDatabase.database.prepare("SELECT 1 AS ok").get();
    const version = personalDatabase.database.prepare(
      "SELECT version FROM schema_migrations WHERE name = 'personal-intelligence-base' ORDER BY version DESC LIMIT 1"
    ).get()?.version;
    if (Number(version) !== SCHEMA_VERSION) throw Object.assign(new Error("Schema version mismatch"), { code: "SCHEMA_MISMATCH" });
    if (deep) personalDatabase.database.prepare("PRAGMA quick_check").get();
    return { ok: true };
  },
  impact: "La mémoire, les sessions et les registres persistants peuvent être indisponibles.",
});
reliabilityEngine.register({
  componentId: "private-memory", type: "storage", criticality: "important",
  capabilities: ["read", "decrypt", "candidate_write"], ttlMs: 60_000,
  healthCheck: async () => {
    if (!privateMemoryService.available || !privateMemoryCipher) throw Object.assign(new Error("Private memory key missing"), { code: "KEYSTORE_UNAVAILABLE" });
    return { ok: true };
  }, impact: "Les souvenirs privés ne peuvent pas être consultés.",
});
reliabilityEngine.register({
  componentId: "filesystem", type: "filesystem", criticality: "important",
  capabilities: ["read", "search"], ttlMs: 30_000,
  healthCheck: async () => {
    const roots = getAllowedDirectories();
    if (!roots.length) throw Object.assign(new Error("No authorized root"), { code: "CONFIGURATION_ERROR" });
    const missing = roots.filter((root) => !fs.existsSync(root));
    if (missing.length === roots.length) throw Object.assign(new Error("All roots unavailable"), { status: 503 });
    const denied = roots.filter((root) => { try { fs.accessSync(root, fs.constants.R_OK); return false; } catch { return true; } });
    if (denied.length) throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    return { degradedCapabilities: missing.length ? ["missing_roots"] : [] };
  }, impact: "Certains dossiers locaux ne peuvent pas être parcourus.",
});
reliabilityEngine.register({
  componentId: "context-cache", type: "engine", criticality: "important",
  capabilities: ["read", "invalidate"], ttlMs: 30_000,
  healthCheck: async () => { const stats = contextBuilder.cacheStats(); if (!Number.isFinite(stats.entries) || stats.entries < 0) throw new Error("Cache invalid response"); return { ok: true }; },
  safeRepair: async () => contextBuilder.clearContextCache(),
  impact: "Le contexte sera reconstruit sans cache.",
});
reliabilityEngine.register({
  componentId: "portfolio-capacity", type: "engine", criticality: "optional",
  capabilities: ["capacity_snapshot", "portfolio_snapshot", "overload", "scenario_simulation"], ttlMs: 60_000,
  healthCheck: async () => {
    const state = portfolioCapacityEngine.health();
    if (state.executionAuthority || state.calendarWriteAuthority || state.projectWriteAuthority || state.goalWriteAuthority) {
      throw Object.assign(new Error("Portfolio authority boundary violated"), { code: "PORTFOLIO_AUTHORITY_VIOLATION" });
    }
    return state;
  },
  impact: "L’analyse globale de capacité peut être indisponible ; Planning et Priority restent inchangés.",
});
reliabilityEngine.register({
  componentId: "artifacts", type: "renderer", criticality: "optional",
  capabilities: ["docx", "pdf", "pptx", "xlsx", "png"], ttlMs: 60_000,
  healthCheck: async () => { fs.mkdirSync(ARTIFACT_PREVIEW_DIRECTORY, { recursive: true }); fs.accessSync(ARTIFACT_PREVIEW_DIRECTORY, fs.constants.R_OK | fs.constants.W_OK); return { ok: true }; },
  impact: "La prévisualisation ou certains exports peuvent être indisponibles.",
});
for (const [connector, operation] of [[notesConnector, "listRecentNotes"], [remindersConnector, "listIncompleteReminders"]]) {
  reliabilityEngine.register({ componentId: connector.id, type: "connector", criticality: "optional",
    capabilities: connector.readCapabilities, ttlMs: 60_000, authState: () => connector.status.authState,
    healthCheck: async () => { await connector[operation](); }, impact: "Cette source locale ne peut pas être vérifiée." });
}
reliabilityEngine.register({ componentId: "gmail", type: "connector", criticality: "optional", capabilities: ["read", "search", "draft"], ttlMs: 60_000, authState: () => gmailConnector.connected ? "connected" : "missing", healthCheck: async () => { if (!gmailConnector.connected) throw Object.assign(new Error("Google non connecté"), { status: 401, code: "AUTH_MISSING" }); await gmailConnector.searchGmailMessages("newer_than:1d", { maxResults: 1 }); }, impact: "Les emails ne peuvent pas être vérifiés ou inclus." });
reliabilityEngine.register({ componentId: "google-calendar", type: "connector", criticality: "optional", capabilities: ["read", "availability", "write"], ttlMs: 60_000, authState: () => calendarConnector.connected ? "connected" : "missing", healthCheck: async () => { if (!calendarConnector.connected) throw Object.assign(new Error("Google non connecté"), { status: 401, code: "AUTH_MISSING" }); await calendarConnector.listCalendars(); }, impact: "Les disponibilités de l’agenda restent inconnues." });
reliabilityEngine.register({ componentId: "openai-models", type: "model", criticality: "important", capabilities: ["luna", "terra", "sol", "astra"], ttlMs: 60_000, healthCheck: async () => { if (!process.env.OPENAI_API_KEY) throw Object.assign(new Error("OpenAI API key missing"), { code: "CONFIGURATION_ERROR" }); }, impact: "Le chat IA et les analyses distantes ne peuvent pas répondre." });
reliabilityEngine.register({ componentId: "google-ai-models", type: "model", criticality: "optional", capabilities: ["gemini"], ttlMs: 60_000, healthCheck: async () => { if (!process.env.GEMINI_API_KEY) throw Object.assign(new Error("Gemini credential missing"), { code: "CONFIGURATION_ERROR" }); }, impact: "Gemini est exclu ; OpenAI reste disponible." });
for (const modelId of ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-6-astra"]) {
  reliabilityEngine.register({ componentId: modelId, type: "model", criticality: "optional", capabilities: ["responses"], ttlMs: 30_000, circuitThreshold: 2, impact: "Ce profil de modèle est temporairement évité par le routeur." });
}
reliabilityEngine.register({ componentId: "gemini-3.8-flash", type: "model", criticality: "optional", capabilities: ["generateContent"], ttlMs: 30_000, circuitThreshold: 2, circuitCooldownMs: 30_000, impact: "Gemini est temporairement évité après deux échecs transitoires ; OpenAI reste disponible." });
reliabilityEngine.register({ componentId: "realtime", type: "voice", criticality: "optional", capabilities: ["webrtc", "stt", "tts"], ttlMs: 60_000, fallback: "text-chat", fallbackQuality: "degraded", healthCheck: async () => { if (!process.env.OPENAI_API_KEY) throw Object.assign(new Error("OpenAI API key missing"), { code: "CONFIGURATION_ERROR" }); }, impact: "La voix Live est indisponible, mais le chat texte reste utilisable." });
reliabilityEngine.register({ componentId: "wake-word", type: "voice", criticality: "optional", capabilities: ["wake_word"], ttlMs: 120_000, impact: "L’activation par « Salut Noon » peut être indisponible." });
reliabilityEngine.register({ componentId: "scheduler", type: "scheduler", criticality: "important", capabilities: ["daily_brief"], ttlMs: 60_000, impact: "Le brief planifié peut être retardé." });
for (const [componentId, capabilities] of [
  ["multimodal-image", ["vision", "ocr"]],
  ["multimodal-screenshot", ["vision", "ocr"]],
  ["multimodal-pdf", ["native_text", "vision", "ocr"]],
  ["multimodal-audio", ["speech_transcription"]],
]) {
  reliabilityEngine.register({
    componentId, type: "multimodal", criticality: "optional", capabilities,
    ttlMs: 60_000,
    healthCheck: async () => {
      if (!process.env.OPENAI_API_KEY) throw Object.assign(
        new Error("OpenAI API key missing"), { code: "CONFIGURATION_ERROR" }
      );
      return { ok: true };
    },
    impact: "L’analyse de ce type de média est temporairement indisponible.",
  });
}

const operationalSecurityPolicy = createOperationalSecurityPolicy({
  hardRulesRegistry,
  reliabilityEngine,
  allowedRootsProvider: () => getAllowedDirectories(),
  allowedWriteRootsProvider: () => localPermissionStore.roots("read-write"),
  observability: (event, metadata) => toolAuditLog.append(event, metadata),
});

// V3-L5a : l'exécutant externe travaille dans un worktree détaché, hors de tout dépôt.
// En développement, DATA_DIRECTORY est le dépôt Noon lui-même : les worktrees vont alors dans
// ~/.noon-dev pour ne jamais être imbriqués dans le dépôt cible.
const EXECUTOR_WORKTREE_ROOT = path.join(
  path.resolve(DATA_DIRECTORY) === path.resolve(__dirname) ? path.join(require("node:os").homedir(), ".noon-dev") : DATA_DIRECTORY,
  "executor-worktrees",
);
const executorWorktreeManager = createExecutorWorktreeManager({ rootDir: EXECUTOR_WORKTREE_ROOT });

const sandboxDevValidationExecutor =
  createSandboxDevValidationExecutor({
    workspaceEngine,
    operationalSecurityPolicy,
    isolatedWorkspaceResolver: (root) => executorWorktreeManager.resolveSource(root),
    observability:
      (event, metadata) =>
        toolAuditLog.append(
          `dev.sandbox.${event}`,
          metadata
        ),
  });

const devWorkspaceTerminalService = createDevWorkspaceTerminalService({
  workspaceEngine,
  operationalSecurityPolicy,
  observability: (event, metadata) =>
    toolAuditLog.append(`dev.terminal.${event}`, metadata),
});
const devWorkspaceAgentExecutionLoop = createDevWorkspaceAgentExecutionLoop({
  terminalService: devWorkspaceTerminalService,
  operationalSecurityPolicy,
  approvalEngine: approvalManager,
  observability: (event, metadata) => {
    toolAuditLog.append(
      `dev.workspace-agent.${event}`,
      metadata,
    );

    userProgressAdapter.devAgent(
      event,
      metadata,
    );
  },
});
const { refreshDailyWebSearchUsage, registerWebSearchCalls, getVoiceBudgetStatus, registerRealtimeUsage, calculateTranscriptionCostUSD, trackImageGenerationUsage, getBudgetStatus, getRuntimeLimits, trackUsage, trackTranscriptionUsage } = createUsageTracking({
  CACHED_INPUT_DISCOUNT,
  IMAGE_GENERATION_ESTIMATED_COST_USD,
  LUNA_INPUT_PRICE,
  LUNA_OUTPUT_PRICE,
  MODEL_PRICES,
  MONTHLY_BUDGET_USD,
  TRANSCRIPTION_PRICE_PER_MINUTE,
  USAGE_FILE,
  VOICE_BUDGET_USD,
  VOICE_USAGE_FILE,
  WEB_SEARCH_DAILY_LIMIT,
  WEB_SEARCH_PRICE_PER_CALL,
  WEB_SEARCH_USAGE_FILE,
  get metricsService() { return metricsService; },
});
const openAIMediaAnalyzer = createOpenAIMediaAnalyzer({
  client: getOpenAIClient,
  privacyPolicy: providerPrivacyPolicy,
  trackUsage,
});
multimodalEngine = createMultimodalEngine({
  allowedRoots: getAllowedDirectories,
  vision: openAIMediaAnalyzer.vision,
  nativeDocument: createNativePdfAnalyzer(),
  transcribe: Object.assign(async ({ asset, buffer }) => {
    const text = await transcribeAudioBuffer(buffer, asset.mimeType);
    return {
      summary: text.slice(0, 2000),
      evidence: text ? [{
        type: "AUDIO_TRANSCRIPT", content: text, confidence: "UNKNOWN",
        observationType: "OBSERVATION", extractionMethod: "speech_transcription",
      }] : [],
      segments: [],
      partial: false,
    };
  }, { local: false }),
  synthesis: (...args) => multiSourceSynthesisEngine?.synthesize(...args),
  workspaceLink: async (workspaceId, asset) => {
    workspaceEngine.get(workspaceId);
    return asset.assetId;
  },
  securityPolicy: operationalSecurityPolicy,
  modelRouter: selectModelRoute,
  reliability: reliabilityEngine,
  observability: (event, metadata) => toolAuditLog.append(`multimodal.${event}`, metadata),
});
const transactionalExecutionEngine = createTransactionalExecutionEngine({
  repository: transactionalExecutionRepository,
  skillRegistry,
  reliabilityEngine,
  observability: (event, metadata) => {
    toolAuditLog.append(
      event,
      metadata,
    );

    userProgressAdapter.transactional(
      event,
      metadata,
    );
  },
});
const {
  goalDevExecutionService,
  goalDevRetryRuntime,
  nativeDevB3Facade,
  nativeDevCoordinator,
  nativeDevJournal,
} = createNativeDevComposition({
  DATA_DIRECTORY,
  approvalManager,
  authorizeOpenAIPrivacy,
  devCostBudgetService,
  devProjectRuleResolver,
  estimateModelCost,
  evaluationEngineProvider: () => agentEvaluationEngine,
  featureFlags,
  getValidRegisteredProjects: () => getValidRegisteredProjects(),
  goalStrategyEngine,
  interventionPermissionEngine,
  openAIProviderAdapter,
  operationalSecurityPolicy,
  personalDatabase,
  runtimeConfig,
  sandboxDevValidationExecutor,
  selectConfiguredModelRoute,
  skillRegistry,
  toolAuditLog,
  trackUsage,
  transactionalExecutionEngine,
  userProgressAdapter,
  workspaceEngine,
});

/*
 * Branchement B1 — runtime Goal Mode DEV (flag goals.mode-dev, OFF par défaut).
 * Aucune route ici (B2). Construit seulement si le flag n'est pas OFF au
 * démarrage ; un échec de composition n'empêche jamais Noon de démarrer.
 * Activation réelle : exige aussi 4C-2 (réconciliation) et B3 (UI).
 */
// 4C-2 / B3b : verrou exclusif sur DATA_DIRECTORY, acquis au démarrage avant le
// scan de réconciliation, libéré à l'arrêt. Périmé : repris automatiquement
// seulement si même hostname + ESRCH (mutex de reprise) ; sinon reprise explicite.
const dataDirectoryLock = createDataDirectoryLock({ directory: DATA_DIRECTORY });
process.once("exit", () => { try { dataDirectoryLock.release(); } catch {} });

const { selfDevHttpRoutes, selfDevPathPolicyProvider } = createSelfDevComposition({
  DATA_DIRECTORY,
  UI_VALIDATION_MODE,
  featureFlags,
  localIntelligenceRuntime,
  localPermissionStore,
  sandboxDevValidationExecutor,
  toolAuditLog,
  workspaceEngine,
});

// Compagnon iPhone (IP-3, flag remote.lan OFF par défaut) : passerelle LAN démarrée
// uniquement à la demande depuis le Control Center ; identité du Mac dans le coffre safeStorage.
const remoteLanEnabled = () => featureFlags.evaluate("remote.lan", {}).mode !== "OFF" &&
  !UI_VALIDATION_MODE && process.env.NOON_SMOKE_TEST !== "1" && process.env.NOON_SAFE_MODE !== "1";
let remoteLanService = null;
const remoteLanHttpRoutes = createRemoteLanHttpRoutes({
  isEnabled: remoteLanEnabled,
  service: () => {
    remoteLanService ||= createRemoteLanService({
      isEnabled: remoteLanEnabled, databaseWrapper: personalDatabase, secureStore: integrationTokenStore,
      port: Number(process.env.NOON_REMOTE_LAN_PORT) || undefined,
      observability: (event, metadata) => toolAuditLog.append(event, metadata),
    });
    return remoteLanService;
  },
  observability: (event, metadata) => toolAuditLog.append(event, metadata),
});

const { goalModeDevHttp, goalModeDevLockMaintenance } = createGoalModeDevComposition({
  DATA_DIRECTORY,
  approvalManager,
  authorizeOpenAIPrivacy,
  createAuditLog,
  dataDirectoryLock,
  devCostBudgetService,
  devProjectRuleResolver,
  estimateModelCost,
  featureFlags,
  goalStrategyEngine,
  nativeDevB3Facade,
  nativeDevJournal,
  openAIProviderAdapter,
  operationalSecurityPolicy,
  personalDatabase,
  readJsonBody,
  runtimeConfig,
  selectConfiguredModelRoute,
  selfDevPathPolicyProvider,
  toolAuditLog,
  trackUsage,
  workspaceEngine,
});

toolAuditLog.append(
  "goals.dev-retry.runtime_composed",
  {
    persistence:
      goalDevRetryRuntime
        .persistenceCapabilities(),
  }
);

const devDecisionConsumer =
  createDevDecisionConsumer({
    nativeDevFacade:
      nativeDevB3Facade,
    decisionSupportEngine,
  });

const nativeDevUiExecutionService = createNativeDevUiComposition({
  devProjectRuleResolver,
  devWorkspaceTerminalService,
  featureFlags,
  nativeDevB3Facade,
  toolAuditLog,
  workspaceEngine,
});

// Les extensions enrichissent les registries existants ; elles ne reçoivent jamais les services internes bruts.
const extensionRuntime = createExtensionRuntime({
  securityPolicy: operationalSecurityPolicy,
  allowedRoots: getAllowedDirectories(),
  observability: (event, metadata) => toolAuditLog.append(`extensions.${event}`, metadata),
  transactionalExecutor: async ({ skill, input, actionRequest, decision, operation, execution }) => {
    const result = await transactionalExecutionEngine.executeSingleStep({
      executionId: execution.executionId,
      actionRequest,
      policyDecision: decision,
      approvalRequired: decision.requiredApproval === true,
      approvalRef: execution.approval || null,
      workspaceId: execution.workspaceId || null,
      profileScope: execution.profileScope || "arnaud",
      step: { skillId: skill.id, operation: skill.id, args: input, actionClass: skill.permissionLevel, verificationLevel: "BASIC" },
      executeStep: operation,
      revalidate: () => operationalSecurityPolicy.evaluate({ actionRequest, skillPolicy: { level: skill.permissionLevel.toLowerCase() }, pendingApproval: execution.approval || null }),
      verifyStep: async () => ({ verified: true, reasonCode: "EXTENSION_SCHEMA_VALIDATED" }),
    });
    if (result.status !== "SUCCEEDED") throw Object.assign(new Error("Exécution transactionnelle incomplète."), { code: `EXTENSION_TRANSACTION_${result.status}` });
    return result.result;
  },
});
const extensionRegistry = createExtensionRegistry({
  noonVersion: require("./package.json").version,
  skillRegistry,
  runtime: extensionRuntime,
  reliability: reliabilityEngine,
  enabled: featureFlags.evaluate("extensions.sdk").enabled,
  developerMode: process.env.NOON_EXTENSION_DEV_MODE === "true",
  observability: (event, metadata) => toolAuditLog.append(`extensions.${event}`, metadata),
});
extensionRuntime.bindRegistry(extensionRegistry);
// Client MCP (flag connectors.mcp, OFF par défaut) : outils en lecture seule
// validés par l'utilisateur, jetons dans le coffre safeStorage existant.
const mcpService = createMcpService({
  enabled: featureFlags.evaluate("connectors.mcp").enabled && !UI_VALIDATION_MODE && process.env.NOON_SMOKE_TEST !== "1",
  dataDirectory: DATA_DIRECTORY,
  tokenStore: integrationTokenStore,
  skillRegistry,
  clientVersion: require("./package.json").version,
  // Mode local uniquement / hors ligne : aucun serveur MCP distant (Figma = REMOTE_FIGMA).
  isRemoteAllowed: (capabilityId) => localIntelligenceRuntime.preflight({ requiredCapabilities: [capabilityId] }).status === "AVAILABLE",
  observability: (event, metadata) => toolAuditLog.append(event, metadata),
});
// L'extension de démonstration reste disponible pour les tests de développement,
// mais ne doit jamais concurrencer la vraie recherche publique en production.
if (process.env.NOON_ENABLE_EXAMPLE_SEARCH_EXTENSION === "true") {
  extensionRegistry.discover({ manifest: noonExampleSearchExtension.manifest, module: noonExampleSearchExtension, provenance: "BUNDLED", trust: "TRUSTED", signed: true });
  extensionRegistry.install(noonExampleSearchExtension.manifest.id, { approvedPermissions: noonExampleSearchExtension.manifest.permissions });
  void extensionRegistry.enable(noonExampleSearchExtension.manifest.id).catch((error) => {
    toolAuditLog.append("extensions.extension_failed", { extensionId: noonExampleSearchExtension.manifest.id, errorCode: String(error.code || "ACTIVATION_FAILED") });
  });
}

const specialistRegistry = createSpecialistRegistry();
const contextCapsuleBuilder = createContextCapsuleBuilder();
const { codexSpecialistAgent, devDelegationRunner, devMissionHttpRoutes } = createDevDelegationComposition({
  UI_VALIDATION_MODE,
  approvalManager,
  executorWorktreeManager,
  featureFlags,
  operationalSecurityPolicy,
  sandboxDevValidationExecutor,
  toolAuditLog,
  workspaceEngine,
});

// Plugin Figma « Noon Bridge » (flag figma.bridge OFF par défaut) : serveur 127.0.0.1 démarré
// seulement à la génération d'un code de jumelage, ou au démarrage si un jumelage existe.
const figmaBridgeEnabled = () => featureFlags.evaluate("figma.bridge", {}).enabled &&
  process.env.NOON_SAFE_MODE !== "1" && process.env.NOON_SMOKE_TEST !== "1" && !UI_VALIDATION_MODE;
const figmaBridge = createFigmaBridge({
  stateFile: path.join(DATA_DIRECTORY, "figma-bridge.json"),
  port: Number(process.env.NOON_FIGMA_BRIDGE_PORT) || undefined,
  observability: (event, metadata) => toolAuditLog.append(event, metadata),
});
const figmaBridgeHttpRoutes = createFigmaBridgeHttpRoutes({ isEnabled: figmaBridgeEnabled, bridge: figmaBridge });
// Outils Figma du modèle (lecture ; écriture EXTERNAL sous validation) : seulement si le flag est actif.
const figmaToolsEnabled = figmaBridgeEnabled();
if (figmaToolsEnabled) registerFigmaSkills({ skillRegistry, bridge: figmaBridge });
const { benchmarkControlPlane } = createBenchmarkComposition({
  DATA_DIRECTORY,
  codexSpecialistAgent,
  featureFlags,
  nativeDevCoordinator,
  operationalSecurityPolicy,
  personalDatabase,
  runtimeConfig,
  toolAuditLog,
});
const delegationEngine = createChatDelegation({
  authorizeOpenAIPrivacy,
  contextCapsuleBuilder,
  devDelegationRunner,
  estimateModelCost,
  openAIProviderAdapter,
  reliabilityEngine,
  selectConfiguredModelRoute,
  specialistRegistry,
  toolAuditLog,
  trackUsage,
  get metricsService() { return metricsService; },
});
transactionalExecutionEngine.recoverInterrupted();
reliabilityEngine.register({
  componentId: "transactional-execution", type: "core", criticality: "critical",
  capabilities: ["plan", "journal", "idempotency", "verify", "recover"], ttlMs: 30_000,
  healthCheck: async () => {
    if (!transactionalExecutionEngine.version()) throw Object.assign(new Error("Execution engine unavailable"), { code: "CONFIGURATION_ERROR" });
    transactionalExecutionRepository.listRecoverable();
    return { ok: true };
  },
  impact: "Les actions mutantes restent bloquées tant que leur journal fiable est indisponible.",
});
reliabilityEngine.register({
  componentId: "security-policy", type: "core", criticality: "critical",
  capabilities: ["evaluate", "risk", "approval_decision"], ttlMs: 30_000,
  healthCheck: async () => {
    if (!operationalSecurityPolicy.version()) throw Object.assign(new Error("Security policy unavailable"), { code: "CONFIGURATION_ERROR" });
    return { ok: true };
  },
  impact: "Les actions sont bloquées par sécurité tant que la politique centrale est indisponible.",
});
for (const specialist of specialistRegistry.list()) {
  reliabilityEngine.register({
    componentId: `specialist-${specialist.specialistId.toLowerCase()}`,
    type: "specialist",
    criticality: "optional",
    capabilities: specialist.capabilities,
    ttlMs: 60_000,
    healthCheck: async () => ({ ok: Boolean(process.env.OPENAI_API_KEY) }),
    impact: `L’analyse spécialisée ${specialist.specialistId} est indisponible ; Noon conserve son traitement direct.`,
  });
}

const { agentEvaluationEngine, noonOrchestrator } = createChatOrchestration({
  ENABLE_TOOL_SEARCH,
  WEB_SEARCH_PRICE_PER_CALL,
  approvalManager,
  contextBuilder,
  delegationEngine,
  geminiProviderAdapter,
  geminiShadowRunner,
  hardRulesRegistry,
  integrationTokenStore,
  interventionPermissionEngine,
  modelFallbacks,
  noonObservability,
  openAIProviderAdapter,
  operationalSecurityPolicy,
  orchestratorObservability,
  priorityEngine,
  providerPrivacyPolicy,
  registerWebSearchCalls,
  reliabilityEngine,
  selectConfiguredModelRoute,
  skillRegistry,
  toolAuditLog,
  trackUsage,
  transactionalExecutionEngine,
  get metricsService() { return metricsService; },
  get setSessionActivity() { return setSessionActivity; },
});

const privateSeedImporter = privateMemoryService.available
  ? createPrivateSeedImporter(privateMemoryService)
  : null;
const memoryHttpRoutes = createMemoryHttpRoutes({ memoryEngine, seedImporter: privateSeedImporter, validateSeed });
const PUBLIC_DIRECTORY = path.join(__dirname, "public");
const staticAssets = createStaticAssets({ publicDirectory: PUBLIC_DIRECTORY });
const operationalProfileService = createOperationalProfileService(personalRepository);
const projectIntelligenceService = createProjectIntelligenceService(personalRepository);
const personalInboxService = createInboxService(personalRepository);
const quickCaptureService = createQuickCaptureService({ inboxService: personalInboxService });
// V3-L2b : « Où j'en étais ? », assemblé localement (aucun appel au modèle).
const resumeBriefingService = createResumeBriefingService({
  getActiveSession: () => sessionContinuityEngine.getActiveSession({}),
  resolveFocus: (focusId, focusPath) => resolveFocusCatalogSelection(focusId, focusPath),
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
const { dailyBriefEngine, briefUsageLog, briefScheduledTime, safeUsageLog, generateDailyBrief } = createDailyBriefComposition({
  DATA_DIRECTORY,
  authorizeOpenAIPrivacy,
  calendarConnector,
  contextBuilder,
  countWebSearchCalls,
  creativeBriefStore,
  dailyPlanningEngine,
  estimateModelCost,
  executionTrackingEngine,
  extractWebSources,
  getBudgetStatus,
  gmailConnector,
  localIntelligenceRuntime,
  memoryEngine,
  noonObservability,
  normalizeGmailMessage,
  notesConnector,
  openAIProviderAdapter,
  personalBriefStore,
  planningPreferenceStore,
  priorityEngine,
  proactiveEngine,
  projectIntelligenceService,
  redactSecrets,
  registerWebSearchCalls,
  reliabilityEngine,
  remindersConnector,
  reviewLearningEngine,
  selectModelRoute,
  toolAuditLog,
  trackUsage,
});

// V3-L6 (G.1, G.2, G.6) : bilan local « Santé de Noon » (traces, coût par jour, usage du Brief).
const NOON_DAILY_COST_CAP_USD = Number(process.env.NOON_DAILY_COST_CAP_USD) > 0 ? Number(process.env.NOON_DAILY_COST_CAP_USD) : MONTHLY_BUDGET_USD / 30;
const noonHealthReport = createNoonHealthReport({
  listTraces: (options) => noonObservability.listTraces(options),
  usageStatus: () => getBudgetStatus(),
  briefUsage: () => briefUsageLog.summary({ days: 14 }),
  budgets: { dailyCostUSD: NOON_DAILY_COST_CAP_USD },
});

const { getValidRegisteredProjects, initializeUiValidationWorkspaces, scanRegisteredProjects, isExcluded, listDirectory, isPathAllowed, normalizeFocusPath, getProjectContextVersion, normalizeFocusName, normalizeNoonMode, listLocalProjects, resolveFocusProject, resolveFocusCatalogSelection, searchFiles, readAllowedFile, handleLocalCommand } = createLocalProjects({
  PRIORITY_DIRECTORIES,
  PROJECTS_REGISTRY_FILE,
  UI_VALIDATION_MODE,
  getAllowedDirectories,
  uiValidationFixtures,
  get workspaceEngine() { return workspaceEngine; },
});

// Les contextes UI Validation sont déclarés ici mais initialisés
// seulement après conversationIndex : workspaceEngine.context()
// peut consulter conversationProvider pendant leur création.
let uiValidationProjectContexts = [];


const buildIntentContext = createIntentContextBuilder({
  approvalManager,
  intentCommandEngine,
  sessionContinuityEngine,
  get createConversationKey() { return createConversationKey; },
  get getConversationHistory() { return getConversationHistory; },
  get workspaceEngine() { return workspaceEngine; },
});

const askAI = createAskAI({
  get CREATIVE_IMAGE_PREVIEW_DIRECTORY() { return CREATIVE_IMAGE_PREVIEW_DIRECTORY; },
  get WEB_SEARCH_PRICE_PER_CALL() { return WEB_SEARCH_PRICE_PER_CALL; },
  get artifactEngine() { return artifactEngine; },
  get authorizeOpenAIPrivacy() { return authorizeOpenAIPrivacy; },
  get backgroundJobEngine() { return backgroundJobEngine; },
  get calendarConnector() { return calendarConnector; },
  get contextBuilder() { return contextBuilder; },
  get executionTrackingEngine() { return executionTrackingEngine; },
  get featureFlags() { return featureFlags; },
  get figmaToolsEnabled() { return figmaToolsEnabled; },
  get getAllowedDirectories() { return getAllowedDirectories; },
  get getBudgetStatus() { return getBudgetStatus; },
  get getOpenAIClient() { return getOpenAIClient; },
  get getProjectContextVersion() { return getProjectContextVersion; },
  get getRuntimeLimits() { return getRuntimeLimits; },
  get getValidRegisteredProjects() { return getValidRegisteredProjects; },
  get gmailConnector() { return gmailConnector; },
  get isPathAllowed() { return isPathAllowed; },
  get listDirectory() { return listDirectory; },
  get localIntelligenceRuntime() { return localIntelligenceRuntime; },
  get localPermissionStore() { return localPermissionStore; },
  get memoryEngine() { return memoryEngine; },
  get multiSourceSynthesisEngine() { return multiSourceSynthesisEngine; },
  get multimodalEngine() { return multimodalEngine; },
  get noonOrchestrator() { return noonOrchestrator; },
  get notesConnector() { return notesConnector; },
  get personalInboxService() { return personalInboxService; },
  get personalSearchEngine() { return personalSearchEngine; },
  get planningPreferenceStore() { return planningPreferenceStore; },
  get publicResearchEngine() { return publicResearchEngine; },
  get readAllowedFile() { return readAllowedFile; },
  get reliabilityEngine() { return reliabilityEngine; },
  get remindersConnector() { return remindersConnector; },
  get runtimeConfig() { return runtimeConfig; },
  get searchAuthorizedGmail() { return searchAuthorizedGmail; },
  get searchFiles() { return searchFiles; },
  get sessionContinuityEngine() { return sessionContinuityEngine; },
  get setSessionActivity() { return setSessionActivity; },
  get timeSlotService() { return timeSlotService; },
  get toolAuditLog() { return toolAuditLog; },
  get trackImageGenerationUsage() { return trackImageGenerationUsage; },
  get workspaceEngine() { return workspaceEngine; },
});

const CONVERSATION_MEMORY_FILE = path.join(
  DATA_DIRECTORY,
  "conversation-memory.json"
);
const CONVERSATION_SUMMARIES_FILE = path.join(
  DATA_DIRECTORY,
  "conversation-summaries.json"
);
const CONVERSATION_INDEX_FILE = path.join(
  DATA_DIRECTORY,
  "conversation-index.json"
);

// Le lifecycle est initialement branché en diagnostic/dry-run : le bootstrap
// existant reste autoritaire et aucune migration utilisateur n'est rejouée.
const durableStoreRegistry = createDurableStoreRegistry([
  { storeId: "personal-database", path: personalDatabase.filePath, kind: personalDatabase.kind === "sqlite" ? "sqlite" : "json", criticality: "CRITICAL", sensitive: true, encrypted: false, validateBackup(backupPath) { if (personalDatabase.kind !== "sqlite") { JSON.parse(fs.readFileSync(backupPath, "utf8")); return true; } const sqlite = loadSqlite(); const candidate = new sqlite.DatabaseSync(backupPath, { readOnly: true }); try { return candidate.prepare("PRAGMA integrity_check").get()?.integrity_check === "ok" && Boolean(candidate.prepare("SELECT 1 FROM schema_migrations LIMIT 1").get()); } finally { candidate.close(); } } },
  { storeId: "conversations", path: CONVERSATION_MEMORY_FILE, kind: "json", criticality: "CRITICAL", sensitive: true, encrypted: false },
  { storeId: "conversation-index", path: CONVERSATION_INDEX_FILE, kind: "json", criticality: "CRITICAL", sensitive: true, encrypted: false },
  { storeId: "conversation-summaries", path: CONVERSATION_SUMMARIES_FILE, kind: "json", criticality: "IMPORTANT", sensitive: true, encrypted: false },
  { storeId: "runtime-config", path: path.join(DATA_DIRECTORY, "runtime-config.json"), kind: "json", criticality: "CRITICAL", sensitive: false, encrypted: false },
  { storeId: "projects-registry", path: PROJECTS_REGISTRY_FILE, kind: "json", criticality: "IMPORTANT", sensitive: true, encrypted: false },
  { storeId: "artifact-previews", path: ARTIFACT_PREVIEW_DIRECTORY, kind: "directory", criticality: "EPHEMERAL", rebuildable: true, backup: false },
]);
const lifecycleBackupService = createBackupService({
  backupRoot: path.join(DATA_DIRECTORY, "recovery-backups"),
  storeRegistry: durableStoreRegistry,
  appVersion: require("./package.json").version,
  schemaVersion: SCHEMA_VERSION,
  configSchemaVersion: configRegistry.schemaVersion,
  sqliteBackup: async (_store, destination) => {
    const escaped = String(destination).replace(/'/g, "''");
    personalDatabase.database.exec(`VACUUM INTO '${escaped}'`);
  },
  observability: (event, metadata) => toolAuditLog.append(`lifecycle.${event}`, metadata),
});
const lifecycleJournal = createUpdateJournal(path.join(DATA_DIRECTORY, "update-journal.json"));
const lifecycleMigrationManager = createMigrationManager({
  migrations: [], expectedSchemaVersion: SCHEMA_VERSION,
  minimumSupportedSchemaVersion: SCHEMA_VERSION,
  readSchemaVersion: () => Number(personalDatabase.kind === "sqlite"
    ? personalDatabase.database.prepare(
      "SELECT version FROM schema_migrations WHERE name = 'personal-intelligence-base' ORDER BY version DESC LIMIT 1"
    ).get()?.version
    : personalDatabase.load().version) || 0,
  writeSchemaVersion: () => { throw new Error("Aucune migration lifecycle active n'est enregistrée."); },
  observability: (event, metadata) => toolAuditLog.append(`lifecycle.${event}`, metadata),
});
const updateRecoveryEngine = createUpdateRecoveryEngine({
  appVersion: require("./package.json").version,
  migrationManager: lifecycleMigrationManager,
  backupService: lifecycleBackupService,
  journal: lifecycleJournal,
  runtimeConfig,
  featureFlags,
  reliability: reliabilityEngine,
  activeExecutions: () => transactionalExecutionRepository.listRecoverable(),
  secureStorageAvailable: () => privateMemoryService.available,
  observability: (event, metadata) => toolAuditLog.append(`lifecycle.${event}`, metadata),
});

const { controlCenterService } = createControlCenterComposition({
  ambientContextEngine,
  approvalManager,
  backgroundJobEngine,
  calendarConnector,
  configRegistry,
  createGoogleReadAuthorization,
  extensionRegistry,
  featureFlags,
  gmailConnector,
  goalStrategyEngine,
  hardRulesRegistry,
  localIntelligenceRuntime,
  localPermissionStore,
  memoryEngine,
  notesConnector,
  notificationAttentionEngine,
  portfolioCapacityEngine,
  privateMemoryService,
  reliabilityEngine,
  remindersConnector,
  runtimeConfig,
  toolAuditLog,
  updateRecoveryEngine,
  get workspaceEngine() { return workspaceEngine; },
});



const { getConversationIndex, conversationSummaries, replaceConversationIndex, touchConversation, deleteConversation, normalizeSessionId, createConversationKey, getConversationHistory, getConversationTranscript, rememberConversation, clearConversationSession } = createConversationStore({
  CONVERSATION_INDEX_FILE,
  CONVERSATION_MEMORY_FILE,
  CONVERSATION_SUMMARIES_FILE,
  contextBuilder,
  get multiSourceSynthesisEngine() { return multiSourceSynthesisEngine; },
  get personalSearchEngine() { return personalSearchEngine; },
  get sessionActivities() { return sessionActivities; },
});

// UI_VALIDATION_INIT_ORDER_FIX
// conversationIndex doit exister avant tout appel à workspaceEngine.context().
uiValidationProjectContexts =
  initializeUiValidationWorkspaces();

personalSearchEngine = createPersonalSearchEngine({
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
      version: () => `multimodal-${multimodalEngine.listAssets().length}`,
      search: (request) => multimodalEngine.search({
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
multiSourceSynthesisEngine = createMultiSourceSynthesisEngine({
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

const { sessionActivities, setSessionActivity, getSessionActivity, MAX_AUDIO_BYTES, transcribeAudioBuffer } = createSessionActivityAndTranscription({
  getOpenAIClient,
  toFile,
});

// Interface DEV de confiance : en-tête x-noon-request obligatoire (pure, partagée par les routes).
function requireTrustedDevUi(req) {
  if (req.headers["x-noon-request"] !== "1") {
    throw Object.assign(
      new Error("Requête Noon refusée."),
      {
        statusCode: 403,
        code: "TRUSTED_UI_REQUIRED",
      }
    );
  }
}

// V3-L7 : les modules de routes sont construits ensemble (services/http/route-modules-composition.js) ;
// chacun ne reçoit que ses DEPENDENCIES, lues à chaque accès dans cet objet. Les imports
// statiques (STATIC_ROUTE_DEPENDENCIES) sont fournis par la composition, pas ici.
const httpRouteDependencies = {
  get DATA_DIRECTORY() { return DATA_DIRECTORY; },
  get DEFAULT_HOST() { return DEFAULT_HOST; },
  get FIRST_STEP_MODEL() { return FIRST_STEP_MODEL; },
  get GOOGLE_ACCOUNT_EMAIL() { return GOOGLE_ACCOUNT_EMAIL; },
  get MAX_AUDIO_BYTES() { return MAX_AUDIO_BYTES; },
  get PUBLIC_DIRECTORY() { return PUBLIC_DIRECTORY; },
  get REALTIME_IDLE_TIMEOUT_MS() { return REALTIME_IDLE_TIMEOUT_MS; },
  get REALTIME_MAX_SESSION_MS() { return REALTIME_MAX_SESSION_MS; },
  get WEB_SEARCH_DAILY_LIMIT() { return WEB_SEARCH_DAILY_LIMIT; },
  get WEB_SEARCH_MAX_PER_REQUEST() { return WEB_SEARCH_MAX_PER_REQUEST; },
  get ambientContextEngine() { return ambientContextEngine; },
  get approvalManager() { return approvalManager; },
  get askAI() { return askAI; },
  get attachmentResolver() { return attachmentResolver; },
  get autonomousMemoryPipeline() { return autonomousMemoryPipeline; },
  get backgroundAnalysisService() { return backgroundAnalysisService; },
  get backgroundJobEngine() { return backgroundJobEngine; },
  get benchmarkControlPlane() { return benchmarkControlPlane; },
  get briefScheduledTime() { return briefScheduledTime; },
  get briefUsageLog() { return briefUsageLog; },
  get buildIntentContext() { return buildIntentContext; },
  get calculateTranscriptionCostUSD() { return calculateTranscriptionCostUSD; },
  get calendarConnector() { return calendarConnector; },
  get characterStore() { return characterStore; },
  get chatProgressRequestContext() { return chatProgressRequestContext; },
  get clearConversationSession() { return clearConversationSession; },
  get completeGoogleOAuthCallback() { return completeGoogleOAuthCallback; },
  get contextBuilder() { return contextBuilder; },
  get controlCenterService() { return controlCenterService; },
  get createConversationKey() { return createConversationKey; },
  get createGoogleReadAuthorization() { return createGoogleReadAuthorization; },
  get dailyBriefEngine() { return dailyBriefEngine; },
  get dailyPlanStore() { return dailyPlanStore; },
  get dailyPlanningEngine() { return dailyPlanningEngine; },
  get decisionSupportEngine() { return decisionSupportEngine; },
  get deleteConversation() { return deleteConversation; },
  get devCostBudgetService() { return devCostBudgetService; },
  get devDecisionConsumer() { return devDecisionConsumer; },
  get devMissionHttpRoutes() { return devMissionHttpRoutes; },
  get devProjectRuleResolver() { return devProjectRuleResolver; },
  get devWorkspaceAgentExecutionLoop() { return devWorkspaceAgentExecutionLoop; },
  get devWorkspaceTerminalService() { return devWorkspaceTerminalService; },
  get executeExplicitConversationMemoryCommand() { return executeExplicitConversationMemoryCommand; },
  get executionTrackingEngine() { return executionTrackingEngine; },
  get executionTrackingRepository() { return executionTrackingRepository; },
  get extensionRegistry() { return extensionRegistry; },
  get featureFlags() { return featureFlags; },
  get firstStepService() { return firstStepService; },
  get followUpService() { return followUpService; },
  get generateDailyBrief() { return generateDailyBrief; },
  get getAllowedDirectories() { return getAllowedDirectories; },
  get getBudgetStatus() { return getBudgetStatus; },
  get getConversationHistory() { return getConversationHistory; },
  get getConversationIndex() { return getConversationIndex; },
  get getConversationTranscript() { return getConversationTranscript; },
  get getGoogleAccessToken() { return getGoogleAccessToken; },
  get getSessionActivity() { return getSessionActivity; },
  get getValidRegisteredProjects() { return getValidRegisteredProjects; },
  get getVoiceBudgetStatus() { return getVoiceBudgetStatus; },
  get gmailConnector() { return gmailConnector; },
  get goalDevExecutionService() { return goalDevExecutionService; },
  get goalDevRetryRuntime() { return goalDevRetryRuntime; },
  get goalModeDevHttp() { return goalModeDevHttp; },
  get goalStrategyEngine() { return goalStrategyEngine; },
  get handleLocalCommand() { return handleLocalCommand; },
  get intentCommandEngine() { return intentCommandEngine; },
  get internetDecisionRouter() { return internetDecisionRouter; },
  get isPathAllowed() { return isPathAllowed; },
  get listDirectory() { return listDirectory; },
  get listLocalProjects() { return listLocalProjects; },
  get localIntelligenceRuntime() { return localIntelligenceRuntime; },
  get longTermMemoryStore() { return longTermMemoryStore; },
  get mcpService() { return mcpService; },
  get memoryEngine() { return memoryEngine; },
  get metricsService() { return metricsService; },
  get multiSourceSynthesisEngine() { return multiSourceSynthesisEngine; },
  get nativeDevB3Facade() { return nativeDevB3Facade; },
  get nativeDevUiExecutionService() { return nativeDevUiExecutionService; },
  get noonHealthReport() { return noonHealthReport; },
  get noonObservability() { return noonObservability; },
  get noonOrchestrator() { return noonOrchestrator; },
  get normalizeFocusName() { return normalizeFocusName; },
  get normalizeFocusPath() { return normalizeFocusPath; },
  get normalizeNoonMode() { return normalizeNoonMode; },
  get normalizeSessionId() { return normalizeSessionId; },
  get notesConnector() { return notesConnector; },
  get operationalProfileService() { return operationalProfileService; },
  get personalBriefStore() { return personalBriefStore; },
  get personalDatabase() { return personalDatabase; },
  get personalInboxService() { return personalInboxService; },
  get personalMigration() { return personalMigration; },
  get personalRepository() { return personalRepository; },
  get personalSearchEngine() { return personalSearchEngine; },
  get planningPreferenceStore() { return planningPreferenceStore; },
  get proactiveEngine() { return proactiveEngine; },
  get projectIntelligenceService() { return projectIntelligenceService; },
  get publicDevProgress() { return publicDevProgress; },
  get quickCaptureService() { return quickCaptureService; },
  get readAllowedFile() { return readAllowedFile; },
  get realtimeVoiceConfig() { return realtimeVoiceConfig; },
  get recentAutomaticMemoryIds() { return recentAutomaticMemoryIds; },
  get recentAutomaticMemoryReports() { return recentAutomaticMemoryReports; },
  get refreshDailyWebSearchUsage() { return refreshDailyWebSearchUsage; },
  get registerRealtimeUsage() { return registerRealtimeUsage; },
  get reliabilityEngine() { return reliabilityEngine; },
  get rememberConversation() { return rememberConversation; },
  get rememberedRealtimeTurns() { return rememberedRealtimeTurns; },
  get remindersConnector() { return remindersConnector; },
  get remoteLanHttpRoutes() { return remoteLanHttpRoutes; },
  get replaceConversationIndex() { return replaceConversationIndex; },
  get requireTrustedDevUi() { return requireTrustedDevUi; },
  get resolveFocusCatalogSelection() { return resolveFocusCatalogSelection; },
  get resolveFocusProject() { return resolveFocusProject; },
  get resumeBriefingService() { return resumeBriefingService; },
  get reviewLearningEngine() { return reviewLearningEngine; },
  get runtimeConfig() { return runtimeConfig; },
  get safeUsageLog() { return safeUsageLog; },
  get scanRegisteredProjects() { return scanRegisteredProjects; },
  get searchFiles() { return searchFiles; },
  get selectConfiguredModelRoute() { return selectConfiguredModelRoute; },
  get selfDevHttpRoutes() { return selfDevHttpRoutes; },
  get sendGoogleCallbackPage() { return sendGoogleCallbackPage; },
  get sessionActivities() { return sessionActivities; },
  get sessionContinuityEngine() { return sessionContinuityEngine; },
  get timeSlotService() { return timeSlotService; },
  get toolAuditLog() { return toolAuditLog; },
  get touchConversation() { return touchConversation; },
  get trackTranscriptionUsage() { return trackTranscriptionUsage; },
  get transcribeAudioBuffer() { return transcribeAudioBuffer; },
  get updateRecoveryEngine() { return updateRecoveryEngine; },
  get voiceIdentity() { return voiceIdentity; },
  get workspaceEngine() { return workspaceEngine; },
};
const httpRouteModules = createHttpRouteModules(httpRouteDependencies);

// Crée le serveur HTTP et renvoie toutes les réponses au format JSON.

const { server, startNoonServer, stopNoonServer } = createNoonHttpServer({
  ...httpRouteModules,
  DEFAULT_HOST,
  DEFAULT_PORT,
  NOT_HANDLED,
  UI_VALIDATION_MODE,
  backgroundJobEngine,
  dataDirectoryLock,
  figmaBridge,
  figmaBridgeEnabled,
  figmaBridgeHttpRoutes,
  goalModeDevLockMaintenance,
  http,
  isUiValidationExternalRequest,
  mcpService,
  memoryHttpRoutes,
  nativeDevB3Facade,
  nativeDevCoordinator,
  readJsonBody,
  reliabilityEngine,
  reportInterruptedNativeDevTasks,
  runLegacyMemoryMigrationOnce,
  sessionContinuityEngine,
  setProviderKeyLoaders,
  staticAssets,
  toolAuditLog,
});

// server.js est composé dans le processus main Electron (voir electron/main.js).
// Cette commande reste donc en mémoire : aucun secret ni jeton d'action ne traverse HTTP.
function mutateDevProjectRuleFromTrustedMain(payload) {
  assertUiValidationWorkspace(payload?.workspaceId);
  return executeDevProjectRuleCommand({ workspaceEngine, repository: devProjectRuleRepository, payload });
}

function listDevProjectRulesFromTrustedMain(workspaceId) {
  assertUiValidationWorkspace(workspaceId);
  return listTrustedDevProjectRules({ workspaceEngine, repository: devProjectRuleRepository, workspaceId });
}

function assertUiValidationWorkspace(workspaceId) {
  if (UI_VALIDATION_MODE && !isUiValidationWorkspaceId(workspaceId, uiValidationFixtures)) {
    throw Object.assign(new Error("Ce workspace n'est pas une fixture UI autorisée."), { code: "UI_VALIDATION_WORKSPACE_DENIED" });
  }
}

function listUiValidationProjectContextsFromTrustedMain() {
  return UI_VALIDATION_MODE ? uiValidationProjectContexts.map(({ workspaceId, projectId, name }) => ({ workspaceId, projectId, name })) : [];
}

if (require.main === module) {
  startNoonServer().catch((error) => {
    console.error("Impossible de démarrer Noon :", error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  server,
  sanitizeResponseOutputForInput,
  listDevProjectRulesFromTrustedMain,
  listUiValidationProjectContextsFromTrustedMain,
  mutateDevProjectRuleFromTrustedMain,
  startNoonServer,
  stopNoonServer,
};
