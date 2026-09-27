"use strict";

const { EventEmitter } = require("node:events");

const DEV_PREVIEW_PARTITION = "noon-dev-preview";
const MAX_PREVIEW_URL_LENGTH = 2048;

class DevPreviewError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DevPreviewError";
    this.code = code;
  }
}

function previewError(code, message) {
  return new DevPreviewError(code, message);
}

function parseUrl(rawUrl) {
  const value = String(rawUrl || "").trim();

  if (
    !value ||
    value.length > MAX_PREVIEW_URL_LENGTH
  ) {
    throw previewError(
      "DEV_PREVIEW_URL_INVALID",
      "URL de Preview invalide."
    );
  }

  const candidate =
    /^https?:\/\//i.test(value)
      ? value
      : `http://${value}`;

  try {
    return new URL(candidate);
  } catch {
    throw previewError(
      "DEV_PREVIEW_URL_INVALID",
      "URL de Preview invalide."
    );
  }
}

function isLoopbackHostname(hostname) {
  return new Set([
    "localhost",
    "127.0.0.1",
  ]).has(
    String(hostname || "")
      .toLowerCase()
  );
}

function effectivePort(url) {
  if (url.port) {
    return url.port;
  }

  if (url.protocol === "http:") {
    return "80";
  }

  if (url.protocol === "https:") {
    return "443";
  }

  if (url.protocol === "ws:") {
    return "80";
  }

  if (url.protocol === "wss:") {
    return "443";
  }

  return "";
}

function isNoonServerEndpoint(
  url,
  noonOrigin
) {
  if (
    !url ||
    !isLoopbackHostname(url.hostname)
  ) {
    return false;
  }

  let noonUrl;

  try {
    noonUrl =
      new URL(
        String(noonOrigin || "")
      );
  } catch {
    return false;
  }

  return (
    isLoopbackHostname(
      noonUrl.hostname
    ) &&
    effectivePort(url) ===
      effectivePort(noonUrl)
  );
}

function normalizeDevPreviewUrl(
  rawUrl,
  { noonOrigin = null } = {}
) {
  const url =
    parseUrl(rawUrl);

  if (url.protocol !== "http:") {
    throw previewError(
      "DEV_PREVIEW_PROTOCOL_DENIED",
      "Le Preview DEV accepte uniquement HTTP local."
    );
  }

  if (
    url.username ||
    url.password
  ) {
    throw previewError(
      "DEV_PREVIEW_CREDENTIALS_DENIED",
      "Les identifiants dans l’URL sont refusés."
    );
  }

  if (
    !isLoopbackHostname(
      url.hostname
    )
  ) {
    throw previewError(
      "DEV_PREVIEW_HOST_DENIED",
      "Le Preview DEV accepte uniquement localhost ou 127.0.0.1."
    );
  }

  if (
    isNoonServerEndpoint(
      url,
      noonOrigin
    )
  ) {
    throw previewError(
      "DEV_PREVIEW_NOON_ORIGIN_DENIED",
      "Le serveur interne de Noon ne peut pas être chargé dans le Preview DEV."
    );
  }

  return url.toString();
}

function isAllowedDevPreviewResourceUrl(
  rawUrl,
  { noonOrigin = null } = {}
) {
  const value =
    String(rawUrl || "").trim();

  if (!value) {
    return false;
  }

  if (
    value.startsWith("data:") ||
    value.startsWith("blob:")
  ) {
    return true;
  }

  let url;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (
    !["http:", "ws:"].includes(
      url.protocol
    )
  ) {
    return false;
  }

  if (
    !isLoopbackHostname(
      url.hostname
    )
  ) {
    return false;
  }

  if (
    url.username ||
    url.password
  ) {
    return false;
  }

  if (
    isNoonServerEndpoint(
      url,
      noonOrigin
    )
  ) {
    return false;
  }

  return true;
}

function shouldOpenExternally(rawUrl) {
  try {
    const url =
      new URL(
        String(rawUrl || "")
      );

    return (
      ["http:", "https:"].includes(
        url.protocol
      ) &&
      !isLoopbackHostname(
        url.hostname
      )
    );
  } catch {
    return false;
  }
}

function finiteInteger(
  value,
  fallback = 0
) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.round(number);
}

