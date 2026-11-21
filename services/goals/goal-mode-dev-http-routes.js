"use strict";

/*
 * Branchement B2 — routes HTTP Goal Mode DEV (préfixe /api/goals/mode-dev/).
 *
 * - 404 GOAL_MODE_DEV_DISABLED si le runtime n'est pas composé ou si le flag
 *   vaut OFF au moment de la requête (réévalué à chaque requête) ; puis
 *   en-tête de confiance obligatoire (403).
 * - Plafonds de capacités fixés par le serveur ; localOnly dérivé des
 *   politiques existantes (sensibilité du Goal, préférence d'exécution) :
 *   LOCAL_ONLY_REQUIRED (422) avant toute réservation ou appel distant.
 * - Planning : confirmProviderCall: true obligatoire (appel fournisseur).
 * - resume est synchrone : une déconnexion du client ne coupe pas le
 *   dispatch (aucun signal de requête transmis au service).
 * - Audit minimal : route, statut HTTP, code. Jamais de corps, de jeton ni
 *   d'affichage.
 */

const { createGoalModeRunContract } = require("./goal-mode-run-contract");
const contract = require("./goal-mode-dev-http-contract");

const GOAL_MODE_DEV_HTTP_PREFIX = "/api/goals/mode-dev/";
const BODY_LIMIT_BYTES = 8 * 1024;
const MAX_LISTED_RUNS = 50;
const FIXED_CAPABILITY_CEILINGS = Object.freeze({ network: true, gitWrite: false, destructiveActions: false });

function httpError(code) {
  return Object.assign(new Error("Opération Goal Mode DEV refusée."), { code });
}

