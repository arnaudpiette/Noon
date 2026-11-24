"use strict";

// V3-L7 — règles de l'état d'un run Goal Mode (version, statuts, transitions autorisées,
// bornes), primitives de validation et validateurs d'enregistrements (exécution, réservations,
// planification, contrat, usage), sortis tels quels de goal-mode-run-state.js. Fonctions pures et
// constantes ; goal-mode-run-state.js réexporte les mêmes valeurs.

const crypto = require("node:crypto");

const {
  VERSION: CONTRACT_VERSION,
} = require(
  "./goal-mode-run-contract"
);

const VERSION =
  "goal-mode-run-state-v1";

const STATUSES =
  Object.freeze([
    "READY",
    "RUNNING",
    "WAITING_APPROVAL",
    "PAUSED",
    "BLOCKED",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
  ]);

const PLANNING_STATUSES = Object.freeze([
  "PREPARED",
  "MAY_HAVE_STARTED",
  "RECONCILED",
  "UNKNOWN",
]);

const PLANNING_UNKNOWN_REASONS = Object.freeze([
  "OUTCOME_UNCERTAIN",
  "USAGE_INCOMPLETE",
  "TIMEOUT",
  "CANCELLED",
  "PERSISTENCE_UNCERTAIN",
]);

const MAX_PLANNING_RESERVATIONS = 1000;
const MAX_EXECUTION_RESERVATIONS = 1000;
// RELEASED : réservation PREPARED libérée explicitement, jamais passée en
// MAY_HAVE_STARTED. Elle ne consomme rien. Statut additif : les lignes
// persistées existantes restent valides ; une version antérieure de Noon
// refuse de relire un run qui contient RELEASED (limite de downgrade
// documentée, option A).
const EXECUTION_STATUSES = Object.freeze([
  "PREPARED", "MAY_HAVE_STARTED", "RECONCILED", "UNKNOWN", "RELEASED",
]);
const EXECUTION_CLOSED_STATUSES = Object.freeze(["RECONCILED", "RELEASED"]);
const EXECUTION_UNKNOWN_REASONS = Object.freeze([
  "OUTCOME_UNCERTAIN", "USAGE_INCOMPLETE", "TIMEOUT",
  "CANCELLED", "PERSISTENCE_UNCERTAIN",
]);

const TERMINAL_STATUSES =
  new Set([
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
  ]);

const TRANSITIONS =
  Object.freeze({
    READY:
      new Set([
        "RUNNING",
        "CANCELLED",
      ]),

    RUNNING:
      new Set([
        "WAITING_APPROVAL",
        "PAUSED",
        "BLOCKED",
        "SUCCEEDED",
        "FAILED",
        "CANCELLED",
      ]),

    WAITING_APPROVAL:
      new Set([
        "RUNNING",
        "PAUSED",
        "BLOCKED",
        "CANCELLED",
      ]),

    PAUSED:
      new Set([
        "RUNNING",
        "BLOCKED",
        "CANCELLED",
      ]),

    BLOCKED:
      new Set([
        "RUNNING",
        "CANCELLED",
      ]),

    SUCCEEDED:
      new Set(),

    FAILED:
      new Set(),

    CANCELLED:
      new Set(),
  });

function fail(
  code,
  message,
  details = null
) {
  throw Object.assign(
    new Error(message),
    {
      code,
      ...(details === null
        ? {}
        : { details }),
    }
  );
}

function clone(
  value
) {
  return value == null
    ? value
    : structuredClone(value);
}

function deepFreeze(
  value
) {
  if (
    !value ||
    typeof value !== "object" ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  for (
    const child of
      Object.values(value)
  ) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}

function canonical(
  value
) {
  if (
    value === undefined ||
    value === null
  ) {
    return value ?? null;
  }

  if (
    Array.isArray(value)
  ) {
    return value.map(
      canonical
    );
  }

  if (
    typeof value === "object"
  ) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(
          (key) => [
            key,
            canonical(
              value[key]
            ),
          ]
        )
    );
  }

  return value;
}

function same(
  left,
  right
) {
  return JSON.stringify(
    canonical(left)
  ) ===
    JSON.stringify(
      canonical(right)
    );
}

function requiredString(
  value,
  label,
  max = 200
) {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > max
  ) {
    fail(
      "GOAL_MODE_RUN_STATE_INVALID",
      `${label} invalide.`
    );
  }

  return value;
}

function nullableString(
  value,
  label,
  max = 200
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  return requiredString(
    value,
    label,
    max
  );
}

