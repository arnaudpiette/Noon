"use strict";

const assert =
  require("node:assert/strict");
const test =
  require("node:test");

const {
  ACTIONABLE_MILESTONE_STATUSES,
  TERMINAL_MILESTONE_STATUSES,
  createGoalModeRunState,
  directFixture,
  engine,
  goal,
  runningSnapshot,
  selectGoalModeNextTarget,
  testFingerprint,
  validProposal,
  validateGoalModeStepProposal,
} = require("./helpers/goal-mode-next-step-planner-fixtures");

test(
  "5.0C sélectionne le premier milestone actionnable dans l'ordre de roadmap",
  () => {
    const currentGoal =
      goal();

    const selection =
      selectGoalModeNextTarget({
        goalStrategyEngine:
          engine(
            currentGoal
          ),

        runSnapshot:
          runningSnapshot(
            currentGoal
          ),
      });

    assert.equal(
      selection.decision,
      "PLAN"
    );

    assert.equal(
      selection.reasonCode,
      "NEXT_MILESTONE"
    );

    assert.equal(
      selection.target
        .targetId,
      "milestone-1"
    );

    assert.deepEqual(
      selection.target
        .evidenceTargetIds,
      [
        "milestone-1",
        "criterion-m1",
      ]
    );

    assert.equal(
      selection.authority
        .executionAuthorized,
      false
    );

    assert.equal(
      selection.providerCalled,
      false
    );
  }
);

test(
  "5.0C respecte les dépendances et bloque si aucun milestone n'est actionnable",
  () => {
    const currentGoal =
      goal({
        milestones: [
          {
            milestoneId:
              "milestone-a",

            goalId:
              "goal-50c",

            title:
              "A",

            description:
              "A bloqué.",

            status:
              "BLOCKED",

            dependencies: [],

            linkedProjectIds: [],

            completionCriteria: [],

            evidenceRefs: [],
          },

          {
            milestoneId:
              "milestone-b",

            goalId:
              "goal-50c",

            title:
              "B",

            description:
              "B dépend de A.",

            status:
              "NOT_STARTED",

            dependencies: [
              "milestone-a",
            ],

            linkedProjectIds: [],

            completionCriteria: [],

            evidenceRefs: [],
          },
        ],
      });

    const selection =
      selectGoalModeNextTarget({
        goalStrategyEngine:
          engine(
            currentGoal
          ),

        runSnapshot:
          runningSnapshot(
            currentGoal
          ),
      });

    assert.equal(
      selection.decision,
      "BLOCKED"
    );

    assert.equal(
      selection.reasonCode,
      "NO_ACTIONABLE_MILESTONE"
    );

    assert.deepEqual(
      selection
        .blockedMilestoneIds,
      [
        "milestone-a",
        "milestone-b",
      ]
    );
  }
);

test(
  "5.0C bascule sur un success criterion quand il n'y a plus de milestone à planifier",
  () => {
    const currentGoal =
      goal({
        milestones: [],
      });

    const selection =
      selectGoalModeNextTarget({
        goalStrategyEngine:
          engine(
            currentGoal
          ),

        runSnapshot:
          runningSnapshot(
            currentGoal
          ),
      });

    assert.equal(
      selection.decision,
      "PLAN"
    );

    assert.equal(
      selection.reasonCode,
      "NEXT_SUCCESS_CRITERION"
    );

    assert.equal(
      selection.target.kind,
      "SUCCESS_CRITERION"
    );

    assert.equal(
      selection.target
        .targetId,
      "criterion-global"
    );
  }
);

