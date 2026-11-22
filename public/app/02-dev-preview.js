// DEV_PREVIEW_UI_START
// Le contenu Web n'entre jamais dans le renderer Noon.
// Ce bloc ne manipule que le chrome UI et les coordonnées
// transmises à la vue native sandboxée du main process.

const devPreviewPanel =
  document.getElementById(
    "devPreviewPanel"
  );

const devPreviewProject =
  document.getElementById(
    "devPreviewProject"
  );

const devPreviewForm =
  document.getElementById(
    "devPreviewForm"
  );

const devPreviewUrlInput =
  document.getElementById(
    "devPreviewUrl"
  );

const devPreviewOpenButton =
  document.getElementById(
    "devPreviewOpen"
  );

const devPreviewBackButton =
  document.getElementById(
    "devPreviewBack"
  );

const devPreviewForwardButton =
  document.getElementById(
    "devPreviewForward"
  );

const devPreviewReloadButton =
  document.getElementById(
    "devPreviewReload"
  );

const devPreviewExternalButton =
  document.getElementById(
    "devPreviewExternal"
  );

const devPreviewCloseButton =
  document.getElementById(
    "devPreviewClose"
  );

const devPreviewViewport =
  document.getElementById(
    "devPreviewViewport"
  );

const devPreviewPlaceholder =
  document.getElementById(
    "devPreviewPlaceholder"
  );

const devPreviewStatus =
  document.getElementById(
    "devPreviewStatus"
  );

const devWorkspaceComposer =
  document.querySelector(
    ".composer"
  );

// DEV_WORKSPACE_CONSERVATIVE_V5_START

const devPreviewResizeHandle =
  document.getElementById(
    "devPreviewResizeHandle"
  );

const devWorkspaceChatHeader =
  chatView.querySelector(
    ".chat-header"
  );

const DEV_PREVIEW_WIDTH_STORAGE_KEY =
  "noonDevPreviewWidth";

const DEV_PREVIEW_MIN_WIDTH = 300;
const DEV_LEFT_MIN_WIDTH = 320;
const DEV_PREVIEW_SPLITTER_WIDTH = 12;
const DEV_PREVIEW_GAP = 12;
const DEV_WORKSPACE_COMPOSER_GAP = 40;

let devPreviewWidth = null;

const devPreviewResizeState = {
  active: false,
  startX: 0,
  startWidth: 0,
  nativeWasVisible: false,
};

// DEV_WORKSPACE_CONSERVATIVE_V5_END

const DEV_PREVIEW_URL_STORAGE_KEY =
  "noonDevPreviewUrl";

const devPreviewState = {
  contextKey: null,
  syncSerial: 0,
  boundsTimer: null,

  native: {
    status: "CLOSED",
    url: null,
    title: null,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    visible: false,
    error: null,
  },
};

devPreviewUrlInput.value =
  localStorage.getItem(
    DEV_PREVIEW_URL_STORAGE_KEY
  ) || "";

function devPreviewHorizontalInset() {
  return window.matchMedia(
    "(max-width: 1100px)"
  ).matches
    ? 12
    : 26;
}

function devPreviewAvailableWidth() {
  const rect =
    chatView.getBoundingClientRect();

  const inset =
    devPreviewHorizontalInset();

  return Math.max(
    640,
    rect.width -
      inset * 2
  );
}

function maxDevPreviewWidth() {
  return Math.max(
    DEV_PREVIEW_MIN_WIDTH,
    devPreviewAvailableWidth() -
      DEV_LEFT_MIN_WIDTH -
      DEV_PREVIEW_SPLITTER_WIDTH -
      DEV_PREVIEW_GAP
  );
}

function defaultDevPreviewWidth() {
  return Math.round(
    devPreviewAvailableWidth() *
      0.52
  );
}

function clampDevPreviewWidth(value) {
  const numeric =
    Number(value);

  const candidate =
    Number.isFinite(numeric)
      ? numeric
      : defaultDevPreviewWidth();

  return Math.min(
    maxDevPreviewWidth(),
    Math.max(
      DEV_PREVIEW_MIN_WIDTH,
      Math.round(candidate)
    )
  );
}

