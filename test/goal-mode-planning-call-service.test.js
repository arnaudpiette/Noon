"use strict";

const assert =
  require("node:assert/strict");
const fs =
  require("node:fs");
const os =
  require("node:os");
const path =
  require("node:path");
const test =
  require("node:test");

const {
  createGoalModeRunContract,
} = require(
  "../services/goals/goal-mode-run-contract"
);

const {
  createGoalModeRunStore,
} = require(
  "../services/goals/goal-mode-run-store"
);

const {
  createGoalModeNextStepPlanner,
} = require(
  "../services/goals/goal-mode-next-step-planner"
);

const {
  createGoalModePlanningCallService,
} = require(
  "../services/goals/goal-mode-planning-call-service"
);

const {
  createPersonalDatabase,
} = require(
  "../services/persistence/database"
);

const {
  createGoalModeRunRepository,
} = require(
  "../services/persistence/repositories/goal-mode-run-repository"
);

function goal(
  overrides = {}
) {
  return {
    goalId:
      "goal-50d1",
    title:
      "Goal Mode 5.0D-1",
    status:
      "ACTIVE",
    outcomeDefinition:
      "Atteindre le prochain milestone Goal Mode sans exécution implicite.",
    successCriteria: [
      {
        criterionId:
          "criterion-global",
        description:
          "Le résultat global est vérifié.",
        type:
          "BOOLEAN",
        targetValue:
          true,
        currentValue:
          false,
        status:
          "NOT_MET",
        evidenceRefs: [],
      },
    ],
    milestones: [
      {
        milestoneId:
          "milestone-1",
        goalId:
          "goal-50d1",
        title:
          "Planifier l'étape minimale",
        description:
          "Produire une proposition bornée sans l'exécuter.",
        status:
          "IN_PROGRESS",
        targetDate:
          null,
        dependencies: [],
        linkedProjectIds: [
          "project-noon",
        ],
        completionCriteria: [
          {
            criterionId:
              "criterion-m1",
            description:
              "La proposition est validée.",
            type:
              "BOOLEAN",
            targetValue:
              true,
            currentValue:
              false,
            status:
              "NOT_MET",
            evidenceRefs: [],
          },
        ],
        evidenceRefs: [],
      },
    ],
    linkedProjectIds: [
      "project-noon",
    ],
    linkedWorkspaceIds: [
      "workspace-noon",
    ],
    constraints: [
      {
        constraintId:
          "constraint-safe",
        description:
          "Aucune exécution pendant le planning.",
        strength:
          "HARD",
        source:
          "explicit_user",
        evidenceRefs: [],
      },
    ],
    profileScope:
      "arnaud",
    sensitivity:
      "NORMAL",
    userConfirmed:
      true,
    version: 5,
    ...overrides,
  };
}

function goalEngine(
  currentGoal
) {
  return {
    registry: {
      get(goalId) {
        assert.equal(
          goalId,
          currentGoal.goalId
        );
        return currentGoal;
      },
    },
  };
}

