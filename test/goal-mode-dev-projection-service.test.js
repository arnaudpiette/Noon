"use strict";

const assert =
  require("node:assert/strict");
const fs =
  require("node:fs");
const os =
  require("node:os");
const path =
  require("node:path");
const {
  execFileSync,
} = require(
  "node:child_process"
);
const test =
  require("node:test");

const {
  createGoalModeDevProjectionService,
} = require(
  "../services/goals/goal-mode-dev-projection-service"
);

function goal(
  overrides = {}
) {
  return {
    goalId:
      "goal-50d4b",
    title:
      "Projection DEV",
    description: "",
    status:
      "ACTIVE",
    horizon:
      "SHORT_TERM",
    category:
      "PROJECT",
    outcomeDefinition:
      "Projeter une étape Goal Mode vers Native DEV.",
    successCriteria: [],
    milestones: [],
    linkedProjectIds: [
      "project-noon",
    ],
    linkedWorkspaceIds: [
      "workspace-noon",
    ],
    strategyRef: null,
    constraints: [],
    progress: {
      status:
        "IN_PROGRESS",
      value: null,
      method:
        "UNKNOWN",
      confidence: 0,
      measuredAt: null,
      evidenceRefs: [],
    },
    confidence: 1,
    targetDate: null,
    reviewCadence: null,
    importance: null,
    profileScope:
      "arnaud",
    sensitivity:
      "NORMAL",
    createdAt:
      "2026-10-13T00:00:00.000Z",
    updatedAt:
      "2026-10-13T00:00:00.000Z",
    source:
      "explicit_user",
    userConfirmed:
      true,
    version: 7,
    qualityWarnings: [],
    ...overrides,
  };
}