function loadDevPreviewWidth() {
  return clampDevPreviewWidth(
    localStorage.getItem(
      DEV_PREVIEW_WIDTH_STORAGE_KEY
    ) ||
    defaultDevPreviewWidth()
  );
}

function applyDevPreviewWidth(
  width,
  persist = true
) {
  devPreviewWidth =
    clampDevPreviewWidth(
      width
    );

  chatView.style.setProperty(
    "--dev-preview-width",
    `${devPreviewWidth}px`
  );

  devPreviewResizeHandle
    .setAttribute(
      "aria-valuemin",
      String(
        DEV_PREVIEW_MIN_WIDTH
      )
    );

  devPreviewResizeHandle
    .setAttribute(
      "aria-valuemax",
      String(
        maxDevPreviewWidth()
      )
    );

  devPreviewResizeHandle
    .setAttribute(
      "aria-valuenow",
      String(
        devPreviewWidth
      )
    );

  if (persist) {
    localStorage.setItem(
      DEV_PREVIEW_WIDTH_STORAGE_KEY,
      String(devPreviewWidth)
    );
  }

  scheduleDevPreviewBounds();

  return devPreviewWidth;
}

function devPreviewApiAvailable() {
  return Boolean(
    window.noon?.devPreviewOpen &&
    window.noon?.devPreviewClose &&
    window.noon?.devPreviewSetBounds
  );
}

function currentDevPreviewContextKey() {
  if (
    currentMode !== "DEV" ||
    !currentFocusId ||
    !currentFocusPath
  ) {
    return null;
  }

  return `${currentFocusId}:${currentFocusPath}`;
}

function syncDevPreviewResizeHandle() {
  const enabled =
    currentMode === "DEV" &&
    Boolean(
      currentFocusId &&
      currentFocusPath
    ) &&
    !devPreviewPanel.hidden;

  devPreviewResizeHandle.hidden =
    !enabled;

  devPreviewResizeHandle
    .setAttribute(
      "aria-hidden",
      enabled
        ? "false"
        : "true"
    );
}

function devPreviewIsOpen() {
  const state =
    devPreviewState.native;

  return (
    state.status !== "CLOSED" &&
    (
      Boolean(state.url) ||
      state.status === "LOADING" ||
      state.status === "READY" ||
      state.status === "ERROR"
    )
  );
}

function setDevPreviewStatus(
  message,
  state = "idle"
) {
  devPreviewStatus.textContent =
    String(message || "");

  devPreviewStatus.dataset.state =
    state;
}

function renderDevPreviewState() {
  const state =
    devPreviewState.native;

  const open =
    devPreviewIsOpen();

  devPreviewBackButton.disabled =
    !open ||
    !state.canGoBack;

  devPreviewForwardButton.disabled =
    !open ||
    !state.canGoForward;

  devPreviewReloadButton.disabled =
    !open;

  devPreviewExternalButton.disabled =
    !state.url;

  devPreviewCloseButton.disabled =
    !open;

  if (
    state.url &&
    document.activeElement !==
      devPreviewUrlInput
  ) {
    devPreviewUrlInput.value =
      state.url;

    localStorage.setItem(
      DEV_PREVIEW_URL_STORAGE_KEY,
      state.url
    );
  }

  devPreviewViewport.dataset.state =
    state.status ||
    "CLOSED";

  if (open) {
    devPreviewPlaceholder.hidden =
      true;
  } else {
    devPreviewPlaceholder.hidden =
      false;
  }

  if (
    state.status === "LOADING" ||
    state.loading
  ) {
    setDevPreviewStatus(
      "Chargement…",
      "running"
    );

    return;
  }

  if (
    state.status === "ERROR"
  ) {
    setDevPreviewStatus(
      state.error?.message ||
        "Preview indisponible",
      "error"
    );

    return;
  }

  if (
    state.status === "READY"
  ) {
    setDevPreviewStatus(
      "Preview actif",
      "ready"
    );

    return;
  }

  if (
    state.status === "IDLE"
  ) {
    setDevPreviewStatus(
      "Prêt",
      "ready"
    );

    return;
  }

  setDevPreviewStatus(
    "En attente",
    "idle"
  );
}

