function setDevTerminalStatus(message, state = "idle") {
  devTerminalStatus.textContent = message;
  devTerminalStatus.dataset.state = state;
}

function clearLastAuthorizedDevValidation() {
  devTerminalState.lastAuthorizedValidationCommand = null;
  devTerminalState.lastAuthorizedValidationSessionId = null;
  devTerminalState.lastAuthorizedValidationContextKey = null;
}

function lastAuthorizedDevValidationForActiveSession() {
  const sessionId = devTerminalState.session?.id || null;
  if (!sessionId ||
    devTerminalState.lastAuthorizedValidationSessionId !== sessionId ||
    devTerminalState.lastAuthorizedValidationContextKey !== devTerminalState.contextKey) return null;
  return devTerminalState.lastAuthorizedValidationCommand;
}

async function devTerminalRequest(
  route,
  {
    method = "GET",
    body,
  } = {}
) {
  const headers = {
    "X-Noon-Request": "1",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(route, {
    method,
    headers,
    cache: "no-store",
    body:
      body === undefined
        ? undefined
        : JSON.stringify(body),
  });

  let data;

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const error = new Error(
      data?.message ||
      "Terminal DEV indisponible."
    );

    error.code =
      data?.code ||
      "DEV_TERMINAL_REQUEST_FAILED";

    error.httpStatus =
      response.status;

    throw error;
  }

  return data;
}

function stopDevTerminalPolling() {
  if (devTerminalState.pollTimer !== null) {
    window.clearInterval(
      devTerminalState.pollTimer
    );

    devTerminalState.pollTimer = null;
  }
}

function setDevTerminalHeight(
  height,
  persist = true
) {
  devTerminalState.height =
    clampDevTerminalHeight(height);

  const value =
    `${devTerminalState.height}px`;

  devTerminalPanel.style.setProperty(
    "--dev-terminal-height",
    value
  );

  chatView.style.setProperty(
    "--dev-terminal-height",
    value
  );

  if (persist) {
    localStorage.setItem(
      DEV_TERMINAL_HEIGHT_STORAGE_KEY,
      String(devTerminalState.height)
    );
  }
}

function applyDevTerminalLayoutState() {
  devTerminalPanel.classList.toggle(
    "is-collapsed",
    devTerminalState.collapsed
  );

  devTerminalPanel.classList.toggle(
    "is-maximized",
    devTerminalState.maximized
  );

  chatView.classList.toggle(
    "dev-terminal-collapsed",
    devTerminalState.collapsed
  );

  chatView.classList.toggle(
    "dev-terminal-maximized",
    devTerminalState.maximized
  );

  devTerminalCollapseButton.setAttribute(
    "aria-expanded",
    String(!devTerminalState.collapsed)
  );

  devTerminalCollapseButton.setAttribute(
    "aria-label",
    devTerminalState.collapsed
      ? "Restaurer le terminal"
      : "Réduire le terminal"
  );

  devTerminalCollapseButton.title =
    devTerminalState.collapsed
      ? "Restaurer le terminal"
      : "Réduire le terminal";

  devTerminalCollapseButton.textContent =
    devTerminalState.collapsed
      ? "⌃"
      : "⌄";

  devTerminalMaximizeButton.setAttribute(
    "aria-pressed",
    String(devTerminalState.maximized)
  );

  devTerminalMaximizeButton.setAttribute(
    "aria-label",
    devTerminalState.maximized
      ? "Restaurer la taille du terminal"
      : "Maximiser le terminal"
  );

  devTerminalMaximizeButton.title =
    devTerminalState.maximized
      ? "Restaurer la taille du terminal"
      : "Maximiser le terminal";

  devTerminalMaximizeButton.textContent =
    devTerminalState.maximized
      ? "↙"
      : "□";
}

function setDevTerminalCollapsed(collapsed) {
  devTerminalState.collapsed =
    Boolean(collapsed);

  if (devTerminalState.collapsed) {
    devTerminalState.maximized = false;
  }

  applyDevTerminalLayoutState();

  if (!devTerminalState.collapsed) {
    requestAnimationFrame(() => {
      devTerminalInput.focus();
    });
  }
}

function toggleDevTerminalCollapsed() {
  setDevTerminalCollapsed(
    !devTerminalState.collapsed
  );
}

function toggleDevTerminalMaximized() {
  devTerminalState.maximized =
    !devTerminalState.maximized;

  if (devTerminalState.maximized) {
    devTerminalState.collapsed = false;
  }

  applyDevTerminalLayoutState();

  requestAnimationFrame(() => {
    devTerminalInput.focus();
  });
}