function iso(
  value,
  label
) {
  const parsed =
    Date.parse(
      String(value || "")
    );

  if (
    !Number.isFinite(parsed)
  ) {
    fail(
      "GOAL_MODE_RUN_TIME_INVALID",
      `${label} invalide.`
    );
  }

  return new Date(
    parsed
  ).toISOString();
}

function finite(
  value,
  label
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    fail(
      "GOAL_MODE_RUN_USAGE_INVALID",
      `${label} invalide.`
    );
  }

  return value;
}

function integer(
  value,
  label
) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    fail(
      "GOAL_MODE_RUN_USAGE_INVALID",
      `${label} invalide.`
    );
  }

  return value;
}

function planningReservations(state) {
  return state.planningReservations === undefined
    ? []
    : state.planningReservations;
}

function executionReservations(state) {
  return state.executionReservations === undefined
    ? []
    : state.executionReservations;
}

function executionReservationId(binding) {
  const digest = crypto.createHash("sha256")
    .update(JSON.stringify([
      binding.runId, binding.stepId, binding.taskId,
      binding.proposalFingerprint,
    ]))
    .digest("hex");
  return `goal-dev-execution-${digest}`;
}

const EXECUTION_BINDING_KEYS = Object.freeze([
  "runId", "runRevision", "goalId", "goalVersion", "stepId",
  "proposalFingerprint", "taskId", "targetKind", "targetId",
  "targetFingerprint",
]);

const EXECUTION_RECORD_KEYS = Object.freeze([
  "reservationId", "binding", "status", "reservedSteps", "reservedRetries",
  "reservedProviderCalls", "reservedCost", "reservedAt", "mayHaveStartedAt",
  "closedAt", "observedSteps", "observedRetries", "observedProviderCalls",
  "observedActualCost", "accountedCost", "accountingUnit", "unknownReasonCode",
]);

function executionIso(value, label) {
  if (typeof value !== "string") {
    fail("GOAL_MODE_EXECUTION_TIME_INVALID", `${label} invalide.`);
  }
  const normalized = iso(value, label);
  if (normalized !== value) {
    fail("GOAL_MODE_EXECUTION_TIME_INVALID", `${label} invalide.`);
  }
  return normalized;
}

function assertExecutionBinding(binding, state) {
  exactPlanningKeys(binding, EXECUTION_BINDING_KEYS, "executionBinding", "GOAL_MODE_EXECUTION_BINDING_INVALID");
  if (binding.runId !== state.runId ||
      binding.goalId !== state.contract.goalRef.goalId ||
      binding.goalVersion !== state.contract.goalRef.goalVersion ||
      !Number.isSafeInteger(binding.runRevision) || binding.runRevision < 1 ||
      !["MILESTONE", "SUCCESS_CRITERION"].includes(binding.targetKind) ||
      !/^sha256:[a-f0-9]{64}$/.test(binding.proposalFingerprint) ||
      !/^sha256:[a-f0-9]{64}$/.test(binding.targetFingerprint)) {
    fail("GOAL_MODE_EXECUTION_BINDING_INVALID", "Binding DEV incohérent.");
  }
  requiredString(binding.stepId, "binding.stepId");
  requiredString(binding.taskId, "binding.taskId");
  requiredString(binding.targetId, "binding.targetId");
}

