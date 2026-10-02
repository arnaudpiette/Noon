"use strict";

const test =
  require("node:test");

const assert =
  require("node:assert/strict");

const {
  PHASES,
  STATES,
  createUserProgressEngine,
} = require(
  "../services/observability/user-progress-engine"
);

function engine(
  options = {},
) {
  return createUserProgressEngine({
    now:
      () =>
        Date.parse(
          "2026-10-02T08:00:00.000Z",
        ),
    ...options,
  });
}

test(
  "publie un ProgressEvent user-facing minimal",
  () => {
    const progress =
      engine();

    const result =
      progress.publish({
        executionId:
          "execution-1",
        state:
          STATES.RUNNING,
        phase:
          PHASES.ACTION,
        source:
          "orchestrator",
        progress: 25,
      });

    assert.equal(
      result.emitted,
      true,
    );

    assert.deepEqual(
      result.event,
      {
        version: "1.0",
        eventId:
          "execution-1:1",
        executionId:
          "execution-1",
        stepId: null,
        state: "RUNNING",
        phase: "ACTION",
        label:
          "Exécution en cours",
        progress: 25,
        currentStep: null,
        totalSteps: null,
        source:
          "orchestrator",
        userVisible: true,
        reasonCode: null,
        at:
          "2026-10-02T08:00:00.000Z",
      },
    );
  },
);

test(
  "génère des libellés sans exposer de raisonnement",
  () => {
    const progress =
      engine();

    const cases = [
      [
        STATES.PLANNED,
        PHASES.PLAN,
        "Planifié",
      ],
      [
        STATES.RUNNING,
        PHASES.VALIDATION,
        "Vérification",
      ],
      [
        STATES.WAITING,
        PHASES.APPROVAL,
        "Validation requise",
      ],
      [
        STATES.SUCCEEDED,
        PHASES.VALIDATION,
        "Terminé et vérifié",
      ],
      [
        STATES.FAILED,
        PHASES.VALIDATION,
        "Échec de la vérification",
      ],
    ];

    for (
      const [
        state,
        phase,
        label,
      ] of cases
    ) {
      const result =
        progress.publish({
          executionId:
            `execution-${state}-${phase}`,
          state,
          phase,
          source: "system",
        });

      assert.equal(
        result.event.label,
        label,
      );
    }
  },
);

test(
  "refuse les champs susceptibles d'exposer contenu ou raisonnement interne",
  () => {
    const progress =
      engine();

    for (
      const unsafe of [
        {
          rawPrompt:
            "secret",
        },
        {
          chainOfThought:
            "raisonnement",
        },
        {
          arguments:
            {
              path: "/tmp",
            },
        },
        {
          output:
            "résultat brut",
        },
        {
          accessToken:
            "token",
        },
      ]
    ) {
      assert.throws(
        () =>
          progress.publish({
            executionId:
              "execution-unsafe",
            state:
              STATES.RUNNING,
            phase:
              PHASES.ACTION,
            source:
              "system",
            ...unsafe,
          }),
        {
          code:
            "PROGRESS_UNSAFE_FIELD",
        },
      );
    }
  },
);

test(
  "n'expose que des reason codes bornés",
  () => {
    const progress =
      engine();

    const result =
      progress.publish({
        executionId:
          "execution-reason",
        state:
          STATES.BLOCKED,
        phase:
          PHASES.ACTION,
        source:
          "execution_tracking",
        reasonCode:
          "dependency_waiting",
      });

    assert.equal(
      result.event.reasonCode,
      "DEPENDENCY_WAITING",
    );

    assert.equal(
      Object.hasOwn(
        result.event,
        "error",
      ),
      false,
    );
  },
);

test(
  "borne la progression entre zéro et cent",
  () => {
    const progress =
      engine();

    assert.equal(
      progress.publish({
        executionId: "p1",
        state:
          STATES.RUNNING,
        phase:
          PHASES.ACTION,
        source: "system",
        progress: -10,
      }).event.progress,
      0,
    );

    assert.equal(
      progress.publish({
        executionId: "p2",
        state:
          STATES.RUNNING,
        phase:
          PHASES.ACTION,
        source: "system",
        progress: 140,
      }).event.progress,
      100,
    );
  },
);

test(
  "valide currentStep et totalSteps",
  () => {
    const progress =
      engine();

    const result =
      progress.publish({
        executionId:
          "execution-steps",
        stepId: "step-2",
        state:
          STATES.RUNNING,
        phase:
          PHASES.TOOL,
        source:
          "transactional_execution",
        currentStep: 2,
        totalSteps: 4,
        progress: 50,
      });

    assert.equal(
      result.event.currentStep,
      2,
    );

    assert.equal(
      result.event.totalSteps,
      4,
    );

    assert.throws(
      () =>
        progress.publish({
          executionId:
            "execution-invalid-step",
          state:
            STATES.RUNNING,
          phase:
            PHASES.ACTION,
          source: "system",
          currentStep: 5,
          totalSteps: 4,
        }),
      {
        code:
          "PROGRESS_STEP_RANGE_INVALID",
      },
    );
  },
);

