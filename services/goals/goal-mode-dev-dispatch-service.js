"use strict";

/*
 * 5.0D-4C-1B — Recheck et dispatch unique d'une réservation DEV.
 *
 * - prepare() réserve via 4C-1A (CAS) et capture une empreinte de la cible.
 * - dispatch() revérifie tout, puis passe PREPARED → MAY_HAVE_STARTED par CAS
 *   AVANT tout effet. Le dispatcher est appelé au plus une fois par
 *   réservation, jamais rejoué. MAY_HAVE_STARTED ou UNKNOWN partent en
 *   réconciliation (4C-2), jamais en replay.
 * - Aucune permission n'est accordée ici : le contrat remis est envoyé tel
 *   quel, et toute capacité effective est l'intersection des sources.
 * - Le service n'est pas câblé au serveur : le dispatcher est injecté.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const VERSION = "goal-mode-dev-dispatch-v1";
const MIN_REMAINING_DURATION_MS = 1_000;
const ALLOWED_DEV_PERMISSIONS = Object.freeze(["READ_WRITE_WORKSPACE", "TERMINAL_SAFE"]);
const TARGET_MAX_ENTRIES = 5_000;
const TARGET_MAX_BYTES = 64 * 1024 * 1024;

function fail(code, message, details = null) {
  const error = Object.assign(new Error(message), { code });
  if (details !== null) error.details = Object.freeze({ ...details });
  throw error;
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function git(root, args, maxBuffer = 16 * 1024 * 1024) {
  return execFileSync("git", args, {
    cwd: root, encoding: "buffer", timeout: 15_000, maxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/*
 * Empreinte bornée du repository cible : racine canonique, branche, HEAD,
 * statut Git et contenu des fichiers modifiés ou non suivis (hors ignorés).
 * Toute impossibilité de mesurer est un refus, jamais une empreinte vide.
 */
function defaultTargetInspector({ repositoryRoot, branch } = {}) {
  try {
    const root = fs.realpathSync(path.resolve(String(repositoryRoot || "")));
    const top = fs.realpathSync(git(root, ["rev-parse", "--show-toplevel"]).toString("utf8").trim());
    if (top !== root) fail("GOAL_MODE_DEV_TARGET_UNINSPECTABLE", "Racine Git inattendue.");
    const currentBranch = git(root, ["branch", "--show-current"]).toString("utf8").trim();
    const head = git(root, ["rev-parse", "--verify", "HEAD"]).toString("utf8").trim();
    const status = git(root, [
      "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=no",
    ]);
    const entries = status.toString("utf8").split("\0").filter(Boolean);
    if (entries.length > TARGET_MAX_ENTRIES) {
      fail("GOAL_MODE_DEV_TARGET_UNINSPECTABLE", "Trop de fichiers modifiés.");
    }
    const contents = [];
    let total = 0;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const code = entry.slice(0, 2);
      const relative = entry.slice(3);
      // Renommage/copie : l'entrée suivante est le chemin d'origine.
      if (code.includes("R") || code.includes("C")) index += 1;
      const absolute = path.join(root, relative);
      if (!absolute.startsWith(`${root}${path.sep}`)) {
        fail("GOAL_MODE_DEV_TARGET_UNINSPECTABLE", "Chemin hors repository.");
      }
      let stat;
      try { stat = fs.lstatSync(absolute); } catch { contents.push([relative, null]); continue; }
      if (stat.isSymbolicLink()) {
        contents.push([relative, sha256(`link:${fs.readlinkSync(absolute)}`)]);
      } else if (stat.isFile()) {
        total += stat.size;
        if (total > TARGET_MAX_BYTES) {
          fail("GOAL_MODE_DEV_TARGET_UNINSPECTABLE", "Contenu modifié trop volumineux.");
        }
        contents.push([relative, sha256(fs.readFileSync(absolute))]);
      } else {
        contents.push([relative, `kind:${stat.isDirectory() ? "dir" : "other"}`]);
      }
    }
    return sha256(JSON.stringify([
      root, currentBranch, branch === currentBranch, head,
      sha256(status), contents,
    ]));
  } catch (error) {
    if (error?.code === "GOAL_MODE_DEV_TARGET_UNINSPECTABLE") throw error;
    return fail("GOAL_MODE_DEV_TARGET_UNINSPECTABLE", "Cible DEV non mesurable.");
  }
}

function strictBoolean(value) {
  return value === true;
}

