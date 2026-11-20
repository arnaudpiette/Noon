"use strict";

/*
 * Branchement B2 — contrat HTTP Goal Mode DEV.
 *
 * - Clés exactes par route : toute clé inconnue est refusée, en particulier
 *   taskId, chemins, permissions, plafonds de capacités, règles ou localOnly.
 * - decision est obligatoire ("approve" | "reject"), sans valeur par défaut.
 * - Le jeton de reprise n'apparaît que dans les réponses prepare et renew ;
 *   l'affichage local (display) aussi ; aucun taskId dans aucune réponse.
 * - Erreurs minimales : code, message générique, détails sûrs seulement.
 */

const VERSION = "goal-mode-dev-http-v1";
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const APPROVAL_ID_PATTERN = /^approval_[0-9a-f-]{36}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const REASON_PATTERN = /^[A-Z][A-Z0-9_]{0,79}$/;
const LIMIT_KEYS = Object.freeze(["maxSteps", "maxRetries", "maxProviderCalls", "maxDuration", "maxEstimatedCost"]);

function fail(message = "Corps de requête Goal Mode DEV invalide.") {
  throw Object.assign(new Error(message), { code: "GOAL_MODE_DEV_HTTP_BODY_INVALID" });
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exactKeys(value, required, optional = []) {
  if (!plainObject(value)) fail();
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) fail();
  }
  for (const key of required) if (!Object.hasOwn(value, key)) fail();
  return value;
}

function id(value) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) fail();
  return value;
}

function revision(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail();
  return value;
}

function reasonCode(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !REASON_PATTERN.test(value)) fail();
  return value;
}

function trueOnly(value) {
  if (value !== true) fail();
  return true;
}

