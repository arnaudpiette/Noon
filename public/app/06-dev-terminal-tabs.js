function renderDevTerminalTabs() {
  devTerminalTabs.replaceChildren();

  for (
    const terminal of
    devTerminalState.terminals.values()
  ) {
    const wrapper =
      document.createElement("div");

    wrapper.className =
      "dev-terminal-tab-shell";

    const select =
      document.createElement("button");

    select.type = "button";
    select.className =
      "dev-terminal-tab";

    select.dataset.active =
      String(
        terminal.id ===
        devTerminalState.activeTerminalId
      );

    select.setAttribute(
      "role",
      "tab"
    );

    select.setAttribute(
      "aria-selected",
      String(
        terminal.id ===
        devTerminalState.activeTerminalId
      )
    );

    select.dataset.terminalId =
      terminal.id;

    select.tabIndex =
      terminal.id ===
      devTerminalState.activeTerminalId
        ? 0
        : -1;

    select.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "ArrowLeft"
        ) {
          event.preventDefault();

          moveDevTerminalSelection(
            -1,
            {
              focusTab: true,
            }
          );

          return;
        }

        if (
          event.key === "ArrowRight"
        ) {
          event.preventDefault();

          moveDevTerminalSelection(
            1,
            {
              focusTab: true,
            }
          );

          return;
        }

        if (
          event.key === "Home"
        ) {
          event.preventDefault();

          moveDevTerminalSelection(
            "first",
            {
              focusTab: true,
            }
          );

          return;
        }

        if (
          event.key === "End"
        ) {
          event.preventDefault();

          moveDevTerminalSelection(
            "last",
            {
              focusTab: true,
            }
          );
        }
      }
    );

    const state =
      terminal.running
        ? "RUNNING"
        : terminal.status;

    select.textContent =
      `${terminal.title} · ${state}`;

    select.addEventListener(
      "click",
      () => {
        activateDevTerminal(
          terminal.id
        );
      }
    );

    const close =
      document.createElement("button");

    close.type = "button";
    close.className =
      "dev-terminal-tab-close";

    close.textContent = "×";

    close.setAttribute(
      "aria-label",
      `Fermer ${terminal.title}`
    );

    close.addEventListener(
      "click",
      async (event) => {
        event.stopPropagation();

        await closeDevTerminal(
          terminal.id
        );
      }
    );

    wrapper.append(
      select,
      close
    );

    devTerminalTabs.append(wrapper);
  }
}

function applyDevTerminal(terminal) {
  if (!terminal?.id) return;

  devTerminalState.terminals.set(
    terminal.id,
    terminal
  );

  if (
    !devTerminalState.activeTerminalId
  ) {
    devTerminalState.activeTerminalId =
      terminal.id;
  }

  renderDevTerminalTabs();

  if (
    terminal.id ===
    devTerminalState.activeTerminalId
  ) {
    setDevTerminalStatus(
      terminal.running
        ? "Commande en cours"
        : terminal.status === "EXITED"
          ? `Terminé${
              terminal.exitCode === null
                ? ""
                : ` · code ${terminal.exitCode}`
            }`
          : "Prêt",
      terminal.running
        ? "running"
        : terminal.exitCode
          ? "error"
          : "ready"
    );
  }
}

async function createDevTerminal() {
  if (!devTerminalState.session) {
    setDevTerminalStatus(
      "Aucune session DEV.",
      "error"
    );

    return null;
  }

  const number =
    devTerminalState.terminals.size + 1;

  const data =
    await devTerminalRequest(
      `/api/dev/workspace-terminal/sessions/${
        encodeURIComponent(
          devTerminalState.session.id
        )
      }/terminals`,
      {
        method: "POST",
        body: {
          title: `USER ${number}`,
        },
      }
    );

  const terminal =
    data.terminal;

  devTerminalState.terminals.set(
    terminal.id,
    terminal
  );

  devTerminalState.outputByTerminal.set(
    terminal.id,
    []
  );

  devTerminalState.offsetByTerminal.set(
    terminal.id,
    0
  );

  devTerminalState.activeTerminalId =
    terminal.id;

  applyDevTerminal(terminal);
  renderDevTerminalOutput();

  persistDevTerminalLayout();

  devTerminalInput.focus();

  return terminal;
}

