"use strict";

const crypto =
  require("node:crypto");

const {
  assessGoalModeBudget,
  assessGoalModeCapabilityCeiling,
  createGoalModeRunContract,
} = require(
  "./goal-mode-run-contract"
);

const {
  CRITERION_STATUSES,
  MILESTONE_STATUSES,
} = require(
  "./goal-schema"
);


const {
  VERSION,
  actionableMilestoneStatuses,
  terminalMilestoneStatuses,
  ACTIONABLE_MILESTONE_STATUSES,
  TERMINAL_MILESTONE_STATUSES,
  PROPOSAL_KEYS,
  fail,
  deepFreeze,
  clone,
  fingerprint,
  requiredString,
  strictObject,
  assertRunSnapshot,
} = require("./goal-mode-next-step-primitives");

function getAuthoritativeGoal(
  goalStrategyEngine,
  state
) {
  if (
    typeof goalStrategyEngine
      ?.registry?.get !==
    "function"
  ) {
    throw new TypeError(
      "GoalStrategyEngine autoritatif requis."
    );
  }

  const goal =
    goalStrategyEngine
      .registry
      .get(
        state.contract
          .goalRef
          .goalId
      );

  if (
    !goal ||
    typeof goal !== "object"
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_GOAL_UNAVAILABLE",
      "Goal autoritatif indisponible."
    );
  }

  if (
    goal.status !==
      "ACTIVE"
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_GOAL_NOT_ACTIVE",
      "Le Goal n'est plus ACTIVE."
    );
  }

  if (
    goal.version !==
      state.contract
        .goalRef
        .goalVersion
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_GOAL_STALE",
      "Le Goal a changé depuis l'admission du run."
    );
  }

  const admitted =
    state.contract;

  const current =
    createGoalModeRunContract({
      goal,
      request: {
        userConfirmed: true,
        workspaceId:
          admitted.scope
            .workspaceId,
        projectId:
          admitted.scope
            .projectId,
        limits:
          admitted.limits,
        capabilityCeilings:
          admitted
            .capabilityCeilings,
        localOnly:
          admitted.localOnly,
      },
      now:
        () =>
          new Date(
            admitted.admittedAt
          ),
      idFactory:
        () =>
          admitted.runId,
    });

  if (
    current.objectiveFingerprint !==
      admitted.objectiveFingerprint ||
    current.successCriteria
      .fingerprint !==
      admitted.successCriteria
        .fingerprint ||
    current.constraints
      .fingerprint !==
      admitted.constraints
        .fingerprint ||
    fingerprint(current.scope) !==
      fingerprint(admitted.scope) ||
    current.localOnly !==
      admitted.localOnly
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_GOAL_STALE",
      "Le contenu du Goal a changé depuis l'admission du run."
    );
  }

  return goal;
}

function milestoneDone(
  milestonesById,
  milestoneId
) {
  const dependency =
    milestonesById.get(
      milestoneId
    );

  return dependency?.status ===
    "ACHIEVED";
}

function dependenciesSatisfied(
  milestone,
  milestonesById
) {
  const dependencies =
    Array.isArray(
      milestone.dependencies
    )
      ? milestone.dependencies
      : [];

  return dependencies.every(
    (dependencyId) =>
      milestoneDone(
        milestonesById,
        dependencyId
      )
  );
}

function criterionTarget(
  criterion
) {
  return {
    kind:
      "SUCCESS_CRITERION",

    targetId:
      criterion.criterionId,

    title:
      criterion.description ||
      criterion.criterionId,

    description:
      criterion.description ||
      "",

    status:
      criterion.status,

    criterionType:
      criterion.type,

    targetValue:
      clone(
        criterion.targetValue
      ),

    evidenceTargetIds:
      Object.freeze([
        criterion.criterionId,
      ]),
  };
}

function milestoneTarget(
  milestone
) {
  const completionCriteria =
    Array.isArray(
      milestone
        .completionCriteria
    )
      ? milestone
          .completionCriteria
      : [];

  return {
    kind:
      "MILESTONE",

    targetId:
      milestone.milestoneId,

    title:
      milestone.title ||
      milestone.milestoneId,

    description:
      milestone.description ||
      "",

    status:
      milestone.status,

    linkedProjectIds:
      Object.freeze([
        ...(
          milestone
            .linkedProjectIds ||
          []
        ),
      ]),

    evidenceTargetIds:
      Object.freeze([
        milestone.milestoneId,
        ...completionCriteria
          .map(
            (criterion) =>
              criterion.criterionId
          )
          .filter(Boolean),
      ]),
  };
}

