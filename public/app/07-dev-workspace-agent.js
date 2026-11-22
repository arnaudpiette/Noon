// DEV_WORKSPACE_AGENT_UI_START
let devWorkspaceAgentExecutionId = null;
let devNativeExecutionId = null;
let devAgentExecutionKind = null;
let devWorkspaceAgentSerial = 0;

function setDevWorkspaceAgentActive(
  active
) {
  const isActive =
    active === true;

  devWorkspaceAgentRun.dataset.active =
    String(isActive);

  devWorkspaceAgentRun.setAttribute(
    "aria-pressed",
    String(isActive)
  );

  devWorkspaceAgentRun.setAttribute(
    "aria-label",
    isActive
      ? "Noon actif"
      : "Lancer Noon"
  );

  devWorkspaceAgentRun.title =
    isActive
      ? "Noon actif"
      : "Lancer Noon";
}

function clearDevWorkspaceAgent() {
  devWorkspaceAgentSerial += 1;
  devWorkspaceAgentExecutionId = null;
  devNativeExecutionId = null;
  devAgentExecutionKind = null;

  setDevWorkspaceAgentActive(
    false
  );

  devWorkspaceAgentState.textContent = "Noon prêt";
  devWorkspaceAgentState.dataset.state = "idle";
  devWorkspaceAgentRun.disabled = false;
  devWorkspaceAgentCancel.disabled = true;
}

function renderDevWorkspaceAgent(
  execution,
  progress = null
) {
  if (
    !execution ||
    execution.executionId !==
      devWorkspaceAgentExecutionId
  ) {
    return;
  }

  const presentation =
    presentDevProgress(
      progress,
      execution
    );

  const terminal =
    [
      "COMPLETED",
      "FAILED",
      "BLOCKED",
      "CANCELLED",
    ].includes(
      execution.status
    );

  devWorkspaceAgentState
    .textContent =
    presentation.label;

  devWorkspaceAgentState
    .dataset.state =
    presentation.state;

  devWorkspaceAgentState
    .title =
    presentation.label;

  devWorkspaceAgentState
    .setAttribute(
      "aria-label",
      presentation.label
    );

  setDevWorkspaceAgentActive(
    !terminal
  );

  devWorkspaceAgentRun.disabled =
    !terminal;

  devWorkspaceAgentCancel.disabled =
    terminal;

  if (terminal) {
    devWorkspaceAgentExecutionId =
      null;

    if (
      devAgentExecutionKind ===
      "workspace"
    ) {
      devAgentExecutionKind =
        null;
    }
  }
}

function nativeDevFallbackProgress(
  execution
) {
  const status =
    String(
      execution?.status || ""
    ).toUpperCase();

  if (status === "COMPLETED") {
    return {
      source:
        "native_dev",
      state:
        "SUCCEEDED",
      phase:
        "VALIDATION",
      progress: 100,
    };
  }

  if (status === "CANCELLED") {
    return {
      source:
        "native_dev",
      state:
        "CANCELLED",
      phase:
        "ACTION",
    };
  }

  if (status === "INTERRUPTED") {
    return {
      source:
        "native_dev",
      state:
        "BLOCKED",
      phase:
        "RECOVERY",
      reasonCode:
        "PROCESS_RESTARTED",
    };
  }

  if (
    status === "FAILED" ||
    status === "TIMEOUT"
  ) {
    return {
      source:
        "native_dev",
      state:
        "FAILED",
      phase:
        "FINALIZE",
      reasonCode:
        execution
          ?.failureCategory ||
        null,
    };
  }

  return {
    source:
      "native_dev",
    state:
      "RUNNING",
    phase:
      "PLAN",
    progress: 10,
  };
}

function renderDevNativeExecution(
  execution,
  progress = null
) {
  if (
    !execution ||
    execution.taskId !==
      devNativeExecutionId
  ) {
    return;
  }

  const safeProgress =
    progress ||
    nativeDevFallbackProgress(
      execution
    );

  const presentation =
    presentDevProgress(
      safeProgress,
      execution
    );

  const terminal =
    [
      "COMPLETED",
      "FAILED",
      "CANCELLED",
      "TIMEOUT",
      "INTERRUPTED",
    ].includes(
      String(
        execution.status ||
        ""
      ).toUpperCase()
    ) ||
    [
      "SUCCEEDED",
      "FAILED",
      "CANCELLED",
      "BLOCKED",
    ].includes(
      String(
        safeProgress.state ||
        ""
      ).toUpperCase()
    );

  devWorkspaceAgentState.textContent =
    presentation.label;

  devWorkspaceAgentState.dataset.state =
    presentation.state;

  devWorkspaceAgentState.title =
    presentation.label;

  devWorkspaceAgentState.setAttribute(
    "aria-label",
    presentation.label
  );

  setDevWorkspaceAgentActive(
    !terminal
  );

  devWorkspaceAgentRun.disabled =
    !terminal;

  devWorkspaceAgentCancel.disabled =
    terminal;

  if (terminal) {
    devNativeExecutionId =
      null;

    if (
      devAgentExecutionKind ===
      "native"
    ) {
      devAgentExecutionKind =
        null;
    }
  }
}