async function pollActiveDevTerminal() {
  const session =
    devTerminalState.session;

  const terminalId =
    devTerminalState.activeTerminalId;

  if (
    !session ||
    !terminalId
  ) {
    return;
  }

  const from =
    devTerminalState.offsetByTerminal.get(
      terminalId
    ) || 0;

  try {
    const data =
      await devTerminalRequest(
        `/api/dev/workspace-terminal/sessions/${
          encodeURIComponent(session.id)
        }/terminals/${
          encodeURIComponent(terminalId)
        }/output?from=${
          encodeURIComponent(from)
        }`
      );

    if (
      Array.isArray(data.output) &&
      data.output.length
    ) {
      const publicOutput =
        data.output.filter(
          (event) =>
            event?.type !== "input"
        );

      devTerminalBuffer(
        terminalId
      ).push(
        ...publicOutput
      );

      const following =
        devTerminalState.followOutputByTerminal.get(
          terminalId
        ) !== false;

      if (
        publicOutput.length &&
        !following
      ) {
        devTerminalState.pendingOutputByTerminal.set(
          terminalId,
          devTerminalPendingOutputCount(
            terminalId
          ) + publicOutput.length
        );
      }
    }

    devTerminalState.offsetByTerminal.set(
      terminalId,
      Number(data.next) || 0
    );

    applyDevTerminal(
      data.terminal
    );

    renderDevTerminalOutput();

    if (shouldRefreshDevProblems()) {
      await refreshDevProblems();
    }

    if (
      devAgentExecutionKind ===
        "native" &&
      devNativeExecutionId
    ) {
      await refreshDevNativeExecution();
    } else if (
      devAgentExecutionKind ===
        "workspace" &&
      devWorkspaceAgentExecutionId
    ) {
      await refreshDevWorkspaceAgent();
    }
  } catch (error) {
    if (
      error.code ===
      "TERMINAL_NOT_FOUND"
    ) {
      devTerminalState.terminals.delete(
        terminalId
      );

      devTerminalState.activeTerminalId =
        [...devTerminalState.terminals.keys()][0] ||
        null;

      renderDevTerminalTabs();
      renderDevTerminalOutput();

      return;
    }

    setDevTerminalStatus(
      error.message,
      "error"
    );
  }
}

function startDevTerminalPolling() {
  stopDevTerminalPolling();

  devTerminalState.pollTimer =
    window.setInterval(
      () => {
        void pollActiveDevTerminal();
      },
      750
    );
}

async function closeDevTerminal(
  terminalId
) {
  const session =
    devTerminalState.session;

  if (
    !session ||
    !terminalId
  ) {
    return;
  }

  try {
    await devTerminalRequest(
      `/api/dev/workspace-terminal/sessions/${
        encodeURIComponent(session.id)
      }/terminals/${
        encodeURIComponent(terminalId)
      }/close`,
      {
        method: "POST",
        body: {},
      }
    );
  } catch (error) {
    setDevTerminalStatus(
      error.message,
      "error"
    );

    return;
  }

  devTerminalState.terminals.delete(
    terminalId
  );

  devTerminalState.outputByTerminal.delete(
    terminalId
  );

  devTerminalState.offsetByTerminal.delete(
    terminalId
  );

  if (
    devTerminalState.activeTerminalId ===
    terminalId
  ) {
    devTerminalState.activeTerminalId =
      [...devTerminalState.terminals.keys()][0] ||
      null;
  }

  renderDevTerminalTabs();
  renderDevTerminalOutput();

  if (
    devTerminalState.activeTerminalId
  ) {
    void pollActiveDevTerminal();
  } else {
    setDevTerminalStatus(
      "Aucun terminal",
      "idle"
    );
  }
}