test(
  "5.0C stoppe le planning lorsque tous les critères globaux sont MET",
  () => {
    const currentGoal =
      goal({
        successCriteria: [
          {
            criterionId:
              "criterion-global",

            description:
              "Résultat vérifié.",

            type:
              "BOOLEAN",

            targetValue:
              true,

            currentValue:
              true,

            status:
              "MET",

            evidenceRefs: [
              "evidence-1",
            ],
          },
        ],

        milestones: [],
      });

    const selection =
      selectGoalModeNextTarget({
        goalStrategyEngine:
          engine(
            currentGoal
          ),

        runSnapshot:
          runningSnapshot(
            currentGoal
          ),
      });

    assert.equal(
      selection.decision,
      "STOP"
    );

    assert.equal(
      selection.reasonCode,
      "SUCCESS_CRITERIA_MET"
    );

    assert.equal(
      selection.target,
      null
    );

    assert.equal(
      selection
        .proposalRequired,
      false
    );

    const pendingMilestoneGoal =
      goal({
        successCriteria:
          currentGoal
            .successCriteria,
      });

    assert.equal(
      selectGoalModeNextTarget({
        goalStrategyEngine:
          engine(
            pendingMilestoneGoal
          ),
        runSnapshot:
          runningSnapshot(
            pendingMilestoneGoal
          ),
      }).decision,
      "STOP"
    );
  }
);

test(
  "5.0C refuse un Goal stale et un run hors RUNNING",
  () => {
    const currentGoal =
      goal();

    const stale =
      goal({
        version: 6,
      });

    assert.throws(
      () =>
        selectGoalModeNextTarget({
          goalStrategyEngine:
            engine(
              stale
            ),

          runSnapshot:
            runningSnapshot(
              currentGoal
            ),
        }),
      {
        code:
          "GOAL_MODE_NEXT_STEP_GOAL_STALE",
      }
    );

    const snapshot =
      runningSnapshot(
        currentGoal
      );

    const ready =
      createGoalModeRunState({
        contract:
          snapshot.state
            .contract,
      });

    assert.throws(
      () =>
        selectGoalModeNextTarget({
          goalStrategyEngine:
            engine(
              currentGoal
            ),

          runSnapshot: {
            revision: 1,
            state:
              ready,
          },
        }),
      {
        code:
          "GOAL_MODE_NEXT_STEP_RUN_NOT_RUNNING",
      }
    );
  }
);

test(
  "5.0C interdit skill/operation/command/args dans une proposition",
  () => {
    const currentGoal =
      goal();

    const snapshot =
      runningSnapshot(
        currentGoal
      );

    const selection =
      selectGoalModeNextTarget({
        goalStrategyEngine:
          engine(
            currentGoal
          ),

        runSnapshot:
          snapshot,
      });

    assert.throws(
      () =>
        validateGoalModeStepProposal({
          runSnapshot:
            snapshot,

          selection,

          currentGoalVersion:
            5,

          proposal: {
            objective:
              "Faire progresser milestone-1.",

            expectedOutcome:
              "Preuve produite.",

            evidenceTargetIds: [
              "milestone-1",
            ],

            usage: {
              steps: 1,
              retries: 0,
              providerCalls: 0,
              estimatedCost: 0,
            },

            requestedCapabilities: {
              network: false,
              gitWrite: false,
              destructiveActions:
                false,
            },

            requiresUserInput:
              false,

            command:
              "git push",
          },
        }),
      {
        code:
          "GOAL_MODE_NEXT_STEP_FIELD_FORBIDDEN",
      }
    );
  }
);