const DEV_TERMINAL_STATIC_COMPLETIONS = [
  "npm test",
  "npm run dev",
  "npm run build",
  "npm run lint",
  "npm run start",
  "npm run preview",
  "npm install",
  "npm ci",
  "node --test",
  "git status",
  "git diff",
  "git diff --staged",
  "git log --oneline -10",
  "git branch",
  "git switch",
  "git checkout",
  "git restore",
  "git show",
  "git fetch",
  "git pull",
  "git add",
  "git commit",
  "git push",
  "pwd",
  "ls",
  "ls -la",
];

const devTerminalCompletionPopup =
  document.createElement("div");

devTerminalCompletionPopup.className =
  "dev-terminal-completion";

devTerminalCompletionPopup.hidden =
  true;

devTerminalCompletionPopup.setAttribute(
  "role",
  "listbox"
);

devTerminalCompletionPopup.setAttribute(
  "aria-label",
  "Suggestions de commandes"
);

devTerminalForm.append(
  devTerminalCompletionPopup
);

function closeDevTerminalCompletion() {
  devTerminalState.completionItems = [];
  devTerminalState.completionIndex = -1;
  devTerminalState.completionQuery = "";

  devTerminalCompletionPopup.hidden =
    true;

  devTerminalCompletionPopup.replaceChildren();
}

function devTerminalCompletionCandidates(
  query
) {
  const normalized =
    String(query || "").trim();

  if (!normalized) {
    return [];
  }

  const lower =
    normalized.toLowerCase();

  const values = [
    ...[...devTerminalState.history].reverse(),
    ...DEV_TERMINAL_STATIC_COMPLETIONS,
  ];

  const seen =
    new Set();

  const results = [];

  for (const value of values) {
    const candidate =
      String(value || "").trim();

    if (
      !candidate ||
      candidate === normalized ||
      !candidate
        .toLowerCase()
        .startsWith(lower)
    ) {
      continue;
    }

    const key =
      candidate.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(candidate);

    if (results.length >= 8) {
      break;
    }
  }

  return results;
}

function renderDevTerminalCompletion() {
  devTerminalCompletionPopup.replaceChildren();

  const items =
    devTerminalState.completionItems;

  if (!items.length) {
    devTerminalCompletionPopup.hidden =
      true;
    return;
  }

  items.forEach(
    (value, index) => {
      const option =
        document.createElement("button");

      option.type = "button";
      option.className =
        "dev-terminal-completion-item";

      option.dataset.active =
        String(
          index ===
            devTerminalState.completionIndex
        );

      option.setAttribute(
        "role",
        "option"
      );

      option.setAttribute(
        "aria-selected",
        String(
          index ===
            devTerminalState.completionIndex
        )
      );

      option.textContent =
        value;

      option.addEventListener(
        "pointerdown",
        (event) => {
          event.preventDefault();

          devTerminalInput.value =
            value;

          closeDevTerminalCompletion();

          devTerminalInput.focus();
        }
      );

      devTerminalCompletionPopup.append(
        option
      );
    }
  );

  devTerminalCompletionPopup.hidden =
    false;

  const active =
    devTerminalCompletionPopup.querySelector(
      '[data-active="true"]'
    );

  active?.scrollIntoView({
    block: "nearest",
  });
}

async function fetchDevTerminalProjectCompletions(
  query
) {
  const sessionId =
    devTerminalState.session?.id;

  if (
    !sessionId ||
    !query
  ) {
    return [];
  }

  try {
    const data =
      await devTerminalRequest(
        `/api/dev/workspace-terminal/sessions/${
          encodeURIComponent(
            sessionId
          )
        }/completions?q=${
          encodeURIComponent(
            query
          )
        }`
      );

    return Array.isArray(
      data.completions
    )
      ? data.completions
          .filter(
            (item) =>
              typeof item ===
                "string" &&
              item.trim()
          )
          .slice(0, 40)
      : [];
  } catch {
    // L'autocomplétion ne doit jamais
    // empêcher l'usage normal du terminal.
    return [];
  }
}

function applyDevTerminalCompletionValue() {
  const selected =
    devTerminalState.completionItems[
      devTerminalState.completionIndex
    ];

  if (!selected) {
    return;
  }

  devTerminalInput.value =
    selected;

  devTerminalInput.setSelectionRange(
    selected.length,
    selected.length
  );

  renderDevTerminalCompletion();
}

