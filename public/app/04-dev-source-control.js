// DEV_SOURCE_CONTROL_UI_START

const DEV_SOURCE_CONTROL_SCOPES =
  new Set([
    "WORKTREE",
    "STAGED",
  ]);

const devSourceControlView = {
  open: false,
  inventory: null,
  selectedFile: null,
  scope: "WORKTREE",
  refreshSerial: 0,
  patchSerial: 0,
};

function emptyDevSourceControl() {
  return {
    status: "EMPTY",
    branch: null,
    detached: false,
    counts: {
      total: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
    },
    truncated: false,
    unsafeOmitted: 0,
    files: [],
  };
}

function safeDevSourceControlFile(value) {
  const file =
    String(value ?? "");

  if (
    !file ||
    file.includes("\0") ||
    file.includes("\n") ||
    file.includes("\r") ||
    file.startsWith("/") ||
    file.includes("\\") ||
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

function devSourceControlIsAllowed() {
  return (
    currentMode === "DEV" &&
    Boolean(currentFocusId) &&
    Boolean(currentFocusPath) &&
    Boolean(
      devTerminalState.session?.id
    ) &&
    Boolean(
      devTerminalState.contextKey
    ) &&
    devTerminalState.contextKey ===
      `${currentFocusId}:${currentFocusPath}`
  );
}

function setDevSourceControlState(
  message,
  state = "idle"
) {
  devSourceControlState.textContent =
    message;

  devSourceControlState.dataset.state =
    state;
}

function sourceControlEntry(file) {
  const inventory =
    devSourceControlView.inventory;

  if (
    !inventory ||
    !Array.isArray(inventory.files)
  ) {
    return null;
  }

  return (
    inventory.files.find(
      (entry) =>
        entry.file === file
    ) || null
  );
}

function defaultSourceControlScope(entry) {
  if (
    entry?.unstaged ||
    entry?.untracked
  ) {
    return "WORKTREE";
  }

  if (entry?.staged) {
    return "STAGED";
  }

  return "WORKTREE";
}

function sourceControlScopeAvailable(
  entry,
  scope
) {
  if (!entry) return false;

  if (scope === "STAGED") {
    return entry.staged === true;
  }

  return (
    entry.unstaged === true ||
    entry.untracked === true
  );
}

function syncDevSourceControlScopes() {
  const entry =
    sourceControlEntry(
      devSourceControlView.selectedFile
    );

  if (
    !sourceControlScopeAvailable(
      entry,
      devSourceControlView.scope
    )
  ) {
    devSourceControlView.scope =
      defaultSourceControlScope(entry);
  }

  for (const [
    button,
    scope,
  ] of [
    [
      devSourceControlWorktree,
      "WORKTREE",
    ],
    [
      devSourceControlStagedScope,
      "STAGED",
    ],
  ]) {
    button.disabled =
      !sourceControlScopeAvailable(
        entry,
        scope
      );

    button.setAttribute(
      "aria-pressed",
      String(
        devSourceControlView.scope ===
          scope
      )
    );
  }
}

function clearDevSourceControl({
  close = false,
} = {}) {
  devSourceControlView.refreshSerial += 1;
  devSourceControlView.patchSerial += 1;
  devSourceControlView.inventory =
    emptyDevSourceControl();
  devSourceControlView.selectedFile =
    null;
  devSourceControlView.scope =
    "WORKTREE";

  devSourceControlBranch.textContent =
    "—";
  devSourceControlTotal.textContent =
    "0 fichier";
  devSourceControlStaged.textContent =
    "0 staged";
  devSourceControlUnstaged.textContent =
    "0 modifié";
  devSourceControlUntracked.textContent =
    "0 untracked";
  devSourceControlConflicted.textContent =
    "0 conflit";

  devSourceControlFiles.replaceChildren();

  devSourceControlSelected.textContent =
    "Aucun fichier";

  devSourceControlPatch.textContent =
    "Sélectionne un fichier.";

  devSourceControlTruncated.hidden = true;
  devSourceControlTruncated.textContent =
    "";

  setDevSourceControlState(
    "Source Control prêt"
  );

  syncDevSourceControlScopes();

  if (close) {
    devSourceControlView.open =
      false;

    devSourceControlPanel.hidden =
      true;

    devTerminalPanel.classList.remove(
      "is-source-control"
    );

    devSourceControlToggle.setAttribute(
      "aria-pressed",
      "false"
    );

    devSourceControlToggle.title =
      "Source Control";

    devSourceControlToggle.setAttribute(
      "aria-label",
      "Afficher Source Control"
    );
  }
}

function renderDevSourceControlFiles() {
  const inventory =
    devSourceControlView.inventory ||
    emptyDevSourceControl();

  const files =
    Array.isArray(inventory.files)
      ? inventory.files
      : [];

  const fragment =
    document.createDocumentFragment();

  for (const entry of files) {
    const file =
      safeDevSourceControlFile(
        entry?.file
      );

    if (!file) continue;

    const button =
      document.createElement("button");

    button.type = "button";
    button.className =
      "dev-source-control-file";

    button.dataset.active =
      String(
        file ===
          devSourceControlView
            .selectedFile
      );

    const name =
      document.createElement("span");

    name.className =
      "dev-source-control-file-name";

    name.textContent =
      entry.originalFile &&
      entry.originalFile !== file
        ? `${entry.originalFile} → ${file}`
        : file;

    const badge =
      document.createElement("span");

    badge.className =
      "dev-source-control-file-status";

    badge.textContent =
      entry.conflicted
        ? "CONFLICT"
        : entry.untracked
          ? "U"
          : `${
              entry.staged
                ? "S"
                : ""
            }${
              entry.unstaged
                ? "M"
                : ""
            }` || "M";

    if (entry.sensitive) {
      badge.textContent += " · PRIVATE";
    }

    button.append(
      name,
      badge
    );

    button.addEventListener(
      "click",
      () => {
        devSourceControlView
          .selectedFile = file;

        devSourceControlView.scope =
          defaultSourceControlScope(
            entry
          );

        renderDevSourceControlFiles();
        syncDevSourceControlScopes();

        void loadDevSourceControlPatch();
      }
    );

    fragment.append(button);
  }

  devSourceControlFiles.replaceChildren(
    fragment
  );
}

function renderDevSourceControlInventory(
  value
) {
  if (
    !devSourceControlView.open ||
    !devSourceControlIsAllowed()
  ) {
    return;
  }

  const inventory =
    value &&
    typeof value === "object"
      ? value
      : emptyDevSourceControl();

  const files =
    Array.isArray(inventory.files)
      ? inventory.files
          .slice(0, 250)
          .filter(
            (entry) =>
              safeDevSourceControlFile(
                entry?.file
              )
          )
      : [];

  devSourceControlView.inventory = {
    ...inventory,
    files,
  };

  const counts =
    inventory.counts || {};

  const total =
    Math.max(
      0,
      Number(counts.total) || 0
    );

  const staged =
    Math.max(
      0,
      Number(counts.staged) || 0
    );

  const unstaged =
    Math.max(
      0,
      Number(counts.unstaged) || 0
    );

  const untracked =
    Math.max(
      0,
      Number(counts.untracked) || 0
    );

  const conflicted =
    Math.max(
      0,
      Number(counts.conflicted) || 0
    );

  devSourceControlBranch.textContent =
    inventory.branch
      ? `${
          inventory.detached
            ? "detached · "
            : ""
        }${inventory.branch}`
      : "Git";

  devSourceControlTotal.textContent =
    `${total} fichier${
      total === 1 ? "" : "s"
    }`;

  devSourceControlStaged.textContent =
    `${staged} staged`;

  devSourceControlUnstaged.textContent =
    `${unstaged} modifié${
      unstaged === 1 ? "" : "s"
    }`;

  devSourceControlUntracked.textContent =
    `${untracked} untracked`;

  devSourceControlConflicted.textContent =
    `${conflicted} conflit${
      conflicted === 1 ? "" : "s"
    }`;

  const unsafeOmitted =
    Math.max(
      0,
      Number(
        inventory.unsafeOmitted
      ) || 0
    );

  const notices = [];

  if (inventory.truncated === true) {
    notices.push(
      "Liste tronquée à 250 fichiers"
    );
  }

  if (unsafeOmitted > 0) {
    notices.push(
      `${unsafeOmitted} entrée${
        unsafeOmitted === 1 ? "" : "s"
      } masquée${
        unsafeOmitted === 1 ? "" : "s"
      } pour sécurité`
    );
  }

  devSourceControlTruncated.hidden =
    notices.length === 0;

  devSourceControlTruncated.textContent =
    notices.join(" · ");

  const selectedStillExists =
    files.some(
      (entry) =>
        entry.file ===
        devSourceControlView
          .selectedFile
    );

  if (!selectedStillExists) {
    devSourceControlView.selectedFile =
      files[0]?.file || null;

    devSourceControlView.scope =
      defaultSourceControlScope(
        files[0]
      );
  }

  renderDevSourceControlFiles();
  syncDevSourceControlScopes();

  if (!files.length) {
    devSourceControlSelected.textContent =
      "Aucun fichier";

    devSourceControlPatch.textContent =
      "Aucune modification Git.";

    setDevSourceControlState(
      "Working tree propre",
      "ready"
    );
  }
}

function renderDevSourceControlPatch(
  diff
) {
  const entry =
    sourceControlEntry(
      devSourceControlView.selectedFile
    );

  if (!entry) {
    devSourceControlSelected.textContent =
      "Aucun fichier";

    devSourceControlPatch.textContent =
      "Aucune modification Git.";

    return;
  }

  devSourceControlSelected.textContent =
    entry.originalFile &&
    entry.originalFile !== entry.file
      ? `${entry.originalFile} → ${entry.file}`
      : entry.file;

  const status =
    String(
      diff?.status || "EMPTY"
    );

  if (status === "REDACTED") {
    devSourceControlPatch.textContent =
      "Contenu masqué : fichier sensible.";

    setDevSourceControlState(
      "Diff masqué pour protéger les données privées",
      "ready"
    );

    return;
  }

  if (status === "UNTRACKED") {
    devSourceControlPatch.textContent =
      "Fichier non suivi.\n\nSon contenu n’est pas lu automatiquement.";

    setDevSourceControlState(
      "Fichier untracked · contenu non chargé",
      "ready"
    );

    return;
  }

  if (status === "EMPTY") {
    devSourceControlPatch.textContent =
      "Aucune différence pour ce scope.";

    setDevSourceControlState(
      `${devSourceControlView.scope} · aucune différence`,
      "ready"
    );

    return;
  }

  const patch =
    typeof diff?.patch === "string"
      ? diff.patch
      : "";

  if (diff?.binary === true && !patch) {
    devSourceControlPatch.textContent =
      "Fichier binaire modifié.";
  } else {
    devSourceControlPatch.textContent =
      patch ||
      "Aucune différence.";
  }

  const additions =
    Number.isFinite(
      Number(diff?.additions)
    )
      ? Number(diff.additions)
      : null;

  const deletions =
    Number.isFinite(
      Number(diff?.deletions)
    )
      ? Number(diff.deletions)
      : null;

  const stats = [
    devSourceControlView.scope,
    additions === null
      ? null
      : `+${additions}`,
    deletions === null
      ? null
      : `-${deletions}`,
    diff?.binary
      ? "binaire"
      : null,
    diff?.truncated
      ? "patch tronqué"
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  setDevSourceControlState(
    stats || "Diff prêt",
    "ready"
  );
}

function devSourceControlContextValid({
  sessionId,
  contextKey,
  syncSerial,
} = {}) {
  return (
    devSourceControlView.open === true &&
    currentMode === "DEV" &&
    Boolean(currentFocusId) &&
    Boolean(currentFocusPath) &&
    syncSerial ===
      devTerminalState.syncSerial &&
    contextKey ===
      devTerminalState.contextKey &&
    contextKey ===
      `${currentFocusId}:${currentFocusPath}` &&
    sessionId ===
      devTerminalState.session?.id
  );
}

async function loadDevSourceControlPatch() {
  const file =
    safeDevSourceControlFile(
      devSourceControlView.selectedFile
    );

  const scope =
    DEV_SOURCE_CONTROL_SCOPES.has(
      devSourceControlView.scope
    )
      ? devSourceControlView.scope
      : "WORKTREE";

  const sessionId =
    devTerminalState.session?.id ||
    null;

  const contextKey =
    devTerminalState.contextKey;

  const syncSerial =
    devTerminalState.syncSerial;

  const patchSerial =
    ++devSourceControlView.patchSerial;

  if (
    !file ||
    !sessionId ||
    !contextKey ||
    !devSourceControlIsAllowed()
  ) {
    return;
  }

  setDevSourceControlState(
    "Chargement du diff…",
    "running"
  );

  try {
    const data =
      await devTerminalRequest(
        `/api/dev/workspace-terminal/sessions/${
          encodeURIComponent(sessionId)
        }/git-diff/file?file=${
          encodeURIComponent(file)
        }&scope=${
          encodeURIComponent(scope)
        }`
      );

    if (
      patchSerial !==
        devSourceControlView.patchSerial ||
      !devSourceControlContextValid({
        sessionId,
        contextKey,
        syncSerial,
      }) ||
      file !==
        devSourceControlView.selectedFile ||
      scope !==
        devSourceControlView.scope
    ) {
      return;
    }

    renderDevSourceControlPatch(
      data.diff
    );
  } catch (error) {
    if (
      patchSerial !==
        devSourceControlView.patchSerial ||
      !devSourceControlContextValid({
        sessionId,
        contextKey,
        syncSerial,
      })
    ) {
      return;
    }

    devSourceControlPatch.textContent =
      "Impossible de charger ce diff.";

    setDevSourceControlState(
      error.message,
      "error"
    );
  }
}

async function refreshDevSourceControl() {
  const sessionId =
    devTerminalState.session?.id ||
    null;

  const contextKey =
    devTerminalState.contextKey;

  const syncSerial =
    devTerminalState.syncSerial;

  const refreshSerial =
    ++devSourceControlView.refreshSerial;

  devSourceControlView.patchSerial += 1;

  if (
    !sessionId ||
    !contextKey ||
    !devSourceControlIsAllowed()
  ) {
    clearDevSourceControl({
      close: true,
    });

    return;
  }

  setDevSourceControlState(
    "Lecture du dépôt…",
    "running"
  );

  devSourceControlRefresh.disabled =
    true;

  try {
    const data =
      await devTerminalRequest(
        `/api/dev/workspace-terminal/sessions/${
          encodeURIComponent(sessionId)
        }/git-diff`
      );

    if (
      refreshSerial !==
        devSourceControlView.refreshSerial ||
      !devSourceControlContextValid({
        sessionId,
        contextKey,
        syncSerial,
      })
    ) {
      return;
    }

    renderDevSourceControlInventory(
      data.gitDiff
    );

    if (
      devSourceControlView.selectedFile
    ) {
      await loadDevSourceControlPatch();
    }
  } catch (error) {
    if (
      refreshSerial !==
        devSourceControlView.refreshSerial ||
      !devSourceControlContextValid({
        sessionId,
        contextKey,
        syncSerial,
      })
    ) {
      return;
    }

    if (
      error.code ===
      "DEV_WORKSPACE_NOT_FOUND"
    ) {
      clearDevSourceControl({
        close: true,
      });

      return;
    }

    setDevSourceControlState(
      error.message,
      "error"
    );

    devSourceControlPatch.textContent =
      "Source Control indisponible.";
  } finally {
    if (
      refreshSerial ===
        devSourceControlView.refreshSerial
    ) {
      devSourceControlRefresh.disabled =
        false;
    }
  }
}

function setDevSourceControlOpen(open) {
  const next =
    Boolean(open);

  if (
    next &&
    !devSourceControlIsAllowed()
  ) {
    setDevTerminalStatus(
      "Sélectionne un Focus DEV avant d’ouvrir Source Control.",
      "error"
    );

    return false;
  }

  devSourceControlView.open =
    next;

  if (
    next &&
    devTerminalState.collapsed
  ) {
    devTerminalState.collapsed =
      false;

    applyDevTerminalLayoutState();
  }

  devSourceControlPanel.hidden =
    !next;

  devTerminalPanel.classList.toggle(
    "is-source-control",
    next
  );

  devSourceControlToggle.setAttribute(
    "aria-pressed",
    String(next)
  );

  const sourceControlToggleLabel =
    next
      ? "Retour au Terminal"
      : "Afficher Source Control";

  devSourceControlToggle.title =
    sourceControlToggleLabel;

  devSourceControlToggle.setAttribute(
    "aria-label",
    sourceControlToggleLabel
  );

  if (!next) {
    devTerminalInput.focus();
  }

  return true;
}

devSourceControlToggle.addEventListener(
  "click",
  () => {
    const next =
      !devSourceControlView.open;

    if (
      !setDevSourceControlOpen(next)
    ) {
      return;
    }

    if (next) {
      void refreshDevSourceControl();
    }
  }
);

devSourceControlRefresh.addEventListener(
  "click",
  () => {
    void refreshDevSourceControl();
  }
);

for (const [
  button,
  scope,
] of [
  [
    devSourceControlWorktree,
    "WORKTREE",
  ],
  [
    devSourceControlStagedScope,
    "STAGED",
  ],
]) {
  button.addEventListener(
    "click",
    () => {
      const entry =
        sourceControlEntry(
          devSourceControlView
            .selectedFile
        );

      if (
        !sourceControlScopeAvailable(
          entry,
          scope
        )
      ) {
        return;
      }

      devSourceControlView.scope =
        scope;

      syncDevSourceControlScopes();

      void loadDevSourceControlPatch();
    }
  );
}

// DEV_SOURCE_CONTROL_UI_END