function candidate(
  overrides = {}
) {
  return {
    objective:
      "Produire la preuve minimale pour milestone-1.",
    expectedOutcome:
      "Une preuve vérifiable est disponible.",
    evidenceTargetIds: [
      "milestone-1",
      "criterion-m1",
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
    ...overrides,
  };
}

function fixture({
  currentGoal =
    goal(),
  providerExecute =
    null,
  estimateCost =
    null,
  route =
    null,
  privacy =
    null,
} = {}) {
  const directory =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "noon-50d1-"
      )
    );

  const file =
    path.join(
      directory,
      "goal-run.sqlite"
    );

  const database =
    createPersonalDatabase(
      file
    );

  let timestamp =
    Date.parse(
      "2026-10-12T12:00:02.000Z"
    );

  function now() {
    const value =
      new Date(
        timestamp
      ).toISOString();
    timestamp +=
      1000;
    return value;
  }

  const repository =
    createGoalModeRunRepository(
      database
    );

  const runStore =
    createGoalModeRunStore({
      repository,
      now,
      planningIdFactory:
        () =>
          "planning-50d1",
    });

  const contract =
    createGoalModeRunContract({
      goal:
        currentGoal,
      request: {
        userConfirmed:
          true,
        workspaceId:
          "workspace-noon",
        projectId:
          "project-noon",
        limits: {
          maxSteps: 5,
          maxRetries: 1,
          maxProviderCalls: 5,
          maxDuration:
            600_000,
          maxEstimatedCost: 5,
        },
        capabilityCeilings: {
          network: true,
          gitWrite: false,
          destructiveActions:
            false,
        },
      },
      now:
        () =>
          new Date(
            "2026-10-12T12:00:00.000Z"
          ),
      idFactory:
        () =>
          "goal-run-50d1",
    });

  const created =
    runStore.create(
      contract
    );

  const running =
    runStore.transition(
      contract.runId,
      "RUNNING",
      {
        expectedRevision:
          created.revision,
        transitionedAt:
          "2026-10-12T12:00:01.000Z",
      }
    );

  const engine =
    goalEngine(
      currentGoal
    );

  const planner =
    createGoalModeNextStepPlanner({
      goalStrategyEngine:
        engine,
      runStore,
      now,
      idFactory:
        () =>
          "proposal-50d1",
    });

  const calls = {
    provider: 0,
    privacy: 0,
    route: 0,
    track: 0,
    requests: [],
  };

  const providerAdapter = {
    provider:
      "openai",
    async execute(
      request,
      options
    ) {
      calls.provider +=
        1;
      calls.requests.push({
        request,
        options,
      });

      if (
        providerExecute
      ) {
        return providerExecute(
          request,
          options,
          calls
        );
      }

      return {
        text:
          JSON.stringify(
            candidate()
          ),
        toolCalls: [],
        usage: {
          inputTokens: 100,
          cachedInputTokens: 0,
          outputTokens: 50,
          totalTokens: 150,
        },
        provider:
          "openai",
        model:
          "gpt-5.6-terra",
        latencyMs: 10,
      };
    },
  };

  const service =
    createGoalModePlanningCallService({
      runStore,
      nextStepPlanner:
        planner,
      goalStrategyEngine:
        engine,
      selectModelRoute(
        input
      ) {
        calls.route +=
          1;

        return route ||
          {
            provider:
              "openai",
            model:
              "gpt-5.6-terra",
            effort:
              "medium",
            verbosity:
              "low",
            estimatedCost: {
              status:
                "available",
              total:
                0.2,
            },
            input,
          };
      },
      estimateCost:
        estimateCost ||
        (
          () => ({
            status:
              "available",
            total:
              0.15,
          })
        ),
      authorizePrivacy(
        fragments,
        policy
      ) {
        calls.privacy +=
          1;

        if (
          privacy
        ) {
          return privacy(
            fragments,
            policy,
            calls
          );
        }

        return {
          token:
            "privacy",
        };
      },
      providerAdapter,
      trackUsage() {
        calls.track +=
          1;
      },
      now,
    });

  return {
    calls,
    currentGoal,
    database,
    directory,
    planner,
    runStore,
    running,
    service,
    close() {
      database.close();

      fs.rmSync(
        directory,
        {
          recursive:
            true,
          force:
            true,
        }
      );
    },
  };
}

