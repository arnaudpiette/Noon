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
  createPersonalDatabase,
  SCHEMA_VERSION,
} = require(
  "../services/persistence/database"
);

const {
  createGoalStrategyRepository,
} = require(
  "../services/persistence/repositories/goal-strategy-repository"
);

const {
  createGoalRegistry,
  createGoalStrategyEngine,
} = require("../services/goals");

function open(filePath) {
  const database =
    createPersonalDatabase(
      filePath
    );

  const repository =
    createGoalStrategyRepository(
      database
    );

  const registry =
    createGoalRegistry({
      repository,
    });

  const engine =
    createGoalStrategyEngine({
      registry,
      projectProvider:
        () => [],
      workspaceProvider:
        () => [],
      now:
        () =>
          new Date(
            "2026-10-07T08:00:00.000Z"
          ),
    });

  return {
    database,
    repository,
    registry,
    engine,
  };
}

test(
  "la persistence Goal survit à une réouverture SQLite",
  () => {
    const root =
      fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "noon-goals-"
        )
      );

    const filePath =
      path.join(
        root,
        "personal.sqlite"
      );

    try {
      let runtime =
        open(filePath);

      const candidate =
        runtime.engine.proposeGoal({
          title:
            "Apprendre durablement",
          outcomeDefinition:
            "Conserver le candidat",
          profileScope:
            "arnaud",
        });

      const first =
        runtime.engine.createGoal({
          title:
            "Objectif persistant",
          outcomeDefinition:
            "Survivre au redémarrage de Noon",
          category:
            "SYSTEM",
          profileScope:
            "arnaud",
        });

      const second =
        runtime.engine.createGoal({
          title:
            "Objectif lié",
          outcomeDefinition:
            "Tester les relations persistantes",
          category:
            "SYSTEM",
          profileScope:
            "arnaud",
        });

      runtime.engine.updateGoal(
        first.goalId,
        {
          description:
            "Version deux persistée",
        }
      );

      const strategy =
        runtime.engine.versionStrategy(
          first.goalId,
          {
            title:
              "Stratégie persistante",
            chosenApproach:
              "Utiliser SQLite",
          },
          {
            userConfirmed: true,
          }
        );

      const relation =
        runtime.engine.relation(
          first.goalId,
          second.goalId,
          "SUPPORTS",
          {
            userConfirmed: true,
          }
        );

      const review =
        runtime.engine.reviewGoal(
          first.goalId,
          {
            strategyFit: "FIT",
          }
        );

      runtime.database.close();

      runtime = open(filePath);

      const restored =
        runtime.registry.get(
          first.goalId
        );

      assert.equal(
        restored.description,
        "Version deux persistée"
      );

      assert.equal(
        restored.version,
        3
      );

      assert.equal(
        runtime.registry.history(
          first.goalId
        ).length,
        2
      );

      assert.equal(
        runtime.registry
          .getCandidate(
            candidate.candidateId
          )
          .status,
        "PENDING_CONFIRMATION"
      );

      assert.equal(
        runtime.registry
          .strategyHistory(
            first.goalId
          )
          .at(-1)
          .strategyId,
        strategy.strategyId
      );

      assert.ok(
        runtime.registry
          .relationList()
          .some(
            (item) =>
              item.relationId ===
              relation.relationId
          )
      );

      assert.equal(
        runtime.registry
          .reviewHistory(
            first.goalId
          )
          .at(-1)
          .reviewId,
        review.reviewId
      );

      assert.equal(
        runtime.registry.list({
          profileScope: "arnaud",
        }).length,
        2
      );

      const migration =
        runtime.database.database
          .prepare(
            "SELECT version FROM schema_migrations WHERE version=?"
          )
          .get(SCHEMA_VERSION);

      assert.equal(
        migration.version,
        SCHEMA_VERSION
      );

      runtime.database.close();
    } finally {
      fs.rmSync(
        root,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);

test(
  "un GoalCandidate confirmé disparaît durablement",
  () => {
    const root =
      fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "noon-goal-candidate-"
        )
      );

    const filePath =
      path.join(
        root,
        "personal.sqlite"
      );

    try {
      let runtime =
        open(filePath);

      const candidate =
        runtime.engine.proposeGoal({
          title:
            "Candidat",
          outcomeDefinition:
            "Être confirmé",
        });

      const confirmed =
        runtime.engine.confirmCandidate(
          candidate.candidateId,
          {
            category:
              "SYSTEM",
          }
        );

      runtime.database.close();

      runtime = open(filePath);

      assert.equal(
        runtime.registry.getCandidate(
          candidate.candidateId
        ),
        null
      );

      assert.equal(
        runtime.registry.get(
          confirmed.goalId
        ).status,
        "ACTIVE"
      );

      runtime.database.close();
    } finally {
      fs.rmSync(
        root,
        {
          recursive: true,
          force: true,
        }
      );
    }
  }
);
