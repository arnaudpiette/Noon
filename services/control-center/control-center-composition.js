"use strict";

// V3-L7 — assemblage du Control Center, sorti de server.js : lecteurs de supervision (projections
// minimales des moteurs canoniques, sans contenu privé, secret ni chemin) et actions bornées
// (diagnostic rapide, vérification de connexion, santé d'une extension).
// Domaine déplacé tel quel depuis server.js. Dépendances déjà déclarées quand server.js le
// construit : lues une fois ; les autres (`deps.x`) : lues à chaque usage, par accesseur.

const DEPENDENCIES = Object.freeze(["ambientContextEngine","approvalManager","backgroundJobEngine","calendarConnector","configRegistry","createCheckConnectionAction","createControlCenterService","createGoogleReadAuthorization","extensionRegistry","featureFlags","gmailConnector","goalStrategyEngine","hardRulesRegistry","localIntelligenceRuntime","localPermissionStore","memoryEngine","notesConnector","notificationAttentionEngine","portfolioCapacityEngine","privateMemoryService","reliabilityEngine","remindersConnector","runtimeConfig","toolAuditLog","updateRecoveryEngine","workspaceEngine"]);

function createControlCenterComposition(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  const {
    ambientContextEngine,
    approvalManager,
    backgroundJobEngine,
    calendarConnector,
    configRegistry,
    createCheckConnectionAction,
    createControlCenterService,
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
  } = deps;

  // Façade de supervision : elle ne conserve aucune donnée métier et ne reçoit
  // que des projections minimales produites par les moteurs canoniques.
  function controlState(value, fallback = "UNKNOWN") {
    const normalized = String(value || "").toUpperCase();
    if (["HEALTHY", "DEGRADED", "UNAVAILABLE", "UNAUTHORIZED", "MISCONFIGURED", "UNKNOWN", "STALE"].includes(normalized)) return normalized;
    if (["OK", "READY", "AVAILABLE", "ACTIVE", "ENABLED", "SUCCEEDED", "CONNECTED"].includes(normalized)) return "HEALTHY";
    if (["FAILED", "BLOCKED", "REVOKED", "DISCONNECTED", "EXPIRED"].includes(normalized)) return "UNAVAILABLE";
    return fallback;
  }

  function reliabilityItems(report, predicate = () => true) {
    return report.components.filter(predicate).map((component) => ({
      id: component.componentId,
      label: component.componentId.replaceAll("-", " "),
      state: component.state,
      summary: component.reasonCode || "État non vérifié",
      meta: {
        authState: component.authState,
        lastSuccessAt: component.lastSuccessAt,
        lastFailureAt: component.lastFailureAt,
        latencyMs: component.latencyMs,
        userActionRequired: component.userActionRequired,
      },
      actions: component.userActionRequired ? ["RUN_QUICK_DIAGNOSTIC"] : [],
    }));
  }

  const controlCenterService = createControlCenterService({
    reliability: reliabilityEngine,
    featureAccess: () => ({
      enabled: featureFlags.evaluate("controlCenter.enabled").mode !== "OFF",
      advanced: featureFlags.evaluate("controlCenter.advanced").mode !== "OFF",
      developer: featureFlags.evaluate("controlCenter.developer").mode === "ON",
    }),
    observability: (event, metadata) => toolAuditLog.append(`control-center.${event}`, metadata),
    readers: {
      reliability() {
        const report = reliabilityEngine.report();
        return { status: report.overallState, summary: reliabilityEngine.explain().text, items: reliabilityItems(report), counts: { readiness: report.readiness, warnings: report.warnings.length } };
      },
      connections() {
        const report = reliabilityEngine.report();
        const connectionIds = new Set(["gmail", "google-calendar", "apple-notes", "apple-reminders", "openai-models", "public-web-search", "realtime"]);
        const items = reliabilityItems(report, (component) => connectionIds.has(component.componentId)).map((entry) => ({
          ...entry,
          meta: { ...entry.meta, auth: [gmailConnector, calendarConnector, notesConnector, remindersConnector].find((connector) => connector.id === entry.id)?.status.authState || entry.meta.authState || "unknown", health: entry.state },
          actions: ["CHECK_CONNECTION"],
        }));
        const attention = items.some((entry) => ["UNAUTHORIZED", "MISCONFIGURED", "UNAVAILABLE"].includes(entry.state));
        return { status: attention ? "DEGRADED" : "HEALTHY", summary: attention ? "Certaines connexions demandent votre attention." : "Les connexions vérifiées sont disponibles.", items, counts: { total: items.length, attention: items.filter((entry) => entry.meta.userActionRequired).length } };
      },
      jobs() {
        const jobs = backgroundJobEngine?.list?.({ limit: 100 }) || [];
        const stats = backgroundJobEngine?.stats?.() || {};
        return { status: backgroundJobEngine ? "HEALTHY" : "UNAVAILABLE", summary: backgroundJobEngine ? "Travaux en arrière-plan et attentes." : "La file persistante n’est pas disponible.", items: jobs.slice(0, 100).map((job) => ({ id: job.id, label: job.type, state: controlState(job.state, job.state === "WAITING" ? "DEGRADED" : "UNKNOWN"), summary: job.reason_code || job.state, meta: { stage: job.progress?.stage || null, percent: job.progress?.percent || 0, createdAt: job.created_at, completedAt: job.completed_at }, actions: ["RUNNING", "WAITING", "QUEUED", "RETRY_SCHEDULED"].includes(job.state) ? ["CANCEL_JOB"] : [] })), counts: stats };
      },
      approvals() {
        const pending = approvalManager.listPending();
        return { status: "HEALTHY", summary: pending.length ? `${pending.length} validation(s) attendent votre décision.` : "Aucune validation en attente.", items: pending.map((approval) => ({ id: approval.approvalId, label: approval.title, state: "DEGRADED", summary: approval.summary, meta: { effect: approval.consequences, expiresAt: approval.expiresAt, riskLevel: approval.riskLevel, actionFingerprint: approval.payloadHash }, actions: ["APPROVE_ACTION", "REJECT_ACTION"] })), counts: { pending: pending.length } };
      },
      memory() {
        const structured = memoryEngine.listStructured({ limit: 1000 }) || [];
        const privateItems = memoryEngine.privateStatus().available ? memoryEngine.listPrivate({ includeDeleted: false }) : [];
        const all = [...structured.map((entry) => ({ status: entry.status, sensitivity: entry.sensitivity, category: entry.type, localOnly: entry.metadata?.apiPolicy === "local_only" })), ...privateItems.map((entry) => ({ status: entry.status, sensitivity: entry.sensitivity, category: entry.category, localOnly: entry.apiPolicy === "local_only" }))];
        const byStatus = Object.fromEntries([...new Set(all.map((entry) => entry.status))].map((status) => [status, all.filter((entry) => entry.status === status).length]));
        const byCategory = Object.fromEntries([...new Set(all.map((entry) => entry.category).filter(Boolean))].slice(0, 30).map((category) => [category, all.filter((entry) => entry.category === category).length]));
        return { status: privateMemoryService.available ? "HEALTHY" : "DEGRADED", summary: "Résumé local de la mémoire, sans afficher son contenu privé.", items: Object.entries(byCategory).map(([category, count]) => ({ id: `memory-${category.replace(/[^a-z0-9_-]/gi, "-")}`, label: category, state: "HEALTHY", summary: `${count} élément(s)` })), counts: { total: all.length, byStatus, localOnly: all.filter((entry) => entry.localOnly).length, sensitive: all.filter((entry) => ["high", "restricted"].includes(entry.sensitivity)).length } };
      },
      rules() {
        const rules = hardRulesRegistry.getAllRules();
        return { status: "HEALTHY", summary: "Règles permanentes chargées depuis le registre canonique.", items: rules.map((rule) => ({ id: rule.id, label: rule.statement, state: rule.enabled ? "HEALTHY" : "DEGRADED", summary: rule.hierarchy, meta: { category: rule.category, enforcement: rule.enforcement, immutable: rule.hierarchy === "system" } })), counts: { total: rules.length, version: hardRulesRegistry.version() } };
      },
      workspaces({ view }) {
        const workspaces = deps.workspaceEngine.list(); const active = deps.workspaceEngine.getActiveWorkspace?.() || deps.workspaceEngine.active?.();
        return { status: "HEALTHY", summary: active ? "Un espace de travail est actif." : "Aucun espace de travail actif.", items: workspaces.map((workspace) => ({ id: workspace.id, label: workspace.name, state: workspace.id === active?.id ? "HEALTHY" : "UNKNOWN", summary: workspace.id === active?.id ? "Actif" : workspace.status, meta: { projectCount: deps.workspaceEngine.context(workspace.id).projects.length, rootCount: deps.workspaceEngine.context(workspace.id).roots.length, roots: view === "ADVANCED" ? deps.workspaceEngine.context(workspace.id).roots.map(() => "[DOSSIER_LOCAL]") : undefined } })), counts: { total: workspaces.length, active: active ? 1 : 0 } };
      },
      goals() {
        const goals = goalStrategyEngine.registry.list();
        return { status: "HEALTHY", summary: "Objectifs et jalons suivis par GoalStrategyEngine.", items: goals.map((goal) => ({ id: goal.goalId, label: goal.title, state: goal.status === "ACTIVE" ? "HEALTHY" : "UNKNOWN", summary: goal.status, meta: { milestoneCount: goal.milestones?.length || 0, linkedProjectCount: goal.linkedProjectIds?.length || 0 } })), counts: { total: goals.length, candidates: goalStrategyEngine.registry.listCandidates().length } };
      },
      portfolio() {
        const health = portfolioCapacityEngine.health();
        return { status: controlState(health.status), summary: "Capacité et scénarios restent consultatifs : simuler ne modifie rien.", items: [], counts: { snapshots: health.snapshots, scenarios: health.scenarios, readOnly: health.readOnly } };
      },
      devices() { return { status: "UNKNOWN", summary: "Le registre multi-appareils n’est pas activé dans le runtime principal.", items: [], counts: { total: 0 }, partial: true }; },
      sync() { return { status: "UNKNOWN", summary: "La synchronisation reste en rollout contrôlé et n’est pas reliée au runtime principal.", items: [], counts: { pending: 0, conflicts: 0 }, partial: true }; },
      extensions() {
        const extensions = extensionRegistry.list();
        return { status: extensions.some((entry) => ["FAILED", "QUARANTINED"].includes(entry.state)) ? "DEGRADED" : "HEALTHY", summary: "Extensions installées et permissions déclarées.", items: extensions.map((entry) => ({ id: entry.id, label: entry.name, state: controlState(entry.health?.state || entry.state), summary: `${entry.version} · ${entry.state}`, meta: { permissions: entry.permissions, permissionReviewRequired: entry.permissionReviewRequired, source: entry.provenance, isolation: entry.isolation }, actions: ["CHECK_EXTENSION", ...(entry.state === "ENABLED" ? ["DISABLE_EXTENSION"] : entry.state === "DISABLED" ? ["ENABLE_EXTENSION"] : [])] })), counts: { total: extensions.length, enabled: extensions.filter((entry) => entry.state === "ENABLED").length } };
      },
      permissions() {
        const roots = localPermissionStore.load().roots || [];
        return { status: "HEALTHY", summary: "Autorisations locales agrégées sans exposer les chemins.", items: roots.map((entry, index) => ({ id: `root-${index + 1}`, label: `Dossier local ${index + 1}`, state: "HEALTHY", summary: entry.mode === "read-write" ? "Lecture et création" : "Lecture seule", meta: { read: true, write: entry.mode === "read-write", output: entry.output === true } })), counts: { roots: roots.length, writeRoots: roots.filter((entry) => entry.mode === "read-write").length } };
      },
      notifications() {
        const requests = notificationAttentionEngine.store.listRequests();
        return { status: "HEALTHY", summary: "Éléments nécessitant une attention et livraisons récentes.", items: requests.slice(0, 50).map((entry) => ({ id: entry.attentionId, label: entry.title || entry.type, state: entry.userActionRequired ? "DEGRADED" : "HEALTHY", summary: entry.genericSummary || entry.state, meta: { state: entry.state, importance: entry.importance, createdAt: entry.createdAt } })), counts: { total: requests.length, needsAttention: requests.filter((entry) => entry.userActionRequired).length } };
      },
      privacy() {
        const memories = memoryEngine.privateStatus().available ? memoryEngine.listPrivate({ includeDeleted: false }) : [];
        const runtime = localIntelligenceRuntime.snapshot();
        const ambient = ambientContextEngine.currentView();
        return { status: "HEALTHY", summary: "Ce qui reste local et ce qui peut quitter le Mac.", items: [
          { id: "privacy-memory", label: "Mémoire locale", state: "HEALTHY", summary: `${memories.filter((entry) => entry.apiPolicy === "local_only").length} élément(s) local-only` },
          { id: "privacy-runtime", label: "Politique distante", state: runtime.preference === "LOCAL_ONLY" ? "HEALTHY" : "UNKNOWN", summary: runtime.preference || "AUTO" },
          { id: "privacy-ambient", label: "Contexte ambiant", state: ambient.active ? "DEGRADED" : "HEALTHY", summary: ambient.active ? "Partage explicite temporaire actif" : "Aucun partage actif" },
        ], counts: { localOnly: memories.filter((entry) => entry.apiPolicy === "local_only").length, ambientSignals: ambient.signalCount || 0 } };
      },
      offline() {
        const runtime = localIntelligenceRuntime.snapshot();
        return { status: controlState(localIntelligenceRuntime.health().status), summary: "Capacités locales et capacités nécessitant le réseau.", items: runtime.capabilities.map((entry) => ({ id: entry.capabilityId, label: entry.capabilityId.replaceAll("_", " "), state: controlState(entry.availability), summary: entry.requiresNetwork ? "Réseau requis" : "Disponible localement", meta: { provider: entry.provider, executionLocation: entry.executionLocation, localOnly: entry.supportsLocalOnly } })), counts: { preference: runtime.preference, state: runtime.state } };
      },
      configuration({ view }) {
        const definitions = configRegistry.list().filter((entry) => entry.userEditable && !entry.sensitive);
        return { status: runtimeConfig.recovery() === "safe_defaults" ? "DEGRADED" : "HEALTHY", summary: "Réglages explicitement modifiables avec validation et dernier état valide.", items: definitions.map((entry) => ({ id: entry.key, label: entry.key, state: "HEALTHY", summary: String(runtimeConfig.get(entry.key).value), meta: { restartRequired: entry.restartRequired, advanced: entry.public !== true, type: entry.type, source: view !== "USER" ? runtimeConfig.get(entry.key).source : undefined } })), counts: { version: runtimeConfig.state().configVersion, recovery: runtimeConfig.recovery() } };
      },
      backups() {
        const status = updateRecoveryEngine.startupDiagnostic();
        return { status: status.recoveryRequired ? "DEGRADED" : "HEALTHY", summary: "Sauvegardes, migrations et capacité de récupération.", items: [{ id: "backup-status", label: "Sauvegarde", state: status.backupState === "AVAILABLE" ? "HEALTHY" : "UNKNOWN", summary: status.backupState }, { id: "migration-status", label: "Migration", state: status.recoveryRequired ? "DEGRADED" : "HEALTHY", summary: status.migrationState }], counts: { appVersion: status.appVersion, schemaVersion: status.schemaVersion, maintenanceState: status.maintenanceState } };
      },
      evaluations() { return { status: "UNKNOWN", summary: "Les évaluations critiques sont exécutées hors du renderer.", items: [], counts: { lastRun: null }, partial: true }; },
      diagnostics({ view }) {
        const control = controlCenterService.diagnostics();
        const report = reliabilityEngine.report({ includeHistory: view === "DEVELOPER" });
        return { status: report.overallState, summary: "Rapport technique redacted, sans contenu privé, secret ni chemin.", items: reliabilityItems(report), counts: { ...control, componentCount: report.components.length } };
      },
    },
    actions: {
      RUN_QUICK_DIAGNOSTIC: async () => ({ status: "SUCCEEDED", diagnostic: await reliabilityEngine.diagnose({ deep: false }) }),
      CHECK_CONNECTION: createCheckConnectionAction({ googleConnectors: [gmailConnector, calendarConnector], reliabilityEngine, createGoogleReadAuthorization }),
      CHECK_EXTENSION: async ({ targetId }) => ({ status: "SUCCEEDED", health: await extensionRegistry.checkHealth(targetId) }),
    },
  });

  return { controlCenterService };
}

module.exports = { DEPENDENCIES, createControlCenterComposition };