function fixture({
  proposalOverrides = {},
  contractOverrides = {},
  workspaceOverrides = {},
  priorProviderCalls = 0,
  devRemaining = 99,
  admissionDecision =
    "ADMIT",
} = {}) {
  const root =
    fs.realpathSync(
      fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "noon-50d4b-"
        )
      )
    );

  execFileSync(
    "git",
    [
      "init",
      "-q",
      "-b",
      "main",
      root,
    ]
  );

  const proposal = {
    version:
      "goal-mode-step-proposal-v1",
    proposalId:
      "proposal-50d4b",
    fingerprint:
      "sha256:" +
      "a".repeat(64),
    objective:
      "Implémenter uniquement le changement DEV ciblé.",
    expectedOutcome:
      "Le changement est implémenté et validé.",
    evidenceTargetIds: [
      "milestone-1",
    ],
    usage: {
      steps: 1,
      retries: 0,
      providerCalls: 2,
      estimatedCost: 0.5,
    },
    requestedCapabilities: {
      network: true,
      gitWrite: false,
      destructiveActions:
        false,
    },
    requiresUserInput:
      false,
    ...proposalOverrides,
  };

  const state = {
    runId:
      "goal-run-50d4b",
    status:
      "RUNNING",
    contract: {
      goalRef: {
        goalId:
          "goal-50d4b",
        goalVersion: 7,
      },
      scope: {
        profileScope:
          "arnaud",
        workspaceId:
          "workspace-noon",
        projectId:
          "project-noon",
      },
      limits: {
        maxSteps: 4,
        maxRetries: 1,
        maxProviderCalls: 4,
        maxDuration:
          600_000,
        maxEstimatedCost: 2,
      },
      localOnly: false,
      admittedAt:
        "2026-10-13T00:00:00.000Z",
      ...contractOverrides,
    },
    usage: {
      steps: 0,
      retries: 0,
      providerCalls: 1,
      estimatedCost: 0.2,
    },
  };

  const record = {
    stepId:
      "goal-step-50d4b",
    proposal,
    planningRef: {
      targetKind:
        "MILESTONE",
      targetId:
        "milestone-1",
      targetFingerprint:
        "sha256:" +
        "b".repeat(64),
    },
  };

  const admission = {
    decision:
      admissionDecision,
    runRef: {
      runId:
        "goal-run-50d4b",
      runRevision: 5,
      goalId:
        "goal-50d4b",
      goalVersion: 7,
    },
    stepRef: {
      stepId:
        "goal-step-50d4b",
      proposalId:
        "proposal-50d4b",
      proposalFingerprint:
        proposal.fingerprint,
      targetKind:
        "MILESTONE",
      targetId:
        "milestone-1",
      targetFingerprint:
        record.planningRef
          .targetFingerprint,
    },
    capabilityAdmission: {
      externalAuthorizationRequired:
        true,
    },
  };

  let projectorCalls = 0;

  const service =
    createGoalModeDevProjectionService({
      runStore: {
        get(runId) {
          assert.equal(
            runId,
            "goal-run-50d4b"
          );

          return {
            revision: 5,
            state:
              structuredClone(
                state
              ),
          };
        },
      },

      stepProposalStore: {
        get(stepId) {
          assert.equal(
            stepId,
            "goal-step-50d4b"
          );

          return structuredClone(
            record
          );
        },
      },

      stepAdmissionService: {
        admit(input) {
          assert.deepEqual(
            input,
            {
              runId:
                "goal-run-50d4b",
              stepId:
                "goal-step-50d4b",
            }
          );

          return structuredClone(
            admission
          );
        },
      },

      goalStrategyEngine: {
        registry: {
          get(goalId) {
            assert.equal(
              goalId,
              "goal-50d4b"
            );

            return goal();
          },
        },
      },

      workspaceEngine: {
        context(workspaceId) {
          assert.equal(
            workspaceId,
            "workspace-noon"
          );

          return {
            workspace: {
              id:
                "workspace-noon",
              status:
                "active",
              profileScope:
                "arnaud",
            },

            projects: [
              {
                id:
                  "project-noon",
                rootPath:
                  root,
              },
            ],

            relevantRoots: [
              {
                path:
                  root,
                mode:
                  "read-write",
              },
            ],

            ...workspaceOverrides,
          };
        },
      },

      devBudgetService: {
        effectiveRemaining(
          taskId,
          requested
        ) {
          assert.ok(
            taskId.startsWith(
              "goal-mode-dev-"
            )
          );

          return Math.min(
            requested,
            devRemaining
          );
        },

        taskProviderCalls(
          taskId
        ) {
          assert.ok(
            taskId.startsWith(
              "goal-mode-dev-"
            )
          );

          return priorProviderCalls;
        },
      },

      contractProjector(input) {
        projectorCalls += 1;

        const {
          projectGoalDevExecution,
        } = require(
          "../services/goals/goal-dev-execution-contract"
        );

        return projectGoalDevExecution(
          input
        );
      },

      now:
        () =>
          new Date(
            "2026-10-13T00:00:10.000Z"
          ),
    });

  return {
    root,
    service,
    state,
    proposal,
    projectorCalls:
      () =>
        projectorCalls,

    cleanup() {
      fs.rmSync(
        root,
        {
          recursive: true,
          force: true,
        }
      );
    },
  };
}

test(
  "5.0D-4B projette exactement vers Native DEV sans exécuter",
  () => {
    const f =
      fixture();

    try {
      const result =
        f.service.project({
          runId:
            "goal-run-50d4b",
          stepId:
            "goal-step-50d4b",
        });

      assert.equal(
        result.version,
        "goal-mode-dev-projection-v1"
      );

      assert.equal(
        result.taskRef
          .repositoryRoot,
        f.root
      );

      assert.equal(
        result.taskRef.branch,
        "main"
      );

      assert.equal(
        result.devContract
          .devInput
          .maxProviderCalls,
        2
      );

      assert.equal(
        result.devContract
          .devInput
          .maxEstimatedCost,
        0.5
      );

      assert.equal(
        result.devContract
          .devInput
          .maxDuration,
        590_000
      );

      assert.equal(
        result.accounting
          .globalAvailableBefore
          .providerCalls,
        3
      );

      assert.equal(
        result.accounting
          .stepUpperBound
          .providerCalls,
        2
      );

      assert.equal(
        result.accounting
          .consumed,
        false
      );

      assert.equal(
        result.authority
          .executionAuthorized,
        false
      );

      assert.equal(
        result.authorization
          .approvalPrepared,
        false
      );

      assert.equal(
        result.securityBoundary
          .goalLevelActionRequestSynthesized,
        false
      );

      assert.equal(
        result.securityBoundary
          .nativeDevOwnsOperationalActions,
        true
      );

      assert.equal(
        f.projectorCalls(),
        1
      );
    } finally {
      f.cleanup();
    }
  }
);