test(
  "5.0C lie la proposition au run/revision/cible et ne donne aucune autorité",
  () => {
    const currentGoal =
      goal();

    const snapshot =
      runningSnapshot(
        currentGoal
      );

    const selection =
      selectGoalModeNextTarget({
        goalStrategyEngine:
          engine(
            currentGoal
          ),

        runSnapshot:
          snapshot,
      });

    const proposal =
      validateGoalModeStepProposal({
        runSnapshot:
          snapshot,

        selection,

        currentGoalVersion:
          5,

        proposal: {
          objective:
            "Produire une preuve pour la première étape.",

          expectedOutcome:
            "Le milestone dispose d'une preuve vérifiable.",

          evidenceTargetIds: [
            "milestone-1",
            "criterion-m1",
          ],

          usage: {
            steps: 1,
            retries: 0,
            providerCalls: 1,
            estimatedCost: 0.25,
          },

          requestedCapabilities: {
            network: true,
            gitWrite: false,
            destructiveActions:
              false,
          },

          requiresUserInput:
            false,
        },

        now:
          () =>
            new Date(
              "2026-10-12T12:00:02.000Z"
            ),

        idFactory:
          () =>
            "goal-step-proposal-50c",
      });

    assert.equal(
      proposal.proposalId,
      "goal-step-proposal-50c"
    );

    assert.deepEqual(
      proposal.binding,
      {
        runId:
          "goal-run-50c",

        runRevision: 2,

        goalId:
          "goal-50c",

        goalVersion: 5,

        targetKind:
          "MILESTONE",

        targetId:
          "milestone-1",

        targetFingerprint:
          selection
            .targetFingerprint,
      }
    );

    assert.equal(
      proposal.authorization
        .requestRequired,
      true
    );

    assert.equal(
      proposal.authorization
        .executionAuthorized,
      false
    );

    assert.equal(
      proposal.authority
        .proposalOnly,
      true
    );

    assert.equal(
      proposal.authority
        .executionAuthorized,
      false
    );

    assert.match(
      proposal.fingerprint,
      /^sha256:[a-f0-9]{64}$/
    );
  }
);

test(
  "5.0C refuse budget global dépassé avant toute exécution",
  () => {
    const currentGoal =
      goal();

    const snapshot =
      runningSnapshot(
        currentGoal,
        {
          limits: {
            maxSteps: 1,
            maxRetries: 0,
            maxProviderCalls: 0,
            maxDuration:
              60_000,
            maxEstimatedCost: 0,
          },
        }
      );

    snapshot.state =
      {
        ...snapshot.state,

        usage: {
          steps: 1,
          retries: 0,
          providerCalls: 0,
          estimatedCost: 0,
        },
      };

    const selection =
      selectGoalModeNextTarget({
        goalStrategyEngine:
          engine(
            currentGoal
          ),

        runSnapshot:
          snapshot,
      });

    assert.throws(
      () =>
        validateGoalModeStepProposal({
          runSnapshot:
            snapshot,

          selection,

          currentGoalVersion:
            5,

          proposal: {
            objective:
              "Étape supplémentaire.",

            expectedOutcome:
              "Résultat.",

            evidenceTargetIds: [
              "milestone-1",
            ],

            usage: {
              steps: 1,
              retries: 0,
              providerCalls: 0,
              estimatedCost: 0,
            },

            requestedCapabilities: {
              network: false,
              gitWrite: false,
              destructiveActions:
                false,
            },
          },

          now:
            () =>
              new Date(
                "2026-10-12T12:00:02.000Z"
              ),
        }),
      (error) => {
        assert.equal(
          error.code,
          "GOAL_MODE_NEXT_STEP_BUDGET_BLOCKED"
        );

        assert.equal(
          error.details
            ?.assessment
            ?.reasonCode,
          "STEP_LIMIT"
        );

        return true;
      }
    );
  }
);

test(
  "5.0C refuse une capacité hors ceiling",
  () => {
    const currentGoal =
      goal();

    const snapshot =
      runningSnapshot(
        currentGoal,
        {
          capabilityCeilings: {
            network: false,
            gitWrite: false,
            destructiveActions:
              false,
          },
        }
      );

    const selection =
      selectGoalModeNextTarget({
        goalStrategyEngine:
          engine(
            currentGoal
          ),

        runSnapshot:
          snapshot,
      });

    assert.throws(
      () =>
        validateGoalModeStepProposal({
          runSnapshot:
            snapshot,

          selection,

          currentGoalVersion:
            5,

          proposal: {
            objective:
              "Étape réseau.",

            expectedOutcome:
              "Résultat.",

            evidenceTargetIds: [
              "milestone-1",
            ],

            usage: {
              steps: 1,
              retries: 0,
              providerCalls: 1,
              estimatedCost: 0.1,
            },

            requestedCapabilities: {
              network: true,
              gitWrite: false,
              destructiveActions:
                false,
            },
          },

          now:
            () =>
              new Date(
                "2026-10-12T12:00:02.000Z"
              ),
        }),
      {
        code:
          "GOAL_MODE_NEXT_STEP_CAPABILITY_DENIED",
      }
    );
  }
);