function applyDevPreviewState(state) {
  if (
    !state ||
    typeof state !== "object"
  ) {
    return;
  }

  devPreviewState.native = {
    ...devPreviewState.native,
    ...state,
  };

  renderDevPreviewState();

  if (devPreviewIsOpen()) {
    scheduleDevPreviewBounds();
  }
}

let devTerminalWorkspaceClampFrame =
  null;

function scheduleDevTerminalWorkspaceClamp() {
  if (
    devTerminalWorkspaceClampFrame !==
    null
  ) {
    return;
  }

  devTerminalWorkspaceClampFrame =
    window.requestAnimationFrame(
      () => {
        devTerminalWorkspaceClampFrame =
          null;

        setDevTerminalHeight(
          devTerminalState.height,
          false
        );
      }
    );
}

function syncDevWorkspaceBottomInset() {
  if (
    !devWorkspaceComposer ||
    !chatView
  ) {
    return;
  }

  const composerRect =
    devWorkspaceComposer
      .getBoundingClientRect();

  const chatRect =
    chatView
      .getBoundingClientRect();

  const inset =
    Math.max(
      104,
      Math.ceil(
        chatRect.bottom -
        composerRect.top +
        DEV_WORKSPACE_COMPOSER_GAP
      )
    );

  chatView.style.setProperty(
    "--dev-workspace-bottom",
    `${inset}px`
  );

  scheduleDevPreviewBounds();
  scheduleDevTerminalWorkspaceClamp();
}

function devPreviewBounds() {
  if (
    devPreviewPanel.hidden ||
    !devPreviewViewport
  ) {
    return null;
  }

  const rect =
    devPreviewViewport
      .getBoundingClientRect();

  const bounds = {
    x:
      Math.max(
        0,
        Math.round(rect.left)
      ),

    y:
      Math.max(
        0,
        Math.round(rect.top)
      ),

    width:
      Math.max(
        0,
        Math.round(rect.width)
      ),

    height:
      Math.max(
        0,
        Math.round(rect.height)
      ),
  };

  if (
    bounds.width < 120 ||
    bounds.height < 90
  ) {
    return null;
  }

  return bounds;
}

function scheduleDevPreviewBounds() {
  if (
    !devPreviewIsOpen() ||
    !devPreviewApiAvailable() ||
    devPreviewPanel.hidden ||
    !chatView.classList.contains(
      "active"
    ) ||
    chatView.classList.contains(
      "dev-terminal-maximized"
    )
  ) {
    return;
  }

  if (
    devPreviewState.boundsTimer !==
    null
  ) {
    return;
  }

  // Le registrar IPC est volontairement borné.
  // On plafonne donc le resize à ~8 appels/s.
  devPreviewState.boundsTimer =
    window.setTimeout(
      async () => {
        devPreviewState.boundsTimer =
          null;

        const bounds =
          devPreviewBounds();

        if (!bounds) {
          return;
        }

        try {
          await window.noon
            .devPreviewSetBounds(
              bounds
            );
        } catch (error) {
          setDevPreviewStatus(
            error.message,
            "error"
          );
        }
      },
      125
    );
}

async function syncDevPreviewNativeVisibility() {
  if (
    !devPreviewApiAvailable() ||
    !devPreviewIsOpen() ||
    !window.noon
      ?.devPreviewSetVisible
  ) {
    return;
  }

  const visible =
    chatView.classList.contains(
      "active"
    ) &&
    !devPreviewPanel.hidden &&
    !chatView.classList.contains(
      "dev-terminal-maximized"
    );

  try {
    const state =
      await window.noon
        .devPreviewSetVisible(
          visible
        );

    applyDevPreviewState(
      state
    );

    if (visible) {
      scheduleDevPreviewBounds();
    }
  } catch (error) {
    setDevPreviewStatus(
      error.message,
      "error"
    );
  }
}

async function closeDevPreview() {
  if (
    !devPreviewApiAvailable()
  ) {
    devPreviewState.native = {
      ...devPreviewState.native,
      status: "CLOSED",
      url: null,
      visible: false,
      loading: false,
      error: null,
    };

    renderDevPreviewState();
    return;
  }

  try {
    const state =
      await window.noon
        .devPreviewClose();

    applyDevPreviewState(
      state
    );
  } catch (error) {
    setDevPreviewStatus(
      error.message,
      "error"
    );
  }
}

