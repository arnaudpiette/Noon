"use strict";

const assert =
  require("node:assert/strict");

const test =
  require("node:test");

const {
  DEFAULT_TERMINAL_EXECUTION_PROFILE,
  resolveTerminalExecutionProfile,
  terminalExecutionProfileMarker,
} =
  require(
    "../services/dev/terminal-execution-profile"
  );

const {
  createNativeDevReasoner,
} =
  require(
    "../services/dev/native-dev-reasoner"
  );

test(
  "le profil terminal global est AUTONOMOUS par défaut",
  () => {
    const result =
      resolveTerminalExecutionProfile(
        []
      );

    assert.equal(
      DEFAULT_TERMINAL_EXECUTION_PROFILE,
      "AUTONOMOUS"
    );

    assert.equal(
      result.profile,
      "AUTONOMOUS"
    );

    assert.equal(
      result.source,
      "GLOBAL_DEFAULT"
    );

    assert.match(
      result.projectInstructions[0],
      /autonome|AUTONOMOUS/i
    );

    assert.match(
      result.projectInstructions[0],
      /git add \./i
    );

    assert.match(
      result.projectInstructions[0],
      /push/i
    );
  }
);

test(
  "une règle projet surcharge le profil et le marqueur n'est pas transmis comme instruction",
  () => {
    const result =
      resolveTerminalExecutionProfile([
        terminalExecutionProfileMarker(
          "STEP_BY_STEP"
        ),
        "Préserver les tests existants.",
      ]);

    assert.equal(
      result.profile,
      "STEP_BY_STEP"
    );

    assert.equal(
      result.source,
      "PROJECT"
    );

    assert.equal(
      result.projectInstructions.some(
        (item) =>
          item.includes(
            "NOON_TERMINAL_PROFILE"
          )
      ),
      false
    );

    assert.equal(
      result.projectInstructions.includes(
        "Préserver les tests existants."
      ),
      true
    );
  }
);

test(
  "NativeDevReasoner transmet le profil terminal effectif au payload structuré",
  async () => {
    let captured =
      null;

    const reasoner =
      createNativeDevReasoner({
        executeStructured:
          async (
            request
          ) => {
            captured =
              request.payload;

            return {
              result: {
                summary:
                  "fixture",

                files: [],

                searchTerms:
                  [],

                operations:
                  [],

                validationCommands:
                  [],
              },

              metadata:
                null,
            };
          },
      });

    await reasoner.reason({
      phase:
        "PLAN",

      contract: {
        taskId:
          "terminal-profile-test",

        objective:
          "Vérifier le profil",

        workspaceId:
          "workspace-a",

        repositoryRoot:
          "/tmp/repo",

        allowedPaths: [
          "/tmp/repo",
        ],

        constraints:
          [],

        projectInstructions: [
          "[NOON_TERMINAL_PROFILE:STANDARD]",
          "Conserver la structure.",
        ],
      },

      preflight:
        {},
    });

    assert.equal(
      captured
        .terminalExecutionProfile,
      "STANDARD"
    );

    assert.equal(
      captured
        .projectInstructions
        .some(
          (item) =>
            item.includes(
              "NOON_TERMINAL_PROFILE"
            )
        ),
      false
    );

    assert.match(
      captured
        .projectInstructions[0],
      /STANDARD/
    );
  }
);