function createGoalModeDevHttpHandler({
  runtime,
  goalStrategyEngine,
  enabled,
  requireTrustedUi,
  readJsonBody,
  executionPreference,
  audit = null,
  lockMaintenance = null,
  now = () => new Date(),
} = {}) {
  if (typeof enabled !== "function" || typeof requireTrustedUi !== "function" ||
      typeof readJsonBody !== "function" || typeof executionPreference !== "function" ||
      typeof goalStrategyEngine?.registry?.get !== "function") {
    throw new TypeError("Dépendances HTTP Goal Mode DEV requises.");
  }
  // approvalId → runId, pour revérifier la confidentialité avant resume.
  const approvalRuns = new Map();

  function record(route, status, code) {
    try { audit?.("goals.mode-dev.http", { route, status, code: code || null }); } catch {}
  }

  function send(res, status, body) {
    if (res.writableEnded || res.destroyed) return;
    try {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    } catch {}
  }

  function goal(goalId) {
    let value;
    try { value = goalStrategyEngine.registry.get(goalId); } catch { value = null; }
    if (!value) throw httpError("GOAL_MODE_DEV_GOAL_NOT_FOUND");
    return value;
  }

  // Politique de confidentialité : sensibilité du Goal (objectif du projet)
  // et préférence d'exécution de l'utilisateur. Inconnue = local seulement.
  function assertRemoteAllowed(goalValue) {
    let preference;
    try { preference = executionPreference(); } catch { preference = "LOCAL_ONLY"; }
    if (goalValue?.sensitivity === "LOCAL_ONLY" || preference === "LOCAL_ONLY" ||
        typeof preference !== "string") {
      throw httpError("GOAL_MODE_DEV_LOCAL_ONLY_REQUIRED");
    }
  }

  function goalForRun(runId) {
    const snapshot = runtime.runStore.get(runId);
    return goal(snapshot.state.contract.goalRef.goalId);
  }

  // B3b : maintenance du verrou DATA_DIRECTORY (absente → 503 explicite).
  function maintenance() {
    if (!lockMaintenance) throw httpError("GOAL_MODE_DEV_LOCK_MAINTENANCE_UNAVAILABLE");
    return lockMaintenance;
  }

  async function body(req) {
    try { return await readJsonBody(req, BODY_LIMIT_BYTES); } catch { throw httpError("GOAL_MODE_DEV_HTTP_BODY_INVALID"); }
  }

  const routes = {
    "POST runs": async (req) => {
      const input = contract.normalizeCreateRun(await body(req));
      const goalValue = goal(input.goalId);
      assertRemoteAllowed(goalValue);
      const runContract = createGoalModeRunContract({
        goal: goalValue,
        request: {
          userConfirmed: input.userConfirmed,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          limits: { ...input.limits },
          capabilityCeilings: { ...FIXED_CAPABILITY_CEILINGS },
          localOnly: false,
        },
        now: () => new Date(now()),
      });
      return [201, contract.projectRun(runtime.runStore.create(runContract))];
    },
    "POST runs/start": async (req) => {
      const input = contract.normalizeRunRevision(await body(req));
      if (runtime.runStore.get(input.runId).state.status !== "READY") {
        throw httpError("GOAL_MODE_DEV_RUN_NOT_READY");
      }
      return [200, contract.projectRun(runtime.runStore.transition(input.runId, "RUNNING", {
        expectedRevision: input.expectedRevision,
      }))];
    },
    "POST planning": async (req) => {
      const input = contract.normalizePlanning(await body(req));
      assertRemoteAllowed(goalForRun(input.runId));
      const result = await runtime.durablePlanningService.planOnce({ runId: input.runId });
      return [200, contract.projectPlanning(result)];
    },
    "POST dispatch/prepare": async (req) => {
      const input = contract.normalizePrepare(await body(req));
      assertRemoteAllowed(goalForRun(input.runId));
      const prepared = runtime.dispatchService.prepare(input.runId, {
        expectedRevision: input.expectedRevision, stepId: input.stepId,
      });
      approvalRuns.set(prepared.approval.id, input.runId);
      return [201, contract.projectApproval(prepared)];
    },
    "POST dispatch/resume": async (req) => {
      const input = contract.normalizeResume(await body(req));
      if (input.decision === "approve" && approvalRuns.has(input.approvalId)) {
        assertRemoteAllowed(goalForRun(approvalRuns.get(input.approvalId)));
      }
      const result = await runtime.dispatchService.resume({
        approvalId: input.approvalId, resumeToken: input.resumeToken, decision: input.decision,
      });
      approvalRuns.delete(input.approvalId);
      return [200, contract.projectDispatch(result)];
    },
    "POST dispatch/renew": async (req) => {
      const input = contract.normalizeRenew(await body(req));
      const renewed = runtime.dispatchService.renewApproval({ reservationId: input.reservationId });
      approvalRuns.set(renewed.approval.id, renewed.ticket.runId);
      return [201, contract.projectApproval(renewed)];
    },
    "POST runs/pause": async (req) => {
      const input = contract.normalizePause(await body(req));
      return [200, contract.projectHalt(runtime.dispatchService.pauseRun(input))];
    },
    "POST runs/resume": async (req) => {
      const input = contract.normalizeResumeRun(await body(req));
      return [200, contract.projectResumeRun(runtime.dispatchService.resumeRun(input))];
    },
    "POST runs/stop": async (req) => {
      const input = contract.normalizeStop(await body(req));
      return [200, contract.projectHalt(runtime.dispatchService.stopRun(input))];
    },
    "POST dispatch/cancel": async (req) => {
      const input = contract.normalizeCancel(await body(req));
      return [200, contract.projectCancel(runtime.dispatchService.cancelExecution(input))];
    },
    // 4C-2 : réconciliation explicite (CAS seulement, jamais de replay).
    "POST dispatch/reconcile": async (req) => {
      const input = contract.normalizeReconcile(await body(req));
      return [200, contract.projectReconciliation(runtime.dispatchService.reconcileExecution(input))];
    },
    // B3b : reprise explicite du verrou ; aucun scan automatique ensuite.
    "POST maintenance/lock-takeover": async (req) => {
      const input = contract.normalizeLockTakeover(await body(req));
      return [200, contract.projectLockTakeover(maintenance().takeover(input))];
    },
    // B3b : « Réconcilier maintenant » (verrou exigé, réconciliation EXPLICIT).
    "POST maintenance/reconcile-scan": async (req) => {
      contract.normalizeReconcileScan(await body(req));
      return [200, contract.projectReconcileScan(maintenance().scanNow())];
    },
    "POST dispatch/release": async (req) => {
      const input = contract.normalizeRelease(await body(req));
      const snapshot = runtime.runStore.releaseExecution(input.runId, {
        expectedRevision: input.expectedRevision, reservationId: input.reservationId,
      });
      return [200, contract.projectRelease(snapshot, input.reservationId)];
    },
  };

  function matchGet(segments) {
    // B3b : état du verrou DATA_DIRECTORY (lecture seule).
    if (segments.length === 2 && segments[0] === "maintenance" && segments[1] === "lock") {
      return ["GET maintenance/lock", () => [200, contract.projectLockState(maintenance().inspect())]];
    }
    // B3a : liste des runs récents, en lecture seule (reprise après rechargement).
    if (segments.length === 1 && segments[0] === "runs") {
      return ["GET runs", () => {
        const snapshots = [];
        for (const runId of runtime.runStore.listRunIds()) {
          try { snapshots.push(runtime.runStore.get(runId)); } catch {}
        }
        snapshots.sort((left, right) => String(right.state.updatedAt).localeCompare(String(left.state.updatedAt)));
        return [200, contract.projectRunSummaries(snapshots.slice(0, MAX_LISTED_RUNS))];
      }];
    }
    // B3a : coût maximal estimé de l'appel de planning, sans appel ni réservation.
    if (segments.length === 3 && segments[0] === "runs" && segments[2] === "planning-estimate") {
      return ["GET runs/:runId/planning-estimate", () => {
        const runId = contract.normalizePathId(segments[1]);
        assertRemoteAllowed(goalForRun(runId));
        return [200, contract.projectPlanningEstimate(runtime.planningCallService.estimatePlanning({ runId }))];
      }];
    }
    if (segments.length === 2 && segments[0] === "runs") {
      return ["GET runs/:runId", () => [200, contract.projectRun(
        runtime.runStore.get(contract.normalizePathId(segments[1])))]];
    }
    if (segments.length === 4 && segments[0] === "runs" && segments[2] === "proposals") {
      return ["GET runs/:runId/proposals/:stepId", () => {
        const runId = contract.normalizePathId(segments[1]);
        const stepId = contract.normalizePathId(segments[3]);
        const proposal = runtime.stepProposalStore.get(stepId);
        if (!proposal || proposal.runRef?.runId !== runId) throw httpError("GOAL_MODE_DEV_PROPOSAL_NOT_FOUND");
        let admission;
        try {
          admission = { decision: runtime.stepAdmissionService.admit({ runId, stepId }).decision };
        } catch (error) {
          admission = { decision: "REFUSED", code: typeof error?.code === "string" ? error.code.slice(0, 80) : null };
        }
        return [200, contract.projectProposal(proposal, admission)];
      }];
    }
    if (segments.length === 4 && segments[0] === "runs" && segments[2] === "reservations") {
      return ["GET runs/:runId/reservations/:reservationId", () => [200, contract.projectReservation(
        runtime.dispatchService.executionStatus({
          runId: contract.normalizePathId(segments[1]),
          reservationId: contract.normalizePathId(segments[3]),
        }))]];
    }
    return null;
  }

  async function handle(req, res, requestPath) {
    if (typeof requestPath !== "string" || !requestPath.startsWith(GOAL_MODE_DEV_HTTP_PREFIX)) return false;
    let route = "unknown";
    try {
      let active = false;
      try { active = runtime !== null && runtime !== undefined && enabled() === true; } catch { active = false; }
      if (!active) throw httpError("GOAL_MODE_DEV_DISABLED");
      try { requireTrustedUi(req); } catch { throw httpError("TRUSTED_UI_REQUIRED"); }
      const segments = requestPath.slice(GOAL_MODE_DEV_HTTP_PREFIX.length).split("/").filter(Boolean);
      let handler = null;
      if (req.method === "GET") {
        const matched = matchGet(segments);
        if (matched) [route, handler] = matched;
      } else if (req.method === "POST") {
        const key = `POST ${segments.join("/")}`;
        if (Object.hasOwn(routes, key)) { route = key; handler = routes[key]; }
      }
      if (!handler) throw httpError("GOAL_MODE_DEV_ROUTE_NOT_FOUND");
      const [status, payload] = await handler(req);
      record(route, status, null);
      // Enveloppe stable : le statut métier reste dans result.
      send(res, status, { status: "ok", result: payload });
    } catch (error) {
      const status = contract.goalModeDevHttpStatus(error);
      const payload = contract.goalModeDevErrorBody(error);
      record(route, status, payload.code);
      send(res, status, payload);
    }
    return true;
  }

  return Object.freeze({ handle, prefix: GOAL_MODE_DEV_HTTP_PREFIX });
}

module.exports = {
  FIXED_CAPABILITY_CEILINGS,
  GOAL_MODE_DEV_HTTP_PREFIX,
  createGoalModeDevHttpHandler,
};
