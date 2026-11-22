// DEV_TERMINAL_UI_START
// Le renderer n'exécute aucune commande directement.
// Toutes les opérations passent par l'API locale sécurisée,
// qui force elle-même owner/origin à USER.

// DEV_TERMINAL_V2_START
const DEV_TERMINAL_HEIGHT_STORAGE_KEY =
  "noonDevTerminalHeight";

const DEV_TERMINAL_HISTORY_STORAGE_KEY =
  "noonDevTerminalHistory";

const DEV_TERMINAL_MIN_HEIGHT = 220;
const DEV_TERMINAL_MAX_HISTORY = 100;

function defaultDevTerminalHeight() {
  return window.matchMedia(
    "(max-width: 720px)"
  ).matches
    ? 285
    : 330;
}

function maxDevTerminalHeight() {
  const composerRect =
    devWorkspaceComposer
      ?.getBoundingClientRect?.();

  const headerRect =
    devWorkspaceChatHeader
      ?.getBoundingClientRect?.();

  if (
    composerRect &&
    headerRect &&
    Number.isFinite(
      composerRect.top
    ) &&
    Number.isFinite(
      headerRect.bottom
    )
  ) {
    const available =
      Math.floor(
        composerRect.top -
        DEV_WORKSPACE_COMPOSER_GAP -
        headerRect.bottom -
        14
      );

    return Math.max(
      DEV_TERMINAL_MIN_HEIGHT,
      available
    );
  }

  return Math.max(
    DEV_TERMINAL_MIN_HEIGHT,
    window.innerHeight - 175
  );
}

function clampDevTerminalHeight(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return defaultDevTerminalHeight();
  }

  return Math.min(
    maxDevTerminalHeight(),
    Math.max(
      DEV_TERMINAL_MIN_HEIGHT,
      Math.round(numeric)
    )
  );
}

function loadDevTerminalHeight() {
  return clampDevTerminalHeight(
    localStorage.getItem(
      DEV_TERMINAL_HEIGHT_STORAGE_KEY
    ) ||
    defaultDevTerminalHeight()
  );
}

function loadDevTerminalHistory() {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(
        DEV_TERMINAL_HISTORY_STORAGE_KEY
      ) || "[]"
    );

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(
        (command) =>
          typeof command === "string" &&
          command.trim()
      )
      .slice(
        -DEV_TERMINAL_MAX_HISTORY
      );
  } catch {
    return [];
  }
}
// DEV_TERMINAL_V2_END

const DEV_TERMINAL_LAYOUT_STORAGE_PREFIX =
  "noon-dev-terminal-layout:";

const DEV_TERMINAL_RESTORE_MAX = 9;

function devTerminalLayoutStorageKey(
  contextKey
) {
  if (!contextKey) {
    return null;
  }

  return (
    DEV_TERMINAL_LAYOUT_STORAGE_PREFIX +
    contextKey
  );
}

function getUserDevTerminals() {
  return [
    ...devTerminalState.terminals.values(),
  ].filter((terminal) =>
    /^USER \d+$/.test(
      String(terminal?.title || "")
    )
  );
}

function persistDevTerminalLayout() {
  const contextKey =
    devTerminalState.contextKey;

  const key =
    devTerminalLayoutStorageKey(
      contextKey
    );

  if (!key) {
    return;
  }

  const userTerminals =
    getUserDevTerminals();

  if (!userTerminals.length) {
    localStorage.removeItem(key);
    return;
  }

  const foundActiveIndex =
    userTerminals.findIndex(
      (terminal) =>
        terminal.id ===
        devTerminalState.activeTerminalId
    );

  const activeIndex =
    foundActiveIndex >= 0
      ? foundActiveIndex
      : 0;

  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        userCount: Math.min(
          userTerminals.length,
          DEV_TERMINAL_RESTORE_MAX
        ),
        activeIndex: Math.min(
          activeIndex,
          DEV_TERMINAL_RESTORE_MAX - 1
        ),
      })
    );
  } catch {
    // Persistance uniquement ergonomique.
  }
}