test(
  "5.0D-4B utilise la quota d'étape et jamais le plafond global brut",
  () => {
    const f =
      fixture({
        proposalOverrides: {
          usage: {
            steps: 1,
            retries: 0,
            providerCalls: 1,
            estimatedCost: 0.25,
          },
        },
      });

    try {
      const result =
        f.service.project({
          runId:
            "goal-run-50d4b",
          stepId:
            "goal-step-50d4b",
        });

      assert.equal(
        result.devContract
          .devInput
          .maxProviderCalls,
        1
      );

      assert.equal(
        result.accounting
          .globalAvailableBefore
          .providerCalls,
        3
      );
    } finally {
      f.cleanup();
    }
  }
);

test(
  "5.0D-4B refuse une proposition exigeant une entrée utilisateur",
  () => {
    const f =
      fixture({
        admissionDecision:
          "REQUIRE_USER_INPUT",
      });

    try {
      assert.throws(
        () =>
          f.service.project({
            runId:
              "goal-run-50d4b",
            stepId:
              "goal-step-50d4b",
          }),
        {
          code:
            "GOAL_MODE_DEV_USER_INPUT_REQUIRED",
        }
      );

      assert.equal(
        f.projectorCalls(),
        0
      );
    } finally {
      f.cleanup();
    }
  }
);

test(
  "5.0D-4B refuse root non read-write et projet ambigu avant le projector",
  () => {
    const rootBlocked =
      fixture({
        workspaceOverrides: {
          relevantRoots: [
            {
              path:
                "/tmp",
              mode:
                "read-only",
            },
          ],
        },
      });

    try {
      assert.throws(
        () =>
          rootBlocked
            .service
            .project({
              runId:
                "goal-run-50d4b",
              stepId:
                "goal-step-50d4b",
            }),
        {
          code:
            "GOAL_MODE_DEV_ROOT_NOT_AUTHORIZED",
        }
      );
    } finally {
      rootBlocked.cleanup();
    }

    const ambiguous =
      fixture({
        workspaceOverrides: {
          projects: [
            {
              id:
                "project-noon",
              rootPath:
                "/tmp/a",
            },
            {
              id:
                "project-noon",
              rootPath:
                "/tmp/b",
            },
          ],
        },
      });

    try {
      assert.throws(
        () =>
          ambiguous
            .service
            .project({
              runId:
                "goal-run-50d4b",
              stepId:
                "goal-step-50d4b",
            }),
        {
          code:
            "GOAL_MODE_DEV_PROJECT_UNRESOLVED",
        }
      );
    } finally {
      ambiguous.cleanup();
    }
  }
);

test(
  "5.0D-4B refuse local_only et capacités DEV non supportées",
  () => {
    const local =
      fixture({
        contractOverrides: {
          localOnly: true,
        },
      });

    try {
      assert.throws(
        () =>
          local.service.project({
            runId:
              "goal-run-50d4b",
            stepId:
              "goal-step-50d4b",
          }),
        {
          code:
            "GOAL_MODE_DEV_REMOTE_REASONING_BLOCKED",
        }
      );
    } finally {
      local.cleanup();
    }

    for (
      const capability of [
        "gitWrite",
        "destructiveActions",
      ]
    ) {
      const requested =
        fixture({
          proposalOverrides: {
            requestedCapabilities: {
              network: true,
              gitWrite:
                capability ===
                  "gitWrite",
              destructiveActions:
                capability ===
                  "destructiveActions",
            },
          },
        });

      try {
        assert.throws(
          () =>
            requested
              .service
              .project({
                runId:
                  "goal-run-50d4b",
                stepId:
                  "goal-step-50d4b",
              }),
          {
            code:
              "GOAL_MODE_DEV_CAPABILITY_UNSUPPORTED",
          }
        );
      } finally {
        requested.cleanup();
      }
    }
  }
);