function assertExecutionRecord(record, state) {
  exactPlanningKeys(record, EXECUTION_RECORD_KEYS, "executionReservation", "GOAL_MODE_EXECUTION_INVALID");
  assertExecutionBinding(record.binding, state);
  if (record.reservationId !== executionReservationId(record.binding) ||
      !EXECUTION_STATUSES.includes(record.status) ||
      record.reservedSteps !== 1 || record.reservedRetries !== 0 ||
      !Number.isSafeInteger(record.reservedProviderCalls) ||
      record.reservedProviderCalls < 1 ||
      typeof record.reservedCost !== "number" ||
      !Number.isFinite(record.reservedCost) || record.reservedCost <= 0) {
    fail("GOAL_MODE_EXECUTION_INVALID", "Réservation DEV invalide.");
  }
  const reservedAt = executionIso(record.reservedAt, "reservedAt");
  const startedAt = record.mayHaveStartedAt === null
    ? null : executionIso(record.mayHaveStartedAt, "mayHaveStartedAt");
  const closedAt = record.closedAt === null
    ? null : executionIso(record.closedAt, "closedAt");
  if (Date.parse(reservedAt) < Date.parse(state.createdAt) ||
      Date.parse(reservedAt) > Date.parse(state.updatedAt) ||
      (startedAt && Date.parse(startedAt) < Date.parse(reservedAt)) ||
      (startedAt && Date.parse(startedAt) > Date.parse(state.updatedAt)) ||
      (closedAt && Date.parse(closedAt) < Date.parse(startedAt || reservedAt)) ||
      (closedAt && Date.parse(closedAt) > Date.parse(state.updatedAt))) {
    fail("GOAL_MODE_EXECUTION_TIME_INVALID", "Horodatage DEV incohérent.");
  }
  for (const key of ["observedSteps", "observedRetries", "observedProviderCalls"]) {
    if (record[key] !== null && (!Number.isSafeInteger(record[key]) ||
        record[key] < 0 || (key === "observedSteps" && record[key] > 1))) {
      fail("GOAL_MODE_EXECUTION_USAGE_INVALID", `${key} invalide.`);
    }
  }
  for (const key of ["observedActualCost", "accountedCost"]) {
    if (record[key] !== null && (typeof record[key] !== "number" ||
        !Number.isFinite(record[key]) || record[key] < 0)) {
      fail("GOAL_MODE_EXECUTION_USAGE_INVALID", `${key} invalide.`);
    }
  }
  if (record.accountingUnit !== null && record.accountingUnit !== "USD") {
    fail("GOAL_MODE_EXECUTION_USAGE_INVALID", "Unité d'accounting invalide.");
  }
  if ((record.observedActualCost !== null || record.accountedCost !== null) &&
      record.accountingUnit !== "USD") {
    fail("GOAL_MODE_EXECUTION_USAGE_INVALID", "Coût observé sans unité d'accounting.");
  }
  const unobserved = ["observedSteps", "observedRetries", "observedProviderCalls",
    "observedActualCost", "accountedCost", "accountingUnit"]
    .every((key) => record[key] === null);
  if ((record.status === "PREPARED" &&
       (startedAt !== null || closedAt !== null || !unobserved || record.unknownReasonCode !== null)) ||
      (record.status === "MAY_HAVE_STARTED" &&
       (startedAt === null || closedAt !== null || !unobserved || record.unknownReasonCode !== null)) ||
      (record.status === "RECONCILED" &&
       (startedAt === null || closedAt === null || ![0, 1].includes(record.observedSteps) ||
        // 4C-2 « jamais lancée » : 0 pas impose 0 essai, 0 appel et un coût nul.
        (record.observedSteps === 0 &&
         (record.observedRetries !== 0 || record.observedProviderCalls !== 0 ||
          record.accountedCost !== 0 || ![null, 0].includes(record.observedActualCost))) ||
        record.observedRetries === null || record.observedProviderCalls === null ||
        record.accountedCost === null || record.accountingUnit !== "USD" ||
        (record.observedActualCost !== null &&
         record.observedActualCost !== record.accountedCost) ||
        record.unknownReasonCode !== null)) ||
      (record.status === "UNKNOWN" &&
       (closedAt === null || !EXECUTION_UNKNOWN_REASONS.includes(record.unknownReasonCode))) ||
      (record.status === "RELEASED" &&
       (startedAt !== null || closedAt === null || !unobserved || record.unknownReasonCode !== null))) {
    fail("GOAL_MODE_EXECUTION_STATE_INVALID", "État de réservation DEV incohérent.");
  }
}

function executionExposure(state) {
  const reservations = executionReservations(state);
  if (reservations.some((item) => item.status === "UNKNOWN")) {
    fail("GOAL_MODE_EXECUTION_UNKNOWN_BLOCKED", "Issue DEV incertaine.");
  }
  if (reservations.some((item) => item.status === "RECONCILED" &&
      (item.observedSteps > item.reservedSteps ||
       item.observedRetries > item.reservedRetries ||
       item.observedProviderCalls > item.reservedProviderCalls ||
       item.accountedCost > item.reservedCost))) {
    fail("GOAL_MODE_EXECUTION_RESERVATION_EXCEEDED", "Réservation DEV dépassée.");
  }
  if (reservations.some((item) => ["PREPARED", "MAY_HAVE_STARTED"].includes(item.status))) {
    fail("GOAL_MODE_EXECUTION_IN_FLIGHT", "Réservation DEV non résolue.");
  }
}

function assertLegacyConsumeAvailable(state, delta) {
  planningExposure(state);
  executionExposure(state);
  if (executionReservations(state).length > 0 ||
      (planningReservations(state).length > 0 &&
       (delta.providerCalls !== 0 || delta.estimatedCost !== 0))) {
    fail("GOAL_MODE_RUN_LEGACY_CONSUME_UNAVAILABLE", "Accounting réservé indisponible via consume.");
  }
}