test(
  "5.0D-1 fait exactement un appel provider sans outil puis valide via 5.0C",
  async () => {
    const f =
      fixture();

    try {
      const result =
        await f.service
          .planOnce({
            runId:
              "goal-run-50d1",
          });

      assert.equal(
        result.status,
        "PROPOSED"
      );

      assert.equal(
        f.calls.provider,
        1
      );

      assert.equal(
        f.calls.route,
        1
      );

      assert.equal(
        f.calls.privacy,
        1
      );

      assert.equal(
        f.calls.track,
        1
      );

      const request =
        f.calls.requests[0]
          .request;

      assert.equal(
        Object.hasOwn(
          request,
          "tools"
        ),
        false
      );

      assert.equal(
        Object.hasOwn(
          request,
          "toolChoice"
        ),
        false
      );

      assert.equal(
        Object.hasOwn(
          request,
          "maxToolCalls"
        ),
        false
      );

      assert.equal(
        request.text
          .format.strict,
        true
      );

      assert.equal(
        request.text
          .format.schema
          .additionalProperties,
        false
      );

      assert.equal(
        result.proposal
          .authority
          .executionAuthorized,
        false
      );

      assert.equal(
        result.authority
          .executionAuthorized,
        false
      );

      const current =
        f.runStore.get(
          "goal-run-50d1"
        );

      assert.equal(
        current.revision,
        5
      );

      assert.equal(
        current.state
          .planningReservations[0]
          .status,
        "RECONCILED"
      );

      assert.equal(
        current.state
          .usage
          .providerCalls,
        1
      );

      assert.equal(
        current.state
          .usage
          .estimatedCost,
        0.15
      );

      assert.equal(
        result.proposal
          .binding
          .runRevision,
        current.revision
      );
    } finally {
      f.close();
    }
  }
);

test(
  "5.0D-1 marque UNKNOWN sans retry si l'appel provider échoue après MAY_HAVE_STARTED",
  async () => {
    const f =
      fixture({
        providerExecute() {
          const error =
            new Error(
              "timeout"
            );
          error.code =
            "TIMEOUT";
          throw error;
        },
      });

    try {
      await assert.rejects(
        () =>
          f.service.planOnce({
            runId:
              "goal-run-50d1",
          }),
        {
          code:
            "GOAL_MODE_PLANNING_CALL_UNKNOWN",
        }
      );

      assert.equal(
        f.calls.provider,
        1
      );

      const current =
        f.runStore.get(
          "goal-run-50d1"
        );

      assert.equal(
        current.state
          .planningReservations[0]
          .status,
        "UNKNOWN"
      );

      assert.equal(
        current.state
          .planningReservations[0]
          .unknownReasonCode,
        "TIMEOUT"
      );

      assert.equal(
        current.state
          .usage
          .providerCalls,
        0
      );

      assert.equal(
        current.state
          .usage
          .estimatedCost,
        0
      );
    } finally {
      f.close();
    }
  }
);

test(
  "5.0D-1 bloque si le coût réel est inconnu et conserve l'observation partielle",
  async () => {
    const f =
      fixture({
        estimateCost() {
          return {
            status:
              "unavailable",
          };
        },
        route: {
          provider:
            "openai",
          model:
            "gpt-5.6-terra",
          effort:
            "medium",
          verbosity:
            "low",
          estimatedCost: {
            status:
              "available",
            total:
              0.2,
          },
        },
      });

    try {
      await assert.rejects(
        () =>
          f.service.planOnce({
            runId:
              "goal-run-50d1",
          }),
        {
          code:
            "GOAL_MODE_PLANNING_USAGE_UNKNOWN",
        }
      );

      assert.equal(
        f.calls.provider,
        1
      );

      const current =
        f.runStore.get(
          "goal-run-50d1"
        );

      const record =
        current.state
          .planningReservations[0];

      assert.equal(
        record.status,
        "UNKNOWN"
      );

      assert.equal(
        record.unknownReasonCode,
        "USAGE_INCOMPLETE"
      );

      assert.equal(
        record.observedProviderCalls,
        1
      );

      assert.equal(
        record.observedCost,
        null
      );
    } finally {
      f.close();
    }
  }
);

