"use strict";

// Shared setup for test/goal-dev-retry-chain-persistence*.test.js (moved verbatim from test/goal-dev-retry-chain-persistence.test.js, V3-L7).

const fs =
  require("node:fs");

const os =
  require("node:os");

const path =
  require("node:path");

const {
  createPersonalDatabase,
} = require(
  "../../services/persistence/database"
);

const {
  createGoalDevRetryChainRepository,
} = require(
  "../../services/persistence/repositories/goal-dev-retry-chain-repository"
);

const {
  createGoalDevRetryExecutionTemplate,
} = require(
  "../../services/goals/goal-dev-retry-execution-template"
);

const {
  createGoalDevRetryChainStore,
} = require(
  "../../services/goals/goal-dev-retry-chain-store"
);

function tempDatabase() {
  const directory =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "noon-goal-retry-chain-"
      )
    );

  const filePath =
    path.join(
      directory,
      "personal-intelligence.sqlite"
    );

  return {
    directory,
    filePath,
  };
}

function open(
  filePath,
  now =
    () =>
      "2026-10-11T08:00:00.000Z"
) {
  const database =
    createPersonalDatabase(
      filePath
    );

  const repository =
    createGoalDevRetryChainRepository(
      database
    );

  const store =
    createGoalDevRetryChainStore({
      repository,
      now,
    });

  return {
    database,
    repository,
    store,
  };
}

function createChain(
  store
) {
  return store.create({
    chainId:
      "chain-persist-1",

    goalRef: {
      goalId: "goal-1",
      goalVersion: 4,
      workspaceId:
        "workspace-1",
      projectId:
        "project-1",
    },

    rootTaskId:
      "task-root",

    executionTemplate:
      createGoalDevRetryExecutionTemplate({
        objective:
          "Corriger les validations du projet.",

        requiredQuality:
          "HIGH",

        allowedPaths: [
          "/repo/src",
          "/repo/test",
        ],

        forbiddenPaths: [
          "/repo/.env",
        ],

        constraints: [
          "Préserver les changements existants",
        ],

        validationCommands: [
          "npm test",
        ],

        maxIterations: 3,
        maxDuration: 60_000,
        maxEstimatedCost: 3,
        localOnly: true,
      }),

    limits: {
      maxRetries: 2,
      maxDuration:
        60_000,
      maxEstimatedCost: 3,
    },

    createdAt:
      "2026-10-11T08:00:00.000Z",
  });
}

function readyCandidate(
  store,
  taskId = "task-retry-1"
) {
  const created = createChain(store);

  const recorded =
    store.recordAttempt(
      "chain-persist-1",
      {
        expectedRevision: created.revision,
        taskId: "task-root",
        finalVerdict: "FAIL",
        continuationState:
          "RETRY_CANDIDATE",
        estimatedCost: 0.5,
        recordedAt:
          "2026-10-11T08:00:10.000Z",
      }
    );

  const candidate =
    store.projectCandidate(
      "chain-persist-1",
      {
        now:
          "2026-10-11T08:00:20.000Z",
        taskId,
      }
    );

  return {
    candidate,
    expectedRevision:
      recorded.revision,
  };
}

module.exports = {
  createChain,
  createGoalDevRetryChainRepository,
  createGoalDevRetryChainStore,
  createGoalDevRetryExecutionTemplate,
  open,
  readyCandidate,
  tempDatabase,
};
