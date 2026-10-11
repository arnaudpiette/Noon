"use strict";

const assert =
  require("node:assert/strict");

const test =
  require("node:test");

const {
  assertGoalDevRetryExecutionTemplate,
  createGoalDevRetryExecutionTemplate,
} = require(
  "../services/goals/goal-dev-retry-execution-template"
);

function input(
  overrides = {}
) {
  return {
    taskId:
      "task-root",

    sessionId:
      "session-1",

    objective:
      "Corriger les validations du projet.",

    requiredQuality:
      "HIGH",

    workspaceAuthorized:
      true,

    workspaceRoots: [
      "/workspace",
    ],

    repositoryRoot:
      "/workspace/repo",

    branch:
      "v2/multi-provider",

    allowedPaths: [
      "/workspace/repo/src",
      "/workspace/repo/test",
    ],

    forbiddenPaths: [
      "/workspace/repo/.env",
    ],

    constraints: [
      "Préserver les changements existants",
    ],

    projectInstructions: [
      "Instruction serveur fraîche",
    ],

    validationCommands: [
      "npm test",
    ],

    permissions: [
      "READ_WRITE_WORKSPACE",
      "TERMINAL_SAFE",
    ],

    maxIterations: 3,
    maxDuration: 60_000,
    maxEstimatedCost: 2,
    enforceTaskBudget: true,
    localOnly: true,

    benchmark: {
      id: "bench-1",
      limitUsd: 10,
    },

    ...overrides,
  };
}

test(
  "4.6E construit un template allowlisté sans autorité dynamique",
  () => {
    const template =
      createGoalDevRetryExecutionTemplate(
        input()
      );

    assert.equal(
      template.version,
      "goal-dev-retry-execution-template-v1"
    );

    assert.match(
      template.fingerprint,
      /^sha256:[a-f0-9]{64}$/
    );

    assert.equal(
      template.request.objective,
      "Corriger les validations du projet."
    );

    assert.equal(
      template.request
        .requiredQuality,
      "HIGH"
    );

    for (
      const forbidden of [
        "taskId",
        "sessionId",
        "workspaceAuthorized",
        "workspaceRoots",
        "repositoryRoot",
        "permissions",
        "projectInstructions",
        "enforceTaskBudget",
        "benchmark",
      ]
    ) {
      assert.equal(
        Object.prototype
          .hasOwnProperty
          .call(
            template.request,
            forbidden
          ),
        false,
        forbidden
      );
    }

    assert.equal(
      template.authority
        .retryAuthorized,
      false
    );

    assert.equal(
      template.authority
        .executionAuthorized,
      false
    );

    assert.equal(
      Object.isFrozen(
        template
      ),
      true
    );

    assert.equal(
      Object.isFrozen(
        template.request
      ),
      true
    );
  }
);

test(
  "4.6E le fingerprint lie objectif scope validations contraintes et limites",
  () => {
    const base =
      createGoalDevRetryExecutionTemplate(
        input()
      );

    const variants = [
      input({
        objective:
          "Autre objectif",
      }),

      input({
        allowedPaths: [
          "/workspace/repo/src",
        ],
      }),

      input({
        constraints: [
          "Autre contrainte",
        ],
      }),

      input({
        validationCommands: [
          "npm run build",
        ],
      }),

      input({
        maxIterations: 2,
      }),

      input({
        localOnly: false,
      }),
    ];

    for (
      const variant of variants
    ) {
      const template =
        createGoalDevRetryExecutionTemplate(
          variant
        );

      assert.notEqual(
        template.fingerprint,
        base.fingerprint
      );
    }
  }
);

test(
  "4.6E projectInstructions et permissions ne changent jamais le fingerprint",
  () => {
    const first =
      createGoalDevRetryExecutionTemplate(
        input({
          projectInstructions: [
            "Règle A",
          ],

          permissions: [
            "READ_ONLY",
          ],
        })
      );

    const second =
      createGoalDevRetryExecutionTemplate(
        input({
          projectInstructions: [
            "Règle B",
          ],

          permissions: [
            "READ_WRITE_WORKSPACE",
            "TERMINAL_SAFE",
          ],
        })
      );

    assert.equal(
      first.fingerprint,
      second.fingerprint
    );
  }
);

test(
  "4.6E allowNetwork false peut réduire mais true n'est pas persisté comme autorité",
  () => {
    const denied =
      createGoalDevRetryExecutionTemplate(
        input({
          allowNetwork: false,
        })
      );

    assert.equal(
      denied.request
        .allowNetwork,
      false
    );

    const allowed =
      createGoalDevRetryExecutionTemplate(
        input({
          allowNetwork: true,
        })
      );

    assert.equal(
      Object.prototype
        .hasOwnProperty
        .call(
          allowed.request,
          "allowNetwork"
        ),
      false
    );
  }
);

test(
  "4.6E une altération du contenu sans nouveau fingerprint est refusée",
  () => {
    const template =
      createGoalDevRetryExecutionTemplate(
        input()
      );

    const tampered =
      structuredClone(
        template
      );

    tampered.request.objective =
      "Nouvel objectif injecté";

    assert.throws(
      () =>
        assertGoalDevRetryExecutionTemplate(
          tampered
        ),
      {
        code:
          "GOAL_DEV_RETRY_TEMPLATE_FINGERPRINT_INVALID",
      }
    );
  }
);

test(
  "4.6E un template ne peut porter aucune autorité retry",
  () => {
    const template =
      structuredClone(
        createGoalDevRetryExecutionTemplate(
          input()
        )
      );

    template.authority
      .executionAuthorized =
      true;

    assert.throws(
      () =>
        assertGoalDevRetryExecutionTemplate(
          template
        ),
      {
        code:
          "GOAL_DEV_RETRY_TEMPLATE_AUTHORITY_INVALID",
      }
    );
  }
);