async function closeDevTerminalSession({
  silent = true,
} = {}) {
  const sessionId =
    devTerminalState.session?.id ||
    null;

  stopDevTerminalPolling();
  clearDevProblemsPanel();
  clearDevSourceControl({
    close: true,
  });
  devProjectRulesUi?.reset();

  await cancelActiveDevAgent({
    silent: true,
  });

  clearDevWorkspaceAgent();

  persistDevTerminalLayout();

  devTerminalState.session = null;
  devTerminalState.terminals.clear();
  devTerminalState.outputByTerminal.clear();
  devTerminalState.offsetByTerminal.clear();
  devTerminalState.scrollByTerminal.clear();
  devTerminalState.followOutputByTerminal.clear();
  devTerminalState.pendingOutputByTerminal.clear();
  devTerminalState.activeTerminalId = null;
  devTerminalState.contextKey = null;
  clearLastAuthorizedDevValidation();

  renderDevTerminalTabs();
  renderDevTerminalOutput();
  updateDevTerminalHeader();

  if (!sessionId) return;

  try {
    await devTerminalRequest(
      `/api/dev/workspace-terminal/sessions/${
        encodeURIComponent(sessionId)
      }/close`,
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
  }
}

async function openDevTerminalSession(
  expectedSerial
) {
  const data =
    await devTerminalRequest(
      "/api/dev/workspace-terminal/sessions",
      {
        method: "POST",
        body: {
          focusId:
            currentFocusId,
          focusName:
            currentFocus,
          repositoryRoot:
            currentFocusPath,
        },
      }
    );

  if (
    expectedSerial !==
    devTerminalState.syncSerial
  ) {
    try {
      await devTerminalRequest(
        `/api/dev/workspace-terminal/sessions/${
          encodeURIComponent(
            data.session.id
          )
        }/close`,
        {
          method: "POST",
          body: {},
        }
      );
    } catch {}

    return;
  }

  devTerminalState.session =
    data.session;

  devTerminalState.contextKey =
    `${currentFocusId}:${currentFocusPath}`;

  void devTerminalProfileUi?.refresh();

  if (!devProjectRulesPanel.hidden) void devProjectRulesUi?.refresh();

  updateDevTerminalHeader();

  renderDevProblems(
    data.session.problems
  );

  const restoredLayout =
    loadDevTerminalLayout(
      devTerminalState.contextKey
    );

  const restoredUserTerminals =
    [];

  for (
    let index = 0;
    index < restoredLayout.userCount;
    index += 1
  ) {
    const terminal =
      await createDevTerminal();

    if (terminal) {
      restoredUserTerminals.push(
        terminal
      );
    }
  }

  const restoredActiveTerminal =
    restoredUserTerminals[
      restoredLayout.activeIndex
    ] ||
    restoredUserTerminals[0] ||
    null;

  if (restoredActiveTerminal) {
    devTerminalState.activeTerminalId =
      restoredActiveTerminal.id;

    persistDevTerminalLayout();

    renderDevTerminalTabs();
    renderDevTerminalOutput();
  }

  startDevTerminalPolling();

  setDevTerminalStatus(
    "Terminal prêt",
    "ready"
  );
}

async function syncDevTerminalPanel() {
  const serial =
    ++devTerminalState.syncSerial;

  const devMode =
    currentMode === "DEV";

  devTerminalPanel.hidden =
    !devMode;

  chatView.classList.toggle(
    "dev-terminal-active",
    devMode
  );

  applyDevTerminalLayoutState();

  if (!devMode) {
    await closeDevTerminalSession({
      silent: true,
    });

    return;
  }

  if (uiValidationMode) {
    await closeDevTerminalSession({
      silent: true,
    });
    if (serial !== devTerminalState.syncSerial) return;
    const context = uiValidationContext();
    devTerminalProject.textContent = context?.projectName || "Profil isolé";
    devTerminalMeta.textContent = context ? "Projet synthétique sélectionné pour la validation des règles." : "Aucun workspace personnel n’est chargé dans ce profil.";
    for (const control of [devWorkspaceAgentRun, devWorkspaceAgentCancel, devTerminalAddButton, devTerminalRun, devSourceControlToggle, devSourceControlRefresh]) {
      if (!control) continue;
      control.disabled = true;
      control.title = uiValidationBlockedMessage;
    }
    setDevTerminalStatus(uiValidationBlockedMessage, "idle");
    devTerminalOutput.textContent = uiValidationBlockedMessage;
    return;
  }

  devTerminalProject.textContent =
    currentFocus ||
    "Aucun Focus";

  if (
    !currentFocusId ||
    !currentFocusPath
  ) {
    await closeDevTerminalSession({
      silent: true,
    });

    if (
      serial !==
      devTerminalState.syncSerial
    ) {
      return;
    }

    devTerminalPanel.hidden = false;

    devTerminalProject.textContent =
      currentFocus ||
      "Aucun Focus";

    devTerminalMeta.textContent =
      "Sélectionne un projet Focus disposant d’un dossier local.";

    setDevTerminalStatus(
      "Focus DEV requis",
      "idle"
    );

    renderDevTerminalOutput();

    return;
  }

  const contextKey =
    `${currentFocusId}:${currentFocusPath}`;

  if (
    devTerminalState.session &&
    devTerminalState.contextKey ===
      contextKey
  ) {
    updateDevTerminalHeader();
    startDevTerminalPolling();

    return;
  }

  await closeDevTerminalSession({
    silent: true,
  });

  if (
    serial !==
    devTerminalState.syncSerial
  ) {
    return;
  }

  setDevTerminalStatus(
    "Ouverture du workspace…",
    "running"
  );

  devTerminalMeta.textContent =
    "Vérification des permissions locales…";

  try {
    await openDevTerminalSession(
      serial
    );
  } catch (error) {
    if (
      serial !==
      devTerminalState.syncSerial
    ) {
      return;
    }

    updateDevTerminalHeader();

    setDevTerminalStatus(
      error.message,
      "error"
    );

    devTerminalOutput.textContent =
      [
        "Impossible d’ouvrir le terminal DEV.",
        "",
        error.message,
        "",
        "Le dossier du projet doit être autorisé en lecture et création dans Noon.",
      ].join("\n");
  }
}

devTerminalAddButton.addEventListener(
  "click",
  async () => {
    try {
      await createDevTerminal();
    } catch (error) {
      setDevTerminalStatus(
        error.message,
        "error"
      );
    }
  }
);

devTerminalCopyOutputButton.addEventListener(
  "click",
  () => {
    void copyActiveDevTerminalOutput();
  }
);

devTerminalExportOutputButton.addEventListener(
  "click",
  () => {
    exportActiveDevTerminalOutput();
  }
);

devTerminalForm.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    const command =
      devTerminalInput.value.trim();

    const session =
      devTerminalState.session;

    const terminalId =
      devTerminalState.activeTerminalId;

    const contextKey =
      devTerminalState.contextKey;

    if (!command) return;

    closeDevTerminalCompletion();

    if (
      !session ||
      !terminalId
    ) {
      setDevTerminalStatus(
        "Ouvre d’abord un terminal.",
        "error"
      );

      return;
    }

    rememberDevTerminalCommand(
      command
    );

    devTerminalBuffer(
      terminalId
    ).push({
      type: "command",
      text: command,
    });

    renderDevTerminalOutput();

    devTerminalInput.value = "";
    devTerminalInput.disabled = true;
    devTerminalRun.disabled = true;

    setDevTerminalStatus(
      "Commande en cours",
      "running"
    );

    try {
      const data =
        await devTerminalRequest(
          `/api/dev/workspace-terminal/sessions/${
            encodeURIComponent(session.id)
          }/terminals/${
            encodeURIComponent(terminalId)
          }/run`,
          {
            method: "POST",
            body: {
              command,
            },
          }
        );

      applyDevTerminal(
        data.result?.terminal
      );

      if (
        data.result?.classification ===
        "SAFE_READ"
      ) {
        if (session.id === devTerminalState.session?.id && contextKey === devTerminalState.contextKey) {
          devTerminalState.lastAuthorizedValidationCommand = command;
          devTerminalState.lastAuthorizedValidationSessionId = session.id;
          devTerminalState.lastAuthorizedValidationContextKey = contextKey;
        }
        devTerminalState.problemsRefreshPending =
          true;
      }

      await pollActiveDevTerminal();

      if (
        devSourceControlView.open
      ) {
        await refreshDevSourceControl();
      }
    } catch (error) {
      devTerminalBuffer(
        terminalId
      ).push({
        type: "stderr",
        text:
          `Commande refusée : ${error.message}\n`,
      });

      renderDevTerminalOutput();

      setDevTerminalStatus(
        error.message,
        "error"
      );
    } finally {
      devTerminalInput.disabled = false;
      devTerminalRun.disabled = false;
      devTerminalInput.focus();
    }
  }
);

