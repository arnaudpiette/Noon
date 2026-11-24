"use strict";

const { spawn } = require("node:child_process");

const {
  classifyDevCommand,
} = require("../delegation/dev-command-policy");

const {
  redactSecrets,
} = require("./redaction");

const {
  SANDBOX_LEVELS,
  RESULT_STATUSES,
  OS_CAPABILITIES,
  MAX_LIMITS,
  DEFAULT_LIMITS,
  CONTRACT_KEYS,
  BUILD_INPUT_KEYS,
  DevProcessRunnerError,
  fail,
  clean,
  assertKnownKeys,
  sha256,
  canonicalExistingRoot,
  resolveExecutableFromPath,
  minimalEnvironment,
  normalizedLimits,
  normalizedCapabilities,
  normalizedAuthority,
  deepFreeze,
} = require("./dev-process-sandbox-primitives");

function createSandboxExecutionContractV1(
  input = {},
  {
    now = () => Date.now(),
    resolveExecutable =
      resolveExecutableFromPath,
    environment = process.env,
  } = {}
) {
  assertKnownKeys(
    input,
    BUILD_INPUT_KEYS,
    "SANDBOX_CONTRACT_INVALID"
  );

  const executionId =
    clean(
      input.executionId,
      200
    );

  const workspaceId =
    clean(
      input.workspaceId,
      180
    );

  const workspaceSessionId =
    clean(
      input.workspaceSessionId,
      200
    );

  const command =
    String(
      input.command || ""
    ).trim();

  if (
    !executionId ||
    !workspaceId ||
    !workspaceSessionId ||
    !command
  ) {
    fail(
      "SANDBOX_CONTRACT_INVALID",
      "Contexte Sandbox incomplet."
    );
  }

  const decision =
    classifyDevCommand(
      command
    );

  if (
    decision.allowed !== true ||
    !Array.isArray(
      decision.execution
    ) ||
    typeof
      decision.execution[0] !==
      "string" ||
    !Array.isArray(
      decision.execution[1]
    )
  ) {
    fail(
      decision.reasonCode ||
        "COMMAND_NOT_ALLOWLISTED",
      "Commande DEV non autorisée."
    );
  }

  const root =
    canonicalExistingRoot(
      input
        .canonicalWorkspaceRoot
    );

  const executableIdentity =
    resolveExecutable(
      decision.execution[0],
      environment
    );

  const currentTime =
    Number(now());

  if (
    !Number.isFinite(
      currentTime
    )
  ) {
    fail(
      "SANDBOX_CLOCK_INVALID",
      "Horloge Sandbox invalide."
    );
  }

  const limits =
    normalizedLimits(
      input.limits || {}
    );

  const createdAt =
    input.createdAt
      ? new Date(
          input.createdAt
        ).toISOString()
      : new Date(
          currentTime
        ).toISOString();

  const defaultExpiry =
    currentTime +
    Math.max(
      5 * 60_000,
      limits.wallTimeMs +
        2 *
          limits
            .terminateGraceMs +
        60_000
    );

  const expiresAt =
    input.expiresAt
      ? new Date(
          input.expiresAt
        ).toISOString()
      : new Date(
          defaultExpiry
        ).toISOString();

  if (
    !Number.isFinite(
      Date.parse(createdAt)
    ) ||
    !Number.isFinite(
      Date.parse(expiresAt)
    ) ||
    Date.parse(expiresAt) <=
      Date.parse(createdAt)
  ) {
    fail(
      "SANDBOX_CONTRACT_INVALID",
      "Temporalité Sandbox invalide."
    );
  }

  const requiredCapabilities =
    normalizedCapabilities(
      input.requiredCapabilities ||
        {}
    );

  const verifiedCapabilities =
    Object.fromEntries(
      OS_CAPABILITIES.map(
        (key) => [
          key,
          false,
        ]
      )
    );

  const contract = {
    version: 1,

    executionId,

    owner: "NOON",

    purpose:
      "DEV_VALIDATION",

    workspaceId,

    workspaceSessionId,

    canonicalWorkspaceRoot:
      root,

    commandProfileId:
      clean(
        decision.reasonCode ||
          decision.classification ||
          "DEV_COMMAND",
        120
      ),

    canonicalCommand:
      command,

    commandFingerprint:
      sha256(command),

    executableIdentity,

    argv: [
      ...decision.execution[1],
    ],

    environmentProfileId:
      "DEV_VALIDATION_MINIMAL_V1",

    limits,

    requiredCapabilities,

    authority:
      normalizedAuthority(
        input.authority || {}
      ),

    isolation: {
      level:
        SANDBOX_LEVELS
          .APPLICATION_CONSTRAINED,

      backendId: null,

      verifiedCapabilities,
    },

    createdAt,

    expiresAt,
  };

  return deepFreeze(
    contract
  );
}