function sanitizeDevPreviewBounds(
  rawBounds,
  contentSize
) {
  const maxWidth =
    Math.max(
      0,
      finiteInteger(
        contentSize?.width
      )
    );

  const maxHeight =
    Math.max(
      0,
      finiteInteger(
        contentSize?.height
      )
    );

  if (
    maxWidth <= 0 ||
    maxHeight <= 0
  ) {
    throw previewError(
      "DEV_PREVIEW_BOUNDS_UNAVAILABLE",
      "Dimensions de la fenêtre Noon indisponibles."
    );
  }

  const x =
    Math.max(
      0,
      finiteInteger(
        rawBounds?.x
      )
    );

  const y =
    Math.max(
      0,
      finiteInteger(
        rawBounds?.y
      )
    );

  const width =
    Math.min(
      Math.max(
        0,
        maxWidth - x
      ),
      Math.max(
        0,
        finiteInteger(
          rawBounds?.width
        )
      )
    );

  const height =
    Math.min(
      Math.max(
        0,
        maxHeight - y
      ),
      Math.max(
        0,
        finiteInteger(
          rawBounds?.height
        )
      )
    );

  if (
    width < 120 ||
    height < 90
  ) {
    throw previewError(
      "DEV_PREVIEW_BOUNDS_TOO_SMALL",
      "Zone Preview trop petite."
    );
  }

  return {
    x,
    y,
    width,
    height,
  };
}