devTerminalCollapseButton.addEventListener(
  "click",
  () => {
    toggleDevTerminalCollapsed();
  }
);

devTerminalMaximizeButton.addEventListener(
  "click",
  () => {
    toggleDevTerminalMaximized();
  }
);

devTerminalInput.addEventListener(
  "keydown",
  (event) => {
    if (
      event.key === "Tab" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();

      void cycleDevTerminalCompletion(
        event.shiftKey
          ? -1
          : 1
      );

      return;
    }

    if (
      event.key === "Escape" &&
      !devTerminalCompletionPopup.hidden
    ) {
      event.preventDefault();
      closeDevTerminalCompletion();
      return;
    }

    if (
      event.key === "ArrowUp" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      closeDevTerminalCompletion();

      if (
        navigateDevTerminalHistory(-1)
      ) {
        event.preventDefault();
      }

      return;
    }

    if (
      event.key === "ArrowDown" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      closeDevTerminalCompletion();

      if (
        navigateDevTerminalHistory(1)
      ) {
        event.preventDefault();
      }
    }
  }
);

devTerminalInput.addEventListener(
  "input",
  () => {
    if (
      !devTerminalCompletionPopup.hidden
    ) {
      closeDevTerminalCompletion();
    }
  }
);

devTerminalResizeHandle.addEventListener(
  "pointerdown",
  (event) => {
    if (
      devTerminalState.collapsed ||
      devTerminalState.maximized
    ) {
      return;
    }

    event.preventDefault();

    devTerminalState.resizing = true;
    devTerminalState.resizeStartY =
      event.clientY;
    devTerminalState.resizeStartHeight =
      devTerminalState.height;

    devTerminalResizeHandle.setPointerCapture?.(
      event.pointerId
    );

    document.body.classList.add(
      "dev-terminal-resizing"
    );
  }
);