async function bestEffortCancelDevExecution(
  kind,
  id
) {
  if (!kind || !id) {
    return;
  }

  const route =
    kind === "native"
      ? `/api/dev/native-ui/executions/${
          encodeURIComponent(id)
        }/cancel`
      : `/api/dev/workspace-agent/executions/${
          encodeURIComponent(id)
        }/cancel`;

  try {
    await devTerminalRequest(
      route,
      {
        method: "POST",
        body: {},
      }
    );
  } catch {}
}

async function refreshDevNativeExecution() {
  const taskId =
    devNativeExecutionId;

  const serial =
    devWorkspaceAgentSerial;

  const sessionId =
    devTerminalState
      .session?.id ||
    null;

  const contextKey =
    devTerminalState
      .contextKey;

  if (
    !taskId ||
    !sessionId ||
    !contextKey
  ) {
    return;
  }

  try {
    const data =
      await devTerminalRequest(
        `/api/dev/native-ui/executions/${
          encodeURIComponent(
            taskId
          )
        }`
      );

    if (
      serial !==
        devWorkspaceAgentSerial ||
      taskId !==
        devNativeExecutionId ||
      sessionId !==
        devTerminalState
          .session?.id ||
      contextKey !==
        devTerminalState
          .contextKey ||
      currentMode !== "DEV"
    ) {
      return;
    }

    renderDevNativeExecution(
      data.execution,
      data.progress
    );

    if (
      [
        "COMPLETED",
        "FAILED",
        "CANCELLED",
        "TIMEOUT",
      ].includes(
        data.execution?.status
      )
    ) {
      await refreshDevProblems();
    }
  } catch (error) {
    if (
      serial ===
        devWorkspaceAgentSerial &&
      taskId ===
        devNativeExecutionId
    ) {
      devNativeExecutionId =
        null;

      devAgentExecutionKind =
        null;

      setDevWorkspaceAgentActive(
        false
      );

      devWorkspaceAgentRun.disabled =
        false;

      devWorkspaceAgentCancel.disabled =
        true;

      devWorkspaceAgentState.textContent =
        "Échec";

      devWorkspaceAgentState.dataset.state =
        "failed";

      setDevTerminalStatus(
        error.message,
        "error"
      );
    }
  }
}

async function startLegacyDevWorkspaceAgent(
  command,
  sessionId,
  serial
) {
  const data =
    await devTerminalRequest(
      "/api/dev/workspace-agent/executions",
      {
        method: "POST",

        body: {
          workspaceSessionId:
            sessionId,

          task:
            `Valider le Workspace avec ${command}`,

          validationCommand:
            command,

          previewObservation: {
            url:
              devPreviewState
                .native.url ||
              null,

            status:
              devPreviewIsOpen()
                ? "READY"
                : "CLOSED",

            loadState:
              devPreviewState
                .native.loading
                ? "LOADING"
                : "IDLE",
          },
        },
      }
    );

  const executionId =
    data.execution
      ?.executionId ||
    null;

  if (
    serial !==
      devWorkspaceAgentSerial ||
    sessionId !==
      devTerminalState
        .session?.id
  ) {
    await bestEffortCancelDevExecution(
      "workspace",
      executionId
    );

    return;
  }

  devAgentExecutionKind =
    "workspace";

  devWorkspaceAgentExecutionId =
    executionId;

  renderDevWorkspaceAgent(
    data.execution,
    data.progress
  );

  void refreshDevWorkspaceAgent();
}

async function startNativeDevExecution(
  command,
  sessionId,
  serial
) {
  const data =
    await devTerminalRequest(
      "/api/dev/native-ui/executions",
      {
        method: "POST",

        body: {
          workspaceSessionId:
            sessionId,

          validationCommand:
            command,
        },
      }
    );

  const taskId =
    data.execution
      ?.taskId ||
    null;

  if (
    serial !==
      devWorkspaceAgentSerial ||
    sessionId !==
      devTerminalState
        .session?.id
  ) {
    await bestEffortCancelDevExecution(
      "native",
      taskId
    );

    return;
  }

  devAgentExecutionKind =
    "native";

  devNativeExecutionId =
    taskId;

  renderDevNativeExecution(
    data.execution,
    data.progress
  );

  void refreshDevNativeExecution();
}

async function cancelActiveDevAgent({
  silent = true,
} = {}) {
  const kind =
    devAgentExecutionKind;

  const id =
    kind === "native"
      ? devNativeExecutionId
      : devWorkspaceAgentExecutionId;

  if (!kind || !id) {
    return {
      cancelled: false,
      reason:
        "NOT_RUNNING",
    };
  }

  try {
    const route =
      kind === "native"
        ? `/api/dev/native-ui/executions/${
            encodeURIComponent(id)
          }/cancel`
        : `/api/dev/workspace-agent/executions/${
            encodeURIComponent(id)
          }/cancel`;

    return await devTerminalRequest(
      route,
      {
        method: "POST",
        body: {},
      }
    );
  } catch (error) {
    if (!silent) {
      setDevTerminalStatus(
        error.message,
        "error"
      );
    }

    return {
      cancelled: false,
      reason:
        error.code ||
        "CANCEL_FAILED",
    };
  }
}