test(
  "déduplique deux événements consécutifs identiques",
  () => {
    const progress =
      engine();

    const input = {
      executionId:
        "execution-dedupe",
      state:
        STATES.RUNNING,
      phase:
        PHASES.VALIDATION,
      source:
        "transactional_execution",
      progress: 70,
    };

    const first =
      progress.publish(input);

    const second =
      progress.publish(input);

    assert.equal(
      first.emitted,
      true,
    );

    assert.equal(
      second.emitted,
      false,
    );

    assert.equal(
      second.event,
      first.event,
    );

    assert.equal(
      progress.list(
        "execution-dedupe",
      ).length,
      1,
    );
  },
);

test(
  "une variation de progression reste visible",
  () => {
    const progress =
      engine();

    progress.publish({
      executionId:
        "execution-progress",
      state:
        STATES.RUNNING,
      phase:
        PHASES.ACTION,
      source:
        "background_job",
      progress: 20,
    });

    const next =
      progress.publish({
        executionId:
          "execution-progress",
      state:
        STATES.RUNNING,
      phase:
        PHASES.ACTION,
      source:
        "background_job",
      progress: 40,
    });

    assert.equal(
      next.emitted,
      true,
    );

    assert.equal(
      progress.list(
        "execution-progress",
      ).length,
      2,
    );
  },
);

test(
  "les abonnés reçoivent uniquement les événements effectivement émis",
  () => {
    const received = [];

    const progress =
      engine();

    const unsubscribe =
      progress.subscribe(
        (event) => {
          received.push(event);
        },
      );

    const input = {
      executionId:
        "execution-subscribe",
      state:
        STATES.RUNNING,
      phase:
        PHASES.ACTION,
      source:
        "dev_agent_loop",
    };

    progress.publish(input);
    progress.publish(input);

    unsubscribe();

    progress.publish({
      ...input,
      progress: 50,
    });

    assert.equal(
      received.length,
      1,
    );
  },
);

test(
  "onEvent permet un futur branchement SSE sans coupler le moteur au serveur",
  () => {
    const emitted = [];

    const progress =
      engine({
        onEvent(event) {
          emitted.push(event);
        },
      });

    progress.publish({
      executionId:
        "execution-sse",
      state:
        STATES.WAITING,
      phase:
        PHASES.APPROVAL,
      source:
        "orchestrator",
    });

    assert.equal(
      emitted.length,
      1,
    );

    assert.equal(
      emitted[0].label,
      "Validation requise",
    );
  },
);

test(
  "conserve un historique borné",
  () => {
    const progress =
      engine({
        historyLimit: 2,
      });

    for (
      const value of [
        10,
        20,
        30,
      ]
    ) {
      progress.publish({
        executionId:
          "execution-history",
        state:
          STATES.RUNNING,
        phase:
          PHASES.ACTION,
        source: "system",
        progress: value,
      });
    }

    assert.deepEqual(
      progress
        .list(
          "execution-history",
        )
        .map(
          (event) =>
            event.progress,
        ),
      [20, 30],
    );
  },
);

test(
  "clear supprime état, historique et séquence d'une exécution",
  () => {
    const progress =
      engine();

    progress.publish({
      executionId:
        "execution-clear",
      state:
        STATES.RUNNING,
      phase:
        PHASES.ACTION,
      source: "system",
    });

    progress.clear(
      "execution-clear",
    );

    assert.equal(
      progress.latest(
        "execution-clear",
      ),
      null,
    );

    assert.equal(
      progress.list(
        "execution-clear",
      ).length,
      0,
    );

    const next =
      progress.publish({
        executionId:
          "execution-clear",
        state:
          STATES.RUNNING,
        phase:
          PHASES.ACTION,
        source: "system",
      });

    assert.equal(
      next.event.eventId,
      "execution-clear:1",
    );
  },
);

test(
  "refuse états, phases et sources inconnus",
  () => {
    const progress =
      engine();

    assert.throws(
      () =>
        progress.publish({
          executionId: "x1",
          state: "THINKING",
          phase:
            PHASES.ACTION,
          source: "system",
        }),
      {
        code:
          "PROGRESS_STATE_INVALID",
      },
    );

    assert.throws(
      () =>
        progress.publish({
          executionId: "x2",
          state:
            STATES.RUNNING,
          phase:
            "CHAIN_OF_THOUGHT",
          source: "system",
        }),
      {
        code:
          "PROGRESS_PHASE_INVALID",
      },
    );

    assert.throws(
      () =>
        progress.publish({
          executionId: "x3",
          state:
            STATES.RUNNING,
          phase:
            PHASES.ACTION,
          source:
            "unknown_engine",
        }),
      {
        code:
          "PROGRESS_SOURCE_INVALID",
      },
    );
  },
);