test(
  "5.0C refuse une cible de preuve hors scope et une sélection stale",
  () => {
    const currentGoal =
      goal();

    const snapshot =
      runningSnapshot(
        currentGoal
      );

    const selection =
      selectGoalModeNextTarget({
        goalStrategyEngine:
          engine(
            currentGoal
          ),

        runSnapshot:
          snapshot,
      });

    assert.throws(
      () =>
        validateGoalModeStepProposal({
          runSnapshot:
            snapshot,

          selection,

          currentGoalVersion:
            5,

          proposal: {
            objective:
              "Écrire une preuve.",

            expectedOutcome:
              "Preuve.",

            evidenceTargetIds: [
              "criterion-global",
            ],

            usage: {
              steps: 1,
              retries: 0,
              providerCalls: 0,
              estimatedCost: 0,
            },

            requestedCapabilities: {
              network: false,
              gitWrite: false,
              destructiveActions:
                false,
            },
          },
        }),
      {
        code:
          "GOAL_MODE_NEXT_STEP_EVIDENCE_TARGET_OUT_OF_SCOPE",
      }
    );

    assert.throws(
      () =>
        validateGoalModeStepProposal({
          runSnapshot: {
            ...snapshot,

            revision: 3,
          },

          selection,

          currentGoalVersion:
            5,

          proposal: {
            objective:
              "Écrire une preuve.",

            expectedOutcome:
              "Preuve.",

            evidenceTargetIds: [
              "milestone-1",
            ],

            usage: {
              steps: 1,
              retries: 0,
              providerCalls: 0,
              estimatedCost: 0,
            },

            requestedCapabilities: {
              network: false,
              gitWrite: false,
              destructiveActions:
                false,
            },
          },
        }),
      {
        code:
          "GOAL_MODE_NEXT_STEP_SELECTION_STALE",
      }
    );
  }
);

test(
  "5.0C lit le run canonique et recalcule la cible avant validation",
  () => {
    const f =
      directFixture();
    const selection =
      f.planner.select({
        runId:
          "goal-run-50c",
      });

    assert.deepEqual(
      f.reads,
      ["goal-run-50c"]
    );

    assert.throws(
      () =>
        f.planner.select({
          runId:
            "goal-run-50c",
          runSnapshot:
            f.snapshot,
        }),
      {
        code:
          "GOAL_MODE_NEXT_STEP_FIELD_FORBIDDEN",
      }
    );

    assert.throws(
      () =>
        f.planner.select({
          runId: 50,
        }),
      {
        code:
          "GOAL_MODE_NEXT_STEP_INVALID",
      }
    );

    const proposal =
      f.planner.validate({
        runId:
          "goal-run-50c",
        selection,
        proposal:
          validProposal(),
      });

    assert.equal(
      f.reads.length,
      2
    );

    assert.equal(
      proposal.binding
        .targetId,
      "milestone-1"
    );
  }
);

test(
  "5.0C refuse une cible caller auto-cohérente mais non canonique",
  () => {
    const f =
      directFixture();
    const selection =
      f.planner.select({
        runId:
          "goal-run-50c",
      });
    const forged =
      structuredClone(
        selection
      );

    forged.target = {
      ...forged.target,
      evidenceTargetIds: [
        "criterion-global",
      ],
    };
    forged.targetFingerprint =
      testFingerprint(
        forged.target
      );

    // La sélection libre ne peut élargir les preuves,
    // même si ses autres références de run sont correctes.
    assert.throws(
      () =>
        f.planner.validate({
          runId:
            "goal-run-50c",
          selection: forged,
          proposal:
            validProposal({
              evidenceTargetIds: [
                "criterion-global",
              ],
            }),
        }),
      {
        code:
          "GOAL_MODE_NEXT_STEP_SELECTION_STALE",
      }
    );
  }
);