async function showDevWorkspaceAgentTerminal(execution, sessionId, serial) {
  const terminalId = execution?.terminalExecutionRefs?.at(-1)?.terminalSessionId;
  if (!terminalId || devTerminalState.terminals.has(terminalId)) return;
  const data = await devTerminalRequest(`/api/dev/workspace-terminal/sessions/${encodeURIComponent(sessionId)}`);
  if (serial !== devWorkspaceAgentSerial || sessionId !== devTerminalState.session?.id || execution.executionId !== devWorkspaceAgentExecutionId) return;
  const terminal = data.session?.terminalSessions?.find((item) => item.id === terminalId);
  if (!terminal) return;
  devTerminalState.offsetByTerminal.set(terminal.id, 0);
  devTerminalState.activeTerminalId = terminal.id;
  applyDevTerminal(terminal);
  renderDevTerminalOutput();
  await pollActiveDevTerminal();
}

async function refreshDevWorkspaceAgent() {
  const executionId = devWorkspaceAgentExecutionId;
  const serial = devWorkspaceAgentSerial;
  const sessionId = devTerminalState.session?.id || null;
  const contextKey = devTerminalState.contextKey;
  if (!executionId || !sessionId || !contextKey) return;
  try {
    const data = await devTerminalRequest(`/api/dev/workspace-agent/executions/${encodeURIComponent(executionId)}`);
    if (serial !== devWorkspaceAgentSerial || executionId !== devWorkspaceAgentExecutionId ||
      sessionId !== devTerminalState.session?.id || contextKey !== devTerminalState.contextKey || currentMode !== "DEV") return;
    await showDevWorkspaceAgentTerminal(data.execution, sessionId, serial);
    renderDevWorkspaceAgent(data.execution, data.progress);
  } catch {
    if (serial === devWorkspaceAgentSerial) clearDevWorkspaceAgent();
  }
}

devWorkspaceAgentRun.addEventListener("click", async () => {
  const command =
    lastAuthorizedDevValidationForActiveSession();

  const sessionId =
    devTerminalState
      .session?.id ||
    null;

  if (
    !command ||
    !sessionId ||
    currentMode !== "DEV"
  ) {
    setDevTerminalStatus(
      "Exécute d’abord une validation autorisée pour Noon.",
      "error"
    );

    return;
  }

  const serial =
    ++devWorkspaceAgentSerial;

  setDevWorkspaceAgentActive(
    true
  );

  devWorkspaceAgentRun.disabled =
    true;

  devWorkspaceAgentCancel.disabled =
    true;

  devWorkspaceAgentState.textContent =
    "Analyse…";

  devWorkspaceAgentState.dataset.state =
    "running";

  try {
    await startNativeDevExecution(
      command,
      sessionId,
      serial
    );
  } catch (error) {
    /*
     * Fallback legacy uniquement quand
     * Native est désactivé AVANT tout run.
     */
    if (
      error.code ===
      "DEV_NATIVE_FEATURE_DISABLED"
    ) {
      devWorkspaceAgentState.textContent =
        "Mode classique…";

      try {
        await startLegacyDevWorkspaceAgent(
          command,
          sessionId,
          serial
        );

        return;
      } catch (legacyError) {
        // eslint-disable-next-line no-ex-assign -- l'échec du mode classique remplace celui du mode natif
        error =
          legacyError;
      }
    }

    if (
      serial ===
        devWorkspaceAgentSerial
    ) {
      devNativeExecutionId =
        null;

      devWorkspaceAgentExecutionId =
        null;

      devAgentExecutionKind =
        null;

      setDevWorkspaceAgentActive(
        false
      );

      devWorkspaceAgentRun.disabled =
        false;

      devWorkspaceAgentCancel.disabled =
        true;

      devWorkspaceAgentState.textContent =
        "Échec";

      devWorkspaceAgentState.dataset.state =
        "failed";

      setDevTerminalStatus(
        error.message,
        "error"
      );
    }
  }
});

devWorkspaceAgentCancel.addEventListener("click", async () => {
  const kind =
    devAgentExecutionKind;

  const id =
    kind === "native"
      ? devNativeExecutionId
      : devWorkspaceAgentExecutionId;

  if (!kind || !id) {
    return;
  }

  devWorkspaceAgentCancel.disabled =
    true;

  devWorkspaceAgentState.textContent =
    "Arrêt…";

  devWorkspaceAgentState.dataset.state =
    "cancelling";

  await cancelActiveDevAgent({
    silent: false,
  });

  if (
    kind === "native" &&
    id === devNativeExecutionId
  ) {
    await refreshDevNativeExecution();
  } else if (
    kind === "workspace" &&
    id === devWorkspaceAgentExecutionId
  ) {
    await refreshDevWorkspaceAgent();
  }
});

// DEV_WORKSPACE_AGENT_UI_END

// DEV_TERMINAL_UI_END