function assertReservationAccountingOwned(state) {
  // Une consommation historique sans identité d'opération ne peut être
  // réattribuée a posteriori à une réservation planning ou DEV.
  const records = [
    ...planningReservations(state).filter((item) => item.status === "RECONCILED")
      .map((item) => ({ revision: item.binding.runRevision, usage: {
        steps: 0, retries: 0,
        providerCalls: item.observedProviderCalls,
        estimatedCost: item.observedCost,
      } })),
    ...executionReservations(state).filter((item) => item.status === "RECONCILED")
      .map((item) => ({ revision: item.binding.runRevision, usage: {
        steps: item.observedSteps, retries: item.observedRetries,
        providerCalls: item.observedProviderCalls,
        estimatedCost: item.accountedCost,
      } })),
  ].sort((left, right) => left.revision - right.revision);
  const accounted = { steps: 0, retries: 0, providerCalls: 0, estimatedCost: 0 };
  for (const record of records) {
    for (const key of Object.keys(accounted)) {
      accounted[key] += record.usage[key];
    }
  }
  if (!same(accounted, state.usage)) {
    fail("GOAL_MODE_RUN_UNATTRIBUTED_USAGE", "Accounting historique non attribuable à une réservation.");
  }
}

function exactPlanningKeys(value, keys, label, code = "GOAL_MODE_PLANNING_INVALID") {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).length !== keys.length ||
      Reflect.ownKeys(value).some((key) => typeof key !== "string" || !keys.includes(key))) {
    fail(code, `${label} invalide.`);
  }
  return value;
}

const PLANNING_BINDING_KEYS = Object.freeze([
  "runId", "runRevision", "goalId", "goalVersion",
  "targetKind", "targetId", "targetFingerprint",
]);

const PLANNING_RECORD_KEYS = Object.freeze([
  "reservationId", "binding", "status", "reservedProviderCalls",
  "reservedCost", "reservedAt", "mayHaveStartedAt", "closedAt",
  "observedProviderCalls", "observedCost", "unknownReasonCode",
]);

function assertPlanningBinding(binding, state) {
  exactPlanningKeys(binding, PLANNING_BINDING_KEYS, "binding");
  if (binding.runId !== state.runId ||
      binding.goalId !== state.contract.goalRef.goalId ||
      binding.goalVersion !== state.contract.goalRef.goalVersion ||
      !Number.isSafeInteger(binding.runRevision) || binding.runRevision < 1 ||
      !["MILESTONE", "SUCCESS_CRITERION"].includes(binding.targetKind) ||
      !/^sha256:[a-f0-9]{64}$/.test(binding.targetFingerprint)) {
    fail("GOAL_MODE_PLANNING_BINDING_INVALID", "Binding de planning incohérent.");
  }
  requiredString(binding.targetId, "binding.targetId");
}

function assertPlanningRecord(record, state) {
  exactPlanningKeys(record, PLANNING_RECORD_KEYS, "planningReservation");
  requiredString(record.reservationId, "reservationId");
  assertPlanningBinding(record.binding, state);
  if (!PLANNING_STATUSES.includes(record.status) ||
      !Number.isSafeInteger(record.reservedProviderCalls) ||
      record.reservedProviderCalls < 1 ||
      typeof record.reservedCost !== "number" ||
      !Number.isFinite(record.reservedCost) || record.reservedCost < 0) {
    fail("GOAL_MODE_PLANNING_INVALID", "Réservation de planning invalide.");
  }
  const reservedAt = iso(record.reservedAt, "reservedAt");
  const startedAt = record.mayHaveStartedAt === null ? null : iso(record.mayHaveStartedAt, "mayHaveStartedAt");
  const closedAt = record.closedAt === null ? null : iso(record.closedAt, "closedAt");
  if (Date.parse(reservedAt) < Date.parse(state.createdAt) ||
      Date.parse(reservedAt) > Date.parse(state.updatedAt) ||
      (startedAt && Date.parse(startedAt) < Date.parse(reservedAt)) ||
      (closedAt && Date.parse(closedAt) < Date.parse(startedAt || reservedAt)) ||
      (closedAt && Date.parse(closedAt) > Date.parse(state.updatedAt))) {
    fail("GOAL_MODE_PLANNING_TIME_INVALID", "Horodatage de planning incohérent.");
  }
  const observedCalls = record.observedProviderCalls;
  const observedCost = record.observedCost;
  if ((observedCalls !== null && (!Number.isSafeInteger(observedCalls) || observedCalls < 0)) ||
      (observedCost !== null && (typeof observedCost !== "number" || !Number.isFinite(observedCost) || observedCost < 0))) {
    fail("GOAL_MODE_PLANNING_USAGE_INVALID", "Usage de planning invalide.");
  }
  if (record.status === "PREPARED" &&
      (startedAt !== null || closedAt !== null || observedCalls !== null || observedCost !== null || record.unknownReasonCode !== null) ||
      record.status === "MAY_HAVE_STARTED" &&
      (startedAt === null || closedAt !== null || observedCalls !== null || observedCost !== null || record.unknownReasonCode !== null) ||
      record.status === "RECONCILED" &&
      (startedAt === null || closedAt === null || observedCalls === null || observedCalls < 1 ||
       observedCost === null || record.unknownReasonCode !== null) ||
      record.status === "UNKNOWN" &&
      (closedAt === null || !PLANNING_UNKNOWN_REASONS.includes(record.unknownReasonCode))) {
    fail("GOAL_MODE_PLANNING_STATE_INVALID", "État de planning incohérent.");
  }
}

