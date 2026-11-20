"use strict";

/*
 * Branchement B1 — composition du runtime Goal Mode DEV.
 *
 * Assemble toute la chaîne (runs, planning, propositions, admission,
 * projection, réservation, approbation exacte, dispatch) sur les services
 * canoniques déjà présents dans le serveur. Aucune route n'est exposée ici
 * (B2) ; le serveur ne construit ce runtime que si goals.mode-dev n'est pas
 * OFF, et un échec de composition ne doit jamais empêcher Noon de démarrer.
 *
 * - Permissions vivantes : écriture repository = racine read-write du
 *   workspace ; réseau = OperationalSecurityPolicy (ni DENY ni UNAVAILABLE)
 *   ET dev.native-core LIMITED ; Git write et actions destructives : jamais.
 * - Règles projet : résolues depuis le workspace autoritatif, jamais fournies
 *   par l'appelant ; le service de dispatch les lie à l'approbation.
 * - Dispatcher : façade Native DEV B3 (journal fiable, espace réservé).
 */

const fs = require("node:fs");
const path = require("node:path");

const { createGoalModeRunStore } = require("./goal-mode-run-store");
const { createGoalModeStepProposalStore } = require("./goal-mode-step-proposal-store");
const { createGoalModeNextStepPlanner } = require("./goal-mode-next-step-planner");
const { createGoalModePlanningCallService } = require("./goal-mode-planning-call-service");
const { createGoalModeDurablePlanningService } = require("./goal-mode-durable-planning-service");
const { createGoalModeStepAdmissionService } = require("./goal-mode-step-admission-service");
const { createGoalModeDevProjectionService } = require("./goal-mode-dev-projection-service");
const { createGoalModeDevDispatchService } = require("./goal-mode-dev-dispatch-service");
const { OPERATION, SKILL_NAME } = require("./goal-mode-dev-approval-action");
const {
  createGoalModeRunRepository,
} = require("../persistence/repositories/goal-mode-run-repository");
const {
  createGoalModeStepProposalRepository,
} = require("../persistence/repositories/goal-mode-step-proposal-repository");

const VERSION = "goal-mode-dev-runtime-v1";
const MAX_PROJECT_RULES = 20;
const DENIED_SECURITY_OUTCOMES = Object.freeze(["DENY", "UNAVAILABLE"]);
const GOAL_MODE_DEV_SKILL_POLICY = Object.freeze({
  level: "write",
  networkAccess: true,
  explicitOrderRequired: true,
});

function clean(value, max = 200) {
  return String(value ?? "").replace(/[\0\r\n]+/g, " ").trim().slice(0, max);
}