test(
  "5.0D-1 comptabilise l'appel avant de refuser un JSON invalide",
  async () => {
    const f =
      fixture({
        providerExecute() {
          return {
            text:
              "{invalid",
            toolCalls: [],
            usage: {
              inputTokens: 50,
              cachedInputTokens: 0,
              outputTokens: 10,
              totalTokens: 60,
            },
            provider:
              "openai",
            model:
              "gpt-5.6-terra",
          };
        },
      });

    try {
      await assert.rejects(
        () =>
          f.service.planOnce({
            runId:
              "goal-run-50d1",
          }),
        {
          code:
            "GOAL_MODE_PLANNING_RESPONSE_INVALID",
        }
      );

      assert.equal(
        f.calls.provider,
        1
      );

      const current =
        f.runStore.get(
          "goal-run-50d1"
        );

      assert.equal(
        current.state
          .planningReservations[0]
          .status,
        "RECONCILED"
      );

      assert.equal(
        current.state
          .usage
          .providerCalls,
        1
      );
    } finally {
      f.close();
    }
  }
);

test(
  "5.0D-1 refuse un tool call provider même si l'usage est connu",
  async () => {
    const f =
      fixture({
        providerExecute() {
          return {
            text:
              JSON.stringify(
                candidate()
              ),
            toolCalls: [
              {
                type:
                  "function_call",
              },
            ],
            usage: {
              inputTokens: 50,
              cachedInputTokens: 0,
              outputTokens: 10,
              totalTokens: 60,
            },
            provider:
              "openai",
            model:
              "gpt-5.6-terra",
          };
        },
      });

    try {
      await assert.rejects(
        () =>
          f.service.planOnce({
            runId:
              "goal-run-50d1",
          }),
        {
          code:
            "GOAL_MODE_PLANNING_RESPONSE_INVALID",
        }
      );

      assert.equal(
        f.calls.provider,
        1
      );

      assert.equal(
        f.runStore
          .get(
            "goal-run-50d1"
          )
          .state
          .planningReservations[0]
          .status,
        "RECONCILED"
      );
    } finally {
      f.close();
    }
  }
);

test(
  "5.0D-1 n'appelle pas le provider pour STOP",
  async () => {
    const f =
      fixture({
        currentGoal:
          goal({
            successCriteria: [
              {
                criterionId:
                  "criterion-global",
                description:
                  "Fini.",
                type:
                  "BOOLEAN",
                targetValue:
                  true,
                currentValue:
                  true,
                status:
                  "MET",
                evidenceRefs: [
                  "proof",
                ],
              },
            ],
          }),
      });

    try {
      const result =
        await f.service
          .planOnce({
            runId:
              "goal-run-50d1",
          });

      assert.equal(
        result.status,
        "STOP"
      );

      assert.equal(
        f.calls.provider,
        0
      );

      assert.equal(
        f.calls.route,
        0
      );

      assert.equal(
        f.runStore
          .get(
            "goal-run-50d1"
          )
          .state
          .planningReservations
          .length,
        0
      );
    } finally {
      f.close();
    }
  }
);

test(
  "5.0D-1 refuse provider différent avant réservation",
  async () => {
    const f =
      fixture({
        route: {
          provider:
            "google_ai",
          model:
            "gemini-3.8-flash",
          estimatedCost: {
            status:
              "available",
            total:
              0.1,
          },
        },
      });

    try {
      await assert.rejects(
        () =>
          f.service.planOnce({
            runId:
              "goal-run-50d1",
          }),
        {
          code:
            "GOAL_MODE_PLANNING_PROVIDER_MISMATCH",
        }
      );

      assert.equal(
        f.calls.provider,
        0
      );

      assert.equal(
        f.runStore
          .get(
            "goal-run-50d1"
          )
          .state
          .planningReservations
          .length,
        0
      );
    } finally {
      f.close();
    }
  }
);