async function syncDevPreviewPanel() {
  const serial =
    ++devPreviewState.syncSerial;

  const nextContextKey =
    currentDevPreviewContextKey();

  const contextChanged =
    Boolean(
      devPreviewState.contextKey &&
      devPreviewState.contextKey !==
        nextContextKey
    );

  if (
    !nextContextKey ||
    contextChanged
  ) {
    await closeDevPreview();

    if (
      serial !==
      devPreviewState.syncSerial
    ) {
      return;
    }
  }

  devPreviewState.contextKey =
    nextContextKey;

  const active =
    Boolean(nextContextKey);

  devPreviewPanel.hidden =
    !active;

  chatView.classList.toggle(
    "dev-preview-active",
    active
  );

  syncDevPreviewResizeHandle();

  if (!active) {
    return;
  }

  devPreviewProject.textContent =
    currentFocus ||
    "Projet DEV";

  if (
    !devPreviewApiAvailable()
  ) {
    setDevPreviewStatus(
      "Preview natif indisponible",
      "error"
    );

    devPreviewOpenButton.disabled =
      true;

    return;
  }

  devPreviewOpenButton.disabled =
    false;

  renderDevPreviewState();

  await syncDevPreviewNativeVisibility();
}

devPreviewForm.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    const url =
      devPreviewUrlInput.value.trim();

    if (!url) {
      setDevPreviewStatus(
        "Saisis une URL locale.",
        "error"
      );

      devPreviewUrlInput.focus();
      return;
    }

    if (
      !devPreviewApiAvailable()
    ) {
      setDevPreviewStatus(
        "Preview natif indisponible",
        "error"
      );

      return;
    }

    const bounds =
      devPreviewBounds();

    if (!bounds) {
      setDevPreviewStatus(
        "Zone Preview trop petite.",
        "error"
      );

      return;
    }

    devPreviewOpenButton.disabled =
      true;

    setDevPreviewStatus(
      "Ouverture…",
      "running"
    );

    try {
      localStorage.setItem(
        DEV_PREVIEW_URL_STORAGE_KEY,
        url
      );

      const state =
        await window.noon
          .devPreviewOpen({
            url,
            bounds,
          });

      applyDevPreviewState(
        state
      );

      scheduleDevPreviewBounds();
    } catch (error) {
      setDevPreviewStatus(
        error.message,
        "error"
      );
    } finally {
      devPreviewOpenButton.disabled =
        false;
    }
  }
);

devPreviewBackButton.addEventListener(
  "click",
  async () => {
    try {
      applyDevPreviewState(
        await window.noon
          .devPreviewBack()
      );
    } catch (error) {
      setDevPreviewStatus(
        error.message,
        "error"
      );
    }
  }
);

devPreviewForwardButton.addEventListener(
  "click",
  async () => {
    try {
      applyDevPreviewState(
        await window.noon
          .devPreviewForward()
      );
    } catch (error) {
      setDevPreviewStatus(
        error.message,
        "error"
      );
    }
  }
);

devPreviewReloadButton.addEventListener(
  "click",
  async () => {
    try {
      applyDevPreviewState(
        await window.noon
          .devPreviewReload()
      );
    } catch (error) {
      setDevPreviewStatus(
        error.message,
        "error"
      );
    }
  }
);

devPreviewCloseButton.addEventListener(
  "click",
  () => {
    void closeDevPreview();
  }
);

devPreviewExternalButton.addEventListener(
  "click",
  async () => {
    const url =
      devPreviewState.native.url ||
      devPreviewUrlInput.value.trim();

    if (
      !url ||
      !window.noon
        ?.devPreviewOpenExternal
    ) {
      return;
    }

    try {
      await window.noon
        .devPreviewOpenExternal(
          url
        );
    } catch (error) {
      setDevPreviewStatus(
        error.message,
        "error"
      );
    }
  }
);