function canonical(value) {
  const source = clean(value, 4000);
  if (!source) return null;
  try { return fs.realpathSync.native(path.resolve(source)); } catch { return null; }
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function createGoalModeDevRuntime({
  database,
  goalStrategyEngine,
  workspaceEngine,
  devBudgetService,
  devTaskJournal,
  approvalEngine,
  operationalSecurityPolicy,
  projectRuleResolver,
  nativeDevFacade,
  featureMode,
  selectModelRoute,
  estimateCost,
  authorizePrivacy,
  providerAdapter,
  trackUsage = null,
  now = () => new Date(),
  observability = null,
} = {}) {
  if (!database ||
      typeof goalStrategyEngine?.registry?.get !== "function" ||
      typeof workspaceEngine?.context !== "function" ||
      typeof devBudgetService?.effectiveRemaining !== "function" ||
      typeof devBudgetService?.taskProviderCalls !== "function" ||
      typeof devTaskJournal?.lookup !== "function" ||
      typeof approvalEngine?.prepareAction !== "function" ||
      typeof operationalSecurityPolicy?.createActionRequest !== "function" ||
      typeof operationalSecurityPolicy?.evaluate !== "function" ||
      typeof projectRuleResolver?.resolve !== "function" ||
      typeof nativeDevFacade?.runTask !== "function" ||
      typeof nativeDevFacade?.cancelTask !== "function" ||
      typeof nativeDevFacade?.getTaskStatus !== "function" ||
      typeof featureMode !== "function" ||
      typeof now !== "function") {
    throw new TypeError("Dépendances du runtime Goal Mode DEV requises.");
  }

  function emit(event, metadata = {}) {
    try { observability?.(event, metadata); } catch {}
  }

  const nowIso = () => new Date(now()).toISOString();

  // Projection paresseuse : le store des runs en a besoin, et la projection
  // a besoin du store (dépendance circulaire résolue à l'appel).
  let projectionService = null;
  const lazyProjection = Object.freeze({
    project(input) {
      if (!projectionService) {
        throw Object.assign(new Error("Projection DEV non composée."), {
          code: "GOAL_MODE_DEV_RUNTIME_NOT_READY",
        });
      }
      return projectionService.project(input);
    },
  });

  const runStore = createGoalModeRunStore({
    repository: createGoalModeRunRepository(database),
    devProjectionService: lazyProjection,
    devTaskLedger: devBudgetService,
    devTaskJournal,
    now: nowIso,
  });
  // Le store des propositions horodate avec une chaîne ISO (une Date perdrait
  // les millisecondes et ferait précéder la réconciliation du planning).
  const stepProposalStore = createGoalModeStepProposalStore({
    repository: createGoalModeStepProposalRepository(database),
    now: nowIso,
  });
  const nextStepPlanner = createGoalModeNextStepPlanner({ goalStrategyEngine, runStore, now });
  // Planning : appel fournisseur explicite seulement (déclenché par B2, flag actif).
  const planningCallService = createGoalModePlanningCallService({
    runStore, nextStepPlanner, goalStrategyEngine,
    selectModelRoute, estimateCost, authorizePrivacy, providerAdapter, trackUsage, now,
  });
  const durablePlanningService = createGoalModeDurablePlanningService({
    runStore, planningCallService, stepProposalStore,
  });
  const stepAdmissionService = createGoalModeStepAdmissionService({
    runStore, stepProposalStore, nextStepPlanner, goalStrategyEngine, now,
  });
  projectionService = createGoalModeDevProjectionService({
    runStore, stepProposalStore, stepAdmissionService, goalStrategyEngine,
    workspaceEngine, devBudgetService, now,
  });

  function workspaceContext(workspaceId) {
    const id = clean(workspaceId, 200);
    if (!id) return null;
    try { return workspaceEngine.context(id); } catch { return null; }
  }

  function repositoryWritable(context, repositoryRoot) {
    const target = canonical(repositoryRoot);
    if (!target) return false;
    const roots = (context?.relevantRoots || context?.roots || [])
      .filter((root) => root?.mode === "read-write")
      .map((root) => canonical(root?.path))
      .filter(Boolean);
    return roots.some((root) => isInside(root, target));
  }

  function networkAllowed(context, input) {
    let mode;
    try { mode = String(featureMode("dev.native-core", { workspaceId: input.workspaceId })); } catch { return false; }
    if (mode !== "LIMITED") return false;
    const profileScope = clean(context?.workspace?.profileScope, 160);
    if (!profileScope) return false;
    try {
      const actionRequest = operationalSecurityPolicy.createActionRequest({
        origin: "explicit_user_chat",
        actor: "user",
        skillId: SKILL_NAME,
        operation: OPERATION,
        args: { runId: input.runId, stepId: input.stepId, taskId: input.taskId },
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        profileScope,
        sourceProfileScope: profileScope,
        explicitOrder: true,
        localOnly: false,
        reversibility: "UNKNOWN",
        preconditions: { taskId: input.taskId },
        preconditionsValid: true,
      }, GOAL_MODE_DEV_SKILL_POLICY);
      const decision = operationalSecurityPolicy.evaluate({
        actionRequest,
        currentPermissions: { allowed: true, code: "GOAL_MODE_DEV_PERMISSION_INTERSECTION" },
        skillPolicy: GOAL_MODE_DEV_SKILL_POLICY,
      });
      return typeof decision?.outcome === "string" &&
        !DENIED_SECURITY_OUTCOMES.includes(decision.outcome);
    } catch {
      return false;
    }
  }

  // Source vivante intersectée par le dispatch : toute erreur = refus.
  const permissionSource = Object.freeze({
    current(input = {}) {
      const context = workspaceContext(input.workspaceId);
      const repositoryWrite = context ? repositoryWritable(context, input.repositoryRoot) : false;
      const network = context ? networkAllowed(context, input) : false;
      return Object.freeze({ network, repositoryWrite, gitWrite: false, destructiveActions: false });
    },
  });

  // Règles projet du workspace autoritatif (même projection que le service
  // DEV historique), jamais fournies par l'appelant.
  const projectRulesResolver = Object.freeze({
    resolve({ workspaceId, projectId, constraints = [] } = {}) {
      const context = workspaceContext(workspaceId);
      const profileScope = clean(context?.workspace?.profileScope, 160);
      const linked = (Array.isArray(context?.projects) ? context.projects : [])
        .some((project) => String(project?.id) === String(projectId));
      if (!context || !profileScope || !linked) {
        throw Object.assign(new Error("Règles projet non résolues."), {
          code: "GOAL_MODE_DEV_RULES_UNRESOLVED",
        });
      }
      const projection = projectRuleResolver.resolve({
        projectId: String(projectId),
        ownerProfileScope: profileScope,
        taskRestrictions: Array.isArray(constraints) ? [...constraints] : [],
      });
      return (Array.isArray(projection?.applied) ? projection.applied : [])
        .map((rule) => String(rule?.text || "").trim())
        .filter(Boolean)
        .slice(0, MAX_PROJECT_RULES);
    },
  });

  // La façade B3 porte le journal fiable et l'espace de taskId réservé.
  const dispatcher = Object.freeze({
    runTask: (payload) => nativeDevFacade.runTask(payload),
    cancelTask: (taskId) => nativeDevFacade.cancelTask(taskId),
    getTaskStatus: (taskId) => nativeDevFacade.getTaskStatus(taskId),
  });

  const dispatchService = createGoalModeDevDispatchService({
    runStore,
    goalStrategyEngine,
    devBudgetService,
    permissionSource,
    dispatcher,
    approvalEngine,
    devTaskJournal,
    projectRulesResolver,
    now,
    observability: (event, metadata) => emit(event, metadata),
  });

  emit("goal_mode_dev.runtime_composed", {
    version: VERSION,
    persistence: runStore.persistenceCapabilities?.() ?? null,
  });

  return Object.freeze({
    version: VERSION,
    runStore,
    stepProposalStore,
    nextStepPlanner,
    planningCallService,
    durablePlanningService,
    stepAdmissionService,
    devProjectionService: projectionService,
    dispatchService,
    permissionSource,
    projectRulesResolver,
    persistenceCapabilities: () => runStore.persistenceCapabilities(),
  });
}

module.exports = {
  GOAL_MODE_DEV_SKILL_POLICY,
  VERSION,
  createGoalModeDevRuntime,
};
