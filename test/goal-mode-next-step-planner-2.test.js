"use strict";

const assert =
  require("node:assert/strict");
const test =
  require("node:test");

const {
  directFixture,
  goal,
  runningSnapshot,
  validProposal,
} = require("./helpers/goal-mode-next-step-planner-fixtures");

test(
  "5.0C refuse les statuts, références et contenus Goal divergents",
  () => {
    const admitted =
      runningSnapshot(
        goal()
      );
    const variants = [
      goal({
        outcomeDefinition:
          "Résultat divergent.",
      }),
      goal({
        constraints: [{
          constraintId: "c-1",
          strength: "HARD",
          description:
            "Contrainte ajoutée.",
        }],
      }),
      goal({
        successCriteria: [{
          ...goal()
            .successCriteria[0],
          targetValue: false,
        }],
      }),
    ];

    for (const currentGoal of
      variants) {
      assert.throws(
        () =>
          directFixture({
            currentGoal,
            snapshot:
              admitted,
          }).planner.select({
            runId:
              "goal-run-50c",
          }),
        {
          code:
            "GOAL_MODE_NEXT_STEP_GOAL_STALE",
        }
      );
    }

    for (const bad of [
      goal({
        successCriteria: [{
          ...goal()
            .successCriteria[0],
          status: "DONE",
        }],
      }),
      goal({
        milestones: [{
          ...goal().milestones[0],
          status: "DONE",
        }],
      }),
      goal({
        milestones: [{
          ...goal().milestones[0],
          dependencies: [
            "missing",
          ],
        }],
      }),
      goal({
        milestones: [{
          ...goal().milestones[0],
          goalId:
            "another-goal",
        }],
      }),
      goal({
        milestones: [
          {
            ...goal()
              .milestones[0],
            dependencies: [
              "milestone-2",
            ],
          },
          goal()
            .milestones[1],
        ],
      }),
    ]) {
      assert.throws(
        () =>
          directFixture({
            currentGoal: bad,
          }).planner.select({
            runId:
              "goal-run-50c",
          })
      );
    }
  }
);

test(
  "5.0C refuse les propositions mal typées et respecte le budget temps",
  () => {
    const f =
      directFixture();
    const selection =
      f.planner.select({
        runId:
          "goal-run-50c",
      });

    for (const proposal of [
      validProposal({
        usage: {
          ...validProposal()
            .usage,
          estimatedCost: null,
        },
      }),
      validProposal({
        usage: {
          ...validProposal()
            .usage,
          providerCalls:
            Infinity,
        },
      }),
      validProposal({
        requestedCapabilities: {
          ...validProposal()
            .requestedCapabilities,
          network: "false",
        },
      }),
      validProposal({
        requiresUserInput:
          "false",
      }),
      validProposal({
        evidenceTargetIds: [
          "milestone-1",
          "milestone-1",
        ],
      }),
      validProposal({
        evidenceTargetIds:
          Array(1),
      }),
      validProposal({
        evidenceTargetIds:
          Object.assign(
            ["milestone-1"],
            { command: "npm test" }
          ),
      }),
      validProposal({
        requestedCapabilities: {
          network: false,
          gitWrite: false,
        },
      }),
      validProposal({
        requestedCapabilities:
          Object.assign(
            Object.create({
              network: true,
            }),
            {
              gitWrite: false,
              destructiveActions:
                false,
            }
          ),
      }),
      validProposal({
        usage: {
          ...validProposal()
            .usage,
          command: "npm test",
        },
      }),
    ]) {
      assert.throws(
        () =>
          f.planner.validate({
            runId:
              "goal-run-50c",
            selection,
            proposal,
          })
      );
    }

    const expired =
      directFixture({
        now: () =>
          new Date(
            "2026-10-12T12:01:00.000Z"
          ),
      });
    const expiredSelection =
      expired.planner.select({
        runId:
          "goal-run-50c",
      });

    assert.throws(
      () =>
        expired.planner.validate({
          runId:
            "goal-run-50c",
          selection:
            expiredSelection,
          proposal:
            validProposal(),
        }),
      {
        code:
          "GOAL_MODE_NEXT_STEP_BUDGET_BLOCKED",
      }
    );

    const rewound =
      directFixture({
        now: () =>
          new Date(
            "2026-10-12T11:59:59.000Z"
          ),
      });

    assert.throws(
      () =>
        rewound.planner.validate({
          runId:
            "goal-run-50c",
          selection:
            rewound.planner
              .select({
                runId:
                  "goal-run-50c",
              }),
          proposal:
            validProposal(),
        }),
      {
        code:
          "GOAL_MODE_NEXT_STEP_CLOCK_INVALID",
      }
    );
  }
);

