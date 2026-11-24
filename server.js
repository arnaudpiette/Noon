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
const { buildNoonSystemPrompt } = require("./lib/noon-system-prompt");
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
const { createCalendarConnector } = require("./services/connectors/google-calendar");
const { createAppleConnector } = require("./services/connectors/apple-reminders");
const { createAppleNotesConnector } = require("./services/connectors/apple-notes");
const { createVoiceIdentity } = require("./services/voice/voice-identity");
const { createRealtimeVoiceConfig } = require("./services/voice/realtime-config");
const { createPlanningPreferenceStore } = require("./lib/planning-preferences");
const { createPersonalDatabase } = require("./services/persistence/database");
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
const { createMemoryHttpRoutes } = require("./services/memory/memory-http-routes");
const { createPersonalMemoryComposition } = require("./services/memory/personal-memory-composition");
const { createPersonalContextComposition, createPersonalSessionContinuity } = require("./services/context/personal-context-composition");
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
const { createNoonObservability } = require("./services/observability/noon-observability");
const { createNoonHealthReport } = require("./services/observability/noon-health-report");
const { smallFirstDecision } = require("./services/models/small-first-policy");
const { createConfigRegistry } = require("./services/config/config-registry");
const { createRuntimeConfigService } = require("./services/config/runtime-config-service");
const { createFeatureFlagRegistry } = require("./services/config/feature-flag-registry");
const { createFeatureFlagService } = require("./services/config/feature-flag-service");
const { createShadowComparator } = require("./services/config/shadow-comparator");
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
const { createDailyPlanStore } = require("./services/planning/daily-plan-store");
const { createModelPerformanceEngine } = require("./services/learning/model-performance-engine");
const { createAdaptiveRoutingService } = require("./services/learning/adaptive-routing-service");
const { createCapabilityRegistry } = require("./services/runtime");
const { createRemoteLanService } = require("./services/remote/remote-lan-service");
const { createRemoteLanHttpRoutes } = require("./services/remote/remote-lan-http-routes");
const { createArtifactEngine } = require("./services/artifacts/artifact-engine");
const { createAuditLog } = require("./services/security/audit-log");
const { createSkillRegistry } = require("./skills/registry");
const { createOpenAIWebSearchAdapter } = require("./services/research/web-search-adapter");
const { createPublicResearchEngine } = require("./services/research/public-research-engine");
const { createInternetDecisionRouter } = require("./services/research/internet-decision-router");
const { createMultimodalEngine, createNativePdfAnalyzer } = require("./services/multimodal/multimodal-engine");
const { createOpenAIMediaAnalyzer } = require("./services/multimodal/openai-media-analyzer");
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
const { registerCoreReliabilityComponents } = require("./services/reliability/core-reliability-components");
const { createPersonalSearchComposition } = require("./services/search/personal-search-composition");
const { createLifecycleComposition } = require("./services/lifecycle/lifecycle-composition");
const { createPersonalIntelligenceComposition } = require("./services/personal-intelligence/personal-intelligence-composition");
const { createExtensionsComposition } = require("./services/extensions/extensions-composition");
const { createProgressComposition } = require("./services/observability/progress-composition");
const { createLocalRuntimeAndJobsComposition } = require("./services/runtime/local-runtime-and-jobs-composition");

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

const { chatProgressRequestContext, userProgressAdapter, publicDevProgress, orchestratorObservability } = createProgressComposition({ noonObservability });
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
const { localIntelligenceRuntime, notificationAttentionEngine, jobRegistry, backgroundJobEngine } = createLocalRuntimeAndJobsComposition({
  featureFlags,
  personalDatabase,
  reliabilityEngine,
  runtimeCapabilityRegistry,
  runtimeConfig,
  get setSessionActivity() { return setSessionActivity; },
  toolAuditLog,
  userProgressAdapter,
});
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

registerCoreReliabilityComponents({
  ARTIFACT_PREVIEW_DIRECTORY,
  calendarConnector,
  contextBuilder,
  getAllowedDirectories,
  gmailConnector,
  notesConnector,
  personalDatabase,
  portfolioCapacityEngine,
  privateMemoryCipher,
  privateMemoryService,
  reliabilityEngine,
  remindersConnector,
});

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

// Les extensions enrichissent les registries existants ; elles ne reçoivent jamais les services
// internes bruts. Client MCP : flag connectors.mcp, OFF par défaut (services/extensions/extensions-composition.js).
const { extensionRegistry, mcpService } = createExtensionsComposition({
  DATA_DIRECTORY,
  UI_VALIDATION_MODE,
  featureFlags,
  getAllowedDirectories,
  integrationTokenStore,
  localIntelligenceRuntime,
  operationalSecurityPolicy,
  reliabilityEngine,
  skillRegistry,
  toolAuditLog,
  transactionalExecutionEngine,
});

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
const {
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
} = createPersonalIntelligenceComposition({
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
  get resolveFocusCatalogSelection() { return resolveFocusCatalogSelection; },
  reviewLearningRepository,
  sessionContinuityEngine,
  toolAuditLog,
  trackUsage,
});
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
// existant reste autoritaire et aucune migration utilisateur n'est rejouée
// (services/lifecycle/lifecycle-composition.js).
const { updateRecoveryEngine } = createLifecycleComposition({
  ARTIFACT_PREVIEW_DIRECTORY,
  CONVERSATION_INDEX_FILE,
  CONVERSATION_MEMORY_FILE,
  CONVERSATION_SUMMARIES_FILE,
  DATA_DIRECTORY,
  PROJECTS_REGISTRY_FILE,
  configRegistry,
  featureFlags,
  personalDatabase,
  privateMemoryService,
  reliabilityEngine,
  runtimeConfig,
  toolAuditLog,
  transactionalExecutionRepository,
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

({ personalSearchEngine, multiSourceSynthesisEngine } = createPersonalSearchComposition({
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
  get multimodalEngine() { return multimodalEngine; },
  notesConnector,
  projectIntelligenceService,
  reliabilityEngine,
  remindersConnector,
  toolAuditLog,
}));

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
