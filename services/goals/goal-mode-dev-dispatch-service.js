"use strict";

/*
 * 5.0D-4C-1B/1C — Recheck, approbation exacte et dispatch unique.
 *
 * - prepare() réserve via 4C-1A (CAS), capture une empreinte de la cible et
 *   émet une approbation ApprovalEngine liée au contrat exact (empreinte du
 *   contrat, reservationId, reservedRevision, empreinte de la cible).
 * - resume() est la seule entrée publique : lecture bornée de l'action
 *   exacte, pré-contrôle, puis ApprovalEngine (consumeAtBoundary) appelle le
 *   dispatch interne qui revérifie tout, CONSOMME l'approbation, passe
 *   PREPARED → MAY_HAVE_STARTED par CAS, puis appelle une seule fois le
 *   dispatcher. Jamais de replay ; MAY_HAVE_STARTED/UNKNOWN → réconciliation.
 * - renewApproval() est explicite, audité, réservé à une réservation encore
 *   PREPARED ; l'ancien jeton devient inutilisable.
 * - 4C-1D : pauseRun/stopRun annulent les approbations en attente (une
 *   réservation PREPARED ne peut plus démarrer après une transition) ;
 *   releasePrepared, désactivé par défaut, passe par releaseExecution.
 *   resumeRun ne réactive rien. cancelExecution demande l'arrêt d'une tâche
 *   MAY_HAVE_STARTED sans changer son statut (réconciliation 4C-2).
 * - Aucune permission n'est accordée ici, aucune libération implicite.
 * - Le service n'est pas câblé au serveur : le dispatcher est injecté.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  BINDING_VERSION: APPROVAL_BINDING_VERSION,
  OPERATION: APPROVAL_OPERATION,
  SKILL_NAME: APPROVAL_SKILL_NAME,
  canonicalJson,
  contractFingerprint,
} = require("./goal-mode-dev-approval-action");

const VERSION = "goal-mode-dev-dispatch-v1";
const MIN_REMAINING_DURATION_MS = 1_000;
// 4C-1C : approbation de 5 min, plafonnée par l'échéance du run moins 1 s.
const APPROVAL_TTL_MS = 5 * 60_000;
const APPROVAL_DEADLINE_MARGIN_MS = 1_000;
// 4C-1D : statuts d'arrêt traités comme une pause (approbations annulées).
const HALT_STATUSES = Object.freeze(["PAUSED", "BLOCKED", "CANCELLED"]);
const RESUMABLE_STATUSES = Object.freeze(["PAUSED", "BLOCKED"]);
const ALLOWED_DEV_PERMISSIONS = Object.freeze(["READ_WRITE_WORKSPACE", "TERMINAL_SAFE"]);
const TARGET_MAX_ENTRIES = 5_000;
const TARGET_MAX_BYTES = 64 * 1024 * 1024;

/*
 * Chemins jamais lus ni hashés par l'empreinte (AGENTS.md §3, §9, §11) :
 * données locales de développement, secrets, bases personnelles,
 * dépendances, caches et builds. Exclus deux fois : par pathspec Git (Git
 * ne les inspecte pas) puis par filtre local avant tout accès fichier.
 */
const PROTECTED_TARGET_GLOBS = Object.freeze([
  "benchmark-workspaces/**",
  "dev-cost-ledger.json",
  "dev-task-journal/**",
  "**/.git/**",
  "**/node_modules/**",
  "**/.env",
  "**/.env.*",
  "**/*.sqlite",
  "**/*.sqlite-*",
  "**/*.sqlite3",
  "**/*.db",
  "**/*.db-*",
  "**/*.pem",
  "**/*.key",
  "**/credentials*.json",
  "**/token*.json",
  "**/.cache/**",
  "**/dist/**",
  "**/out/**",
  "**/build/**",
  "**/coverage/**",
]);