test(
  "5.0C ne transforme pas un accounting incomplet en zéro",
  () => {
    const valid =
      directFixture();

    const selection =
      valid.planner.select({
        runId:
          "goal-run-50c",
      });

    for (
      const estimatedCost of [
        undefined,
        null,
      ]
    ) {
      const snapshot =
        structuredClone(
          runningSnapshot(
            goal()
          )
        );

      if (
        estimatedCost ===
        undefined
      ) {
        delete snapshot
          .state.usage
          .estimatedCost;
      } else {
        snapshot.state
          .usage
          .estimatedCost =
          estimatedCost;
      }

      assert.throws(
        () =>
          directFixture({
            snapshot,
          }).planner.select({
            runId:
              "goal-run-50c",
          }),
        {
          code:
            "GOAL_MODE_NEXT_STEP_USAGE_UNKNOWN",
        }
      );

      assert.throws(
        () =>
          directFixture({
            snapshot,
          }).planner.validate({
            runId:
              "goal-run-50c",
            selection,
            proposal:
              validProposal(),
          }),
        {
          code:
            "GOAL_MODE_NEXT_STEP_USAGE_UNKNOWN",
        }
      );
    }
  }
);

test(
  "5.0C applique les plafonds cumulés provider et coût sans réservation",
  () => {
    const snapshot =
      structuredClone(
        runningSnapshot(
          goal()
        )
      );
    snapshot.state.usage = {
      steps: 0,
      retries: 0,
      providerCalls: 3,
      estimatedCost: 1.9,
    };

    const f =
      directFixture({
        snapshot,
      });
    const selection =
      f.planner.select({
        runId:
          "goal-run-50c",
      });
    const before =
      structuredClone(
        snapshot
      );

    for (
      const [proposal,
        reasonCode] of [
        [
          validProposal(),
          "PROVIDER_CALL_LIMIT",
        ],
        [
          validProposal({
            usage: {
              ...validProposal()
                .usage,
              providerCalls: 0,
            },
          }),
          "COST_LIMIT",
        ],
      ]
    ) {
      assert.throws(
        () =>
          f.planner.validate({
            runId:
              "goal-run-50c",
            selection,
            proposal,
          }),
        (error) => {
          assert.equal(
            error.code,
            "GOAL_MODE_NEXT_STEP_BUDGET_BLOCKED"
          );
          assert.equal(
            error.details
              .assessment
              .reasonCode,
            reasonCode
          );
          return true;
        }
      );
    }

    assert.deepEqual(
      snapshot,
      before
    );
  }
);

test(
  "5.0C reste pur et produit un fingerprint stable",
  () => {
    const currentGoal =
      goal();
    const snapshot =
      runningSnapshot(
        currentGoal
      );
    const beforeGoal =
      structuredClone(
        currentGoal
      );
    const beforeRun =
      structuredClone(
        snapshot
      );
    const f =
      directFixture({
        currentGoal,
        snapshot,
      });
    const first =
      f.planner.select({
        runId:
          "goal-run-50c",
      });
    const second =
      f.planner.select({
        runId:
          "goal-run-50c",
      });
    const a =
      f.planner.validate({
        runId:
          "goal-run-50c",
        selection: first,
        proposal:
          validProposal(),
      });
    const reversed =
      Object.fromEntries(
        Object.entries(
          validProposal()
        ).reverse()
      );
    const b =
      f.planner.validate({
        runId:
          "goal-run-50c",
        selection: second,
        proposal: reversed,
      });

    assert.equal(
      first.targetFingerprint,
      second.targetFingerprint
    );
    assert.equal(
      a.fingerprint,
      b.fingerprint
    );
    assert.deepEqual(
      currentGoal,
      beforeGoal
    );
    assert.deepEqual(
      snapshot,
      beforeRun
    );
  }
);