window.addEventListener(
  "pointermove",
  (event) => {
    if (
      !devTerminalState.resizing
    ) {
      return;
    }

    const delta =
      devTerminalState.resizeStartY -
      event.clientY;

    setDevTerminalHeight(
      devTerminalState.resizeStartHeight +
        delta,
      false
    );
  }
);

function finishDevTerminalResize() {
  if (
    !devTerminalState.resizing
  ) {
    return;
  }

  devTerminalState.resizing = false;

  document.body.classList.remove(
    "dev-terminal-resizing"
  );

  setDevTerminalHeight(
    devTerminalState.height,
    true
  );
}

window.addEventListener(
  "pointerup",
  finishDevTerminalResize
);

window.addEventListener(
  "pointercancel",
  finishDevTerminalResize
);

devTerminalResizeHandle.addEventListener(
  "keydown",
  (event) => {
    if (
      !["ArrowUp", "ArrowDown"].includes(
        event.key
      ) ||
      devTerminalState.collapsed ||
      devTerminalState.maximized
    ) {
      return;
    }

    event.preventDefault();

    const step =
      event.shiftKey
        ? 50
        : 20;

    setDevTerminalHeight(
      devTerminalState.height +
        (
          event.key === "ArrowUp"
            ? step
            : -step
        )
    );
  }
);

window.addEventListener(
  "resize",
  () => {
    setDevTerminalHeight(
      devTerminalState.height,
      false
    );
  }
);

// Navigation globale entre terminaux.
// Ctrl+Tab : terminal suivant
// Ctrl+Shift+Tab : terminal précédent
document.addEventListener(
  "keydown",
  (event) => {
    if (
      !event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.key !== "Tab" ||
      currentMode !== "DEV" ||
      devTerminalPanel.hidden
    ) {
      return;
    }

    event.preventDefault();

    moveDevTerminalSelection(
      event.shiftKey
        ? -1
        : 1
    );
  }
);

// Accès direct aux terminaux.
// Cmd+1 à Cmd+9 sélectionne le terminal correspondant.
document.addEventListener(
  "keydown",
  (event) => {
    if (
      !event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      currentMode !== "DEV" ||
      devTerminalPanel.hidden
    ) {
      return;
    }

    const match =
      event.code.match(
        /^Digit([1-9])$/
      );

    if (!match) {
      return;
    }

    const terminalIndex =
      Number(match[1]) - 1;

    const ids =
      devTerminalIds();

    const terminalId =
      ids[terminalIndex];

    if (!terminalId) {
      return;
    }

    event.preventDefault();

    activateDevTerminal(
      terminalId
    );
  }
);

// Raccourci inspiré des IDE : affiche/réduit
// le panneau sans fermer ses terminaux.
document.addEventListener(
  "keydown",
  (event) => {
    const commandKey =
      event.metaKey ||
      event.ctrlKey;

    if (
      !commandKey ||
      event.key.toLowerCase() !== "j" ||
      currentMode !== "DEV"
    ) {
      return;
    }

    event.preventDefault();

    if (devTerminalPanel.hidden) {
      void syncDevTerminalPanel();
      return;
    }

    toggleDevTerminalCollapsed();
  }
);

window.addEventListener(
  "noon-context-change",
  () => {
    void syncDevTerminalPanel();
  }
);

window.addEventListener(
  "pagehide",
  () => {
    const sessionId =
      devTerminalState.session?.id;

    const activeKind =
      devAgentExecutionKind;

    const activeId =
      activeKind === "native"
        ? devNativeExecutionId
        : devWorkspaceAgentExecutionId;

    if (
      activeKind &&
      activeId
    ) {
      const cancelRoute =
        activeKind === "native"
          ? `/api/dev/native-ui/executions/${
              encodeURIComponent(
                activeId
              )
            }/cancel`
          : `/api/dev/workspace-agent/executions/${
              encodeURIComponent(
                activeId
              )
            }/cancel`;

      void fetch(
        cancelRoute,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "X-Noon-Request":
              "1",
          },

          body: "{}",
          keepalive: true,
        }
      ).catch(() => {});
    }

    if (!sessionId) return;

    void fetch(
      `/api/dev/workspace-terminal/sessions/${
        encodeURIComponent(sessionId)
      }/close`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          "X-Noon-Request": "1",
        },
        body: "{}",
        keepalive: true,
      }
    ).catch(() => {});
  }
);