function baseSelection(
  runSnapshot,
  goal
) {
  return {
    version:
      VERSION,

    runRef: {
      runId:
        runSnapshot
          .state
          .runId,

      runRevision:
        runSnapshot
          .revision,

      goalId:
        goal.goalId,

      goalVersion:
        goal.version,
    },

    authority: {
      planningOnly:
        true,

      executionAuthorized:
        false,

      capabilitiesGranted:
        false,

      securityPipelineBypassed:
        false,
    },

    providerCalled:
      false,
  };
}

function validatedRoadmap(
  goal
) {
  const criteria =
    goal.successCriteria;

  if (
    !Array.isArray(criteria) ||
    criteria.length === 0
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_CRITERIA_INVALID",
      "Un Goal Run exige des critères de succès explicites."
    );
  }

  const criterionIds =
    new Set();

  for (
    const criterion of
    criteria
  ) {
    const id =
      requiredString(
        criterion?.criterionId,
        "criterionId",
        120
      );

    if (
      criterionIds.has(id) ||
      !CRITERION_STATUSES
        .includes(
          criterion.status
        )
    ) {
      fail(
        "GOAL_MODE_NEXT_STEP_CRITERIA_INVALID",
        "Critère de succès incohérent."
      );
    }

    criterionIds.add(id);
  }

  if (
    !Array.isArray(
      goal.milestones
    )
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_ROADMAP_INVALID",
      "Roadmap Goal invalide."
    );
  }

  const milestones =
    goal.milestones;

  const milestonesById =
    new Map();

  for (
    const milestone of
    milestones
  ) {
    const id =
      requiredString(
        milestone?.milestoneId,
        "milestoneId",
        120
      );

    if (
      milestonesById.has(id) ||
      milestone.goalId !==
        goal.goalId ||
      !MILESTONE_STATUSES
        .includes(
          milestone.status
        )
    ) {
      fail(
        "GOAL_MODE_NEXT_STEP_ROADMAP_INVALID",
        "Milestone incohérent."
      );
    }

    milestonesById.set(
      id,
      milestone
    );
  }

  for (
    const milestone of
    milestones
  ) {
    if (
      !Array.isArray(
        milestone.dependencies
      ) ||
      !Array.isArray(
        milestone
          .completionCriteria
      )
    ) {
      fail(
        "GOAL_MODE_NEXT_STEP_ROADMAP_INVALID",
        "Références de milestone invalides."
      );
    }

    const dependencyIds =
      new Set();

    for (
      const dependencyId of
      milestone.dependencies
    ) {
      requiredString(
        dependencyId,
        "dependencyId",
        120
      );

      if (
        dependencyId ===
          milestone.milestoneId ||
        dependencyIds.has(
          dependencyId
        ) ||
        !milestonesById.has(
          dependencyId
        )
      ) {
        fail(
          "GOAL_MODE_NEXT_STEP_ROADMAP_INVALID",
          "Dépendance de milestone incohérente."
        );
      }

      dependencyIds.add(
        dependencyId
      );
    }

    const completionIds =
      new Set();

    for (
      const criterion of
      milestone
        .completionCriteria
    ) {
      const id =
        requiredString(
          criterion?.criterionId,
          "completionCriterionId",
          120
        );

      if (
        completionIds.has(id) ||
        !CRITERION_STATUSES
          .includes(
            criterion.status
          )
      ) {
        fail(
          "GOAL_MODE_NEXT_STEP_ROADMAP_INVALID",
          "Critère de completion incohérent."
        );
      }

      completionIds.add(id);
    }
  }

  const visiting =
    new Set();
  const visited =
    new Set();

  function visit(id) {
    if (visiting.has(id)) {
      fail(
        "GOAL_MODE_NEXT_STEP_ROADMAP_INVALID",
        "Cycle de dépendances dans la roadmap."
      );
    }

    if (visited.has(id)) {
      return;
    }

    visiting.add(id);

    for (
      const dependencyId of
      milestonesById
        .get(id)
        .dependencies
    ) {
      visit(dependencyId);
    }

    visiting.delete(id);
    visited.add(id);
  }

  for (
    const id of
    milestonesById.keys()
  ) {
    visit(id);
  }

  return {
    criteria,
    milestones,
    milestonesById,
  };
}