async function cycleDevTerminalCompletion(
  direction = 1
) {
  const currentQuery =
    devTerminalInput.value;

  const currentPathToken =
    String(currentQuery || "")
      .trim()
      .split(/\s+/)
      .at(-1) || "";

  const currentHasParentTraversal =
    currentPathToken
      .split("/")
      .includes("..");

  if (currentHasParentTraversal) {
    closeDevTerminalCompletion();
    return false;
  }

  // Popup déjà ouverte :
  // on navigue dans les résultats existants.
  if (
    !devTerminalCompletionPopup.hidden &&
    devTerminalState.completionItems.length
  ) {
    const length =
      devTerminalState.completionItems.length;

    devTerminalState.completionIndex =
      (
        devTerminalState.completionIndex +
        direction +
        length
      ) % length;

    applyDevTerminalCompletionValue();

    return true;
  }

  const query =
    devTerminalInput.value;

  const pathToken =
    String(query || "")
      .trim()
      .split(/\s+/)
      .at(-1) || "";

  const hasParentTraversal =
    pathToken
      .split("/")
      .includes("..");

  const localItems =
    hasParentTraversal
      ? []
      : devTerminalCompletionCandidates(
          query
        );

  const projectItems =
    hasParentTraversal
      ? []
      : await fetchDevTerminalProjectCompletions(
          query
        );

  const seen =
    new Set();

  const items = [];

  for (
    const item of [
      ...projectItems,
      ...localItems,
    ]
  ) {
    const value =
      String(item || "").trim();

    const key =
      value.toLowerCase();

    if (
      !value ||
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    items.push(value);

    if (items.length >= 12) {
      break;
    }
  }

  if (!items.length) {
    closeDevTerminalCompletion();
    return false;
  }

  devTerminalState.completionItems =
    items;

  devTerminalState.completionQuery =
    query;

  devTerminalState.completionIndex =
    direction < 0
      ? items.length - 1
      : 0;

  applyDevTerminalCompletionValue();

  return true;
}

function persistDevTerminalHistory() {
  localStorage.setItem(
    DEV_TERMINAL_HISTORY_STORAGE_KEY,
    JSON.stringify(
      devTerminalState.history.slice(
        -DEV_TERMINAL_MAX_HISTORY
      )
    )
  );
}

function rememberDevTerminalCommand(command) {
  const value =
    String(command || "").trim();

  if (!value) return;

  const last =
    devTerminalState.history.at(-1);

  if (last !== value) {
    devTerminalState.history.push(
      value
    );

    if (
      devTerminalState.history.length >
      DEV_TERMINAL_MAX_HISTORY
    ) {
      devTerminalState.history.splice(
        0,
        devTerminalState.history.length -
          DEV_TERMINAL_MAX_HISTORY
      );
    }

    persistDevTerminalHistory();
  }

  devTerminalState.historyIndex = null;
  devTerminalState.historyDraft = "";
}

function navigateDevTerminalHistory(direction) {
  const history =
    devTerminalState.history;

  if (!history.length) {
    return false;
  }

  if (
    devTerminalState.historyIndex ===
    null
  ) {
    devTerminalState.historyDraft =
      devTerminalInput.value;

    devTerminalState.historyIndex =
      history.length;
  }

  const nextIndex =
    Math.max(
      0,
      Math.min(
        history.length,
        devTerminalState.historyIndex +
          direction
      )
    );

  devTerminalState.historyIndex =
    nextIndex;

  if (
    nextIndex === history.length
  ) {
    devTerminalInput.value =
      devTerminalState.historyDraft;
  } else {
    devTerminalInput.value =
      history[nextIndex];
  }

  requestAnimationFrame(() => {
    const end =
      devTerminalInput.value.length;

    devTerminalInput.setSelectionRange(
      end,
      end
    );
  });

  return true;
}

setDevTerminalHeight(
  devTerminalState.height,
  false
);

applyDevTerminalLayoutState();

function devTerminalBuffer(terminalId) {
  if (
    !devTerminalState.outputByTerminal.has(
      terminalId
    )
  ) {
    devTerminalState.outputByTerminal.set(
      terminalId,
      []
    );
  }

  return devTerminalState.outputByTerminal.get(
    terminalId
  );
}

function formatDevTerminalEvent(event) {
  const text = String(event?.text || "");

  if (event?.type === "command") {
    return `$ ${text}\n`;
  }

  return text;
}

let devTerminalSelectingOutput = false;

function hasActiveDevTerminalSelection() {
  const selection =
    window.getSelection();

  if (
    !selection ||
    selection.isCollapsed ||
    selection.rangeCount === 0
  ) {
    return false;
  }

  const anchorInside =
    selection.anchorNode &&
    devTerminalOutput.contains(
      selection.anchorNode
    );

  const focusInside =
    selection.focusNode &&
    devTerminalOutput.contains(
      selection.focusNode
    );

  return Boolean(
    anchorInside ||
    focusInside
  );
}

function isDevTerminalNearBottom() {
  const remaining =
    devTerminalOutput.scrollHeight -
    devTerminalOutput.scrollTop -
    devTerminalOutput.clientHeight;

  return remaining <= 24;
}

function rememberDevTerminalScrollState() {
  const terminalId =
    devTerminalState.activeTerminalId;

  if (!terminalId) return;

  devTerminalState.scrollByTerminal.set(
    terminalId,
    devTerminalOutput.scrollTop
  );

  devTerminalState.followOutputByTerminal.set(
    terminalId,
    isDevTerminalNearBottom()
  );
}

function devTerminalPendingOutputCount(
  terminalId =
    devTerminalState.activeTerminalId
) {
  if (!terminalId) {
    return 0;
  }

  return (
    devTerminalState.pendingOutputByTerminal.get(
      terminalId
    ) || 0
  );
}

function renderDevTerminalJumpBottom() {
  const terminalId =
    devTerminalState.activeTerminalId;

  if (
    !terminalId ||
    !devTerminalJumpBottomButton
  ) {
    return;
  }

  const following =
    devTerminalState.followOutputByTerminal.get(
      terminalId
    ) !== false;

  const count =
    devTerminalPendingOutputCount(
      terminalId
    );

  devTerminalJumpBottomButton.hidden =
    following;

  devTerminalJumpBottomButton.textContent =
    count > 0
      ? `↓ ${count} nouvelle${
          count > 1
            ? "s"
            : ""
        } sortie${
          count > 1
            ? "s"
            : ""
        }`
      : "↓ Revenir en bas";
}

function resetDevTerminalPendingOutput(
  terminalId =
    devTerminalState.activeTerminalId
) {
  if (!terminalId) {
    return;
  }

  devTerminalState.pendingOutputByTerminal.set(
    terminalId,
    0
  );

  renderDevTerminalJumpBottom();
}

function followDevTerminalOutput() {
  const terminalId =
    devTerminalState.activeTerminalId;

  if (!terminalId) {
    return;
  }

  devTerminalState.followOutputByTerminal.set(
    terminalId,
    true
  );

  devTerminalState.scrollByTerminal.set(
    terminalId,
    devTerminalOutput.scrollHeight
  );

  resetDevTerminalPendingOutput(
    terminalId
  );

  renderDevTerminalOutput();

  devTerminalOutput.scrollTop =
    devTerminalOutput.scrollHeight;

  rememberDevTerminalScrollState();
}

function getActiveDevTerminalOutputText() {
  const terminalId =
    devTerminalState.activeTerminalId;

  if (!terminalId) {
    return "";
  }

  return devTerminalBuffer(terminalId)
    .map((event) =>
      formatDevTerminalEvent(event)
    )
    .join("");
}

function safeDevTerminalLogName() {
  const terminal =
    devTerminalState.terminals.get(
      devTerminalState.activeTerminalId
    );

  const title =
    String(
      terminal?.title ||
      "terminal"
    )
      .normalize("NFKD")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9._-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) ||
    "terminal";

  const stamp =
    new Date()
      .toISOString()
      .replace(/[:.]/g, "-");

  return `noon-${title}-${stamp}.log`;
}