devPreviewResizeHandle.addEventListener(
  "pointerdown",
  async (event) => {
    if (
      devPreviewResizeHandle.hidden ||
      chatView.classList.contains(
        "dev-terminal-maximized"
      )
    ) {
      return;
    }

    event.preventDefault();

    devPreviewResizeState.active =
      true;

    devPreviewResizeState.startX =
      event.clientX;

    devPreviewResizeState.startWidth =
      devPreviewWidth;

    devPreviewResizeState.nativeWasVisible =
      Boolean(
        devPreviewIsOpen() &&
        devPreviewState.native.visible
      );

    devPreviewResizeHandle
      .setPointerCapture?.(
        event.pointerId
      );

    document.body.classList.add(
      "dev-preview-resizing"
    );

    if (
      devPreviewResizeState
        .nativeWasVisible &&
      window.noon
        ?.devPreviewSetVisible
    ) {
      try {
        await window.noon
          .devPreviewSetVisible(
            false
          );
      } catch {
        // Le resize du chrome reste utilisable.
      }
    }
  }
);

window.addEventListener(
  "pointermove",
  (event) => {
    if (
      !devPreviewResizeState.active
    ) {
      return;
    }

    const delta =
      devPreviewResizeState.startX -
      event.clientX;

    applyDevPreviewWidth(
      devPreviewResizeState
        .startWidth +
        delta,
      false
    );
  }
);

async function finishDevPreviewResize() {
  if (
    !devPreviewResizeState.active
  ) {
    return;
  }

  devPreviewResizeState.active =
    false;

  document.body.classList.remove(
    "dev-preview-resizing"
  );

  applyDevPreviewWidth(
    devPreviewWidth,
    true
  );

  if (
    devPreviewResizeState
      .nativeWasVisible &&
    window.noon
      ?.devPreviewSetVisible
  ) {
    try {
      await window.noon
        .devPreviewSetVisible(
          true
        );

      scheduleDevPreviewBounds();
    } catch {
      // L'état Preview sera resynchronisé ensuite.
    }
  }

  devPreviewResizeState
    .nativeWasVisible = false;
}

window.addEventListener(
  "pointerup",
  () => {
    void finishDevPreviewResize();
  }
);

window.addEventListener(
  "pointercancel",
  () => {
    void finishDevPreviewResize();
  }
);

devPreviewResizeHandle.addEventListener(
  "keydown",
  (event) => {
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
      ].includes(
        event.key
      ) ||
      devPreviewResizeHandle.hidden
    ) {
      return;
    }

    event.preventDefault();

    const step =
      event.shiftKey
        ? 80
        : 30;

    applyDevPreviewWidth(
      devPreviewWidth +
        (
          event.key ===
          "ArrowLeft"
            ? step
            : -step
        )
    );
  }
);

window.noon
  ?.onDevPreviewState?.(
    (state) => {
      if (
        !devPreviewState.contextKey
      ) {
        return;
      }

      applyDevPreviewState(
        state
      );
    }
  );

window.addEventListener(
  "resize",
  () => {
    syncDevWorkspaceBottomInset();

    applyDevPreviewWidth(
      devPreviewWidth,
      false
    );

    setDevTerminalHeight(
      devTerminalState.height,
      false
    );

    scheduleDevPreviewBounds();
  }
);

if (
  typeof ResizeObserver ===
  "function" &&
  devWorkspaceComposer
) {
  const composerObserver =
    new ResizeObserver(
      () => {
        syncDevWorkspaceBottomInset();
      }
    );

  composerObserver.observe(
    devWorkspaceComposer
  );
}

if (
  typeof ResizeObserver ===
  "function"
) {
  const observer =
    new ResizeObserver(
      () => {
        scheduleDevPreviewBounds();
      }
    );

  observer.observe(
    devPreviewViewport
  );
}

const devPreviewLayoutObserver =
  new MutationObserver(
    () => {
      void syncDevPreviewNativeVisibility();
      scheduleDevPreviewBounds();
    }
  );

devPreviewLayoutObserver.observe(
  chatView,
  {
    attributes: true,
    attributeFilter: [
      "class",
    ],
  }
);

window.addEventListener(
  "noon-context-change",
  () => {
    syncDevWorkspaceBottomInset();
    void syncDevPreviewPanel();
  }
);

window.addEventListener(
  "pagehide",
  () => {
    void window.noon
      ?.devPreviewClose?.();
  }
);

devPreviewWidth =
  loadDevPreviewWidth();

applyDevPreviewWidth(
  devPreviewWidth,
  false
);

syncDevWorkspaceBottomInset();
syncDevPreviewResizeHandle();

// DEV_PREVIEW_UI_END