test(
  "5.0D-1 refuse local_only avant route, réservation et provider",
  async () => {
    const localGoal =
      goal({
        sensitivity:
          "LOCAL_ONLY",
      });

    const directory =
      fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "noon-50d1-local-"
        )
      );

    const database =
      createPersonalDatabase(
        path.join(
          directory,
          "run.sqlite"
        )
      );

    try {
      let clock =
        Date.parse(
          "2026-10-12T12:00:02.000Z"
        );

      const now =
        () =>
          new Date(
            clock +=
              1000
          ).toISOString();

      const store =
        createGoalModeRunStore({
          repository:
            createGoalModeRunRepository(
              database
            ),
          now,
          planningIdFactory:
            () =>
              "planning-local",
        });

      const contract =
        createGoalModeRunContract({
          goal:
            localGoal,
          request: {
            userConfirmed:
              true,
            workspaceId:
              "workspace-noon",
            projectId:
              "project-noon",
            localOnly:
              true,
            limits: {
              maxSteps: 2,
              maxRetries: 0,
              maxProviderCalls: 2,
              maxDuration:
                60_000,
              maxEstimatedCost: 1,
            },
            capabilityCeilings: {
              network: false,
              gitWrite: false,
              destructiveActions:
                false,
            },
          },
          now:
            () =>
              new Date(
                "2026-10-12T12:00:00.000Z"
              ),
          idFactory:
            () =>
              "goal-run-local",
        });

      const created =
        store.create(
          contract
        );

      store.transition(
        contract.runId,
        "RUNNING",
        {
          expectedRevision:
            created.revision,
          transitionedAt:
            "2026-10-12T12:00:01.000Z",
        }
      );

      const engine =
        goalEngine(
          localGoal
        );

      const planner =
        createGoalModeNextStepPlanner({
          goalStrategyEngine:
            engine,
          runStore:
            store,
          now,
        });

      let routeCalls =
        0;
      let providerCalls =
        0;

      const service =
        createGoalModePlanningCallService({
          runStore:
            store,
          nextStepPlanner:
            planner,
          goalStrategyEngine:
            engine,
          selectModelRoute() {
            routeCalls +=
              1;
            return {};
          },
          estimateCost() {
            return {
              status:
                "available",
              total: 0,
            };
          },
          authorizePrivacy() {
            throw new Error(
              "must not run"
            );
          },
          providerAdapter: {
            provider:
              "openai",
            async execute() {
              providerCalls +=
                1;
              return {};
            },
          },
          now,
        });

      await assert.rejects(
        () =>
          service.planOnce({
            runId:
              contract.runId,
          }),
        {
          code:
            "GOAL_MODE_PLANNING_LOCAL_ONLY",
        }
      );

      assert.equal(
        routeCalls,
        0
      );

      assert.equal(
        providerCalls,
        0
      );

      assert.equal(
        store.get(
          contract.runId
        ).state
          .planningReservations
          .length,
        0
      );
    } finally {
      database.close();
      fs.rmSync(
        directory,
        {
          recursive:
            true,
          force:
            true,
        }
      );
    }
  }
);

test(
  "5.0D-1 ne retourne pas de proposition si la cible change pendant l'appel",
  async () => {
    const f =
      fixture();

    try {
      let first =
        true;

      const originalSelect =
        f.planner.select.bind(
          f.planner
        );

      const changingPlanner = {
        select(input) {
          const selected =
            originalSelect(
              input
            );

          if (
            first
          ) {
            first =
              false;
            return selected;
          }

          return {
            ...selected,
            targetFingerprint:
              `sha256:${"b".repeat(64)}`,
          };
        },
        validate:
          f.planner.validate.bind(
            f.planner
          ),
      };

      const calls = {
        provider: 0,
      };

      const service =
        createGoalModePlanningCallService({
          runStore:
            f.runStore,
          nextStepPlanner:
            changingPlanner,
          goalStrategyEngine:
            goalEngine(
              f.currentGoal
            ),
          selectModelRoute() {
            return {
              provider:
                "openai",
              model:
                "gpt-5.6-terra",
              estimatedCost: {
                status:
                  "available",
                total:
                  0.2,
              },
            };
          },
          estimateCost() {
            return {
              status:
                "available",
              total:
                0.15,
            };
          },
          authorizePrivacy() {
            return {};
          },
          providerAdapter: {
            provider:
              "openai",
            async execute() {
              calls.provider +=
                1;
              return {
                text:
                  JSON.stringify(
                    candidate()
                  ),
                toolCalls: [],
                usage: {
                  inputTokens: 1,
                  cachedInputTokens: 0,
                  outputTokens: 1,
                  totalTokens: 2,
                },
                provider:
                  "openai",
                model:
                  "gpt-5.6-terra",
              };
            },
          },
          now:
            () =>
              "2026-10-12T12:00:20.000Z",
        });

      await assert.rejects(
        () =>
          service.planOnce({
            runId:
              "goal-run-50d1",
          }),
        {
          code:
            "GOAL_MODE_PLANNING_TARGET_CHANGED",
        }
      );

      assert.equal(
        calls.provider,
        0
      );

      const current =
        f.runStore.get(
          "goal-run-50d1"
        );

      assert.equal(
        current.state
          .planningReservations[0]
          .status,
        "UNKNOWN"
      );
    } finally {
      f.close();
    }
  }
);