function normalizeCreateRun(body) {
  exactKeys(body, ["goalId", "workspaceId", "projectId", "limits", "userConfirmed"]);
  exactKeys(body.limits, LIMIT_KEYS);
  const limits = {};
  for (const key of LIMIT_KEYS) {
    const value = body.limits[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail();
    limits[key] = value;
  }
  return Object.freeze({
    goalId: id(body.goalId),
    workspaceId: id(body.workspaceId),
    projectId: id(body.projectId),
    limits: Object.freeze(limits),
    userConfirmed: trueOnly(body.userConfirmed),
  });
}

function normalizeRunRevision(body) {
  exactKeys(body, ["runId", "expectedRevision"]);
  return Object.freeze({ runId: id(body.runId), expectedRevision: revision(body.expectedRevision) });
}

function normalizePlanning(body) {
  exactKeys(body, ["runId", "confirmProviderCall"]);
  return Object.freeze({ runId: id(body.runId), confirmProviderCall: trueOnly(body.confirmProviderCall) });
}

function normalizePrepare(body) {
  exactKeys(body, ["runId", "expectedRevision", "stepId"]);
  return Object.freeze({
    runId: id(body.runId), expectedRevision: revision(body.expectedRevision), stepId: id(body.stepId),
  });
}

function normalizeResume(body) {
  exactKeys(body, ["approvalId", "resumeToken", "decision"]);
  if (typeof body.approvalId !== "string" || !APPROVAL_ID_PATTERN.test(body.approvalId)) fail();
  if (typeof body.resumeToken !== "string" || !TOKEN_PATTERN.test(body.resumeToken)) fail();
  if (body.decision !== "approve" && body.decision !== "reject") fail();
  return Object.freeze({ approvalId: body.approvalId, resumeToken: body.resumeToken, decision: body.decision });
}

function normalizeRenew(body) {
  exactKeys(body, ["reservationId"]);
  return Object.freeze({ reservationId: id(body.reservationId) });
}

function normalizePause(body) {
  exactKeys(body, ["runId", "expectedRevision"], ["reasonCode", "releasePrepared"]);
  if (Object.hasOwn(body, "releasePrepared") && typeof body.releasePrepared !== "boolean") fail();
  return Object.freeze({
    runId: id(body.runId), expectedRevision: revision(body.expectedRevision),
    reasonCode: reasonCode(body.reasonCode), releasePrepared: body.releasePrepared === true,
  });
}

function normalizeResumeRun(body) {
  exactKeys(body, ["runId", "expectedRevision"], ["reasonCode"]);
  return Object.freeze({
    runId: id(body.runId), expectedRevision: revision(body.expectedRevision), reasonCode: reasonCode(body.reasonCode),
  });
}

function normalizeStop(body) {
  exactKeys(body, ["runId", "expectedRevision", "status"], ["reasonCode"]);
  if (body.status !== "BLOCKED" && body.status !== "CANCELLED") fail();
  return Object.freeze({
    runId: id(body.runId), expectedRevision: revision(body.expectedRevision),
    status: body.status, reasonCode: reasonCode(body.reasonCode),
  });
}

function normalizeCancel(body) {
  exactKeys(body, ["runId", "reservationId"]);
  return Object.freeze({ runId: id(body.runId), reservationId: id(body.reservationId) });
}

function normalizeRelease(body) {
  exactKeys(body, ["runId", "expectedRevision", "reservationId"]);
  return Object.freeze({
    runId: id(body.runId), expectedRevision: revision(body.expectedRevision), reservationId: id(body.reservationId),
  });
}

function normalizePathId(value) {
  let decoded;
  try { decoded = decodeURIComponent(String(value ?? "")); } catch { fail(); }
  return id(decoded);
}

// ---- Projections de réponses (jamais de taskId) ----

function runDeadline(state) {
  const deadline = Date.parse(state?.contract?.admittedAt) + Number(state?.contract?.limits?.maxDuration);
  return Number.isFinite(deadline) ? new Date(deadline).toISOString() : null;
}

function projectRun(snapshot) {
  const state = snapshot.state;
  return Object.freeze({
    runId: state.runId,
    revision: snapshot.revision,
    status: state.status,
    usage: { ...state.usage },
    limits: { ...state.contract.limits },
    deadline: runDeadline(state),
    reservations: (state.executionReservations || [])
      .map((item) => ({ reservationId: item.reservationId, status: item.status })),
  });
}

function projectApproval(prepared) {
  const approval = prepared.approval;
  return Object.freeze({
    reservationId: prepared.ticket.reservationId,
    reservedRevision: prepared.ticket.reservedRevision,
    approval: {
      approvalId: approval.id,
      expiresAt: approval.expiresAt,
      title: approval.title,
      summary: approval.summary,
    },
    resumeToken: prepared.resumeToken,
    display: {
      ...prepared.display,
      permissions: [...prepared.display.permissions],
      projectRules: [...prepared.display.projectRules],
    },
  });
}

function projectProposal(record, admission) {
  const proposal = record.proposal;
  return Object.freeze({
    stepId: record.stepId,
    proposalId: proposal.proposalId,
    fingerprint: proposal.fingerprint,
    objective: proposal.objective,
    expectedOutcome: proposal.expectedOutcome,
    usage: { ...proposal.usage },
    requestedCapabilities: { ...proposal.requestedCapabilities },
    admission,
  });
}

function projectPlanning(result) {
  const record = result?.stepRecord || null;
  return Object.freeze({
    status: String(result?.status || "UNKNOWN").slice(0, 60),
    recovered: result?.recovered === true,
    stepId: record?.stepId ?? null,
    proposal: record ? {
      objective: record.proposal.objective,
      expectedOutcome: record.proposal.expectedOutcome,
      requiresUserInput: record.proposal.requiresUserInput === true,
    } : null,
  });
}

function projectDispatch(result) {
  if (result?.status === "rejected") {
    return Object.freeze({ status: "rejected", reservationId: result.reservationId });
  }
  const pick = (value) => (typeof value === "string" ? value.slice(0, 60) : null);
  return Object.freeze({
    status: "DISPATCHED",
    reservationId: result.reservationId,
    mayHaveStartedRevision: result.mayHaveStartedRevision,
    native: { status: pick(result.devResult?.status), finalVerdict: pick(result.devResult?.finalVerdict) },
    reconciliationRequired: true,
  });
}

function projectHalt(result) {
  return Object.freeze({
    status: result.status,
    revision: result.revision,
    approvalsCancelled: result.approvalsCancelled.length,
    approvalCancelFailures: result.approvalCancelFailures.length,
    release: result.release ? { ...result.release } : null,
  });
}

function projectResumeRun(result) {
  return Object.freeze({
    status: result.status,
    revision: result.revision,
    releaseRequired: [...result.releaseRequired],
    reconciliationRequired: [...result.reconciliationRequired],
  });
}

function projectCancel(result) {
  return Object.freeze({
    cancelRequested: result.cancelRequested === true,
    alreadyRequested: result.alreadyRequested === true,
    nativeCancelled: result.nativeCancelled === true,
    reservationStatus: result.reservationStatus,
    reconciliationRequired: true,
  });
}

function projectReservation(status) {
  return Object.freeze({
    runId: status.runId,
    runStatus: status.runStatus,
    runRevision: status.runRevision,
    reservationId: status.reservationId,
    reservationStatus: status.reservationStatus,
    dispatchedByThisInstance: status.dispatchedByThisInstance === true,
    cancelRequested: status.cancelRequested === true,
    native: status.native ? { ...status.native } : null,
  });
}

function projectRelease(snapshot, reservationId) {
  const record = snapshot.state.executionReservations?.find((item) => item.reservationId === reservationId);
  return Object.freeze({ reservationId, status: record?.status ?? null, revision: snapshot.revision });
}

// ---- Erreurs ----

const STATUS_BY_CODE = new Map([
  ...["GOAL_MODE_DEV_HTTP_BODY_INVALID", "GOAL_MODE_DEV_DISPATCH_DECISION_INVALID",
    "GOAL_MODE_DEV_RUN_TRANSITION_INVALID", "GOAL_MODE_RUN_TRANSITION_INVALID",
    "GOAL_MODE_RUN_CONTRACT_INVALID", "GOAL_MODE_RUN_STATUS_INVALID"].map((code) => [code, 400]),
  ...["TRUSTED_UI_REQUIRED", "APPROVAL_TOKEN_INVALID"].map((code) => [code, 403]),
  ...["GOAL_MODE_DEV_DISABLED", "GOAL_MODE_DEV_ROUTE_NOT_FOUND", "GOAL_MODE_DEV_GOAL_NOT_FOUND",
    "GOAL_MODE_RUN_NOT_FOUND", "GOAL_MODE_DEV_PROPOSAL_NOT_FOUND",
    "GOAL_MODE_DEV_DISPATCH_RESERVATION_MISSING", "GOAL_MODE_DEV_DISPATCH_TICKET_UNKNOWN",
    "APPROVAL_NOT_FOUND"].map((code) => [code, 404]),
  ...["GOAL_MODE_RUN_PERSISTENCE_CONFLICT", "GOAL_MODE_EXECUTION_IN_FLIGHT",
    "GOAL_MODE_EXECUTION_UNKNOWN_BLOCKED", "GOAL_MODE_EXECUTION_DUPLICATE",
    "GOAL_MODE_EXECUTION_TRANSITION_INVALID", "GOAL_MODE_PLANNING_IN_FLIGHT",
    "GOAL_MODE_PLANNING_UNKNOWN_BLOCKED", "GOAL_MODE_DEV_DISPATCH_RESERVATION_CLOSED",
    "GOAL_MODE_DEV_DISPATCH_STALE", "GOAL_MODE_DEV_DISPATCH_RENEW_UNAVAILABLE",
    "GOAL_MODE_DEV_CANCEL_UNAVAILABLE", "GOAL_MODE_DEV_DISPATCH_RECONCILIATION_REQUIRED",
    "GOAL_MODE_DEV_DISPATCH_ALREADY_ATTEMPTED", "GOAL_MODE_DEV_DISPATCH_IN_PROGRESS",
    "GOAL_MODE_DEV_RUN_NOT_PAUSED", "GOAL_MODE_DEV_RUN_NOT_READY", "GOAL_MODE_DEV_DISPATCH_RUN_NOT_RUNNING",
    "GOAL_MODE_RUN_NOT_RUNNING", "APPROVAL_INVALID", "APPROVAL_IN_FLIGHT"].map((code) => [code, 409]),
  ...["approval_expired", "APPROVAL_CONSUMED"].map((code) => [code, 410]),
  ...["GOAL_MODE_DEV_LOCAL_ONLY_REQUIRED", "GOAL_MODE_DEV_DISPATCH_PERMISSION_REVOKED",
    "GOAL_MODE_DEV_DISPATCH_PERMISSION_ESCALATION", "GOAL_MODE_DEV_DISPATCH_BUDGET_EXHAUSTED",
    "GOAL_MODE_DEV_DISPATCH_TIME_BUDGET_BLOCKED", "GOAL_MODE_DEV_DISPATCH_TARGET_CHANGED",
    "GOAL_MODE_DEV_TARGET_UNINSPECTABLE", "GOAL_MODE_DEV_DISPATCH_RULES_CHANGED",
    "GOAL_MODE_DEV_DISPATCH_RULES_UNAVAILABLE", "GOAL_MODE_DEV_DISPATCH_GOAL_STALE",
    "GOAL_MODE_DEV_DISPATCH_JOURNAL_UNREADABLE", "GOAL_MODE_EXECUTION_JOURNAL_ENGAGED",
    "GOAL_MODE_EXECUTION_JOURNAL_UNREADABLE", "GOAL_MODE_EXECUTION_RELEASE_JOURNAL_ENGAGED",
    "GOAL_MODE_EXECUTION_RELEASE_JOURNAL_UNREADABLE", "GOAL_MODE_EXECUTION_RELEASE_LEDGER_ENGAGED",
    "GOAL_MODE_EXECUTION_BUDGET_BLOCKED", "approval_stale", "GOAL_MODE_DEV_DISPATCH_APPROVAL_MISMATCH",
    "GOAL_MODE_DEV_DISPATCH_BINDING_MISMATCH"].map((code) => [code, 422]),
  ...["GOAL_MODE_DEV_DISPATCH_OUTCOME_UNCERTAIN"].map((code) => [code, 502]),
  ...["GOAL_MODE_EXECUTION_ATOMIC_BACKEND_REQUIRED", "APPROVAL_STORAGE_ERROR",
    "GOAL_MODE_DEV_RUNTIME_NOT_READY", "GOAL_MODE_EXECUTION_JOURNAL_REQUIRED",
    "GOAL_MODE_EXECUTION_RELEASE_JOURNAL_REQUIRED", "GOAL_MODE_EXECUTION_RELEASE_LEDGER_REQUIRED"]
    .map((code) => [code, 503]),
]);

function goalModeDevHttpStatus(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (STATUS_BY_CODE.has(code)) return STATUS_BY_CODE.get(code);
  if (/^GOAL_MODE_DEV_(PROJECTION|STEP|NOT_ADMITTED|USER_INPUT|SCOPE|REPOSITORY|ROOT|BRANCH|WORKSPACE|PROJECT|GOAL|CAPABILITY|REMOTE|PROVIDER|COST|TIME|LEDGER|RECOVERY|CONTRACT|SECONDARY)/.test(code) ||
      /^GOAL_MODE_STEP_/.test(code) ||
      /^GOAL_MODE_(CONTRACT|LIMIT|WORKSPACE|PROJECT|GOAL|SUCCESS|REFERENCE|CAPABILITY|LOCAL_ONLY|RUN_CONFIRMATION)/.test(code) ||
      code === "GOAL_STALE") {
    return 422;
  }
  return 500;
}

const SAFE_DETAIL_KEYS = Object.freeze(["reservationId", "status", "releaseRequired", "reconciliationRequired"]);

function goalModeDevErrorBody(error) {
  const status = goalModeDevHttpStatus(error);
  const code = status === 500 ? "GOAL_MODE_DEV_INTERNAL_ERROR" : error.code;
  const details = {};
  for (const key of SAFE_DETAIL_KEYS) {
    const value = error?.details?.[key];
    if (typeof value === "string" || typeof value === "boolean") details[key] = value;
  }
  return Object.freeze({
    status: "error",
    code,
    message: "Opération Goal Mode DEV refusée.",
    ...(Object.keys(details).length ? { details } : {}),
  });
}

module.exports = {
  VERSION,
  goalModeDevErrorBody,
  goalModeDevHttpStatus,
  normalizeCancel,
  normalizeCreateRun,
  normalizePathId,
  normalizePause,
  normalizePlanning,
  normalizePrepare,
  normalizeRelease,
  normalizeRenew,
  normalizeResume,
  normalizeResumeRun,
  normalizeRunRevision,
  normalizeStop,
  projectApproval,
  projectCancel,
  projectDispatch,
  projectHalt,
  projectPlanning,
  projectProposal,
  projectRelease,
  projectReservation,
  projectResumeRun,
  projectRun,
};