function selectGoalModeNextTarget({
  goalStrategyEngine,
  runSnapshot,
  runId,
} = {}) {
  const snapshot =
    assertRunSnapshot(
      runSnapshot,
      runId
    );

  const state =
    snapshot.state;

  const goal =
    getAuthoritativeGoal(
      goalStrategyEngine,
      state
    );

  const base =
    baseSelection(
      snapshot,
      goal
    );

  const {
    criteria:
      successCriteria,
    milestones,
    milestonesById,
  } = validatedRoadmap(
    goal
  );

  if (
    successCriteria.length &&
    successCriteria.every(
      (criterion) =>
        criterion.status ===
          "MET"
    )
  ) {
    return deepFreeze({
      ...base,

      decision:
        "STOP",

      reasonCode:
        "SUCCESS_CRITERIA_MET",

      target:
        null,

      targetFingerprint:
        null,

      proposalRequired:
        false,
    });
  }

  if (
    milestones.length
  ) {
    const incomplete =
      milestones.filter(
        (milestone) =>
          !terminalMilestoneStatuses
            .has(
              milestone.status
            )
      );

    const actionable =
      incomplete[0];

    if (
      actionable &&
      actionableMilestoneStatuses
        .has(actionable.status) &&
      dependenciesSatisfied(
        actionable,
        milestonesById
      )
    ) {
      const target =
        milestoneTarget(
          actionable
        );

      return deepFreeze({
        ...base,

        decision:
          "PLAN",

        reasonCode:
          "NEXT_MILESTONE",

        target,

        targetFingerprint:
          fingerprint(
            target
          ),

        proposalRequired:
          true,
      });
    }

    if (
      incomplete.length
    ) {
      const blocked =
        incomplete
          .filter(
            (milestone) =>
              milestone.status ===
                "BLOCKED" ||
              !dependenciesSatisfied(
                milestone,
                milestonesById
              )
          )
          .map(
            (milestone) =>
              milestone.milestoneId
          );

      return deepFreeze({
        ...base,

        decision:
          "BLOCKED",

        reasonCode:
          "NO_ACTIONABLE_MILESTONE",

        target:
          null,

        targetFingerprint:
          null,

        proposalRequired:
          false,

        blockedMilestoneIds:
          Object.freeze(
            blocked
          ),
      });
    }
  }

  const unmetCriterion =
    successCriteria.find(
      (criterion) =>
        criterion.status !==
          "MET"
    );

  if (unmetCriterion) {
    const target =
      criterionTarget(
        unmetCriterion
      );

    return deepFreeze({
      ...base,

      decision:
        "PLAN",

      reasonCode:
        "NEXT_SUCCESS_CRITERION",

      target,

      targetFingerprint:
        fingerprint(
          target
        ),

      proposalRequired:
        true,
    });
  }

  return deepFreeze({
    ...base,

    decision:
      "BLOCKED",

    reasonCode:
      "NO_PLANNING_TARGET",

    target:
      null,

    targetFingerprint:
      null,

    proposalRequired:
      false,
  });
}

function normalizeEvidenceTargetIds(
  raw,
  allowed
) {
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    raw.length >
      (allowed?.length || 0) ||
    Reflect.ownKeys(raw)
      .length !==
      raw.length + 1 ||
    Reflect.ownKeys(raw)
      .some(
        (key, index) =>
          key !==
          (
            index === raw.length
              ? "length"
              : String(index)
          )
      )
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_EVIDENCE_TARGET_INVALID",
      "evidenceTargetIds invalide ou hors borne."
    );
  }

  const normalized =
    raw.map(
      (value) =>
        requiredString(
          value,
          "evidenceTargetId",
          200
        )
    );

  if (
    new Set(normalized)
      .size !==
    normalized.length
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_EVIDENCE_TARGET_INVALID",
      "evidenceTargetIds dupliqués."
    );
  }

  const allowedSet =
    new Set(
      allowed || []
    );

  const invalid =
    normalized.filter(
      (value) =>
        !allowedSet.has(
          value
        )
    );

  if (
    invalid.length
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_EVIDENCE_TARGET_OUT_OF_SCOPE",
      "La proposition vise une preuve hors de la cible sélectionnée.",
      {
        invalid,
      }
    );
  }

  return Object.freeze(
    normalized
  );
}

function normalizeUsage(
  raw
) {
  const source =
    strictObject(
      raw,
      "proposal.usage",
      [
        "steps",
        "retries",
        "providerCalls",
        "estimatedCost",
      ]
    );

  if (
    source.steps !== 1
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_USAGE_INVALID",
      "Une proposition Next-Step doit consommer exactement 1 step global."
    );
  }

  if (
    source.retries !== 0
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_USAGE_INVALID",
      "Une nouvelle proposition ne peut pré-consommer aucun retry global."
    );
  }

  if (
    !Number.isSafeInteger(
      source.providerCalls
    ) ||
    source.providerCalls < 0
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_USAGE_INVALID",
      "providerCalls invalide."
    );
  }

  if (
    typeof source.estimatedCost !==
      "number" ||
    !Number.isFinite(
      source.estimatedCost
    ) ||
    source.estimatedCost < 0
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_USAGE_INVALID",
      "estimatedCost invalide."
    );
  }

  return Object.freeze({
    steps: 1,
    retries: 0,
    providerCalls:
      source.providerCalls,
    estimatedCost:
      source.estimatedCost,
  });
}