function loadDevTerminalLayout(
  contextKey
) {
  const key =
    devTerminalLayoutStorageKey(
      contextKey
    );

  if (!key) {
    return {
      userCount: 1,
      activeIndex: 0,
    };
  }

  try {
    const parsed =
      JSON.parse(
        localStorage.getItem(key) ||
        "{}"
      );

    const userCount =
      Math.max(
        1,
        Math.min(
          DEV_TERMINAL_RESTORE_MAX,
          Number(parsed.userCount) || 1
        )
      );

    const activeIndex =
      Math.max(
        0,
        Math.min(
          userCount - 1,
          Number(parsed.activeIndex) || 0
        )
      );

    return {
      userCount,
      activeIndex,
    };
  } catch {
    return {
      userCount: 1,
      activeIndex: 0,
    };
  }
}

const devTerminalState = {
  session: null,
  problems: null,
  terminals: new Map(),
  outputByTerminal: new Map(),
  offsetByTerminal: new Map(),
  scrollByTerminal: new Map(),
  followOutputByTerminal: new Map(),
  pendingOutputByTerminal: new Map(),
  activeTerminalId: null,
  contextKey: null,
  lastAuthorizedValidationCommand: null,
  lastAuthorizedValidationSessionId: null,
  lastAuthorizedValidationContextKey: null,
  pollTimer: null,
  problemsRefreshPending: false,
  syncSerial: 0,
  collapsed: false,
  maximized: false,
  height: loadDevTerminalHeight(),
  history: loadDevTerminalHistory(),
  historyIndex: null,
  historyDraft: "",
  completionItems: [],
  completionIndex: -1,
  completionQuery: "",
  resizing: false,
  resizeStartY: 0,
  resizeStartHeight: 0,
};

let uiValidationMode = window.noon?.uiValidationMode === true;
let uiValidationProjects = [];
const uiValidationBlockedMessage = "Validation UI isolée : le terminal, l’agent, les commandes et Source Control sont désactivés. Seules les règles des projets synthétiques sont disponibles.";

function uiValidationContext() {
  const selected = uiValidationProjects.find((project) => project.workspaceId === devUiValidationProject?.value);
  return selected ? { workspaceId: selected.workspaceId, contextKey: `ui-validation:${selected.workspaceId}`, projectName: selected.name } : null;
}

function renderUiValidationProjects() {
  if (!devUiValidationProject || !devUiValidationProjectLabel) return;
  devUiValidationProject.replaceChildren();
  for (const project of uiValidationProjects) {
    const option = document.createElement("option"); option.value = project.workspaceId; option.textContent = project.name; devUiValidationProject.append(option);
  }
  devUiValidationProjectLabel.hidden = !uiValidationMode || !uiValidationProjects.length;
}

const devProjectRulesUi = window.NoonDevProjectRulesUi?.mountDevProjectRulesUi({
  elements: { toggle: devProjectRulesToggle, panel: devProjectRulesPanel, project: devProjectRulesProject, add: devProjectRulesAdd, readOnly: devProjectRulesReadOnly, list: devProjectRulesList, form: devProjectRulesForm, input: devProjectRulesInput, preview: devProjectRulesPreview, save: devProjectRulesSave, cancel: devProjectRulesCancel, status: devProjectRulesStatus },
  bridge: window.noon,
  getContext: () => uiValidationMode ? uiValidationContext() : ({ workspaceId: devTerminalState.session?.workspaceId || null, contextKey: devTerminalState.contextKey, projectName: devTerminalState.session?.projectName || currentFocus || "Projet DEV" }),
  getUnavailableReason: () => uiValidationMode && !uiValidationContext() ? "Validation UI isolée : aucun projet synthétique autorisé n’est disponible." : null,
});

if (!devProjectRulesUi && devProjectRulesToggle && devProjectRulesPanel && devProjectRulesStatus) {
  devProjectRulesToggle.addEventListener("click", () => {
    devProjectRulesPanel.hidden = false;
    devProjectRulesToggle.setAttribute("aria-expanded", "true");
    devProjectRulesStatus.textContent = "Le module des règles DEV n’a pas pu être chargé. Recharge l’application isolée.";
    devProjectRulesStatus.dataset.state = "error";
  });
}


const devTerminalProfileUi = window.NoonDevTerminalProfileUi?.createDevTerminalProfileController({
  elements: {
    label: devTerminalExecutionProfileLabel,
    select: devTerminalExecutionProfile,
    status: devTerminalExecutionProfileStatus,
  },
  bridge: window.noon,
  getContext: () => uiValidationMode
    ? uiValidationContext()
    : ({
        workspaceId: devTerminalState.session?.workspaceId || null,
        contextKey: devTerminalState.contextKey,
        projectName: devTerminalState.session?.projectName || currentFocus || "Projet DEV",
      }),
});