function protectedPattern(glob) {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (glob.startsWith("**/", index)) { source += "(?:.*/)?"; index += 2; }
    else if (glob.startsWith("/**", index) && index + 3 === glob.length) { source += "/.*"; index += 2; }
    else if (char === "*") source += "[^/]*";
    else source += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

const PROTECTED_TARGET_PATTERNS = Object.freeze(PROTECTED_TARGET_GLOBS.map(protectedPattern));

const TARGET_STATUS_ARGS = Object.freeze([
  "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=no",
  "--", ".", ...PROTECTED_TARGET_GLOBS.map((glob) => `:(exclude,glob)${glob}`),
]);

function isProtectedTargetPath(relative) {
  const normalized = String(relative).split(path.sep).join("/").replace(/\/+$/, "");
  return PROTECTED_TARGET_PATTERNS.some((pattern) =>
    pattern.test(normalized) || pattern.test(`${normalized}/`));
}

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
    const status = git(root, TARGET_STATUS_ARGS);
    const entries = status.toString("utf8").split("\0").filter(Boolean);
    if (entries.length > TARGET_MAX_ENTRIES) {
      fail("GOAL_MODE_DEV_TARGET_UNINSPECTABLE", "Trop de fichiers modifiés.");
    }
    const listed = [];
    const contents = [];
    let total = 0;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const code = entry.slice(0, 2);
      const relative = entry.slice(3);
      // Renommage/copie : l'entrée suivante est le chemin d'origine.
      const origin = code.includes("R") || code.includes("C") ? entries[++index] : null;
      // Filtre local avant tout accès : un chemin protégé n'est ni lu,
      // ni stat, ni compté, même si Git le listait malgré le pathspec.
      if (isProtectedTargetPath(relative)) continue;
      listed.push([code, relative, origin !== null && isProtectedTargetPath(origin) ? null : origin]);
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
      listed, contents,
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
  goalStrategyEngine,
  devBudgetService,
  permissionSource,
  dispatcher,
  approvalEngine,
  targetInspector = defaultTargetInspector,
  now = () => new Date(),
  approvalTtlMs = APPROVAL_TTL_MS,
  observability = null,
} = {}) {
  if (typeof runStore?.reserveExecutionWithExactProjection !== "function" ||
      typeof runStore?.transition !== "function" ||
      typeof goalStrategyEngine?.registry?.get !== "function" ||
      typeof runStore?.markExecutionMayHaveStarted !== "function" ||
      typeof runStore?.get !== "function" ||
      typeof devBudgetService?.effectiveRemaining !== "function" ||
      typeof devBudgetService?.taskProviderCalls !== "function" ||
      typeof permissionSource?.current !== "function" ||
      typeof dispatcher?.runTask !== "function" ||
      typeof approvalEngine?.prepareAction !== "function" ||
      typeof approvalEngine?.resumeApprovedAction !== "function" ||
      typeof approvalEngine?.getPreparedGoalModeDevDispatchExactAction !== "function" ||
      typeof approvalEngine?.cancel !== "function" ||
      typeof targetInspector !== "function" ||
      typeof now !== "function" ||
      !Number.isSafeInteger(approvalTtlMs) || approvalTtlMs < 1) {
    throw new TypeError("Dépendances Goal Mode DEV Dispatch requises.");
  }

  // Réservations préparées par CETTE instance (aucune après redémarrage) :
  // reservationId → contexte interne ; approvalId → reservationId.
  const reservations = new Map();
  const approvals = new Map();
  // Gardes in-process ; l'autorité inter-processus reste le CAS SQLite.
  const attempted = new Set();
  const resuming = new Set();

  function emit(event, metadata) {
    try { observability?.(event, metadata); } catch {}
  }

  function inspectTarget(taskRef) {
    const fingerprint = targetInspector(Object.freeze({
      repositoryRoot: taskRef.repositoryRoot, branch: taskRef.branch,
    }));
    if (typeof fingerprint !== "string" || !/^sha256:[0-9a-f]{64}$/.test(fingerprint)) {
      fail("GOAL_MODE_DEV_TARGET_UNINSPECTABLE", "Empreinte de cible invalide.");
    }
    return fingerprint;
  }

  function approvalTtl(state) {
    const at = new Date(now()).getTime();
    const deadline = Date.parse(state?.contract?.admittedAt) + state?.contract?.limits?.maxDuration;
    const remaining = deadline - at - APPROVAL_DEADLINE_MARGIN_MS;
    if (!Number.isFinite(remaining) || remaining < 1) {
      fail("GOAL_MODE_DEV_DISPATCH_TIME_BUDGET_BLOCKED", "Temps restant du Goal Run insuffisant.");
    }
    return Math.min(approvalTtlMs, Math.floor(remaining));
  }

  function goalTitle(goalId) {
    try {
      const goal = goalStrategyEngine.registry.get(goalId);
      return typeof goal?.title === "string" ? goal.title : null;
    } catch { return null; }
  }

  // Affichage local uniquement : jamais persisté (le dépôt d'approbations ne
  // conserve que identifiants, empreintes et statuts).
  function display(internal) {
    const projection = internal.handoff.exactProjection;
    const devInput = projection.devContract.devInput;
    const network = projection.devContract.capabilities?.networkAllowed === true &&
      devInput.localOnly === false;
    return Object.freeze({
      goalTitle: goalTitle(internal.binding.goalId),
      instruction: devInput.objective,
      repositoryRoot: projection.taskRef.repositoryRoot,
      branch: projection.taskRef.branch ?? null,
      permissions: Object.freeze([
        ...(Array.isArray(devInput.permissions) ? devInput.permissions : []),
        ...(network ? ["NETWORK"] : []),
      ]),
      maxEstimatedCost: devInput.maxEstimatedCost,
      maxProviderCalls: devInput.maxProviderCalls,
      maxDuration: devInput.maxDuration,
    });
  }

  function summary(view) {
    return [
      `Goal « ${view.goalTitle ?? "sans titre"} »`,
      `Consigne : ${view.instruction}`,
      `Repository : ${view.repositoryRoot}`,
      `Permissions : ${view.permissions.join(", ") || "aucune"}`,
      `Coût maximal : ${view.maxEstimatedCost} USD`,
      `Appels maximum : ${view.maxProviderCalls}`,
      `Durée maximale : ${Math.round(Number(view.maxDuration) / 1000)} s`,
    ].join(" · ");
  }

  function expectedPreconditions(internal) {
    return {
      reservationId: internal.ticket.reservationId,
      reservedRevision: internal.ticket.reservedRevision,
      reservationStatus: "PREPARED",
      latestReservationId: internal.ticket.reservationId,
      targetFingerprint: internal.targetBaseline,
      goalId: internal.binding.goalId,
      goalVersion: internal.binding.goalVersion,
      goalStatus: "ACTIVE",
    };
  }

  function currentPreconditions(internal) {
    try {
      const snapshot = runStore.get(internal.ticket.runId);
      const records = snapshot.state.executionReservations || [];
      const record = records.find((item) => item.reservationId === internal.ticket.reservationId);
      const goal = goalStrategyEngine.registry.get(internal.binding.goalId);
      return {
        reservationId: record?.reservationId ?? null,
        reservedRevision: snapshot.revision,
        reservationStatus: record?.status ?? null,
        latestReservationId: records.at(-1)?.reservationId ?? null,
        targetFingerprint: inspectTarget(internal.handoff.exactProjection.taskRef),
        goalId: goal?.goalId ?? null,
        goalVersion: goal?.version ?? null,
        goalStatus: goal?.status ?? null,
      };
    } catch {
      return {};
    }
  }

  function assertStillPrepared(internal, code) {
    const snapshot = runStore.get(internal.ticket.runId);
    const record = snapshot?.state?.executionReservations?.at(-1);
    if (record?.reservationId !== internal.ticket.reservationId || record.status !== "PREPARED" ||
        snapshot.revision !== internal.ticket.reservedRevision) {
      fail(code, "La réservation DEV n'est plus PREPARED.");
    }
    return snapshot;
  }

  // Émet une approbation pour le contrat exact ; en renouvellement, l'ancienne
  // est annulée (supersededBy) et son jeton devient inutilisable.
  function issueApproval(internal, renewal) {
    const snapshot = assertStillPrepared(internal, "GOAL_MODE_DEV_DISPATCH_RENEW_UNAVAILABLE");
    const ttlMs = approvalTtl(snapshot.state);
    const view = display(internal);
    const approval = approvalEngine.prepareAction({
      executionId: `goal-mode-dev:${internal.ticket.runId}:${internal.ticket.reservationId}`,
      skillName: APPROVAL_SKILL_NAME,
      operation: APPROVAL_OPERATION,
      normalizedArgs: internal.binding,
      target: internal.ticket.taskId,
      permissionLevel: "write",
      title: "Lancer une tâche DEV Goal Mode",
      sanitizedSummary: summary(view),
      riskLevel: "high",
      strengthened: true,
      preconditions: expectedPreconditions(internal),
      contextRef: {
        reservationId: internal.ticket.reservationId,
        contractFingerprint: internal.binding.contractFingerprint,
      },
      ttlMs,
    });
    const previous = internal.approvalId;
    if (previous) {
      try {
        approvalEngine.cancel(previous, approval.id);
      } catch (error) {
        try { approvalEngine.cancel(approval.id); } catch {}
        throw error;
      }
      approvals.delete(previous);
    }
    internal.approvalId = approval.id;
    approvals.set(approval.id, internal.ticket.reservationId);
    emit(renewal ? "goal_mode_dev.approval_renewed" : "goal_mode_dev.approval_issued", {
      reservationId: internal.ticket.reservationId,
      approvalId: approval.id,
      supersededApprovalId: previous || null,
    });
    const { resumeToken, ...publicApproval } = approval;
    return Object.freeze({
      ticket: internal.ticket,
      approval: Object.freeze(publicApproval),
      resumeToken,
      display: view,
    });
  }

  function prepare(runId, input = {}) {
    // Refus avant réservation si le run ne laisse plus le temps d'approuver
    // (un run absent est laissé à la réservation, qui le refuse).
    const before = runStore.get(runId);
    if (before) approvalTtl(before.state);
    const handoff = runStore.reserveExecutionWithExactProjection(runId, input);
    const projection = handoff?.exactProjection;
    if (!projection?.taskRef || !projection?.devContract?.devInput ||
        typeof handoff.reservationId !== "string" ||
        !Number.isSafeInteger(handoff.reservedRevision)) {
      // La réservation existe déjà : sans ticket elle reste PREPARED et
      // bloquante jusqu'à la libération explicite ou la réconciliation.
      fail("GOAL_MODE_DEV_DISPATCH_HANDOFF_INVALID", "Remise DEV incomplète.", {
        reconciliationRequired: true,
      });
    }
    // Échec ici : même règle, PREPARED orphelin → releaseExecution ou UNKNOWN.
    const targetBaseline = inspectTarget(projection.taskRef);
    const ticket = Object.freeze({
      version: VERSION,
      runId,
      stepId: projection.stepRef.stepId,
      taskId: projection.taskRef.taskId,
      reservationId: handoff.reservationId,
      reservedRevision: handoff.reservedRevision,
    });
    const binding = Object.freeze({
      version: APPROVAL_BINDING_VERSION,
      runId,
      reservationId: handoff.reservationId,
      reservedRevision: handoff.reservedRevision,
      stepId: projection.stepRef.stepId,
      taskId: projection.taskRef.taskId,
      goalId: projection.runRef.goalId,
      goalVersion: projection.runRef.goalVersion,
      proposalFingerprint: projection.stepRef.proposalFingerprint,
      contractFingerprint: contractFingerprint(projection),
      targetFingerprint: targetBaseline,
    });
    const internal = { ticket, handoff, targetBaseline, binding, approvalId: null };
    reservations.set(ticket.reservationId, internal);
    // Échec d'émission : la réservation reste PREPARED ; renouvellement
    // explicite possible, jamais de libération implicite.
    return issueApproval(internal, false);
  }

  function renewApproval({ reservationId } = {}) {
    const internal = typeof reservationId === "string" ? reservations.get(reservationId) : null;
    if (!internal) {
      fail("GOAL_MODE_DEV_DISPATCH_TICKET_UNKNOWN", "Réservation DEV inconnue de ce processus.");
    }
    if (attempted.has(reservationId) || resuming.has(reservationId)) {
      fail("GOAL_MODE_DEV_DISPATCH_RENEW_UNAVAILABLE", "Dispatch DEV déjà engagé pour cette réservation.");
    }
    return issueApproval(internal, true);
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

    // 2. Run et Goal autoritatif : pause, archivage ou nouvelle version
    //    depuis la réservation → refus avant tout CAS.
    const state = snapshot.state;
    if (state.status !== "RUNNING") {
      fail("GOAL_MODE_DEV_DISPATCH_RUN_NOT_RUNNING", "Le Goal Run n'est plus RUNNING.");
    }
    const goalRef = state.contract?.goalRef;
    let goal = null;
    try { goal = goalStrategyEngine.registry.get(goalRef?.goalId); } catch { goal = null; }
    if (!goal || goal.goalId !== goalRef.goalId || goal.status !== "ACTIVE" ||
        goal.userConfirmed !== true || goal.version !== goalRef.goalVersion ||
        goal.version !== projection.runRef.goalVersion ||
        binding.goalId !== goal.goalId || binding.goalVersion !== goal.version) {
      fail("GOAL_MODE_DEV_DISPATCH_GOAL_STALE", "Le Goal a changé depuis la réservation.");
    }

    // 3. Budgets restants : Goal Run (temps) et budget DEV secondaire.
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

    // 4. Permissions par intersection : plafond du run ∩ contrat ∩ état vivant.
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

    // 5. Empreinte de la cible.
    if (inspectTarget(projection.taskRef) !== targetBaseline) {
      fail("GOAL_MODE_DEV_DISPATCH_TARGET_CHANGED", "Cible DEV modifiée depuis la réservation.");
    }
    return devInput;
  }

  function assertExactBinding(exactAction, internal) {
    const expected = internal.binding;
    if (exactAction?.skillName !== APPROVAL_SKILL_NAME ||
        exactAction?.operation !== APPROVAL_OPERATION ||
        exactAction?.target !== internal.ticket.taskId ||
        canonicalJson(exactAction?.normalizedArgs) !== canonicalJson(expected) ||
        contractFingerprint(internal.handoff.exactProjection) !== expected.contractFingerprint) {
      fail("GOAL_MODE_DEV_DISPATCH_APPROVAL_MISMATCH",
        "L'approbation ne correspond pas exactement à ce contrat DEV.");
    }
  }

  // Interne : appelé uniquement par ApprovalEngine après approbation exacte.
  // Recheck, consommation, CAS sont synchrones ; l'effet vient ensuite.
  async function dispatch(internal, boundary) {
    const { ticket } = internal;
    const devInput = recheck(ticket, internal);
    // Consommation durable AVANT le CAS : jamais de dispatch sans approbation
    // consommée ; un CAS raté après consommation « brûle » l'approbation.
    boundary.consume();
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
      approvalId: internal.approvalId,
      mayHaveStartedRevision: started.revision,
      devResult,
      reconciliationRequired: true,
      authority: Object.freeze({
        approvalConsumedBy: "ApprovalEngine",
        capabilitiesGranted: false,
      }),
    });
  }

  async function resume({ approvalId, resumeToken, decision = "approve" } = {}) {
    if (!["approve", "reject"].includes(decision)) {
      fail("GOAL_MODE_DEV_DISPATCH_DECISION_INVALID", "Décision d'approbation invalide.");
    }
    // Lecture bornée : jeton, statut pending, action Goal Mode. N'approuve rien.
    const exactAction = approvalEngine.getPreparedGoalModeDevDispatchExactAction({
      approvalId, resumeToken,
    });
    const reservationId = approvals.get(approvalId);
    const internal = reservationId ? reservations.get(reservationId) : null;
    if (!internal || internal.approvalId !== approvalId) {
      fail("GOAL_MODE_DEV_DISPATCH_TICKET_UNKNOWN", "Réservation DEV inconnue de ce processus.");
    }
    assertExactBinding(exactAction, internal);
    if (decision === "reject") {
      // Aucune libération implicite : la réservation reste PREPARED.
      await approvalEngine.resumeApprovedAction({
        approvalId, resumeToken, decision: "reject", exactAction,
      });
      return Object.freeze({ status: "rejected", reservationId, approvalId });
    }
    if (attempted.has(reservationId)) {
      fail("GOAL_MODE_DEV_DISPATCH_ALREADY_ATTEMPTED", "Dispatch DEV déjà tenté.", { reservationId });
    }
    if (resuming.has(reservationId)) {
      fail("GOAL_MODE_DEV_DISPATCH_IN_PROGRESS", "Dispatch DEV déjà en cours.", { reservationId });
    }
    // Pré-contrôle aux codes précis : un refus ici ne touche pas l'approbation.
    recheck(internal.ticket, internal);
    resuming.add(reservationId);
    try {
      const outcome = await approvalEngine.resumeApprovedAction({
        approvalId,
        resumeToken,
        decision: "approve",
        exactAction,
        consumeAtBoundary: true,
        recheckPreconditions: () => currentPreconditions(internal),
        execute: (_args, _record, boundary) => dispatch(internal, boundary),
      });
      return outcome.result;
    } finally {
      resuming.delete(reservationId);
    }
  }

  function errorCode(error, fallback) {
    return typeof error?.code === "string" ? error.code.slice(0, 100) : fallback;
  }

  // Pause / arrêt : la transition fait foi (CAS) ; les approbations en attente
  // du run sont ensuite annulées. Même si une annulation échoue, aucune
  // réservation PREPARED ne peut démarrer après la transition (règle d'état
  // 4C-0 : départ uniquement à la révision qui suit la réservation).
  function haltRun({ runId, expectedRevision, status, reasonCode = null, releasePrepared = false } = {}) {
    if (!HALT_STATUSES.includes(status)) {
      fail("GOAL_MODE_DEV_RUN_TRANSITION_INVALID", "Statut d'arrêt Goal Run invalide.");
    }
    if (typeof releasePrepared !== "boolean") {
      fail("GOAL_MODE_DEV_RUN_TRANSITION_INVALID", "Option releasePrepared invalide.");
    }
    let snapshot = runStore.transition(runId, status, { expectedRevision, reasonCode });
    const approvalsCancelled = [];
    const approvalCancelFailures = [];
    for (const internal of reservations.values()) {
      if (internal.ticket.runId !== runId || !internal.approvalId) continue;
      try {
        if (approvalEngine.cancel(internal.approvalId) === true) {
          approvalsCancelled.push(internal.approvalId);
        }
      } catch (error) {
        approvalCancelFailures.push(Object.freeze({
          approvalId: internal.approvalId,
          code: errorCode(error, "APPROVAL_CANCEL_FAILED"),
        }));
      }
    }
    let release = null;
    if (releasePrepared) {
      // Libération explicite demandée au moment de l'arrêt : mêmes contrôles
      // que releaseExecution (ledger à 0 + CAS). Un refus n'annule pas la
      // pause mais est rapporté et audité, jamais silencieux.
      const record = snapshot.state.executionReservations?.at(-1);
      if (record?.status !== "PREPARED") {
        release = { requested: true, reservationId: null, released: false,
          code: "GOAL_MODE_DEV_NO_PREPARED_RESERVATION" };
      } else if (typeof runStore.releaseExecution !== "function") {
        release = { requested: true, reservationId: record.reservationId, released: false,
          code: "GOAL_MODE_EXECUTION_RELEASE_UNAVAILABLE" };
      } else {
        try {
          snapshot = runStore.releaseExecution(runId, {
            expectedRevision: snapshot.revision, reservationId: record.reservationId,
          });
          release = { requested: true, reservationId: record.reservationId, released: true, code: null };
        } catch (error) {
          release = { requested: true, reservationId: record.reservationId, released: false,
            code: errorCode(error, "GOAL_MODE_DEV_RELEASE_FAILED") };
        }
      }
      release = Object.freeze(release);
      emit("goal_mode_dev.release_on_halt", { runId, status, ...release });
    }
    emit("goal_mode_dev.run_halted", {
      runId, status, revision: snapshot.revision,
      approvalsCancelled: approvalsCancelled.length,
      approvalCancelFailures: approvalCancelFailures.length,
    });
    return Object.freeze({
      runId,
      status,
      revision: snapshot.revision,
      approvalsCancelled: Object.freeze(approvalsCancelled),
      approvalCancelFailures: Object.freeze(approvalCancelFailures),
      release,
    });
  }

  function pauseRun(input = {}) {
    return haltRun({ ...input, status: "PAUSED" });
  }

  function stopRun(input = {}) {
    if (!["BLOCKED", "CANCELLED"].includes(input.status)) {
      fail("GOAL_MODE_DEV_RUN_TRANSITION_INVALID", "stopRun exige BLOCKED ou CANCELLED.");
    }
    return haltRun(input);
  }

  // Reprise : ne réactive aucune réservation ni approbation. Les réservations
  // PREPARED d'avant l'arrêt sont signalées (libération explicite requise).
  function resumeRun({ runId, expectedRevision, reasonCode = null } = {}) {
    const current = runStore.get(runId);
    if (!RESUMABLE_STATUSES.includes(current?.state?.status)) {
      fail("GOAL_MODE_DEV_RUN_NOT_PAUSED", "Seul un Goal Run PAUSED ou BLOCKED peut reprendre.");
    }
    const snapshot = runStore.transition(runId, "RUNNING", { expectedRevision, reasonCode });
    const records = snapshot.state.executionReservations || [];
    const releaseRequired = records.filter((item) => item.status === "PREPARED")
      .map((item) => item.reservationId);
    const reconciliationRequired = records
      .filter((item) => ["MAY_HAVE_STARTED", "UNKNOWN"].includes(item.status))
      .map((item) => item.reservationId);
    emit("goal_mode_dev.run_resumed", {
      runId, revision: snapshot.revision,
      releaseRequired: releaseRequired.length,
      reconciliationRequired: reconciliationRequired.length,
    });
    return Object.freeze({
      runId,
      status: "RUNNING",
      revision: snapshot.revision,
      releaseRequired: Object.freeze(releaseRequired),
      reconciliationRequired: Object.freeze(reconciliationRequired),
    });
  }

  function reservationRecord(runId, reservationId) {
    const snapshot = runStore.get(runId);
    const record = snapshot?.state?.executionReservations
      ?.find((item) => item.reservationId === reservationId);
    if (!record) {
      fail("GOAL_MODE_DEV_DISPATCH_RESERVATION_MISSING", "Réservation DEV introuvable.");
    }
    return { snapshot, record };
  }

  // Demande d'arrêt d'une tâche DEV engagée par CETTE instance. Action qui
  // réduit l'effet : sans approbation, mais explicite et auditée. Le statut
  // reste MAY_HAVE_STARTED : seule la réconciliation (4C-2) tranche l'issue.
  function cancelExecution({ runId, reservationId } = {}) {
    const internal = typeof reservationId === "string" ? reservations.get(reservationId) : null;
    if (!internal || internal.ticket.runId !== runId) {
      fail("GOAL_MODE_DEV_DISPATCH_TICKET_UNKNOWN", "Réservation DEV inconnue de ce processus.");
    }
    const { record } = reservationRecord(runId, reservationId);
    if (record.status !== "MAY_HAVE_STARTED" || !attempted.has(reservationId)) {
      fail("GOAL_MODE_DEV_CANCEL_UNAVAILABLE",
        record.status === "PREPARED"
          ? "Réservation non engagée : utiliser releaseExecution."
          : "Aucune tâche DEV engagée à arrêter pour cette réservation.", { status: record.status });
    }
    if (internal.cancelRequested === true) {
      return Object.freeze({
        reservationId, cancelRequested: true, alreadyRequested: true,
        reservationStatus: record.status, reconciliationRequired: true,
      });
    }
    if (typeof dispatcher.cancelTask !== "function") {
      fail("GOAL_MODE_DEV_CANCEL_UNAVAILABLE", "Arrêt Native DEV indisponible.");
    }
    let result;
    try {
      result = dispatcher.cancelTask(internal.ticket.taskId);
    } catch (error) {
      emit("goal_mode_dev.execution_cancel_failed", {
        runId, reservationId, code: errorCode(error, "CANCEL_FAILED"),
      });
      fail("GOAL_MODE_DEV_CANCEL_FAILED", "Demande d'arrêt Native DEV en échec.", {
        reservationId, causeCode: errorCode(error, null),
      });
    }
    internal.cancelRequested = true;
    emit("goal_mode_dev.execution_cancel_requested", {
      runId, reservationId, cancelled: result?.cancelled === true,
    });
    return Object.freeze({
      reservationId,
      cancelRequested: true,
      alreadyRequested: false,
      nativeCancelled: result?.cancelled === true,
      reservationStatus: record.status,
      reconciliationRequired: true,
    });
  }

  // Statut Goal Mode d'une réservation : projection minimale, sans consigne,
  // chemin ni contenu de la tâche.
  function executionStatus({ runId, reservationId } = {}) {
    const { snapshot, record } = reservationRecord(runId, reservationId);
    let native = null;
    if (attempted.has(reservationId) && typeof dispatcher.getTaskStatus === "function") {
      try {
        const task = dispatcher.getTaskStatus(record.binding.taskId);
        if (task) {
          const pick = (value) => (typeof value === "string" ? value.slice(0, 60) : null);
          native = Object.freeze({
            status: pick(task.status),
            finalVerdict: pick(task.finalVerdict),
            failureCategory: pick(task.failureCategory),
          });
        }
      } catch { native = null; }
    }
    return Object.freeze({
      runId,
      runStatus: snapshot.state.status,
      runRevision: snapshot.revision,
      reservationId,
      reservationStatus: record.status,
      dispatchedByThisInstance: attempted.has(reservationId),
      cancelRequested: reservations.get(reservationId)?.cancelRequested === true,
      native,
    });
  }

  return Object.freeze({
    cancelExecution,
    executionStatus,
    pauseRun,
    prepare,
    renewApproval,
    resume,
    resumeRun,
    stopRun,
  });
}

module.exports = {
  APPROVAL_DEADLINE_MARGIN_MS,
  APPROVAL_TTL_MS,
  PROTECTED_TARGET_GLOBS,
  TARGET_STATUS_ARGS,
  VERSION,
  createGoalModeDevDispatchService,
  defaultGoalModeDevTargetInspector: defaultTargetInspector,
  isProtectedGoalModeDevTargetPath: isProtectedTargetPath,
};