function normalizeRequestedCapabilities(
  raw
) {
  const source =
    strictObject(
      raw,
      "proposal.requestedCapabilities",
      [
        "network",
        "gitWrite",
        "destructiveActions",
      ]
  );

  for (
    const key of [
      "network",
      "gitWrite",
      "destructiveActions",
    ]
  ) {
    if (
      typeof source[key] !==
      "boolean"
    ) {
      fail(
        "GOAL_MODE_NEXT_STEP_CAPABILITY_INVALID",
        `requestedCapabilities.${key} invalide.`
      );
    }
  }

  return Object.freeze({
    network:
      source.network,

    gitWrite:
      source.gitWrite,

    destructiveActions:
      source
        .destructiveActions,
  });
}

function assertSelectionBinding(
  selection,
  runSnapshot
) {
  if (
    !selection ||
    typeof selection !==
      "object" ||
    selection.version !==
      VERSION ||
    selection.decision !==
      "PLAN" ||
    selection.proposalRequired !==
      true ||
    !selection.target ||
    typeof selection
      .targetFingerprint !==
      "string"
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_SELECTION_INVALID",
      "Sélection Next-Step PLAN valide requise."
    );
  }

  const state =
    runSnapshot.state;

  if (
    selection.runRef
      ?.runId !==
      state.runId ||
    selection.runRef
      ?.runRevision !==
      runSnapshot.revision ||
    selection.runRef
      ?.goalId !==
      state.contract
        .goalRef
        .goalId ||
    selection.runRef
      ?.goalVersion !==
      state.contract
        .goalRef
        .goalVersion
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_SELECTION_STALE",
      "La sélection Next-Step ne correspond plus au snapshot du run."
    );
  }

  if (
    selection.targetFingerprint !==
      fingerprint(
        selection.target
      )
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_TARGET_CHANGED",
      "La cible Next-Step a été modifiée."
    );
  }
}

function validateGoalModeStepProposal({
  runSnapshot,
  runId,
  selection,
  canonicalSelection,
  proposal,
  currentGoalVersion,
  now =
    () =>
      new Date(),
  idFactory =
    () =>
      `goal-step-proposal-${crypto.randomUUID()}`,
} = {}) {
  const snapshot =
    assertRunSnapshot(
      runSnapshot,
      runId
    );

  assertSelectionBinding(
    selection,
    snapshot
  );

  if (
    canonicalSelection.decision !==
      "PLAN" ||
    selection.targetFingerprint !==
      canonicalSelection
        .targetFingerprint ||
    selection.target?.kind !==
      canonicalSelection
        .target.kind ||
    selection.target?.targetId !==
      canonicalSelection
        .target.targetId ||
    selection.reasonCode !==
      canonicalSelection
        .reasonCode
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_SELECTION_STALE",
      "La cible Next-Step ne correspond plus au Goal canonique."
    );
  }

  const source =
    strictObject(
      proposal,
      "proposal",
      PROPOSAL_KEYS
    );

  const objective =
    requiredString(
      source.objective,
      "proposal.objective",
      1600
    );

  const expectedOutcome =
    requiredString(
      source.expectedOutcome,
      "proposal.expectedOutcome",
      1600
    );

  const evidenceTargetIds =
    normalizeEvidenceTargetIds(
      source.evidenceTargetIds,
      canonicalSelection.target
        .evidenceTargetIds
    );

  const usage =
    normalizeUsage(
      source.usage
    );

  const requestedCapabilities =
    normalizeRequestedCapabilities(
      source.requestedCapabilities
    );

  if (
    source.requiresUserInput !==
      undefined &&
    typeof source
      .requiresUserInput !==
      "boolean"
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_INVALID",
      "requiresUserInput invalide."
    );
  }

  const budget =
    assessGoalModeBudget({
      contract:
        snapshot.state
          .contract,

      currentUsage:
        snapshot.state
          .usage,

      proposedUsage:
        usage,

      currentGoalVersion,

      now,
    });

  if (
    budget.allowed !==
      true
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_BUDGET_BLOCKED",
      "La proposition dépasse les limites globales du Goal Run.",
      {
        assessment:
          budget,
      }
    );
  }

  const capability =
    assessGoalModeCapabilityCeiling({
      contract:
        snapshot.state
          .contract,

      requestedCapabilities,
    });

  if (
    capability
      .allowedToRequest !==
      true
  ) {
    fail(
      "GOAL_MODE_NEXT_STEP_CAPABILITY_DENIED",
      "La proposition demande une capacité hors ceiling du Goal Run.",
      {
        assessment:
          capability,
      }
    );
  }

  const proposalId =
    requiredString(
      idFactory(),
      "proposalId",
      200
    );

  const normalized =
    {
      version:
        "goal-mode-step-proposal-v1",

      proposalId,

      binding: {
        runId:
          snapshot.state
            .runId,

        runRevision:
          snapshot.revision,

        goalId:
          snapshot.state
            .contract
            .goalRef
            .goalId,

        goalVersion:
          snapshot.state
            .contract
            .goalRef
            .goalVersion,

        targetKind:
          canonicalSelection.target
            .kind,

        targetId:
          canonicalSelection.target
            .targetId,

        targetFingerprint:
          canonicalSelection
            .targetFingerprint,
      },

      objective,
      expectedOutcome,
      evidenceTargetIds,

      usage,

      requestedCapabilities,

      requiresUserInput:
        source.requiresUserInput ??
          false,

      budgetProjection:
        budget.projected,

      authorization: {
        requestRequired:
          capability
            .requiresExternalAuthorization ===
            true,

        decision:
          capability.decision,

        executionAuthorized:
          false,
      },

      /*
       * 5.0C produit seulement une proposition.
       * Aucun skill, operation, args, tool, provider,
       * command ou actionClass n'est accepté ici.
       */
      authority: {
        proposalOnly:
          true,

        executionAuthorized:
          false,

        capabilitiesGranted:
          false,

        securityPipelineBypassed:
          false,
      },
    };

  return deepFreeze({
    ...normalized,

    fingerprint:
      fingerprint(
        normalized
      ),
  });
}