void window.noon?.getStatus?.().then((status) => {
  uiValidationMode = status?.uiValidationMode === true;
  uiValidationProjects = Array.isArray(status?.uiValidationProjects) ? status.uiValidationProjects.filter((project) => typeof project?.workspaceId === "string" && typeof project?.name === "string") : [];
  renderUiValidationProjects();
  if (uiValidationMode && currentMode === "DEV") void syncDevTerminalPanel();
}).catch(() => {});

devUiValidationProject?.addEventListener("change", () => {
  if (uiValidationMode && !devProjectRulesPanel.hidden) void devProjectRulesUi?.refresh();
  if (uiValidationMode) void devTerminalProfileUi?.refresh();
});

// DEV_PROBLEMS_UI_START

const DEV_PROBLEMS_STATUSES =
  new Set([
    "EMPTY",
    "RUNNING",
    "READY",
    "CANCELLED",
    "UNRESOLVED",
  ]);

const DEV_PROBLEM_SEVERITIES =
  new Set([
    "error",
    "warning",
    "info",
  ]);

function emptyDevProblems() {
  return {
    status: "EMPTY",
    counts: {
      total: 0,
      error: 0,
      warning: 0,
      info: 0,
    },
    truncated: false,
    problems: [],
  };
}

function positiveDevProblemInteger(value) {
  const number = Number(value);

  return Number.isSafeInteger(number) &&
    number > 0
    ? number
    : null;
}

function safeDevProblemFile(value) {
  const file =
    String(value || "")
      .trim()
      .replace(/\\/g, "/");

  if (
    !file ||
    file.startsWith("/") ||
    /^[A-Za-z]:\//.test(file) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(
      file
    ) ||
    file.split("/").includes("..")
  ) {
    return null;
  }

  return file;
}

function clearDevProblemsPanel() {
  devTerminalState.problems =
    emptyDevProblems();
  devTerminalState.problemsRefreshPending =
    false;

  devProblemsPanel.hidden = true;
  devProblemsTotal.textContent = "0";
  devProblemsErrors.textContent =
    "0 erreur";
  devProblemsWarnings.textContent =
    "0 warning";
  devProblemsInfos.textContent =
    "0 info";
  devProblemsState.textContent =
    "Aucun problème détecté";
  devProblemsState.dataset.state =
    "EMPTY";
  devProblemsList.replaceChildren();
  devProblemsTruncated.hidden = true;
  devProblemsTruncated.textContent = "";
}

function devProblemsPanelIsAllowed() {
  if (
    currentMode !== "DEV" ||
    !currentFocusId ||
    !currentFocusPath ||
    !devTerminalState.session ||
    !devTerminalState.contextKey
  ) {
    return false;
  }

  return (
    devTerminalState.contextKey ===
    `${currentFocusId}:${currentFocusPath}`
  );
}

