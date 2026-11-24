"use strict";

// V3-L7 — assemblage du runtime local (modèle local, résolution des capacités hors ligne), de
// l'attention des notifications et des travaux de fond (registre, stockage, moteur), avec leurs
// composants Reliability, sorti de server.js. Bloc déplacé tel quel. server.js l'appelle au même
// endroit qu'avant, donc l'ordre des composants Reliability est inchangé. Les dépendances déjà
// initialisées sont lues une fois ; `setSessionActivity`, déclarée plus loin dans server.js,
// est relue à chaque notification de travail (`deps.setSessionActivity`).

const { createLocalIntelligenceRuntime, createLocalModelAdapter } = require("./index");
const { createNotificationAttentionEngine, createNotificationStore } = require("../notifications");
const { createJobRegistry } = require("../jobs/job-registry");
const { createJobStore } = require("../jobs/job-store");
const { createBackgroundJobEngine } = require("../jobs/background-job-engine");

const DEPENDENCIES = Object.freeze(["featureFlags","personalDatabase","reliabilityEngine","runtimeCapabilityRegistry","runtimeConfig","setSessionActivity","toolAuditLog","userProgressAdapter"]);

function createLocalRuntimeAndJobsComposition(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  const {
    featureFlags,
    personalDatabase,
    reliabilityEngine,
    runtimeCapabilityRegistry,
    runtimeConfig,
    toolAuditLog,
    userProgressAdapter,
  } = deps;

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
      if (sessionId) deps.setSessionActivity(sessionId, state === "SUCCEEDED" ? "done" : "idle", state === "SUCCEEDED" ? "Travail en arrière-plan prêt." : `Travail en arrière-plan : ${state}.`);
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

  return { localIntelligenceRuntime, notificationAttentionEngine, jobRegistry, backgroundJobEngine };
}

module.exports = { DEPENDENCIES, createLocalRuntimeAndJobsComposition };