function appendBounded(
  current,
  chunk,
  limit
) {
  const incoming =
    Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(
          String(chunk)
        );

  const combined =
    Buffer.concat([
      current.buffer,
      incoming,
    ]);

  if (
    combined.length <= limit
  ) {
    return {
      buffer: combined,
      truncated:
        current.truncated,
    };
  }

  return {
    buffer:
      combined.subarray(
        combined.length -
          limit
      ),

    truncated: true,
  };
}

function publicIsolation(
  contract
) {
  return {
    level:
      contract.isolation.level,

    backendId:
      contract.isolation
        .backendId,

    verifiedCapabilities: {
      ...contract.isolation
        .verifiedCapabilities,
    },
  };
}

function isThenable(
  value
) {
  return Boolean(
    value &&
    (
      typeof value === "object" ||
      typeof value === "function"
    ) &&
    typeof value.then === "function"
  );
}

function createDevProcessRunner({
  spawnProcess = spawn,
  now = () => Date.now(),
  environment = process.env,
  resolveExecutable =
    resolveExecutableFromPath,
  resolveContext,
  revalidate,
  observability = null,
} = {}) {
  if (
    typeof spawnProcess !==
    "function"
  ) {
    throw new TypeError(
      "spawn injectable requis."
    );
  }

  if (
    typeof resolveContext !==
    "function"
  ) {
    throw new TypeError(
      "Résolveur Workspace requis."
    );
  }

  if (
    typeof revalidate !==
    "function"
  ) {
    throw new TypeError(
      "Revalidation Sandbox requise."
    );
  }

  const emit = (
    event,
    metadata
  ) => {
    try {
      observability?.(
        event,
        metadata
      );
    } catch {}
  };

  function validateContract(
    contract
  ) {
    assertKnownKeys(
      contract,
      CONTRACT_KEYS,
      "SANDBOX_CONTRACT_INVALID"
    );

    if (
      contract.version !== 1 ||
      contract.owner !==
        "NOON" ||
      contract.purpose !==
        "DEV_VALIDATION"
    ) {
      fail(
        "SANDBOX_CONTRACT_INVALID",
        "Contrat Sandbox incompatible."
      );
    }

    if (
      Date.parse(
        contract.expiresAt
      ) <= now()
    ) {
      fail(
        "SANDBOX_CONTRACT_EXPIRED",
        "Contrat Sandbox expiré."
      );
    }

    normalizedLimits(
      contract.limits
    );

    normalizedCapabilities(
      contract
        .requiredCapabilities
    );

    if (
      contract.isolation
        ?.level !==
      SANDBOX_LEVELS
        .APPLICATION_CONSTRAINED
    ) {
      fail(
        "SANDBOX_ISOLATION_INVALID",
        "Niveau Sandbox non démontré."
      );
    }

    for (
      const capability of
      OS_CAPABILITIES
    ) {
      if (
        contract
          .requiredCapabilities[
          capability
        ] === true &&
        contract.isolation
          .verifiedCapabilities?.[
          capability
        ] !== true
      ) {
        fail(
          "SANDBOX_CAPABILITY_UNAVAILABLE",
          "Capacité OS Sandbox indisponible."
        );
      }
    }
  }

  function normalizedResult({
    contract,
    status,
    reasonCode = null,
    exitCode = null,
    signal = null,
    startedAt,
    stdout,
    stderr,
    cleanupConfirmed,
  }) {
    const stdoutText =
      redactSecrets(
        stdout.buffer
          .toString("utf8")
      );

    const stderrText =
      redactSecrets(
        stderr.buffer
          .toString("utf8")
      );

    const outputTail =
      `${stdoutText}\n${stderrText}`
        .trim()
        .slice(-4000);

    return {
      executionId:
        contract.executionId,

      status,

      reasonCode,

      exitCode:
        Number.isInteger(
          exitCode
        )
          ? exitCode
          : null,

      signal:
        signal || null,

      durationMs:
        Math.max(
          0,
          now() - startedAt
        ),

      stdoutTail:
        stdoutText.slice(
          -4000
        ),

      stderrTail:
        stderrText.slice(
          -4000
        ),

      outputTail,

      stdoutTruncated:
        stdout.truncated,

      stderrTruncated:
        stderr.truncated,

      outputTruncated:
        stdout.truncated ||
        stderr.truncated,

      cleanupConfirmed:
        cleanupConfirmed === true,

      isolation:
        publicIsolation(
          contract
        ),
    };
  }

  async function run(
    contract,
    options = {}
  ) {
    const optionKeys =
      Object.keys(options)
        .filter(
          (key) =>
            ![
              "signal",
              "onOutput",
              "onSpawn",
            ].includes(key)
        );

    if (optionKeys.length) {
      fail(
        "SANDBOX_RUN_OPTIONS_INVALID",
        "Option Sandbox inconnue."
      );
    }

    validateContract(
      contract
    );

    const decision =
      classifyDevCommand(
        contract.canonicalCommand
      );

    if (
      decision.allowed !== true ||
      !Array.isArray(
        decision.execution
      )
    ) {
      fail(
        "SANDBOX_COMMAND_STALE",
        "Profil de commande devenu invalide."
      );
    }

    const currentExecutable =
      resolveExecutable(
        decision.execution[0],
        environment
      );

    if (
      currentExecutable !==
        contract
          .executableIdentity ||
      JSON.stringify(
        decision.execution[1]
      ) !==
        JSON.stringify(
          contract.argv
        )
    ) {
      fail(
        "SANDBOX_EXECUTABLE_MISMATCH",
        "Identité de commande modifiée."
      );
    }

    let context;

    try {
      const resolvedContext =
        resolveContext({
          workspaceId:
            contract.workspaceId,

          workspaceSessionId:
            contract
              .workspaceSessionId,

          canonicalWorkspaceRoot:
            contract
              .canonicalWorkspaceRoot,
        });

      context =
        isThenable(
          resolvedContext
        )
          ? await resolvedContext
          : resolvedContext;
    } catch {
      fail(
        "SANDBOX_CONTEXT_UNAVAILABLE",
        "Contexte Workspace indisponible."
      );
    }

    if (
      !context ||
      clean(
        context.workspaceId,
        180
      ) !==
        contract.workspaceId ||
      clean(
        context.workspaceSessionId,
        200
      ) !==
        contract
          .workspaceSessionId
    ) {
      fail(
        "SANDBOX_CONTEXT_STALE",
        "Contexte Workspace obsolète."
      );
    }

    const currentRoot =
      canonicalExistingRoot(
        context
          .canonicalWorkspaceRoot
      );

    if (
      currentRoot !==
      contract
        .canonicalWorkspaceRoot
    ) {
      fail(
        "SANDBOX_CONTEXT_STALE",
        "Racine Workspace modifiée."
      );
    }

    let revalidation;

    try {
      const resolvedRevalidation =
        revalidate({
          contract,
          context,
          commandDecision:
            decision,
        });

      revalidation =
        isThenable(
          resolvedRevalidation
        )
          ? await resolvedRevalidation
          : resolvedRevalidation;
    } catch {
      fail(
        "SANDBOX_REVALIDATION_FAILED",
        "Revalidation Sandbox indisponible."
      );
    }

    if (
      !revalidation ||
      revalidation.allowed !==
        true
    ) {
      fail(
        "SANDBOX_REVALIDATION_DENIED",
        "Lancement refusé par l'autorité existante."
      );
    }

    const startedAt =
      now();

    const emptyStream =
      () => ({
        buffer:
          Buffer.alloc(0),
        truncated: false,
      });

    let stdout =
      emptyStream();

    let stderr =
      emptyStream();

    if (
      options.signal?.aborted
    ) {
      const result =
        normalizedResult({
          contract,
          status:
            RESULT_STATUSES
              .CANCELLED,
          reasonCode:
            "CANCELLED_BEFORE_SPAWN",
          startedAt,
          stdout,
          stderr,
          cleanupConfirmed: true,
        });

      emit(
        "dev_process_runner.completed",
        {
          executionId:
            result.executionId,
          status:
            result.status,
          reasonCode:
            result.reasonCode,
          durationMs:
            result.durationMs,
          outputTruncated:
            result.outputTruncated,
          isolationLevel:
            result.isolation.level,
        }
      );

      return result;
    }

    const childEnvironment =
      minimalEnvironment(
        environment
      );

    let child;

    try {
      child =
        spawnProcess(
          contract
            .executableIdentity,
          [...contract.argv],
          {
            cwd:
              contract
                .canonicalWorkspaceRoot,

            env:
              childEnvironment,

            stdio: [
              "ignore",
              "pipe",
              "pipe",
            ],

            detached: false,
            shell: false,
          }
        );
    } catch {
      const result =
        normalizedResult({
          contract,
          status:
            RESULT_STATUSES.FAIL,
          reasonCode:
            "SPAWN_FAILED",
          startedAt,
          stdout,
          stderr,
          cleanupConfirmed: true,
        });

      emit(
        "dev_process_runner.completed",
        {
          executionId:
            result.executionId,
          status:
            result.status,
          reasonCode:
            result.reasonCode,
          durationMs:
            result.durationMs,
          outputTruncated: false,
          isolationLevel:
            result.isolation.level,
        }
      );

      return result;
    }

    try {
      options.onSpawn?.({
        pid:
          Number.isInteger(
            child?.pid
          )
            ? child.pid
            : null,
      });
    } catch {}

    emit(
      "dev_process_runner.started",
      {
        executionId:
          contract.executionId,
        isolationLevel:
          contract.isolation.level,
      }
    );

    return await new Promise(
      (resolve) => {
        let finalized = false;
        let stopKind = null;
        let stopReason = null;
        let wallTimer = null;
        let graceTimer = null;
        let hardTimer = null;

        const signal =
          options.signal || null;

        const cleanupListeners =
          () => {
            if (wallTimer) {
              clearTimeout(
                wallTimer
              );
            }

            if (graceTimer) {
              clearTimeout(
                graceTimer
              );
            }

            if (hardTimer) {
              clearTimeout(
                hardTimer
              );
            }

            signal?.removeEventListener?.(
              "abort",
              onAbort
            );
          };

        const finish = (
          status,
          {
            reasonCode = null,
            exitCode = null,
            processSignal = null,
            cleanupConfirmed = true,
          } = {}
        ) => {
          if (finalized) {
            return;
          }

          finalized = true;

          cleanupListeners();

          const result =
            normalizedResult({
              contract,
              status,
              reasonCode,
              exitCode,
              signal:
                processSignal,
              startedAt,
              stdout,
              stderr,
              cleanupConfirmed,
            });

          emit(
            "dev_process_runner.completed",
            {
              executionId:
                result.executionId,
              status:
                result.status,
              reasonCode:
                result.reasonCode,
              durationMs:
                result.durationMs,
              exitCode:
                result.exitCode,
              outputTruncated:
                result.outputTruncated,
              cleanupConfirmed:
                result.cleanupConfirmed,
              isolationLevel:
                result.isolation.level,
            }
          );

          resolve(result);
        };

        const requestStop = (
          kind,
          reasonCode
        ) => {
          if (
            finalized ||
            stopKind
          ) {
            return;
          }

          stopKind = kind;
          stopReason =
            reasonCode;

          try {
            child.kill?.(
              "SIGTERM"
            );
          } catch {}

          graceTimer =
            setTimeout(
              () => {
                if (finalized) {
                  return;
                }

                try {
                  child.kill?.(
                    "SIGKILL"
                  );
                } catch {}

                hardTimer =
                  setTimeout(
                    () => {
                      finish(
                        RESULT_STATUSES
                          .CLEANUP_UNCONFIRMED,
                        {
                          reasonCode:
                            "PROCESS_CLOSE_NOT_OBSERVED",
                          cleanupConfirmed:
                            false,
                        }
                      );
                    },
                    contract
                      .limits
                      .terminateGraceMs
                  );
              },
              contract
                .limits
                .terminateGraceMs
            );
        };

        function onAbort() {
          requestStop(
            RESULT_STATUSES
              .CANCELLED,
            "CANCELLED"
          );
        }

        signal?.addEventListener?.(
          "abort",
          onAbort,
          {
            once: true,
          }
        );

        const onOutput =
          (
            type,
            chunk
          ) => {
            const safe =
              redactSecrets(
                Buffer.isBuffer(
                  chunk
                )
                  ? chunk.toString(
                      "utf8"
                    )
                  : String(
                      chunk || ""
                    )
              );

            if (!safe) {
              return;
            }

            if (
              type ===
              "stdout"
            ) {
              stdout =
                appendBounded(
                  stdout,
                  safe,
                  contract
                    .limits
                    .stdoutBytes
                );
            } else {
              stderr =
                appendBounded(
                  stderr,
                  safe,
                  contract
                    .limits
                    .stderrBytes
                );
            }

            try {
              options.onOutput?.({
                type,
                text:
                  safe.slice(
                    0,
                    16_000
                  ),
              });
            } catch {}
          };

        child.stdout?.on?.(
          "data",
          (chunk) =>
            onOutput(
              "stdout",
              chunk
            )
        );

        child.stderr?.on?.(
          "data",
          (chunk) =>
            onOutput(
              "stderr",
              chunk
            )
        );

        child.once?.(
          "error",
          (error) => {
            if (finalized) {
              return;
            }

            if (!child.pid) {
              finish(
                RESULT_STATUSES
                  .FAIL,
                {
                  reasonCode:
                    "SPAWN_FAILED",
                  cleanupConfirmed:
                    true,
                }
              );

              return;
            }

            requestStop(
              RESULT_STATUSES.FAIL,
              clean(
                error?.code,
                80
              ) ||
                "PROCESS_ERROR"
            );
          }
        );

        child.once?.(
          "close",
          (
            code,
            processSignal
          ) => {
            if (finalized) {
              return;
            }

            if (
              stopKind ===
              RESULT_STATUSES
                .TIMEOUT
            ) {
              finish(
                RESULT_STATUSES
                  .TIMEOUT,
                {
                  reasonCode:
                    stopReason ||
                    "TIMEOUT",
                  exitCode: code,
                  processSignal,
                  cleanupConfirmed:
                    true,
                }
              );

              return;
            }

            if (
              stopKind ===
              RESULT_STATUSES
                .CANCELLED
            ) {
              finish(
                RESULT_STATUSES
                  .CANCELLED,
                {
                  reasonCode:
                    stopReason ||
                    "CANCELLED",
                  exitCode: code,
                  processSignal,
                  cleanupConfirmed:
                    true,
                }
              );

              return;
            }

            if (
              stopKind ===
              RESULT_STATUSES.FAIL
            ) {
              finish(
                RESULT_STATUSES
                  .FAIL,
                {
                  reasonCode:
                    stopReason ||
                    "PROCESS_ERROR",
                  exitCode: code,
                  processSignal,
                  cleanupConfirmed:
                    true,
                }
              );

              return;
            }

            finish(
              code === 0
                ? RESULT_STATUSES
                    .PASS
                : RESULT_STATUSES
                    .FAIL,
              {
                reasonCode:
                  code === 0
                    ? null
                    : "PROCESS_EXIT_NON_ZERO",

                exitCode: code,
                processSignal,
                cleanupConfirmed:
                  true,
              }
            );
          }
        );

        wallTimer =
          setTimeout(
            () =>
              requestStop(
                RESULT_STATUSES
                  .TIMEOUT,
                "TIMEOUT"
              ),
            contract
              .limits
              .wallTimeMs
          );
      }
    );
  }

  return {
    run,

    isolationLevel:
      SANDBOX_LEVELS
        .APPLICATION_CONSTRAINED,

    verifiedCapabilities:
      Object.freeze(
        Object.fromEntries(
          OS_CAPABILITIES.map(
            (key) => [
              key,
              false,
            ]
          )
        )
      ),
  };
}

module.exports = {
  DEFAULT_LIMITS,
  MAX_LIMITS,
  OS_CAPABILITIES,
  RESULT_STATUSES,
  SANDBOX_LEVELS,
  DevProcessRunnerError,
  createDevProcessRunner,
  createSandboxExecutionContractV1,
  minimalEnvironment,
  resolveExecutableFromPath,
};