async function copyActiveDevTerminalOutput() {
  const text =
    getActiveDevTerminalOutputText();

  if (!text) {
    setDevTerminalStatus(
      "Aucune sortie à copier",
      "idle"
    );

    return;
  }

  try {
    await navigator.clipboard.writeText(
      text
    );

    setDevTerminalStatus(
      "Sortie copiée",
      "ready"
    );
  } catch {
    setDevTerminalStatus(
      "Copie impossible",
      "error"
    );
  }
}

function exportActiveDevTerminalOutput() {
  const text =
    getActiveDevTerminalOutputText();

  if (!text) {
    setDevTerminalStatus(
      "Aucune sortie à exporter",
      "idle"
    );

    return;
  }

  const url =
    URL.createObjectURL(
      new Blob(
        [text],
        {
          type: "text/plain;charset=utf-8",
        }
      )
    );

  const link =
    document.createElement("a");

  link.href = url;
  link.download =
    safeDevTerminalLogName();

  document.body.append(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);

  setDevTerminalStatus(
    "Log exporté",
    "ready"
  );
}

function renderDevTerminalOutput() {
  if (
    devTerminalSelectingOutput ||
    hasActiveDevTerminalSelection()
  ) {
    return;
  }

  const terminalId =
    devTerminalState.activeTerminalId;

  if (!terminalId) {
    devTerminalOutput.textContent =
      "Aucun terminal ouvert.\nClique sur + pour en créer un.";

    return;
  }

  const shouldFollow =
    devTerminalState.followOutputByTerminal.get(
      terminalId
    ) !== false;

  const savedScrollTop =
    devTerminalState.scrollByTerminal.get(
      terminalId
    ) || 0;

  const buffer =
    devTerminalBuffer(terminalId);

  if (!buffer.length) {
    devTerminalOutput.textContent =
      "Terminal prêt.\n";

    devTerminalOutput.scrollTop = 0;

    return;
  }

  const fragment =
    document.createDocumentFragment();

  for (const event of buffer) {
    const line =
      document.createElement("span");

    const type =
      String(
        event?.type ||
        "stdout"
      ).toLowerCase();

    line.className =
      `dev-terminal-output-chunk dev-terminal-output-chunk--${type}`;

    line.textContent =
      formatDevTerminalEvent(event);

    fragment.append(line);
  }

  devTerminalOutput.replaceChildren(
    fragment
  );

  if (shouldFollow) {
    devTerminalOutput.scrollTop =
      devTerminalOutput.scrollHeight;

    devTerminalState.pendingOutputByTerminal.set(
      terminalId,
      0
    );
  } else {
    devTerminalOutput.scrollTop =
      savedScrollTop;
  }

  renderDevTerminalJumpBottom();
}