function createGoalModeNextStepPlanner({
  goalStrategyEngine,
  runStore,
  now = () => new Date(),
  idFactory = () =>
    `goal-step-proposal-${crypto.randomUUID()}`,
} = {}) {
  if (
    typeof goalStrategyEngine
      ?.registry?.get !==
      "function" ||
    typeof runStore?.get !==
      "function" ||
    typeof now !==
      "function" ||
    typeof idFactory !==
      "function"
  ) {
    throw new TypeError(
      "GoalStrategyEngine et GoalModeRunStore canoniques requis."
    );
  }

  function snapshotFor(
    runId
  ) {
    const id =
      requiredString(
        runId,
        "runId",
        200
      );

    return assertRunSnapshot(
      runStore.get(id),
      id
    );
  }

  function select(input = {}) {
    const { runId } =
      strictObject(
        input,
        "select",
        ["runId"]
      );

    return selectGoalModeNextTarget({
      goalStrategyEngine,
      runSnapshot:
        snapshotFor(runId),
      runId,
    });
  }

  function validate(input = {}) {
    const {
      runId,
      selection,
      proposal,
    } = strictObject(
      input,
      "validate",
      [
        "runId",
        "selection",
        "proposal",
      ]
    );
    const snapshot =
      snapshotFor(runId);

    const canonicalSelection =
      selectGoalModeNextTarget({
        goalStrategyEngine,
        runSnapshot:
          snapshot,
        runId,
      });

    const observedAt =
      new Date(now());

    if (
      !Number.isFinite(
        observedAt.getTime()
      ) ||
      observedAt.getTime() <
        Date.parse(
          snapshot.state
            .updatedAt
        )
    ) {
      fail(
        "GOAL_MODE_NEXT_STEP_CLOCK_INVALID",
        "Horloge Goal Mode invalide ou antérieure au run."
      );
    }

    return validateGoalModeStepProposal({
      runSnapshot:
        snapshot,
      runId,
      selection,
      canonicalSelection,
      proposal,
      currentGoalVersion:
        canonicalSelection
          .runRef
          .goalVersion,
      now:
        () =>
          observedAt,
      idFactory,
    });
  }

  return Object.freeze({
    select,
    validate,
  });
}

module.exports = {
  ACTIONABLE_MILESTONE_STATUSES,
  PROPOSAL_KEYS,
  TERMINAL_MILESTONE_STATUSES,
  VERSION,
  createGoalModeNextStepPlanner,
};