test(
  "5.0D-4B refuse zéro provider, zéro coût et budget global stale",
  () => {
    for (
      const scenario of [
        {
          proposalOverrides: {
            usage: {
              steps: 1,
              retries: 0,
              providerCalls: 0,
              estimatedCost: 0.5,
            },
          },
          code:
            "GOAL_MODE_DEV_PROVIDER_BUDGET_REQUIRED",
        },
        {
          proposalOverrides: {
            usage: {
              steps: 1,
              retries: 0,
              providerCalls: 1,
              estimatedCost: 0,
            },
          },
          code:
            "GOAL_MODE_DEV_COST_BUDGET_REQUIRED",
        },
        {
          proposalOverrides: {
            usage: {
              steps: 1,
              retries: 0,
              providerCalls: 4,
              estimatedCost: 0.5,
            },
          },
          code:
            "GOAL_MODE_DEV_PROVIDER_BUDGET_STALE",
        },
      ]
    ) {
      const f =
        fixture(
          scenario
        );

      try {
        assert.throws(
          () =>
            f.service.project({
              runId:
                "goal-run-50d4b",
              stepId:
                "goal-step-50d4b",
            }),
          {
            code:
              scenario.code,
          }
        );
      } finally {
        f.cleanup();
      }
    }
  }
);

test(
  "5.0D-4B refuse un replay si le taskId a déjà consommé un appel DEV",
  () => {
    const f =
      fixture({
        priorProviderCalls: 1,
      });

    try {
      assert.throws(
        () =>
          f.service.project({
            runId:
              "goal-run-50d4b",
            stepId:
              "goal-step-50d4b",
          }),
        {
          code:
            "GOAL_MODE_DEV_RECOVERY_REQUIRED",
        }
      );

      assert.equal(
        f.projectorCalls(),
        0
      );
    } finally {
      f.cleanup();
    }
  }
);

test(
  "5.0D-4B applique le budget DEV secondaire sans élargir la proposition",
  () => {
    const f =
      fixture({
        devRemaining:
          0.3,
      });

    try {
      const result =
        f.service.project({
          runId:
            "goal-run-50d4b",
          stepId:
            "goal-step-50d4b",
        });

      assert.equal(
        result.accounting
          .stepUpperBound
          .estimatedCost,
        0.5
      );

      assert.equal(
        result.devContract
          .devInput
          .maxEstimatedCost,
        0.3
      );

      assert.equal(
        result.accounting
          .devSecondaryCostCap,
        0.3
      );
    } finally {
      f.cleanup();
    }
  }
);

test(
  "5.0D-4B produit un taskId déterministe sans muter run, step ou Goal",
  () => {
    const f =
      fixture();

    try {
      const beforeState =
        structuredClone(
          f.state
        );

      const beforeProposal =
        structuredClone(
          f.proposal
        );

      const first =
        f.service.project({
          runId:
            "goal-run-50d4b",
          stepId:
            "goal-step-50d4b",
        });

      const second =
        f.service.project({
          runId:
            "goal-run-50d4b",
          stepId:
            "goal-step-50d4b",
        });

      assert.equal(
        first.taskRef.taskId,
        second.taskRef.taskId
      );

      assert.deepEqual(
        f.state,
        beforeState
      );

      assert.deepEqual(
        f.proposal,
        beforeProposal
      );
    } finally {
      f.cleanup();
    }
  }
);