function planningExposure(state) {
  const reservations = planningReservations(state);
  if (reservations.some((item) => item.status === "UNKNOWN")) {
    fail("GOAL_MODE_PLANNING_UNKNOWN_BLOCKED", "Issue de planning incertaine.");
  }
  if (reservations.some((item) => item.status === "RECONCILED" &&
      (item.observedProviderCalls > item.reservedProviderCalls ||
       item.observedCost > item.reservedCost))) {
    fail("GOAL_MODE_PLANNING_RESERVATION_EXCEEDED", "Réservation de planning dépassée.");
  }
  if (reservations.some((item) => ["PREPARED", "MAY_HAVE_STARTED"].includes(item.status))) {
    fail("GOAL_MODE_PLANNING_IN_FLIGHT", "Réservation de planning non résolue.");
  }
}

function assertContract(
  contract
) {
  if (
    !contract ||
    typeof contract !== "object" ||
    Array.isArray(contract) ||
    contract.version !==
      CONTRACT_VERSION
  ) {
    fail(
      "GOAL_MODE_RUN_CONTRACT_INVALID",
      "Contrat Goal Mode invalide."
    );
  }

  requiredString(
    contract.runId,
    "contract.runId"
  );

  requiredString(
    contract.goalRef?.goalId,
    "contract.goalRef.goalId"
  );

  if (
    !Number.isSafeInteger(
      contract.goalRef
        ?.goalVersion
    ) ||
    contract.goalRef
      .goalVersion < 1
  ) {
    fail(
      "GOAL_MODE_RUN_CONTRACT_INVALID",
      "contract.goalRef.goalVersion invalide."
    );
  }

  iso(
    contract.admittedAt,
    "contract.admittedAt"
  );

  if (
    contract.authority
      ?.executionAuthorized !==
        false ||
    contract.authority
      ?.capabilitiesGranted !==
        false ||
    contract.authority
      ?.securityPipelineBypassed !==
        false
  ) {
    fail(
      "GOAL_MODE_RUN_AUTHORITY_INVALID",
      "Le contrat Goal Mode ne peut porter aucune autorité d'exécution."
    );
  }

  return true;
}

function normalizeUsage(
  usage = {}
) {
  return Object.freeze({
    steps:
      integer(
        usage.steps ?? 0,
        "usage.steps"
      ),

    retries:
      integer(
        usage.retries ?? 0,
        "usage.retries"
      ),

    providerCalls:
      integer(
        usage.providerCalls ?? 0,
        "usage.providerCalls"
      ),

    estimatedCost:
      finite(
        usage.estimatedCost ?? 0,
        "usage.estimatedCost"
      ),
  });
}

module.exports = {
  VERSION,
  STATUSES,
  PLANNING_STATUSES,
  PLANNING_UNKNOWN_REASONS,
  MAX_PLANNING_RESERVATIONS,
  MAX_EXECUTION_RESERVATIONS,
  EXECUTION_STATUSES,
  EXECUTION_CLOSED_STATUSES,
  EXECUTION_UNKNOWN_REASONS,
  TERMINAL_STATUSES,
  TRANSITIONS,
  fail,
  clone,
  deepFreeze,
  canonical,
  same,
  requiredString,
  nullableString,
  iso,
  finite,
  integer,
  planningReservations,
  executionReservations,
  executionReservationId,
  EXECUTION_BINDING_KEYS,
  EXECUTION_RECORD_KEYS,
  executionIso,
  assertExecutionBinding,
  assertExecutionRecord,
  executionExposure,
  assertLegacyConsumeAvailable,
  assertReservationAccountingOwned,
  exactPlanningKeys,
  PLANNING_BINDING_KEYS,
  PLANNING_RECORD_KEYS,
  assertPlanningBinding,
  assertPlanningRecord,
  planningExposure,
  assertContract,
  normalizeUsage,
};