devTerminalOutput.addEventListener(
  "scroll",
  () => {
    rememberDevTerminalScrollState();

    if (isDevTerminalNearBottom()) {
      resetDevTerminalPendingOutput();
    } else {
      renderDevTerminalJumpBottom();
    }
  },
  {
    passive: true,
  }
);

devTerminalJumpBottomButton.addEventListener(
  "click",
  () => {
    followDevTerminalOutput();
  }
);

devTerminalOutput.addEventListener(
  "pointerdown",
  () => {
    devTerminalSelectingOutput = true;
  }
);

window.addEventListener(
  "pointerup",
  () => {
    if (!devTerminalSelectingOutput) {
      return;
    }

    devTerminalSelectingOutput = false;

    if (!hasActiveDevTerminalSelection()) {
      renderDevTerminalOutput();
    }
  }
);
function updateDevTerminalHeader() {
  const session =
    devTerminalState.session;

  if (!session) {
    devTerminalProject.textContent =
      currentFocus ||
      "Aucun Focus";

    devTerminalMeta.textContent =
      currentFocusPath
        ? "Session terminal non ouverte."
        : "Sélectionne un projet Focus.";

    return;
  }

  devTerminalProject.textContent =
    session.projectName ||
    currentFocus ||
    "Projet DEV";

  const branch =
    session.branch
      ? `branche ${session.branch}`
      : "sans dépôt Git";

  const dirty =
    session.dirty === true
      ? " · modifications locales"
      : session.dirty === false
        ? " · Git propre"
        : "";

  devTerminalMeta.textContent =
    `${branch}${dirty}`;
}

function devTerminalIds() {
  return [
    ...devTerminalState.terminals.keys(),
  ];
}

function activateDevTerminal(
  terminalId,
  {
    focusTab = false,
  } = {}
) {
  if (
    !terminalId ||
    !devTerminalState.terminals.has(
      terminalId
    )
  ) {
    return false;
  }

  if (
    devTerminalState.activeTerminalId &&
    devTerminalState.activeTerminalId !==
      terminalId
  ) {
    rememberDevTerminalScrollState();
  }

  devTerminalState.activeTerminalId =
    terminalId;

  persistDevTerminalLayout();

  renderDevTerminalTabs();
  renderDevTerminalOutput();

  void pollActiveDevTerminal();

  if (focusTab) {
    const activeTab =
      devTerminalTabs.querySelector(
        '.dev-terminal-tab[data-active="true"]'
      );

    activeTab?.focus();
  }

  return true;
}

function moveDevTerminalSelection(
  direction,
  {
    focusTab = false,
  } = {}
) {
  const ids =
    devTerminalIds();

  if (!ids.length) {
    return false;
  }

  const currentIndex =
    Math.max(
      0,
      ids.indexOf(
        devTerminalState.activeTerminalId
      )
    );

  let nextIndex;

  if (direction === "first") {
    nextIndex = 0;
  } else if (direction === "last") {
    nextIndex =
      ids.length - 1;
  } else {
    const delta =
      direction < 0
        ? -1
        : 1;

    nextIndex =
      (
        currentIndex +
        delta +
        ids.length
      ) %
      ids.length;
  }

  return activateDevTerminal(
    ids[nextIndex],
    {
      focusTab,
    }
  );
}

