"use strict";

const crypto =
  require("node:crypto");

const {
  TERMINAL_STATES,
} = require("./dev-task-journal");

const {
  adaptNativeDevResult,
} = require("./native-dev-result-adapter");

const {
  projectNativeDevEvidence,
} = require("../decision/dev-evidence-adapter");

function createNativeDevOrchestratorFacade({
  orchestrator,
  journal = null,
  featureMode = () =>
    "OFF",
  now = () => Date.now(),
  createTaskId = () =>
    `dev-task-${crypto.randomUUID()}`,
  decisionEvidenceAdapter =
    projectNativeDevEvidence,
} = {}) {
  if (
    typeof orchestrator?.runTask !==
      "function" ||
    typeof orchestrator?.getTaskStatus !==
      "function" ||
    typeof orchestrator?.cancelTask !==
      "function"
  ) {
    throw new TypeError(
      "NativeDevOrchestrator requis."
    );
  }

  if (
    typeof decisionEvidenceAdapter !==
      "function"
  ) {
    throw new TypeError(
      "DevDecisionEvidenceAdapter valide requis."
    );
  }

  if (
    journal !== null &&
    (
      typeof journal?.load !==
        "function" ||
      typeof journal?.interrupted !==
        "function"
    )
  ) {
    throw new TypeError(
      "Journal DEV invalide."
    );
  }

  function adapt(task) {
    return adaptNativeDevResult(
      task,
      { now }
    );
  }

  function featureState(
    input = {}
  ) {
    return String(
      typeof featureMode ===
        "function"
        ? featureMode(input)
        : featureMode
    );
  }

  /*
   * Fin de runTask (succès ou échec) : tout
   * enregistrement encore non terminal passe à un
   * état terminal, y compris un échec ou une
   * annulation pendant l'analyse. Un échec ici ne
   * masque pas le résultat : l'enregistrement reste
   * non terminal et sera signalé par interrupted().
   */
  function finalizeJournal(
    taskId,
    task
  ) {
    if (
      typeof journal?.lookup !==
        "function" ||
      typeof journal?.finish !==
        "function"
    ) {
      return;
    }

    try {
      const found =
        journal.lookup(taskId);

      if (
        found.status !== "PRESENT" ||
        TERMINAL_STATES.has(
          found.record.state
        )
      ) {
        return;
      }

      const verdict =
        task?.status === "CANCELLED"
          ? "CANCELLED"
          : TERMINAL_STATES.has(
            task?.finalVerdict
          )
            ? task.finalVerdict
            : "FAIL";

      journal.finish(
        taskId,
        verdict,
        verdict === "PASS"
          ? null
          : String(
            task?.failureCategory ||
              verdict
          ).slice(0, 100)
      );
    } catch {
      // Laissé non terminal : visible comme interrompu.
    }
  }

  async function runTask(
    input = {}
  ) {
    /*
     * Compatibilité NativeDevCoordinator :
     * le feature gate est évalué avant de démarrer
     * l'orchestration ou d'atteindre le backend.
     */
    if (
      featureState(input) !==
      "LIMITED"
    ) {
      return adapt({
        taskId:
          input.taskId ||
          null,
        status:
          "FAILED",
        finalVerdict:
          "FAIL",
        failureCategory:
          "FEATURE_DISABLED",
        startedAt:
          new Date(now())
            .toISOString(),
        endedAt:
          new Date(now())
            .toISOString(),
        implementation: {
          backendReached:
            false,
        },
      });
    }

    const taskId =
      String(
        input.taskId ||
          createTaskId()
      );

    /*
     * Enregistrement de démarrage synchrone, avant
     * tout await : une tâche lancée est visible dans
     * le journal persistant dès cet instant, y compris
     * après un redémarrage. Échec = aucun lancement.
     */
    if (
      typeof journal?.claim ===
        "function"
    ) {
      try {
        journal.claim(
          taskId,
          {
            source: "B3",
            workspaceId:
              typeof input.workspaceId ===
                "string"
                ? input.workspaceId
                : null,
          }
        );
      } catch (error) {
        return adapt({
          taskId,
          status: "FAILED",
          finalVerdict: "FAIL",
          failureCategory:
            error?.code ===
              "DEV_TASK_ALREADY_EXISTS"
              ? "DEV_TASK_ALREADY_EXISTS"
              : "DEV_TASK_JOURNAL_UNAVAILABLE",
          startedAt:
            new Date(now())
              .toISOString(),
          endedAt:
            new Date(now())
              .toISOString(),
          implementation: {
            backendReached: false,
          },
        });
      }
    }

    try {
      const task =
        await orchestrator.runTask({
          ...input,
          taskId,
        });

      finalizeJournal(
        taskId,
        task
      );

      return adapt(task);
    } catch (error) {
      const task =
        orchestrator.getTaskStatus(
          taskId
        );

      finalizeJournal(
        taskId,
        task ||
          {
            status: "FAILED",
            finalVerdict: "FAIL",
            failureCategory:
              String(
                error?.code ||
                  "DEV_ORCHESTRATION_FAILURE"
              ).slice(0, 100),
          }
      );

      if (task) {
        return adapt(task);
      }

      const failureCategory =
        String(
          error?.code ||
            "DEV_ORCHESTRATION_FAILURE"
        ).slice(0, 100);

      return adapt({
        taskId,
        status:
          "FAILED",
        finalVerdict:
          "FAIL",
        failureCategory,
        startedAt:
          new Date(now())
            .toISOString(),
        endedAt:
          new Date(now())
            .toISOString(),
        implementation: {
          backendReached:
            false,
        },
      });
    }
  }

  function getTaskStatus(
    taskId
  ) {
    const id =
      String(taskId);

    const task =
      orchestrator.getTaskStatus(
        id
      );

    if (task) {
      return adapt(task);
    }

    /*
     * Même fallback que NativeDevCoordinator :
     * après restart, le journal persistant reste lisible.
     */
    try {
      return (
        journal?.load(id) ||
        null
      );
    } catch {
      // Lecture stricte : jamais « inconnu » sur une erreur.
      return {
        taskId: id,
        status: "JOURNAL_UNREADABLE",
        finalVerdict: null,
        failureCategory:
          "JOURNAL_UNREADABLE",
      };
    }
  }

  function projectDecisionEvidence({
    taskId,
    mappings,
    context,
  } = {}) {
    const id =
      String(taskId ?? "")
        .trim();

    if (!id) {
      throw new TypeError(
        "taskId DEV requis pour la projection Decision."
      );
    }

    /*
     * Seul l'état canonique encore détenu par
     * l'orchestrateur peut être projeté.
     *
     * Le journal persistant n'est volontairement
     * pas utilisé ici : une ancienne enveloppe ne
     * doit jamais retrouver rétroactivement une
     * autorité d'attestation.
     */
    const task =
      orchestrator.getTaskStatus(
        id
      );

    if (!task) {
      const error =
        new Error(
          "Preuve Native DEV canonique indisponible."
        );

      error.code =
        "DEV_DECISION_EVIDENCE_UNAVAILABLE";

      throw error;
    }

    return decisionEvidenceAdapter({
      devResult: task,
      mappings,
      context,
    });
  }

  function cancelTask(
    taskId
  ) {
    return orchestrator.cancelTask(
      String(taskId)
    );
  }

  function recoverInterrupted() {
    if (!journal) {
      return [];
    }

    return journal
      .interrupted()
      .map((record) => record?.unreadable === true ? ({
        taskId: null,
        status: "JOURNAL_UNREADABLE",
        finalVerdict: null,
        failureCategory:
          "JOURNAL_UNREADABLE",
        file: record.file,
        requiresUserDecision: true,
      }) : ({
        taskId:
          record.taskId,
        status:
          "INTERRUPTED",
        finalVerdict:
          "PARTIAL",
        failureCategory:
          "PROCESS_RESTARTED",
        requiresUserDecision:
          true,
      }));
  }

  return Object.freeze({
    runTask,
    getTaskStatus,
    projectDecisionEvidence,
    cancelTask,
    recoverInterrupted,
  });
}

module.exports = {
  createNativeDevOrchestratorFacade,
};
