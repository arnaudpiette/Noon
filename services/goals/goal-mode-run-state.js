"use strict";

const crypto = require("node:crypto");

const {
  VERSION: CONTRACT_VERSION,
  assessGoalModeBudget,
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
const EXECUTION_STATUSES = Object.freeze([
  "PREPARED", "MAY_HAVE_STARTED", "RECONCILED", "UNKNOWN",
]);
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
       (startedAt === null || closedAt === null || record.observedSteps !== 1 ||
        record.observedRetries === null || record.observedProviderCalls === null ||
        record.accountedCost === null || record.accountingUnit !== "USD" ||
        (record.observedActualCost !== null &&
         record.observedActualCost !== record.accountedCost) ||
        record.unknownReasonCode !== null)) ||
      (record.status === "UNKNOWN" &&
       (closedAt === null || !EXECUTION_UNKNOWN_REASONS.includes(record.unknownReasonCode)))) {
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

function createGoalModeRunState({
  contract,
  createdAt = null,
} = {}) {
  assertContract(
    contract
  );

  const created =
    iso(
      createdAt ||
        contract.admittedAt,
      "createdAt"
    );

  const usage =
    normalizeUsage();

  return deepFreeze({
    version:
      VERSION,

    runId:
      contract.runId,

    contract:
      clone(contract),

    status:
      "READY",

    reasonCode:
      null,

    createdAt:
      created,

    updatedAt:
      created,

    startedAt:
      null,

    completedAt:
      null,

    usage,

    planningReservations:
      Object.freeze([]),

    /*
     * 5.0B ne stocke encore aucun approval,
     * aucune action et aucun résultat d'étape.
     *
     * Ces références seront ajoutées par
     * les tranches d'orchestration/recovery.
     */
    currentStepRef:
      null,
  });
}

function assertGoalModeRunState(
  state
) {
  if (
    !state ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    state.version !== VERSION
  ) {
    fail(
      "GOAL_MODE_RUN_STATE_INVALID",
      "Goal Run State invalide."
    );
  }

  assertContract(
    state.contract
  );

  const runId =
    requiredString(
      state.runId,
      "runId"
    );

  if (
    state.contract.runId !==
      runId
  ) {
    fail(
      "GOAL_MODE_RUN_IDENTITY_MISMATCH",
      "runId divergent entre état et contrat."
    );
  }

  if (
    !STATUSES.includes(
      state.status
    )
  ) {
    fail(
      "GOAL_MODE_RUN_STATUS_INVALID",
      "Statut Goal Run invalide."
    );
  }

  const createdAt =
    iso(
      state.createdAt,
      "createdAt"
    );

  const updatedAt =
    iso(
      state.updatedAt,
      "updatedAt"
    );

  if (
    Date.parse(updatedAt) <
      Date.parse(createdAt)
  ) {
    fail(
      "GOAL_MODE_RUN_TIME_REWIND",
      "updatedAt ne peut précéder createdAt."
    );
  }

  const startedAt =
    state.startedAt == null
      ? null
      : iso(
          state.startedAt,
          "startedAt"
        );

  const completedAt =
    state.completedAt == null
      ? null
      : iso(
          state.completedAt,
          "completedAt"
        );

  if (
    state.status === "READY" &&
    startedAt !== null
  ) {
    fail(
      "GOAL_MODE_RUN_START_INVALID",
      "Un Goal Run READY ne peut être démarré."
    );
  }

  if (
    state.status !== "READY" &&
    state.status !== "CANCELLED" &&
    startedAt === null
  ) {
    fail(
      "GOAL_MODE_RUN_START_INVALID",
      "Un Goal Run actif ou terminé doit avoir startedAt."
    );
  }

  const terminal =
    TERMINAL_STATUSES.has(
      state.status
    );

  if (
    terminal !==
      (completedAt !== null)
  ) {
    fail(
      "GOAL_MODE_RUN_COMPLETION_INVALID",
      "completedAt incohérent avec le statut terminal."
    );
  }

  if (
    startedAt &&
    Date.parse(startedAt) <
      Date.parse(createdAt)
  ) {
    fail(
      "GOAL_MODE_RUN_TIME_REWIND",
      "startedAt ne peut précéder createdAt."
    );
  }

  if (
    completedAt &&
    startedAt &&
    Date.parse(completedAt) <
      Date.parse(startedAt)
  ) {
    fail(
      "GOAL_MODE_RUN_TIME_REWIND",
      "completedAt ne peut précéder startedAt."
    );
  }

  nullableString(
    state.reasonCode,
    "reasonCode",
    120
  );

  if (
    state.currentStepRef !==
      null
  ) {
    fail(
      "GOAL_MODE_RUN_STEP_REF_UNSUPPORTED",
      "5.0B ne persiste encore aucune référence d'étape."
    );
  }

  if (
    !state.usage ||
    typeof state.usage !==
      "object" ||
    Array.isArray(
      state.usage
    ) ||
    [
      "steps",
      "retries",
      "providerCalls",
      "estimatedCost",
    ].some(
      (key) =>
        !Object.hasOwn(
          state.usage,
          key
        ) ||
        state.usage[key] ==
          null
    )
  ) {
    fail(
      "GOAL_MODE_RUN_USAGE_INVALID",
      "L'accounting Goal Run doit être complet."
    );
  }

  const usage =
    normalizeUsage(
      state.usage
    );

  const reservations = planningReservations(state);
  if (!Array.isArray(reservations) || reservations.length > MAX_PLANNING_RESERVATIONS) {
    fail("GOAL_MODE_PLANNING_INVALID", "Historique de planning invalide ou hors borne.");
  }
  const seen = new Set();
  let observedCalls = 0;
  let callOverage = 0;
  let costOverage = 0;
  for (const reservation of reservations) {
    assertPlanningRecord(reservation, state);
    if (seen.has(reservation.reservationId)) {
      fail("GOAL_MODE_PLANNING_DUPLICATE", "Réservation de planning dupliquée.");
    }
    seen.add(reservation.reservationId);
    if (reservation.status === "RECONCILED") {
      observedCalls += reservation.observedProviderCalls;
      callOverage += Math.max(0, reservation.observedProviderCalls - reservation.reservedProviderCalls);
      costOverage += Math.max(0, reservation.observedCost - reservation.reservedCost);
    }
  }
  const executions = executionReservations(state);
  if (!Array.isArray(executions) || executions.length > MAX_EXECUTION_RESERVATIONS) {
    fail("GOAL_MODE_EXECUTION_INVALID", "Historique DEV invalide ou hors borne.");
  }
  const seenExecutions = new Set();
  const seenExecutionSteps = new Set();
  const seenExecutionTasks = new Set();
  let observedSteps = 0;
  let observedRetries = 0;
  let stepOverage = 0;
  let retryOverage = 0;
  for (const reservation of executions) {
    assertExecutionRecord(reservation, state);
    if (seenExecutions.has(reservation.reservationId) ||
        seenExecutionSteps.has(reservation.binding.stepId) ||
        seenExecutionTasks.has(reservation.binding.taskId)) {
      fail("GOAL_MODE_EXECUTION_DUPLICATE", "Réservation DEV dupliquée.");
    }
    seenExecutions.add(reservation.reservationId);
    seenExecutionSteps.add(reservation.binding.stepId);
    seenExecutionTasks.add(reservation.binding.taskId);
    if (reservation.status === "RECONCILED") {
      observedSteps += reservation.observedSteps;
      observedRetries += reservation.observedRetries;
      observedCalls += reservation.observedProviderCalls;
      stepOverage += Math.max(0, reservation.observedSteps - reservation.reservedSteps);
      retryOverage += Math.max(0, reservation.observedRetries - reservation.reservedRetries);
      callOverage += Math.max(0, reservation.observedProviderCalls - reservation.reservedProviderCalls);
      costOverage += Math.max(0, reservation.accountedCost - reservation.reservedCost);
    }
  }
  // Additionner dans l'ordre des réservations (donc des réconciliations),
  // comme usage.estimatedCost. Regrouper planning puis DEV change l'arrondi
  // IEEE-754 et peut rejeter un accounting pourtant persisté correctement.
  let observedCost = 0;
  const reconciledCosts = [
    ...reservations.filter((item) => item.status === "RECONCILED")
      .map((item) => ({ revision: item.binding.runRevision, cost: item.observedCost })),
    ...executions.filter((item) => item.status === "RECONCILED")
      .map((item) => ({ revision: item.binding.runRevision, cost: item.accountedCost })),
  ].sort((left, right) => left.revision - right.revision);
  for (const item of reconciledCosts) {
    observedCost += item.cost;
  }
  if (!Number.isSafeInteger(observedSteps) || !Number.isSafeInteger(observedRetries) ||
      !Number.isSafeInteger(stepOverage) || !Number.isSafeInteger(retryOverage) ||
      observedSteps > usage.steps || observedRetries > usage.retries ||
      usage.steps > state.contract.limits.maxSteps + stepOverage ||
      usage.retries > state.contract.limits.maxRetries + retryOverage ||
      (reservations.some((item) => ["PREPARED", "MAY_HAVE_STARTED", "UNKNOWN"].includes(item.status)) &&
       executions.some((item) => ["PREPARED", "MAY_HAVE_STARTED", "UNKNOWN"].includes(item.status)))) {
    fail("GOAL_MODE_RUN_USAGE_EXCEEDS_CONTRACT", "Accounting ou exclusivité DEV incohérent.");
  }
  if (!Number.isSafeInteger(observedCalls) || !Number.isFinite(observedCost) ||
      !Number.isSafeInteger(callOverage) || !Number.isFinite(costOverage) ||
      observedCalls > usage.providerCalls || observedCost > usage.estimatedCost ||
      usage.providerCalls > state.contract.limits.maxProviderCalls + callOverage ||
      usage.estimatedCost > state.contract.limits.maxEstimatedCost + costOverage) {
    fail("GOAL_MODE_RUN_USAGE_EXCEEDS_CONTRACT", "Accounting Goal Run incohérent avec le planning.");
  }
  return true;
}

function transitionGoalModeRun(
  state,
  nextStatus,
  {
    reasonCode = null,
    transitionedAt =
      new Date().toISOString(),
  } = {}
) {
  assertGoalModeRunState(
    state
  );

  if (
    !STATUSES.includes(
      nextStatus
    )
  ) {
    fail(
      "GOAL_MODE_RUN_STATUS_INVALID",
      "Statut Goal Run cible invalide."
    );
  }

  if (
    nextStatus ===
      state.status
  ) {
    fail(
      "GOAL_MODE_RUN_TRANSITION_INVALID",
      "Une transition doit changer le statut."
    );
  }

  if (
    !TRANSITIONS[
      state.status
    ]?.has(
      nextStatus
    )
  ) {
    fail(
      "GOAL_MODE_RUN_TRANSITION_INVALID",
      `Transition ${state.status} → ${nextStatus} interdite.`
    );
  }

  const at =
    iso(
      transitionedAt,
      "transitionedAt"
    );

  if (
    Date.parse(at) <
      Date.parse(
        state.updatedAt
      )
  ) {
    fail(
      "GOAL_MODE_RUN_TIME_REWIND",
      "Une transition ne peut remonter le temps."
    );
  }

  const next =
    clone(state);

  next.status =
    nextStatus;

  next.reasonCode =
    nullableString(
      reasonCode,
      "reasonCode",
      120
    );

  next.updatedAt =
    at;

  if (
    nextStatus ===
      "RUNNING" &&
    next.startedAt ===
      null
  ) {
    next.startedAt =
      at;
  }

  if (
    nextStatus ===
      "CANCELLED" &&
    next.startedAt ===
      null
  ) {
    /*
     * Annulation avant le premier démarrage :
     * l'état reste cohérent sans inventer
     * une exécution qui n'a jamais commencé.
     */
    next.completedAt =
      at;
  } else if (
    TERMINAL_STATUSES.has(
      nextStatus
    )
  ) {
    next.completedAt =
      at;
  }

  assertGoalModeRunState(
    next
  );

  return deepFreeze(
    next
  );
}

function applyGoalModeUsage(
  state,
  {
    currentGoalVersion,
    usageDelta,
    updatedAt =
      new Date().toISOString(),
  } = {}
) {
  assertGoalModeRunState(
    state
  );

  if (
    state.status !==
      "RUNNING"
  ) {
    fail(
      "GOAL_MODE_RUN_NOT_RUNNING",
      "L'accounting ne peut évoluer que pendant RUNNING."
    );
  }

  const at =
    iso(
      updatedAt,
      "updatedAt"
    );

  if (
    Date.parse(at) <
      Date.parse(
        state.updatedAt
      )
  ) {
    fail(
      "GOAL_MODE_RUN_TIME_REWIND",
      "L'accounting ne peut remonter le temps."
    );
  }

  const delta =
    normalizeUsage(
      usageDelta
    );

  assertLegacyConsumeAvailable(state, delta);

  const assessment =
    assessGoalModeBudget({
      contract:
        state.contract,

      currentUsage:
        state.usage,

      proposedUsage:
        delta,

      currentGoalVersion,

      now:
        () =>
          new Date(at),
    });

  if (
    assessment.allowed !==
      true
  ) {
    fail(
      "GOAL_MODE_RUN_BUDGET_BLOCKED",
      assessment.reasonCode,
      {
        assessment,
      }
    );
  }

  const next =
    clone(state);

  next.usage = clone(assessment.projected);

  next.updatedAt =
    at;

  assertGoalModeRunState(
    next
  );

  return deepFreeze(
    next
  );
}

function reserveGoalModePlanning(state, {
  reservationId, binding, reservedProviderCalls, reservedCost, reservedAt,
} = {}) {
  assertGoalModeRunState(state);
  if (state.status !== "RUNNING") {
    fail("GOAL_MODE_RUN_NOT_RUNNING", "Un planning exige un run RUNNING.");
  }
  planningExposure(state);
  executionExposure(state);
  assertReservationAccountingOwned(state);
  const records = planningReservations(state);
  if (records.length >= MAX_PLANNING_RESERVATIONS) {
    fail("GOAL_MODE_PLANNING_LIMIT", "Historique de planning hors borne.");
  }
  requiredString(reservationId, "reservationId");
  if (records.some((item) => item.reservationId === reservationId)) {
    fail("GOAL_MODE_PLANNING_DUPLICATE", "Réservation de planning dupliquée.");
  }
  assertPlanningBinding(binding, state);
  if (!Number.isSafeInteger(reservedProviderCalls) || reservedProviderCalls < 1 ||
      typeof reservedCost !== "number" || !Number.isFinite(reservedCost) || reservedCost < 0) {
    fail("GOAL_MODE_PLANNING_USAGE_INVALID", "Plafond de planning invalide.");
  }
  const at = iso(reservedAt, "reservedAt");
  if (Date.parse(at) < Date.parse(state.updatedAt)) {
    fail("GOAL_MODE_RUN_TIME_REWIND", "Réservation antérieure au run.");
  }
  const budget = assessGoalModeBudget({
    contract: state.contract,
    currentUsage: state.usage,
    proposedUsage: {
      steps: 0, retries: 0,
      providerCalls: reservedProviderCalls,
      estimatedCost: reservedCost,
    },
    currentGoalVersion: binding.goalVersion,
    now: () => new Date(at),
  });
  if (budget.allowed !== true) {
    fail("GOAL_MODE_PLANNING_BUDGET_BLOCKED", budget.reasonCode);
  }
  const next = clone(state);
  next.planningReservations = [...records, {
    reservationId,
    binding: clone(binding),
    status: "PREPARED",
    reservedProviderCalls,
    reservedCost,
    reservedAt: at,
    mayHaveStartedAt: null,
    closedAt: null,
    observedProviderCalls: null,
    observedCost: null,
    unknownReasonCode: null,
  }];
  next.updatedAt = at;
  assertGoalModeRunState(next);
  return deepFreeze(next);
}

function openPlanningRecord(state, reservationId, statuses) {
  assertGoalModeRunState(state);
  requiredString(reservationId, "reservationId");
  const records = planningReservations(state);
  const record = records[records.length - 1];
  if (!record || record.reservationId !== reservationId) {
    fail("GOAL_MODE_PLANNING_NOT_FOUND", "Réservation courante introuvable.");
  }
  if (!statuses.includes(record.status)) {
    fail("GOAL_MODE_PLANNING_TRANSITION_INVALID", "Transition de planning interdite.");
  }
  return record;
}

function planningTimestamp(state, value) {
  const at = iso(value, "planningAt");
  if (Date.parse(at) < Date.parse(state.updatedAt)) {
    fail("GOAL_MODE_RUN_TIME_REWIND", "Planning antérieur au run.");
  }
  return at;
}

function markGoalModePlanningMayHaveStarted(state, {
  reservationId, markedAt,
} = {}) {
  openPlanningRecord(state, reservationId, ["PREPARED"]);
  if (state.status !== "RUNNING") {
    fail("GOAL_MODE_RUN_NOT_RUNNING", "Le départ du planning exige un run RUNNING.");
  }
  const at = planningTimestamp(state, markedAt);
  const atBudget = assessGoalModeBudget({
    contract: state.contract,
    currentUsage: state.usage,
    proposedUsage: { steps: 0, retries: 0, providerCalls: 0, estimatedCost: 0 },
    currentGoalVersion: state.contract.goalRef.goalVersion,
    now: () => new Date(at),
  });
  if (atBudget.allowed !== true) {
    fail("GOAL_MODE_PLANNING_BUDGET_BLOCKED", atBudget.reasonCode);
  }
  const next = clone(state);
  const record = next.planningReservations.at(-1);
  record.status = "MAY_HAVE_STARTED";
  record.mayHaveStartedAt = at;
  next.updatedAt = at;
  assertGoalModeRunState(next);
  return deepFreeze(next);
}

function reconcileGoalModePlanning(state, {
  reservationId, observedProviderCalls, observedCost,
  observationComplete, reconciledAt,
} = {}) {
  openPlanningRecord(state, reservationId, ["MAY_HAVE_STARTED"]);
  if (observationComplete !== true ||
      !Number.isSafeInteger(observedProviderCalls) || observedProviderCalls < 1 ||
      typeof observedCost !== "number" || !Number.isFinite(observedCost) || observedCost < 0) {
    fail("GOAL_MODE_PLANNING_USAGE_INCOMPLETE", "Observation terminale complète requise.");
  }
  const at = planningTimestamp(state, reconciledAt);
  const next = clone(state);
  const record = next.planningReservations.at(-1);
  record.status = "RECONCILED";
  record.closedAt = at;
  record.observedProviderCalls = observedProviderCalls;
  record.observedCost = observedCost;
  const calls = state.usage.providerCalls + observedProviderCalls;
  const cost = state.usage.estimatedCost + observedCost;
  if (!Number.isSafeInteger(calls) || !Number.isFinite(cost)) {
    fail("GOAL_MODE_PLANNING_USAGE_INVALID", "Usage observé hors borne numérique.");
  }
  next.usage.providerCalls = calls;
  next.usage.estimatedCost = cost;
  next.updatedAt = at;
  assertGoalModeRunState(next);
  return deepFreeze(next);
}

function markGoalModePlanningUnknown(state, {
  reservationId, observedProviderCalls = null, observedCost = null,
  reasonCode = "OUTCOME_UNCERTAIN", markedAt,
} = {}) {
  openPlanningRecord(state, reservationId, ["PREPARED", "MAY_HAVE_STARTED"]);
  if (!PLANNING_UNKNOWN_REASONS.includes(reasonCode) ||
      (observedProviderCalls !== null && (!Number.isSafeInteger(observedProviderCalls) || observedProviderCalls < 0)) ||
      (observedCost !== null && (typeof observedCost !== "number" || !Number.isFinite(observedCost) || observedCost < 0))) {
    fail("GOAL_MODE_PLANNING_USAGE_INVALID", "Observation incertaine invalide.");
  }
  const at = planningTimestamp(state, markedAt);
  const next = clone(state);
  const record = next.planningReservations.at(-1);
  record.status = "UNKNOWN";
  record.closedAt = at;
  record.observedProviderCalls = observedProviderCalls;
  record.observedCost = observedCost;
  record.unknownReasonCode = reasonCode;
  next.updatedAt = at;
  assertGoalModeRunState(next);
  return deepFreeze(next);
}

function executionTimestamp(state, value) {
  const at = executionIso(value, "executionAt");
  if (Date.parse(at) < Date.parse(state.updatedAt)) {
    fail("GOAL_MODE_RUN_TIME_REWIND", "Réservation DEV antérieure au run.");
  }
  return at;
}

function openExecutionRecord(state, reservationId, statuses) {
  assertGoalModeRunState(state);
  requiredString(reservationId, "reservationId");
  const record = executionReservations(state).at(-1);
  if (!record || record.reservationId !== reservationId) {
    fail("GOAL_MODE_EXECUTION_NOT_FOUND", "Réservation DEV courante introuvable.");
  }
  if (!statuses.includes(record.status)) {
    fail("GOAL_MODE_EXECUTION_TRANSITION_INVALID", "Transition DEV interdite.");
  }
  return record;
}

function reserveGoalModeExecution(state, {
  binding, reservedProviderCalls, reservedCost, reservedAt,
} = {}) {
  assertGoalModeRunState(state);
  if (state.status !== "RUNNING") {
    fail("GOAL_MODE_RUN_NOT_RUNNING", "Une réservation DEV exige RUNNING.");
  }
  planningExposure(state);
  executionExposure(state);
  assertReservationAccountingOwned(state);
  const records = executionReservations(state);
  if (records.length >= MAX_EXECUTION_RESERVATIONS) {
    fail("GOAL_MODE_EXECUTION_LIMIT", "Historique DEV hors borne.");
  }
  assertExecutionBinding(binding, state);
  const reservationId = executionReservationId(binding);
  if (records.some((item) => item.reservationId === reservationId)) {
    fail("GOAL_MODE_EXECUTION_DUPLICATE", "Réservation DEV déjà présente.");
  }
  if (!Number.isSafeInteger(reservedProviderCalls) || reservedProviderCalls < 1 ||
      typeof reservedCost !== "number" || !Number.isFinite(reservedCost) || reservedCost <= 0) {
    fail("GOAL_MODE_EXECUTION_INVALID", "Plafond de réservation DEV invalide.");
  }
  const at = executionTimestamp(state, reservedAt);
  const budget = assessGoalModeBudget({
    contract: state.contract,
    currentUsage: state.usage,
    proposedUsage: {
      steps: 1, retries: 0,
      providerCalls: reservedProviderCalls,
      estimatedCost: reservedCost,
    },
    currentGoalVersion: binding.goalVersion,
    now: () => new Date(at),
  });
  if (budget.allowed !== true) {
    fail("GOAL_MODE_EXECUTION_BUDGET_BLOCKED", budget.reasonCode);
  }
  const next = clone(state);
  next.executionReservations = [...records, {
    reservationId, binding: clone(binding), status: "PREPARED",
    reservedSteps: 1, reservedRetries: 0,
    reservedProviderCalls, reservedCost,
    reservedAt: at, mayHaveStartedAt: null, closedAt: null,
    observedSteps: null, observedRetries: null, observedProviderCalls: null,
    observedActualCost: null, accountedCost: null, accountingUnit: null,
    unknownReasonCode: null,
  }];
  next.updatedAt = at;
  assertGoalModeRunState(next);
  return deepFreeze(next);
}

function markGoalModeExecutionMayHaveStarted(state, {
  reservationId, markedAt,
} = {}) {
  openExecutionRecord(state, reservationId, ["PREPARED"]);
  if (state.status !== "RUNNING") {
    fail("GOAL_MODE_RUN_NOT_RUNNING", "La frontière DEV exige RUNNING.");
  }
  const at = executionTimestamp(state, markedAt);
  const budget = assessGoalModeBudget({
    contract: state.contract, currentUsage: state.usage,
    proposedUsage: { steps: 0, retries: 0, providerCalls: 0, estimatedCost: 0 },
    currentGoalVersion: state.contract.goalRef.goalVersion,
    now: () => new Date(at),
  });
  if (budget.allowed !== true) {
    fail("GOAL_MODE_EXECUTION_BUDGET_BLOCKED", budget.reasonCode);
  }
  const next = clone(state);
  const record = next.executionReservations.at(-1);
  record.status = "MAY_HAVE_STARTED";
  record.mayHaveStartedAt = at;
  next.updatedAt = at;
  assertGoalModeRunState(next);
  return deepFreeze(next);
}

function reconcileGoalModeExecution(state, {
  reservationId, observedSteps, observedRetries, observedProviderCalls,
  observedActualCost, accountedCost, accountingUnit, observationComplete,
  reconciledAt,
} = {}) {
  openExecutionRecord(state, reservationId, ["MAY_HAVE_STARTED"]);
  if (observationComplete !== true || observedSteps !== 1 ||
      !Number.isSafeInteger(observedRetries) || observedRetries < 0 ||
      !Number.isSafeInteger(observedProviderCalls) || observedProviderCalls < 0 ||
      typeof accountedCost !== "number" || !Number.isFinite(accountedCost) ||
      accountedCost < 0 || accountingUnit !== "USD" ||
      (observedActualCost !== null &&
       (typeof observedActualCost !== "number" ||
        !Number.isFinite(observedActualCost) || observedActualCost !== accountedCost))) {
    fail("GOAL_MODE_EXECUTION_USAGE_INCOMPLETE", "Observation terminale DEV complète requise.");
  }
  const at = executionTimestamp(state, reconciledAt);
  const next = clone(state);
  const record = next.executionReservations.at(-1);
  Object.assign(record, {
    status: "RECONCILED", closedAt: at, observedSteps,
    observedRetries, observedProviderCalls, observedActualCost,
    accountedCost, accountingUnit,
  });
  const usage = {
    steps: state.usage.steps + observedSteps,
    retries: state.usage.retries + observedRetries,
    providerCalls: state.usage.providerCalls + observedProviderCalls,
    estimatedCost: state.usage.estimatedCost + accountedCost,
  };
  if (!Number.isSafeInteger(usage.steps) || !Number.isSafeInteger(usage.retries) ||
      !Number.isSafeInteger(usage.providerCalls) || !Number.isFinite(usage.estimatedCost)) {
    fail("GOAL_MODE_EXECUTION_USAGE_INVALID", "Accounting DEV hors borne numérique.");
  }
  next.usage = usage;
  next.updatedAt = at;
  assertGoalModeRunState(next);
  return deepFreeze(next);
}

function markGoalModeExecutionUnknown(state, {
  reservationId, reasonCode = "OUTCOME_UNCERTAIN", observedSteps = null,
  observedRetries = null, observedProviderCalls = null,
  observedActualCost = null, accountedCost = null, accountingUnit = null,
  markedAt,
} = {}) {
  openExecutionRecord(state, reservationId, ["PREPARED", "MAY_HAVE_STARTED"]);
  if (!EXECUTION_UNKNOWN_REASONS.includes(reasonCode)) {
    fail("GOAL_MODE_EXECUTION_USAGE_INVALID", "Raison d'incertitude invalide.");
  }
  const at = executionTimestamp(state, markedAt);
  const next = clone(state);
  const record = next.executionReservations.at(-1);
  Object.assign(record, {
    status: "UNKNOWN", closedAt: at, observedSteps, observedRetries,
    observedProviderCalls, observedActualCost, accountedCost,
    accountingUnit, unknownReasonCode: reasonCode,
  });
  next.updatedAt = at;
  assertGoalModeRunState(next);
  return deepFreeze(next);
}

function immutableProjection(
  state
) {
  return {
    version:
      state.version,

    runId:
      state.runId,

    contract:
      state.contract,

    createdAt:
      state.createdAt,

    currentStepRef:
      state.currentStepRef,
  };
}

function assertGoalModeRunForward(
  previous,
  next,
  { currentRevision = null } = {}
) {
  assertGoalModeRunState(
    previous
  );

  assertGoalModeRunState(
    next
  );

  if (
    !same(
      immutableProjection(
        previous
      ),
      immutableProjection(
        next
      )
    )
  ) {
    fail(
      "GOAL_MODE_RUN_IMMUTABLE_CHANGED",
      "Identité ou contrat Goal Run modifié."
    );
  }

  if (
    Date.parse(
      next.updatedAt
    ) <
    Date.parse(
      previous.updatedAt
    )
  ) {
    fail(
      "GOAL_MODE_RUN_TIME_REWIND",
      "updatedAt ne peut reculer."
    );
  }

  for (
    const key of [
      "steps",
      "retries",
      "providerCalls",
      "estimatedCost",
    ]
  ) {
    if (
      next.usage[key] <
        previous.usage[key]
    ) {
      fail(
        "GOAL_MODE_RUN_USAGE_REWIND",
        `usage.${key} ne peut diminuer.`
      );
    }
  }

  const statusChanged =
    previous.status !==
      next.status;

  const usageChanged =
    !same(
      previous.usage,
      next.usage
    );

  const oldReservations = planningReservations(previous);
  const newReservations = planningReservations(next);
  const planningChanged = !same(oldReservations, newReservations);
  const oldExecutions = executionReservations(previous);
  const newExecutions = executionReservations(next);
  const executionChanged = !same(oldExecutions, newExecutions);

  if (planningChanged && executionChanged) {
    fail("GOAL_MODE_RUN_ATOMIC_MUTATION_MIXED", "Une révision ne peut modifier deux réservations.");
  }

  if (planningChanged) {
    if (statusChanged || previous.status !== next.status ||
        previous.reasonCode !== next.reasonCode ||
        previous.startedAt !== next.startedAt ||
        previous.completedAt !== next.completedAt ||
        newReservations.length < oldReservations.length ||
        newReservations.length > oldReservations.length + 1 ||
        oldReservations.some((record, index) =>
          (newReservations.length > oldReservations.length || index < oldReservations.length - 1) &&
          !same(record, newReservations[index]))) {
      fail("GOAL_MODE_PLANNING_HISTORY_MUTATED", "Historique de planning modifié.");
    }
    if (newReservations.length === oldReservations.length + 1) {
      const added = newReservations.at(-1);
      planningExposure(previous);
      executionExposure(previous);
      assertReservationAccountingOwned(previous);
      if (previous.status !== "RUNNING" || usageChanged ||
          oldReservations.some((record) => record.status !== "RECONCILED") ||
          added.status !== "PREPARED" ||
          (currentRevision !== null && added.binding.runRevision !== currentRevision)) {
        fail("GOAL_MODE_PLANNING_TRANSITION_INVALID", "Ajout de réservation invalide.");
      }
      const admission = assessGoalModeBudget({
        contract: previous.contract,
        currentUsage: previous.usage,
        proposedUsage: {
          steps: 0, retries: 0,
          providerCalls: added.reservedProviderCalls,
          estimatedCost: added.reservedCost,
        },
        currentGoalVersion: added.binding.goalVersion,
        now: () => new Date(added.reservedAt),
      });
      if (admission.allowed !== true) {
        fail("GOAL_MODE_PLANNING_BUDGET_BLOCKED", admission.reasonCode);
      }
    } else {
      const oldRecord = oldReservations.at(-1);
      const newRecord = newReservations.at(-1);
      const immutableKeys = [
        "reservationId", "binding", "reservedProviderCalls", "reservedCost", "reservedAt",
      ];
      const permitted = oldRecord?.status === "PREPARED"
        ? ["MAY_HAVE_STARTED", "UNKNOWN"]
        : oldRecord?.status === "MAY_HAVE_STARTED"
          ? ["RECONCILED", "UNKNOWN"]
          : [];
      if (!oldRecord || !newRecord || !permitted.includes(newRecord.status) ||
          immutableKeys.some((key) => !same(oldRecord[key], newRecord[key])) ||
          (oldRecord.status === "PREPARED" && newRecord.status === "UNKNOWN" &&
           newRecord.mayHaveStartedAt !== null) ||
          (oldRecord.status === "MAY_HAVE_STARTED" &&
           oldRecord.mayHaveStartedAt !== newRecord.mayHaveStartedAt)) {
        fail("GOAL_MODE_PLANNING_TRANSITION_INVALID", "Transition de réservation invalide.");
      }
      if (newRecord.status === "MAY_HAVE_STARTED") {
        if (previous.status !== "RUNNING" ||
            (currentRevision !== null && currentRevision !== oldRecord.binding.runRevision + 1)) {
          fail("GOAL_MODE_PLANNING_TRANSITION_INVALID", "Départ sur snapshot stale interdit.");
        }
        const dispatch = assessGoalModeBudget({
          contract: previous.contract,
          currentUsage: previous.usage,
          proposedUsage: { steps: 0, retries: 0, providerCalls: 0, estimatedCost: 0 },
          currentGoalVersion: oldRecord.binding.goalVersion,
          now: () => new Date(newRecord.mayHaveStartedAt),
        });
        if (dispatch.allowed !== true) {
          fail("GOAL_MODE_PLANNING_BUDGET_BLOCKED", dispatch.reasonCode);
        }
      }
      if (newRecord.status === "RECONCILED") {
        if (next.usage.steps !== previous.usage.steps ||
            next.usage.retries !== previous.usage.retries ||
            next.usage.providerCalls !== previous.usage.providerCalls + newRecord.observedProviderCalls ||
            next.usage.estimatedCost !== previous.usage.estimatedCost + newRecord.observedCost) {
          fail("GOAL_MODE_PLANNING_ACCOUNTING_INVALID", "Usage observé non comptabilisé exactement une fois.");
        }
      } else if (usageChanged) {
        fail("GOAL_MODE_PLANNING_ACCOUNTING_INVALID", "Une issue incertaine n'invente aucun coût.");
      }
    }
  }

  if (executionChanged) {
    if (statusChanged || previous.reasonCode !== next.reasonCode ||
        previous.startedAt !== next.startedAt ||
        previous.completedAt !== next.completedAt ||
        newExecutions.length < oldExecutions.length ||
        newExecutions.length > oldExecutions.length + 1 ||
        oldExecutions.some((record, index) =>
          (newExecutions.length > oldExecutions.length || index < oldExecutions.length - 1) &&
          !same(record, newExecutions[index]))) {
      fail("GOAL_MODE_EXECUTION_HISTORY_MUTATED", "Historique DEV modifié.");
    }
    if (newExecutions.length === oldExecutions.length + 1) {
      const added = newExecutions.at(-1);
      planningExposure(previous);
      executionExposure(previous);
      assertReservationAccountingOwned(previous);
      if (previous.status !== "RUNNING" || usageChanged ||
          oldExecutions.some((record) => record.status !== "RECONCILED") ||
          added.status !== "PREPARED" ||
          (currentRevision !== null && added.binding.runRevision !== currentRevision)) {
        fail("GOAL_MODE_EXECUTION_TRANSITION_INVALID", "Ajout DEV invalide.");
      }
      const admission = assessGoalModeBudget({
        contract: previous.contract,
        currentUsage: previous.usage,
        proposedUsage: {
          steps: 1, retries: 0,
          providerCalls: added.reservedProviderCalls,
          estimatedCost: added.reservedCost,
        },
        currentGoalVersion: added.binding.goalVersion,
        now: () => new Date(added.reservedAt),
      });
      if (admission.allowed !== true) {
        fail("GOAL_MODE_EXECUTION_BUDGET_BLOCKED", admission.reasonCode);
      }
    } else {
      const oldRecord = oldExecutions.at(-1);
      const newRecord = newExecutions.at(-1);
      const immutableKeys = [
        "reservationId", "binding", "reservedSteps", "reservedRetries",
        "reservedProviderCalls", "reservedCost", "reservedAt",
      ];
      const permitted = oldRecord?.status === "PREPARED"
        ? ["MAY_HAVE_STARTED", "UNKNOWN"]
        : oldRecord?.status === "MAY_HAVE_STARTED"
          ? ["RECONCILED", "UNKNOWN"]
          : [];
      if (!oldRecord || !newRecord || !permitted.includes(newRecord.status) ||
          immutableKeys.some((key) => !same(oldRecord[key], newRecord[key])) ||
          (oldRecord.status === "PREPARED" && newRecord.mayHaveStartedAt !== null &&
           newRecord.status === "UNKNOWN") ||
          (oldRecord.status === "MAY_HAVE_STARTED" &&
           oldRecord.mayHaveStartedAt !== newRecord.mayHaveStartedAt)) {
        fail("GOAL_MODE_EXECUTION_TRANSITION_INVALID", "Transition DEV invalide.");
      }
      if (newRecord.status === "MAY_HAVE_STARTED") {
        if (previous.status !== "RUNNING" ||
            (currentRevision !== null &&
             currentRevision !== oldRecord.binding.runRevision + 1)) {
          fail("GOAL_MODE_EXECUTION_TRANSITION_INVALID", "Départ DEV sur snapshot stale interdit.");
        }
        const dispatch = assessGoalModeBudget({
          contract: previous.contract, currentUsage: previous.usage,
          proposedUsage: { steps: 0, retries: 0, providerCalls: 0, estimatedCost: 0 },
          currentGoalVersion: oldRecord.binding.goalVersion,
          now: () => new Date(newRecord.mayHaveStartedAt),
        });
        if (dispatch.allowed !== true) {
          fail("GOAL_MODE_EXECUTION_BUDGET_BLOCKED", dispatch.reasonCode);
        }
      }
      if (newRecord.status === "RECONCILED") {
        if (next.usage.steps !== previous.usage.steps + newRecord.observedSteps ||
            next.usage.retries !== previous.usage.retries + newRecord.observedRetries ||
            next.usage.providerCalls !== previous.usage.providerCalls + newRecord.observedProviderCalls ||
            next.usage.estimatedCost !== previous.usage.estimatedCost + newRecord.accountedCost) {
          fail("GOAL_MODE_EXECUTION_ACCOUNTING_INVALID", "Usage DEV non comptabilisé exactement une fois.");
        }
      } else if (usageChanged) {
        fail("GOAL_MODE_EXECUTION_ACCOUNTING_INVALID", "Une réservation non réconciliée ne consomme rien.");
      }
    }
  }

  if (
    statusChanged
  ) {
    if (
      !TRANSITIONS[
        previous.status
      ]?.has(
        next.status
      )
    ) {
      fail(
        "GOAL_MODE_RUN_TRANSITION_INVALID",
        `Transition ${previous.status} → ${next.status} interdite.`
      );
    }

    if (usageChanged || planningChanged || executionChanged) {
      fail(
        "GOAL_MODE_RUN_ATOMIC_MUTATION_MIXED",
        "Une révision de transition ne peut aussi modifier l'accounting."
      );
    }
  } else if (planningChanged || executionChanged) {
    // Les transitions de réservation sont vérifiées ci-dessus, même avec usage nul.
  } else if (usageChanged) {
    const delta = {
      steps: next.usage.steps - previous.usage.steps,
      retries: next.usage.retries - previous.usage.retries,
      providerCalls: next.usage.providerCalls - previous.usage.providerCalls,
      estimatedCost: next.usage.estimatedCost - previous.usage.estimatedCost,
    };
    assertLegacyConsumeAvailable(previous, delta);
    const assessment = assessGoalModeBudget({
      contract: previous.contract,
      currentUsage: previous.usage,
      proposedUsage: delta,
      currentGoalVersion: previous.contract.goalRef.goalVersion,
      now: () => new Date(next.updatedAt),
    });
    if (assessment.allowed !== true) {
      fail("GOAL_MODE_RUN_BUDGET_BLOCKED", assessment.reasonCode);
    }
    if (
      previous.status !==
        "RUNNING" ||
      next.status !==
        "RUNNING"
    ) {
      fail(
        "GOAL_MODE_RUN_USAGE_STATE_INVALID",
        "L'accounting ne peut évoluer que pendant RUNNING."
      );
    }

    if (
      previous.reasonCode !==
        next.reasonCode ||
      previous.startedAt !==
        next.startedAt ||
      previous.completedAt !==
        next.completedAt
    ) {
      fail(
        "GOAL_MODE_RUN_USAGE_MUTATION_INVALID",
        "Une révision d'accounting ne peut modifier l'état du run."
      );
    }
  } else {
    fail(
      "GOAL_MODE_RUN_NOOP_REVISION",
      "Une nouvelle révision Goal Run doit modifier état ou accounting."
    );
  }

  if (
    previous.startedAt !==
      null &&
    next.startedAt !==
      previous.startedAt
  ) {
    fail(
      "GOAL_MODE_RUN_START_MUTATED",
      "startedAt est immuable une fois défini."
    );
  }

  if (
    previous.completedAt !==
      null &&
    next.completedAt !==
      previous.completedAt
  ) {
    fail(
      "GOAL_MODE_RUN_COMPLETION_MUTATED",
      "completedAt est immuable une fois défini."
    );
  }

  return true;
}

module.exports = {
  EXECUTION_STATUSES,
  EXECUTION_UNKNOWN_REASONS,
  PLANNING_STATUSES,
  PLANNING_UNKNOWN_REASONS,
  STATUSES,
  TERMINAL_STATUSES,
  TRANSITIONS,
  VERSION,
  applyGoalModeUsage,
  assertGoalModeRunForward,
  assertGoalModeRunState,
  createGoalModeRunState,
  markGoalModeExecutionMayHaveStarted,
  markGoalModeExecutionUnknown,
  markGoalModePlanningMayHaveStarted,
  markGoalModePlanningUnknown,
  reconcileGoalModePlanning,
  reconcileGoalModeExecution,
  reserveGoalModeExecution,
  reserveGoalModePlanning,
  transitionGoalModeRun,
};