function renderDevProblems(problems) {
  if (!devProblemsPanelIsAllowed()) {
    clearDevProblemsPanel();
    return;
  }

  const value =
    problems &&
    typeof problems === "object"
      ? problems
      : emptyDevProblems();

  const status =
    DEV_PROBLEMS_STATUSES.has(
      value.status
    )
      ? value.status
      : "UNRESOLVED";

  const diagnostics =
    status === "READY" &&
    Array.isArray(value.problems)
      ? value.problems
          .slice(0, 200)
          .map((problem) => {
            const file =
              safeDevProblemFile(
                problem?.file
              );

            const line =
              positiveDevProblemInteger(
                problem?.line
              );

            if (!file || !line) {
              return null;
            }

            const severity =
              DEV_PROBLEM_SEVERITIES.has(
                problem?.severity
              )
                ? problem.severity
                : "error";

            return {
              problem,
              file,
              line,
              column:
                positiveDevProblemInteger(
                  problem?.column
                ) || 1,
              severity,
            };
          })
          .filter(Boolean)
      : [];

  const severityCount = (severity) =>
    diagnostics.filter(
      (diagnostic) =>
        diagnostic.severity === severity
    ).length;

  const total = diagnostics.length;
  const errors = severityCount("error");
  const warnings = severityCount("warning");
  const infos = severityCount("info");

  devTerminalState.problems = value;
  devTerminalState.problemsRefreshPending =
    status === "RUNNING";
  devProblemsPanel.hidden = false;
  devProblemsPanel.dataset.state = status;
  devProblemsTotal.textContent =
    String(total);
  devProblemsErrors.textContent =
    `${errors} erreur${
      errors === 1 ? "" : "s"
    }`;
  devProblemsWarnings.textContent =
    `${warnings} warning${
      warnings === 1 ? "" : "s"
    }`;
  devProblemsInfos.textContent =
    `${infos} info${
      infos === 1 ? "" : "s"
    }`;

  const stateMessages = {
    RUNNING: "Validation en cours",
    EMPTY: "Aucun problème détecté",
    READY: total
      ? "Diagnostics de validation"
      : "Aucun problème détecté",
    CANCELLED:
      "Validation arrêtée par l’utilisateur",
    UNRESOLVED:
      "Validation échouée sans diagnostic localisable",
  };

  devProblemsState.textContent =
    stateMessages[status];
  devProblemsState.dataset.state = status;

  const fragment =
    document.createDocumentFragment();

  let displayed = 0;

  if (status === "READY") {
    for (const diagnostic of diagnostics) {
      const {
        problem,
        file,
        line,
        column,
        severity,
      } = diagnostic;

      const item =
        document.createElement("article");

      item.className =
        `dev-problem dev-problem--${severity}`;
      item.setAttribute(
        "role",
        "listitem"
      );

      const severityLabel =
        document.createElement("span");
      severityLabel.className =
        "dev-problem-severity";
      severityLabel.textContent =
        severity.toUpperCase();

      const location =
        document.createElement("span");
      location.className =
        "dev-problem-location";
      location.textContent =
        `${file}:${line}:${column}`;

      const message =
        document.createElement("span");
      message.className =
        "dev-problem-message";
      message.textContent =
        String(
          problem?.message ||
          "Erreur de validation."
        ).slice(0, 600);

      const meta =
        document.createElement("span");
      meta.className =
        "dev-problem-meta";

      const source =
        String(problem?.source || "")
          .slice(0, 40);

      const code =
        String(problem?.code || "")
          .slice(0, 100);

      meta.textContent =
        [code, source]
          .filter(Boolean)
          .join(" · ");

      item.append(
        severityLabel,
        location,
        message
      );

      if (meta.textContent) {
        item.append(meta);
      }

      fragment.append(item);
      displayed += 1;
    }
  }

  devProblemsList.replaceChildren(
    fragment
  );

  devProblemsTruncated.hidden =
    value.truncated !== true;

  devProblemsTruncated.textContent =
    value.truncated === true
      ? `Liste tronquée · ${displayed} résultat${
          displayed === 1 ? "" : "s"
        } affiché${
          displayed === 1 ? "" : "s"
        }`
      : "";
}

async function refreshDevProblems() {
  const sessionId =
    devTerminalState.session?.id ||
    null;

  const contextKey =
    devTerminalState.contextKey;

  const syncSerial =
    devTerminalState.syncSerial;

  if (
    !sessionId ||
    !contextKey ||
    !devProblemsPanelIsAllowed()
  ) {
    clearDevProblemsPanel();
    return;
  }

  try {
    const data =
      await devTerminalRequest(
        `/api/dev/workspace-terminal/sessions/${
          encodeURIComponent(sessionId)
        }`
      );

    if (
      currentMode !== "DEV" ||
      !currentFocusId ||
      !currentFocusPath ||
      syncSerial !==
        devTerminalState.syncSerial ||
      contextKey !==
        devTerminalState.contextKey ||
      contextKey !==
        `${currentFocusId}:${currentFocusPath}` ||
      sessionId !==
        devTerminalState.session?.id ||
      data.session?.id !== sessionId
    ) {
      return;
    }

    renderDevProblems(
      data.session.problems
    );
  } catch (error) {
    if (
      currentMode !== "DEV" ||
      !currentFocusId ||
      !currentFocusPath ||
      syncSerial !==
        devTerminalState.syncSerial ||
      contextKey !==
        devTerminalState.contextKey ||
      contextKey !==
        `${currentFocusId}:${currentFocusPath}` ||
      sessionId !==
        devTerminalState.session?.id
    ) {
      return;
    }

    if (
      error.code ===
      "DEV_WORKSPACE_NOT_FOUND"
    ) {
      clearDevProblemsPanel();
    }
  }
}

function shouldRefreshDevProblems() {
  return (
    devTerminalState
      .problemsRefreshPending === true ||
    devTerminalState.problems?.status ===
      "RUNNING"
  );
}

// DEV_PROBLEMS_UI_END


