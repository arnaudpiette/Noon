"use strict";

// V3-L7 — autorisation, exécution transactionnelle des skills et validation du moteur
// d'implémentation Native DEV, sorties telles quelles de native-dev-implementation-engine.js.
// Le moteur les construit avec ses propres dépendances : même politique de sécurité, même
// exécution transactionnelle, même journal.

const crypto = require("node:crypto");
const { observeImplementationValidation } = require("./agents/native-review-validation-agent");

function createNativeDevSkillExecution({
  journal,
  operationalSecurityPolicy,
  skillRegistry,
  transactionalExecutionEngine,
  validationRunner,
}) {
  function authorize(
    contract,
    step,
    actionClass,
    taskId = null
  ) {
    const actionRequest = {
      origin:
        "explicit_user_chat",
      skillId: step.skillId,
      operation:
        actionClass === "WRITE"
          ? "update local file"
          : "read validate local repository",
      args: {
        path:
          contract.repositoryRoot,
      },
      workspaceId:
        contract.workspaceId,
      explicitOrder: true,
      actionClass,
      target: {
        scope: "LOCAL",
        scopeName: "workspace",
        targetType:
          actionClass === "WRITE"
            ? "file"
            : "repository",
        targetCount: 1,
      },
    };

    const benchmarkScope =
      contract.benchmark
        ? {
            authorizedRoots: [
              contract.repositoryRoot,
            ],
            authorizedWriteRoots: [
              contract.repositoryRoot,
            ],
          }
        : {};

    const scopeTelemetry =
      contract.benchmark
        ? {
            benchmark: true,
            sessionId:
              contract.benchmark.id,
            runId: taskId,
            workspaceRoot:
              contract.repositoryRoot,
          }
        : null;

    const decision =
      operationalSecurityPolicy.evaluate(
        {
          actionRequest,
          skillPolicy: {
            level:
              actionClass ===
              "WRITE"
                ? "write"
                : "read",
          },
          currentPermissions: {
            allowed: true,
            code:
              actionClass ===
              "WRITE"
                ? "READ_WRITE_WORKSPACE"
                : "TERMINAL_SAFE",
          },
          ...(scopeTelemetry
            ? {
                scopeTelemetry,
              }
            : {}),
          ...benchmarkScope,
        }
      );

    if (
      ![
        "ALLOW",
        "ALLOW_WITH_CONSTRAINTS",
      ].includes(
        decision.outcome
      )
    ) {
      throw Object.assign(
        new Error(
          "Action DEV refusée par la politique de sécurité."
        ),
        {
          code:
            "PERMISSION_FAILURE",
        }
      );
    }

    return {
      actionRequest,
      decision,
    };
  }

  async function executeSkill(
    contract,
    taskId,
    step,
    actionClass,
    handlers
  ) {
    const {
      actionRequest,
      decision,
    } = authorize(
      contract,
      step,
      actionClass,
      taskId
    );

    const executionId =
      `${taskId}-${step.skillId}-${crypto.randomUUID()}`;

    const outcome =
      await transactionalExecutionEngine.execute(
        {
          executionId,
          workspaceId:
            contract.workspaceId,
          profileScope:
            "arnaud",
          actionRequest,
          policyDecision:
            decision,
          steps: [
            {
              ...step,
              stepId: "step-1",
              actionClass,
              verificationLevel:
                "BASIC",
            },
          ],

          executeStep:
            (
              planned
            ) =>
              skillRegistry.executeSkill(
                planned.skillId,
                planned.args,
                {
                  explicitOrder:
                    true,
                  confirmed: true,
                  allowedRoots:
                    contract.allowedPaths,
                  allowedWriteRoots:
                    contract.allowedPaths,
                  sessionId:
                    taskId,
                  handlers,
                }
              ),

          revalidate: () =>
            authorize(
              contract,
              step,
              actionClass,
              taskId
            ).decision,

          checkPreconditions:
            () => ({
              valid: true,
            }),
        }
      );

    if (
      outcome.status !==
      "SUCCEEDED"
    ) {
      throw Object.assign(
        new Error(
          "Étape transactionnelle DEV incomplète."
        ),
        {
          code:
            `TRANSACTION_${outcome.status}`,
        }
      );
    }

    return outcome.result;
  }

  async function validate(
    contract,
    taskId,
    command,
    iteration,
    signal,
    observation = null
  ) {
    const step = {
      skillId:
        "noon_dev_run_validation",
      operation:
        "validate repository",
      args: {
        command,
        iteration,
      },
    };

    let observedSnapshot = null;

    const result =
      await executeSkill(
        contract,
        taskId,
        step,
        "READ",
        {
          runValidation:
            async () => {
              const runValidation = () => validationRunner(
                command,
                contract.repositoryRoot,
                Math.min(
                  contract.maxDuration,
                  120_000
                ),
                signal,
                {
                  taskId,
                  workspaceId:
                    contract.workspaceId,
                  sessionId:
                    contract.sessionId,
                  permissions:
                    contract.permissions,
                }
              );

              if (observation?.enabled !== true) {
                return runValidation();
              }

              const observed = await observeImplementationValidation({
                contract,
                input: observation.input,
                ordinal: observation.ordinal,
                signal,
                runValidation,
              });
              observedSnapshot = observed.validationSnapshot;
              return observed.validation;
            },
        }
      );

    journal.recordCommand(
      taskId,
      result,
      iteration
    );

    if (observedSnapshot && typeof observation?.record === "function") {
      observation.record(observedSnapshot);
    }

    return result;
  }

  return { authorize, executeSkill, validate };
}

module.exports = { createNativeDevSkillExecution };