test(
  "5.0D-1 refuse un usage provider incomplet au lieu de l'interpréter comme coût zéro",
  async () => {
    const f =
      fixture({
        providerExecute() {
          return {
            text:
              JSON.stringify(
                candidate()
              ),
            toolCalls: [],
            usage: {
              inputTokens: 50,
              outputTokens: 10,
            },
            provider:
              "openai",
            model:
              "gpt-5.6-terra",
          };
        },
      });

    try {
      await assert.rejects(
        () =>
          f.service.planOnce({
            runId:
              "goal-run-50d1",
          }),
        {
          code:
            "GOAL_MODE_PLANNING_USAGE_UNKNOWN",
        }
      );

      assert.equal(
        f.calls.provider,
        1
      );

      const current =
        f.runStore.get(
          "goal-run-50d1"
        );

      const record =
        current.state
          .planningReservations[0];

      assert.equal(
        record.status,
        "UNKNOWN"
      );

      assert.equal(
        record.unknownReasonCode,
        "USAGE_INCOMPLETE"
      );

      assert.equal(
        record.observedProviderCalls,
        1
      );

      assert.equal(
        record.observedCost,
        null
      );

      assert.equal(
        current.state
          .usage
          .providerCalls,
        0
      );
    } finally {
      f.close();
    }
  }
);


test(
  "5.0D-1 refuse la proposition si la cible change vraiment pendant le provider",
  async () => {
    const mutableGoal =
      goal();

    const f =
      fixture({
        currentGoal:
          mutableGoal,

        providerExecute() {
          /*
           * PREPARED + MAY_HAVE_STARTED sont
           * déjà persistés. La cible change
           * réellement pendant l'unique appel.
           */
          mutableGoal
            .milestones[0]
            .title =
            "Cible modifiée pendant le provider";

          return {
            text:
              JSON.stringify(
                candidate()
              ),
            toolCalls: [],
            usage: {
              inputTokens: 20,
              cachedInputTokens: 0,
              outputTokens: 10,
              totalTokens: 30,
            },
            provider:
              "openai",
            model:
              "gpt-5.6-terra",
          };
        },
      });

    try {
      await assert.rejects(
        () =>
          f.service.planOnce({
            runId:
              "goal-run-50d1",
          }),
        (error) => {
          assert.ok(
            [
              "GOAL_MODE_PLANNING_TARGET_CHANGED",
              "GOAL_MODE_NEXT_STEP_GOAL_STALE",
            ].includes(
              error?.code
            )
          );

          return true;
        }
      );

      assert.equal(
        f.calls.provider,
        1
      );

      const current =
        f.runStore.get(
          "goal-run-50d1"
        );

      assert.equal(
        current.state
          .planningReservations[0]
          .status,
        "RECONCILED"
      );

      assert.equal(
        current.state
          .usage
          .providerCalls,
        1
      );

      assert.equal(
        current.state
          .usage
          .estimatedCost,
        0.15
      );
    } finally {
      f.close();
    }
  }
);