test(
  "5.0C ne saute pas le premier milestone bloqué et SKIPPED ne satisfait pas une dépendance",
  () => {
    for (
      const firstStatus of [
        "BLOCKED",
        "SKIPPED",
      ]
    ) {
      const currentGoal =
        goal();
      currentGoal.milestones =
        currentGoal.milestones
          .map((item) => ({
            ...item,
            status:
              item.milestoneId ===
                "milestone-1"
                ? firstStatus
                : item.status,
          }));

      const f =
        directFixture({
          currentGoal,
        });
      const selected =
        f.planner.select({
          runId:
            "goal-run-50c",
        });

      assert.equal(
        selected.decision,
        "BLOCKED"
      );
    }

    const currentGoal =
      goal();
    currentGoal.milestones = [
      {
        ...currentGoal
          .milestones[0],
        status: "BLOCKED",
      },
      {
        ...currentGoal
          .milestones[1],
        dependencies: [],
      },
    ];

    assert.equal(
      directFixture({
        currentGoal,
      }).planner.select({
        runId:
          "goal-run-50c",
      }).decision,
      "BLOCKED"
    );
  }
);

test(
  "5.0C isole les règles de milestone des exports d'inspection",
  () => {
    assert.deepEqual(
      ACTIONABLE_MILESTONE_STATUSES,
      [
        "NOT_STARTED",
        "IN_PROGRESS",
        "DELAYED",
      ]
    );

    assert.deepEqual(
      TERMINAL_MILESTONE_STATUSES,
      [
        "ACHIEVED",
        "SKIPPED",
      ]
    );

    assert.equal(
      Object.isFrozen(
        ACTIONABLE_MILESTONE_STATUSES
      ),
      true
    );

    assert.equal(
      Object.isFrozen(
        TERMINAL_MILESTONE_STATUSES
      ),
      true
    );

    assert.throws(
      () =>
        ACTIONABLE_MILESTONE_STATUSES.push(
          "BLOCKED"
        ),
      TypeError
    );

    assert.throws(
      () =>
        TERMINAL_MILESTONE_STATUSES.splice(
          0,
          1
        ),
      TypeError
    );

    const blockedGoal =
      goal();

    blockedGoal.milestones =
      blockedGoal.milestones.map(
        (milestone) => ({
          ...milestone,
          status:
            milestone.milestoneId ===
              "milestone-1"
              ? "BLOCKED"
              : milestone.status,
        })
      );

    assert.equal(
      directFixture({
        currentGoal:
          blockedGoal,
      }).planner.select({
        runId:
          "goal-run-50c",
      }).decision,
      "BLOCKED"
    );

    const skippedGoal =
      goal();

    skippedGoal.milestones =
      skippedGoal.milestones.map(
        (milestone) => ({
          ...milestone,
          status:
            milestone.milestoneId ===
              "milestone-1"
              ? "SKIPPED"
              : milestone.status,
        })
      );

    assert.equal(
      directFixture({
        currentGoal:
          skippedGoal,
      }).planner.select({
        runId:
          "goal-run-50c",
      }).decision,
      "BLOCKED"
    );
  }
);

test(
  "5.0C ne déduit aucun succès d'une collection vide ou d'un milestone ACHIEVED",
  () => {
    const emptyGoal =
      goal({
        successCriteria: [],
      });
    const admitted =
      runningSnapshot(
        goal()
      );

    assert.throws(
      () =>
        directFixture({
          currentGoal:
            emptyGoal,
          snapshot:
            admitted,
        }).planner.select({
          runId:
            "goal-run-50c",
        }),
      {
        code:
          "GOAL_MODE_SUCCESS_CRITERIA_REQUIRED",
      }
    );

    const currentGoal =
      goal();
    currentGoal.milestones =
      currentGoal.milestones
        .map((item) => ({
          ...item,
          status: "ACHIEVED",
        }));

    const selection =
      directFixture({
        currentGoal,
      }).planner.select({
        runId:
          "goal-run-50c",
      });

    assert.equal(
      selection.decision,
      "PLAN"
    );
    assert.equal(
      selection.target.kind,
      "SUCCESS_CRITERION"
    );
  }
);