function createDevPreviewController({
  WebContentsView,
  session,
  getMainWindow,
  noonOrigin,
  openExternalUrl =
    async () => false,
  devTools = false,
} = {}) {
  if (
    typeof WebContentsView !==
    "function"
  ) {
    throw new TypeError(
      "WebContentsView requis."
    );
  }

  if (
    !session?.fromPartition
  ) {
    throw new TypeError(
      "Session Electron requise."
    );
  }

  if (
    typeof getMainWindow !==
    "function"
  ) {
    throw new TypeError(
      "Accès BrowserWindow requis."
    );
  }

  const events =
    new EventEmitter();

  let view = null;
  let previewSession = null;
  let status = "CLOSED";
  let lastError = null;

  function windowOrThrow() {
    const window =
      getMainWindow();

    if (
      !window ||
      window.isDestroyed?.()
    ) {
      throw previewError(
        "DEV_PREVIEW_WINDOW_UNAVAILABLE",
        "Fenêtre Noon indisponible."
      );
    }

    return window;
  }

  function currentState() {
    const contents =
      view?.webContents;

    const history =
      contents?.navigationHistory;

    return {
      status,
      url:
        contents &&
        !contents.isDestroyed?.()
          ? contents.getURL?.() ||
            null
          : null,
      title:
        contents &&
        !contents.isDestroyed?.()
          ? contents.getTitle?.() ||
            null
          : null,
      loading:
        Boolean(
          contents &&
          !contents.isDestroyed?.() &&
          contents.isLoading?.()
        ),
      canGoBack:
        Boolean(
          history?.canGoBack?.()
        ),
      canGoForward:
        Boolean(
          history?.canGoForward?.()
        ),
      visible:
        Boolean(
          view?.getVisible?.()
        ),
      error:
        lastError,
    };
  }

  function emitState() {
    events.emit(
      "state",
      currentState()
    );
  }

  function ensureSession() {
    if (previewSession) {
      return previewSession;
    }

    previewSession =
      session.fromPartition(
        DEV_PREVIEW_PARTITION,
        {
          cache: false,
        }
      );

    previewSession
      .setPermissionCheckHandler?.(
        () => false
      );

    previewSession
      .setPermissionRequestHandler?.(
        (
          _contents,
          _permission,
          callback
        ) => {
          callback(false);
        }
      );

    previewSession
      .webRequest
      ?.onBeforeRequest?.(
        {
          urls: [
            "http://*/*",
            "https://*/*",
            "ws://*/*",
            "wss://*/*",
          ],
        },
        (
          details,
          callback
        ) => {
          callback({
            cancel:
              !isAllowedDevPreviewResourceUrl(
                details.url,
                {
                  noonOrigin,
                }
              ),
          });
        }
      );

    return previewSession;
  }

  function handleNavigation(
    event,
    rawUrl
  ) {
    try {
      normalizeDevPreviewUrl(
        rawUrl,
        {
          noonOrigin,
        }
      );

      return true;
    } catch {
      event?.preventDefault?.();

      if (
        shouldOpenExternally(
          rawUrl
        )
      ) {
        void openExternalUrl(
          String(rawUrl)
        );
      }

      return false;
    }
  }

  function configureWebContents(
    contents
  ) {
    contents.setWindowOpenHandler?.(
      ({ url }) => {
        try {
          const target =
            normalizeDevPreviewUrl(
              url,
              {
                noonOrigin,
              }
            );

          void contents.loadURL(
            target
          );
        } catch {
          if (
            shouldOpenExternally(
              url
            )
          ) {
            void openExternalUrl(
              String(url)
            );
          }
        }

        return {
          action: "deny",
        };
      }
    );

    contents.on?.(
      "will-navigate",
      (
        event,
        url
      ) => {
        handleNavigation(
          event,
          url
        );
      }
    );

    contents.on?.(
      "will-redirect",
      (
        event,
        url
      ) => {
        handleNavigation(
          event,
          url
        );
      }
    );

    contents.on?.(
      "did-start-loading",
      () => {
        status = "LOADING";
        lastError = null;
        emitState();
      }
    );

    contents.on?.(
      "did-stop-loading",
      () => {
        if (status !== "ERROR") {
          status = "READY";
        }

        emitState();
      }
    );

    contents.on?.(
      "did-navigate",
      () => {
        lastError = null;
        emitState();
      }
    );

    contents.on?.(
      "did-navigate-in-page",
      () => {
        emitState();
      }
    );

    contents.on?.(
      "page-title-updated",
      () => {
        emitState();
      }
    );

    contents.on?.(
      "did-fail-load",
      (
        _event,
        errorCode,
        errorDescription,
        validatedUrl,
        isMainFrame
      ) => {
        if (!isMainFrame) {
          return;
        }

        if (
          Number(errorCode) === -3
        ) {
          return;
        }

        status = "ERROR";

        lastError = {
          code:
            Number(errorCode) ||
            null,
          message:
            String(
              errorDescription ||
              "Chargement impossible."
            ),
          url:
            String(
              validatedUrl ||
              ""
            ) ||
            null,
        };

        emitState();
      }
    );

    contents.on?.(
      "render-process-gone",
      (
        _event,
        details
      ) => {
        status = "ERROR";

        lastError = {
          code:
            "RENDER_PROCESS_GONE",
          message:
            String(
              details?.reason ||
              "Le Preview s’est arrêté."
            ),
        };

        emitState();
      }
    );
  }

  function ensureView() {
    if (
      view &&
      !view.webContents
        ?.isDestroyed?.()
    ) {
      return view;
    }

    const window =
      windowOrThrow();

    const isolatedSession =
      ensureSession();

    view =
      new WebContentsView({
        webPreferences: {
          session:
            isolatedSession,
          nodeIntegration: false,
          nodeIntegrationInWorker:
            false,
          nodeIntegrationInSubFrames:
            false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent:
            false,
          devTools:
            Boolean(devTools),
        },
      });

    view.setBackgroundColor?.(
      "#ffffff"
    );

    view.setVisible?.(
      false
    );

    configureWebContents(
      view.webContents
    );

    window.contentView
      .addChildView(view);

    status = "IDLE";
    lastError = null;

    return view;
  }

  function setBounds(rawBounds) {
    const window =
      windowOrThrow();

    const preview =
      ensureView();

    const [
      width,
      height,
    ] =
      window.getContentSize();

    const bounds =
      sanitizeDevPreviewBounds(
        rawBounds,
        {
          width,
          height,
        }
      );

    preview.setBounds(
      bounds
    );

    return bounds;
  }

  async function open({
    url,
    bounds,
  } = {}) {
    const target =
      normalizeDevPreviewUrl(
        url,
        {
          noonOrigin,
        }
      );

    const preview =
      ensureView();

    if (bounds) {
      setBounds(bounds);
    }

    preview.setVisible?.(
      true
    );

    status = "LOADING";
    lastError = null;
    emitState();

    try {
      await preview
        .webContents
        .loadURL(target);
    } catch (error) {
      status = "ERROR";

      lastError = {
        code:
          error?.code ||
          "DEV_PREVIEW_LOAD_FAILED",
        message:
          String(
            error?.message ||
            "Chargement Preview impossible."
          ),
        url:
          target,
      };

      emitState();

      throw error;
    }

    return currentState();
  }

  async function navigate(
    rawUrl
  ) {
    const preview =
      ensureView();

    const target =
      normalizeDevPreviewUrl(
        rawUrl,
        {
          noonOrigin,
        }
      );

    status = "LOADING";
    lastError = null;
    emitState();

    await preview
      .webContents
      .loadURL(target);

    return currentState();
  }

  function reload() {
    view?.webContents
      ?.reload?.();

    return currentState();
  }

  function back() {
    const history =
      view?.webContents
        ?.navigationHistory;

    if (
      history?.canGoBack?.()
    ) {
      history.goBack();
    }

    return currentState();
  }

  function forward() {
    const history =
      view?.webContents
        ?.navigationHistory;

    if (
      history?.canGoForward?.()
    ) {
      history.goForward();
    }

    return currentState();
  }

  async function capture() {
    const preview = view;
    const contents = preview?.webContents;
    const state = currentState();

    if (
      !preview ||
      state.status !== "READY" ||
      !state.url
    ) {
      throw previewError(
        "DEV_PREVIEW_CAPTURE_NOT_READY",
        "La Preview doit être chargée avant la capture."
      );
    }

    if (
      !contents ||
      contents.isDestroyed?.()
    ) {
      throw previewError(
        "DEV_PREVIEW_CAPTURE_UNAVAILABLE",
        "Preview indisponible pour la capture."
      );
    }

    const normalizedUrl =
      normalizeDevPreviewUrl(
        state.url,
        {
          noonOrigin,
        }
      );

    const image =
      await contents.capturePage();

    if (
      !image ||
      image.isEmpty?.()
    ) {
      throw previewError(
        "DEV_PREVIEW_CAPTURE_EMPTY",
        "La capture Preview est vide."
      );
    }

    const size =
      image.getSize?.() || {
        width: 0,
        height: 0,
      };

    const maxWidth = 1440;

    const bounded =
      size.width > maxWidth &&
      typeof image.resize === "function"
        ? image.resize({
            width: maxWidth,
          })
        : image;

    const boundedSize =
      bounded.getSize?.() || size;

    const jpeg =
      bounded.toJPEG?.(78);

    if (
      !Buffer.isBuffer(jpeg) ||
      jpeg.length === 0
    ) {
      throw previewError(
        "DEV_PREVIEW_CAPTURE_ENCODING_FAILED",
        "Encodage de la capture Preview impossible."
      );
    }

    const maxBytes =
      4 * 1024 * 1024;

    if (jpeg.length > maxBytes) {
      throw previewError(
        "DEV_PREVIEW_CAPTURE_TOO_LARGE",
        "Capture Preview trop volumineuse."
      );
    }

    return {
      status: "READY",
      source: "DEV_PREVIEW",
      url: normalizedUrl,
      mimeType: "image/jpeg",
      width:
        Number(boundedSize.width) || 0,
      height:
        Number(boundedSize.height) || 0,
      bytes: jpeg.length,
      dataUrl:
        `data:image/jpeg;base64,${jpeg.toString("base64")}`,
    };
  }

  function setVisible(visible) {
    if (!view) {
      return currentState();
    }

    view.setVisible?.(
      Boolean(visible)
    );

    emitState();

    return currentState();
  }

  function close() {
    if (!view) {
      status = "CLOSED";
      lastError = null;

      return currentState();
    }

    const window =
      getMainWindow();

    try {
      window?.contentView
        ?.removeChildView?.(
          view
        );
    } catch {}

    try {
      if (
        !view.webContents
          ?.isDestroyed?.()
      ) {
        view.webContents.close();
      }
    } catch {}

    view = null;
    status = "CLOSED";
    lastError = null;

    emitState();

    return currentState();
  }

  return {
    onState(listener) {
      events.on(
        "state",
        listener
      );

      return () => {
        events.off(
          "state",
          listener
        );
      };
    },

    state:
      currentState,

    open,
    navigate,
    setBounds,
    reload,
    back,
    forward,
    capture,
    setVisible,
    close,
  };
}

module.exports = {
  DEV_PREVIEW_PARTITION,
  DevPreviewError,
  createDevPreviewController,
  isAllowedDevPreviewResourceUrl,
  normalizeDevPreviewUrl,
  sanitizeDevPreviewBounds,
};