function createGoalModeDevDispatchService({
  runStore,
  devBudgetService,
  permissionSource,
  dispatcher,
  targetInspector = defaultTargetInspector,
  now = () => new Date(),
} = {}) {
  if (typeof runStore?.reserveExecutionWithExactProjection !== "function" ||
      typeof runStore?.markExecutionMayHaveStarted !== "function" ||
      typeof runStore?.get !== "function" ||
      typeof devBudgetService?.effectiveRemaining !== "function" ||
      typeof devBudgetService?.taskProviderCalls !== "function" ||
      typeof permissionSource?.current !== "function" ||
      typeof dispatcher?.runTask !== "function" ||
      typeof targetInspector !== "function" ||
      typeof now !== "function") {
    throw new TypeError("Dépendances Goal Mode DEV Dispatch requises.");
  }

  // Tickets émis par CETTE instance : un ticket forgé, copié ou issu d'un
  // processus antérieur n'ouvre aucun dispatch.
  const tickets = new WeakMap();
  // Garde in-process ; l'autorité inter-processus reste le CAS SQLite.
  const attempted = new Set();

  function inspectTarget(taskRef) {
    const fingerprint = targetInspector(Object.freeze({
      repositoryRoot: taskRef.repositoryRoot, branch: taskRef.branch,
    }));
    if (typeof fingerprint !== "string" || !/^sha256:[0-9a-f]{64}$/.test(fingerprint)) {
      fail("GOAL_MODE_DEV_TARGET_UNINSPECTABLE", "Empreinte de cible invalide.");
    }
    return fingerprint;
  }

  function prepare(runId, input = {}) {
    const handoff = runStore.reserveExecutionWithExactProjection(runId, input);
    const projection = handoff?.exactProjection;
    if (!projection?.taskRef || !projection?.devContract?.devInput ||
        typeof handoff.reservationId !== "string" ||
        !Number.isSafeInteger(handoff.reservedRevision)) {
      // La réservation existe déjà : sans ticket elle reste PREPARED et
      // bloquante jusqu'à la réconciliation.
      fail("GOAL_MODE_DEV_DISPATCH_HANDOFF_INVALID", "Remise DEV incomplète.", {
        reconciliationRequired: true,
      });
    }
    // Échec ici : même règle, PREPARED orphelin → markExecutionUnknown.
    const targetBaseline = inspectTarget(projection.taskRef);
    const ticket = Object.freeze({
      version: VERSION,
      runId,
      stepId: projection.stepRef.stepId,
      taskId: projection.taskRef.taskId,
      reservationId: handoff.reservationId,
      reservedRevision: handoff.reservedRevision,
    });
    tickets.set(ticket, Object.freeze({ handoff, targetBaseline }));
    return ticket;
  }

  function recheck(ticket, internal) {
    const { handoff, targetBaseline } = internal;
    const projection = handoff.exactProjection;
    const devInput = projection.devContract.devInput;

    // 1. Statut de réservation et absence de dispatch antérieur.
    const snapshot = runStore.get(ticket.runId);
    const records = Array.isArray(snapshot?.state?.executionReservations)
      ? snapshot.state.executionReservations : [];
    const record = records.find((item) => item?.reservationId === ticket.reservationId);
    if (!record) {
      fail("GOAL_MODE_DEV_DISPATCH_RESERVATION_MISSING", "Réservation DEV introuvable.");
    }
    if (["MAY_HAVE_STARTED", "UNKNOWN"].includes(record.status)) {
      fail("GOAL_MODE_DEV_DISPATCH_RECONCILIATION_REQUIRED",
        "Réservation DEV potentiellement engagée : réconciliation requise.", {
          reservationId: ticket.reservationId, status: record.status,
        });
    }
    if (record.status !== "PREPARED" || records.at(-1) !== record) {
      fail("GOAL_MODE_DEV_DISPATCH_RESERVATION_CLOSED", "Réservation DEV non dispatchable.");
    }
    if (snapshot.revision !== ticket.reservedRevision) {
      fail("GOAL_MODE_DEV_DISPATCH_STALE", "Goal Run modifié depuis la réservation.");
    }
    const binding = record.binding;
    if (binding?.runId !== projection.runRef.runId ||
        binding.runRevision !== projection.runRef.runRevision ||
        binding.stepId !== projection.stepRef.stepId ||
        binding.proposalFingerprint !== projection.stepRef.proposalFingerprint ||
        binding.taskId !== projection.taskRef.taskId ||
        binding.taskId !== devInput.taskId ||
        binding.targetFingerprint !== projection.stepRef.targetFingerprint ||
        record.reservedProviderCalls !== projection.accounting.stepUpperBound.providerCalls ||
        record.reservedCost !== projection.accounting.stepUpperBound.estimatedCost) {
      fail("GOAL_MODE_DEV_DISPATCH_BINDING_MISMATCH", "Contrat DEV non lié à la réservation.");
    }
    const priorCalls = devBudgetService.taskProviderCalls(binding.taskId);
    if (!Number.isSafeInteger(priorCalls) || priorCalls !== 0) {
      fail("GOAL_MODE_DEV_DISPATCH_RECONCILIATION_REQUIRED",
        "Le ledger DEV indique un engagement antérieur de cette tâche.", {
          reservationId: ticket.reservationId, status: record.status,
        });
    }

    // 2. Budgets restants : Goal Run (temps) et budget DEV secondaire.
    const state = snapshot.state;
    if (state.status !== "RUNNING") {
      fail("GOAL_MODE_DEV_DISPATCH_RUN_NOT_RUNNING", "Le Goal Run n'est plus RUNNING.");
    }
    const at = new Date(now()).getTime();
    const deadline = Date.parse(state.contract.admittedAt) + state.contract.limits.maxDuration;
    if (!Number.isFinite(at) || !Number.isFinite(deadline) ||
        deadline - at < MIN_REMAINING_DURATION_MS) {
      fail("GOAL_MODE_DEV_DISPATCH_TIME_BUDGET_BLOCKED", "Temps restant du Goal Run insuffisant.");
    }
    const remaining = Number(devBudgetService.effectiveRemaining(
      binding.taskId, projection.accounting.stepUpperBound.estimatedCost
    ));
    if (Number.isNaN(remaining) || typeof devInput.maxEstimatedCost !== "number" ||
        remaining + Number.EPSILON < devInput.maxEstimatedCost) {
      fail("GOAL_MODE_DEV_DISPATCH_BUDGET_EXHAUSTED", "Budget DEV insuffisant au dispatch.");
    }

    // 3. Permissions par intersection : plafond du run ∩ contrat ∩ état vivant.
    const ceilings = state.contract.capabilityCeilings || {};
    const capabilities = projection.devContract.capabilities || {};
    const live = permissionSource.current(Object.freeze({
      runId: ticket.runId, stepId: ticket.stepId, taskId: binding.taskId,
      workspaceId: projection.taskRef.workspaceId,
      projectId: projection.taskRef.projectId,
      repositoryRoot: projection.taskRef.repositoryRoot,
    })) || {};
    const effective = {
      network: strictBoolean(ceilings.network) && strictBoolean(capabilities.networkAllowed) &&
        strictBoolean(live.network),
      gitWrite: strictBoolean(ceilings.gitWrite) && strictBoolean(capabilities.gitWriteAllowed) &&
        strictBoolean(live.gitWrite),
      destructiveActions: strictBoolean(ceilings.destructiveActions) &&
        strictBoolean(capabilities.destructiveActionsAllowed) &&
        strictBoolean(live.destructiveActions),
      repositoryWrite: strictBoolean(live.repositoryWrite),
    };
    const requested = Array.isArray(devInput.permissions) ? devInput.permissions : null;
    if (capabilities.executionAuthority !== false ||
        capabilities.gitWriteAllowed !== false ||
        capabilities.destructiveActionsAllowed !== false ||
        !requested || requested.some((item) => !ALLOWED_DEV_PERMISSIONS.includes(item))) {
      fail("GOAL_MODE_DEV_DISPATCH_PERMISSION_ESCALATION", "Le contrat DEV demande plus que permis.");
    }
    if ((devInput.localOnly === false && !effective.network) ||
        (requested.includes("READ_WRITE_WORKSPACE") && !effective.repositoryWrite)) {
      fail("GOAL_MODE_DEV_DISPATCH_PERMISSION_REVOKED", "Permission requise retirée depuis la réservation.");
    }

    // 4. Empreinte de la cible.
    if (inspectTarget(projection.taskRef) !== targetBaseline) {
      fail("GOAL_MODE_DEV_DISPATCH_TARGET_CHANGED", "Cible DEV modifiée depuis la réservation.");
    }
    return devInput;
  }

  async function dispatch(ticket) {
    const internal = tickets.get(ticket);
    if (!internal) {
      fail("GOAL_MODE_DEV_DISPATCH_TICKET_UNKNOWN", "Ticket DEV inconnu de ce processus.");
    }
    if (attempted.has(ticket.reservationId)) {
      fail("GOAL_MODE_DEV_DISPATCH_ALREADY_ATTEMPTED", "Dispatch DEV déjà tenté.", {
        reservationId: ticket.reservationId,
      });
    }
    // Recheck et CAS sont synchrones : aucun await avant la frontière.
    const devInput = recheck(ticket, internal);
    attempted.add(ticket.reservationId);
    // CAS PREPARED → MAY_HAVE_STARTED avant tout effet. En cas d'échec
    // (conflit, budget, erreur SQLite), aucun dispatch n'a lieu.
    const started = runStore.markExecutionMayHaveStarted(ticket.runId, {
      expectedRevision: ticket.reservedRevision,
      reservationId: ticket.reservationId,
    });
    // Copie neuve : le dispatcher ne peut pas altérer le contrat remis.
    const payload = structuredClone(devInput);
    let devResult;
    try {
      devResult = await dispatcher.runTask(payload);
    } catch (error) {
      fail("GOAL_MODE_DEV_DISPATCH_OUTCOME_UNCERTAIN",
        "Issue DEV incertaine : réconciliation requise, aucun replay.", {
          reservationId: ticket.reservationId,
          mayHaveStartedRevision: started.revision,
          causeCode: typeof error?.code === "string" ? error.code.slice(0, 80) : null,
          reconciliationRequired: true,
        });
    }
    return Object.freeze({
      version: VERSION,
      reservationId: ticket.reservationId,
      mayHaveStartedRevision: started.revision,
      devResult,
      reconciliationRequired: true,
      authority: Object.freeze({ capabilitiesGranted: false, approvalGranted: false }),
    });
  }

  return Object.freeze({ prepare, dispatch });
}

module.exports = {
  VERSION,
  createGoalModeDevDispatchService,
  defaultGoalModeDevTargetInspector: defaultTargetInspector,
};
