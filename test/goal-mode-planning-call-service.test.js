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
  PLANNER_MAX_CRITERION_TEXT,
  PLANNER_MAX_SUCCESS_CRITERIA,
  SYSTEM_PROMPT,
  candidate,
  createGoalModeNextStepPlanner,
  createGoalModePlanningCallService,
  createGoalModeRunContract,
  createGoalModeRunRepository,
  createGoalModeRunStore,
  createPersonalDatabase,
  fixture,
  goal,
  goalEngine,
  plannerInput,
  stepBudgetPayload,
  successCriteriaPayload,
} = require("./helpers/goal-mode-planning-call-service-fixtures");

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

test("B4a entrée du planner : forme exacte, stepBudget et critères (sans champ supplémentaire)", async () => {
  const f = fixture();
  try {
    const result = await f.service.planOnce({ runId: "goal-run-50d1" });
    assert.equal(result.status, "PROPOSED");
    const input = plannerInput(f);
    assert.deepEqual(Object.keys(input), ["run", "goal", "target", "capabilityCeilings", "globalBudget", "stepBudget"]);
    assert.deepEqual(Object.keys(input.goal), ["title", "outcomeDefinition", "constraints", "successCriteria"]);
    assert.deepEqual(input.goal.successCriteria,
      [{ criterionId: "criterion-global", description: "Le résultat global est vérifié.", status: "NOT_MET" }]);
    assert.deepEqual(input.stepBudget, { maxSteps: 5, stepsUsed: 0, remainingSteps: 5, finalStep: false });
    // Aucune donnée de critère au-delà de l'identifiant, de la description et du statut.
    for (const key of ["evidenceRefs", "targetValue", "currentValue", "type"]) {
      assert.equal(JSON.stringify(input.goal.successCriteria).includes(`"${key}"`), false, key);
    }
  } finally { f.close(); }
});

test("B4a entrée du planner : finalStep vrai quand il ne reste qu'une étape", async () => {
  const f = fixture({
    limits: { maxSteps: 1, maxRetries: 0, maxProviderCalls: 3, maxDuration: 600_000, maxEstimatedCost: 0.5 },
  });
  try {
    await f.service.planOnce({ runId: "goal-run-50d1" });
    assert.deepEqual(plannerInput(f).stepBudget, { maxSteps: 1, stepsUsed: 0, remainingSteps: 1, finalStep: true });
  } finally { f.close(); }
  const snapshot = (maxSteps, steps) => ({ state: { contract: { limits: { maxSteps } }, usage: { steps } } });
  assert.deepEqual({ ...stepBudgetPayload(snapshot(3, 2)) }, { maxSteps: 3, stepsUsed: 2, remainingSteps: 1, finalStep: true });
  assert.deepEqual({ ...stepBudgetPayload(snapshot(3, 1)) }, { maxSteps: 3, stepsUsed: 1, remainingSteps: 2, finalStep: false });
  assert.deepEqual({ ...stepBudgetPayload(snapshot(2, 2)) }, { maxSteps: 2, stepsUsed: 2, remainingSteps: 0, finalStep: false });
  for (const [maxSteps, steps] of [[0, 0], [1.5, 0], [2, -1], [2, "1"]]) {
    assert.throws(() => stepBudgetPayload(snapshot(maxSteps, steps)), { code: "GOAL_MODE_PLANNING_STEP_BUDGET_INVALID" });
  }
});

test("B4a entrée du planner : critères tronqués côté serveur (10 entrées, 300 caractères)", async () => {
  assert.equal(PLANNER_MAX_SUCCESS_CRITERIA, 10);
  assert.equal(PLANNER_MAX_CRITERION_TEXT, 300);
  const long = "é".repeat(150) + "🙂".repeat(200); // 350 caractères (points de code)
  const criteria = Array.from({ length: 12 }, (_, index) => ({
    criterionId: `criterion-${index}`, description: long, type: "BOOLEAN", targetValue: true,
    currentValue: false, status: "NOT_MET", evidenceRefs: ["secret-ref"],
  }));
  const f = fixture({ currentGoal: goal({ successCriteria: criteria }) });
  try {
    await f.service.planOnce({ runId: "goal-run-50d1" });
    const sent = plannerInput(f).goal.successCriteria;
    assert.equal(sent.length, 10);
    assert.deepEqual(sent.map((item) => item.criterionId), criteria.slice(0, 10).map((item) => item.criterionId));
    for (const item of sent) {
      assert.deepEqual(Object.keys(item), ["criterionId", "description", "status"]);
      assert.equal(Array.from(item.description).length, 300);
      assert.equal(item.description, Array.from(long).slice(0, 300).join(""));
    }
    assert.equal(JSON.stringify(sent).includes("secret-ref"), false);
  } finally { f.close(); }
  assert.deepEqual(successCriteriaPayload({ successCriteria: [{ criterionId: 7, description: null }] }),
    [{ criterionId: "", description: "", status: "UNKNOWN" }]);
  assert.deepEqual(successCriteriaPayload({}), []);
});

test("B4a prompt du planner : règle de la dernière étape et des critères de succès", () => {
  assert.match(SYSTEM_PROMPT, /stepBudget\.finalStep est vrai, propose l'étape qui atteint directement la cible/);
  assert.match(SYSTEM_PROMPT, /jamais un diagnostic préalable seul/);
  assert.match(SYSTEM_PROMPT, /successCriteria liste les critères de succès du Goal/);
  // Les règles existantes restent en place.
  assert.match(SYSTEM_PROMPT, /N'utilise aucun outil\. N'exécute rien\./);
  assert.match(SYSTEM_PROMPT, /Produis exactement UNE proposition/);
});
