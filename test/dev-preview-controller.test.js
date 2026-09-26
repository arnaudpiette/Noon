"use strict";

const assert =
  require("node:assert/strict");

const test =
  require("node:test");

const {
  EventEmitter,
} =
  require("node:events");

const {
  DEV_PREVIEW_PARTITION,
  createDevPreviewController,
  isAllowedDevPreviewResourceUrl,
  normalizeDevPreviewUrl,
  sanitizeDevPreviewBounds,
} =
  require(
    "../electron/dev-preview-controller"
  );

const NOON_ORIGIN =
  "http://127.0.0.1:3000";

class FakeWebContents
  extends EventEmitter {
  constructor() {
    super();

    this.closed = false;
    this.destroyed = false;
    this.loading = false;
    this.url = "";
    this.title = "";
    this.loadCalls = [];
    this.windowOpenHandler = null;

    this.navigationHistory = {
      canGoBack: () => false,
      canGoForward: () => false,
      goBack: () => {},
      goForward: () => {},
    };
  }

  setWindowOpenHandler(handler) {
    this.windowOpenHandler =
      handler;
  }

  async loadURL(url) {
    this.loadCalls.push(url);
    this.url = url;

    this.emit(
      "did-start-loading"
    );

    this.loading = true;
    this.loading = false;

    this.emit(
      "did-navigate",
      {},
      url
    );

    this.emit(
      "did-stop-loading"
    );
  }

  getURL() {
    return this.url;
  }

  getTitle() {
    return this.title;
  }

  isLoading() {
    return this.loading;
  }

  isDestroyed() {
    return this.destroyed;
  }

  reload() {}

  close() {
    this.closed = true;
    this.destroyed = true;
  }
}

class FakeWebContentsView {
  static instances = [];

  constructor(options) {
    this.options = options;
    this.webContents =
      new FakeWebContents();

    this.visible = true;
    this.bounds = null;

    FakeWebContentsView.instances.push(
      this
    );
  }

  setVisible(value) {
    this.visible =
      Boolean(value);
  }

  getVisible() {
    return this.visible;
  }

  setBounds(bounds) {
    this.bounds = {
      ...bounds,
    };
  }

  setBackgroundColor() {}
}

function fixture() {
  FakeWebContentsView.instances.length =
    0;

  let beforeRequest = null;

  const previewSession = {
    permissionCheckHandler: null,
    permissionRequestHandler: null,

    setPermissionCheckHandler(handler) {
      this.permissionCheckHandler =
        handler;
    },

    setPermissionRequestHandler(handler) {
      this.permissionRequestHandler =
        handler;
    },

    webRequest: {
      onBeforeRequest(
        _filter,
        handler
      ) {
        beforeRequest =
          handler;
      },
    },
  };

  const partitionCalls = [];

  const electronSession = {
    fromPartition(
      partition,
      options
    ) {
      partitionCalls.push({
        partition,
        options,
      });

      return previewSession;
    },
  };

  const added = [];
  const removed = [];

  const mainWindow = {
    isDestroyed: () => false,

    getContentSize: () => [
      1200,
      800,
    ],

    contentView: {
      addChildView(view) {
        added.push(view);
      },

      removeChildView(view) {
        removed.push(view);
      },
    },
  };

  const external = [];

  const controller =
    createDevPreviewController({
      WebContentsView:
        FakeWebContentsView,
      session:
        electronSession,
      getMainWindow:
        () => mainWindow,
      noonOrigin:
        NOON_ORIGIN,
      openExternalUrl:
        async (url) => {
          external.push(url);
          return true;
        },
      devTools: true,
    });

  return {
    controller,
    partitionCalls,
    previewSession,
    added,
    removed,
    external,
    beforeRequest:
      () => beforeRequest,
  };
}

test(
  "le Preview accepte uniquement HTTP loopback et refuse le serveur Noon",
  () => {
    assert.equal(
      normalizeDevPreviewUrl(
        "localhost:5173",
        {
          noonOrigin:
            NOON_ORIGIN,
        }
      ),
      "http://localhost:5173/"
    );

    assert.equal(
      normalizeDevPreviewUrl(
        "http://127.0.0.1:4321/app",
        {
          noonOrigin:
            NOON_ORIGIN,
        }
      ),
      "http://127.0.0.1:4321/app"
    );

    assert.throws(
      () =>
        normalizeDevPreviewUrl(
          "https://localhost:5173",
          {
            noonOrigin:
              NOON_ORIGIN,
          }
        ),
      (error) =>
        error.code ===
        "DEV_PREVIEW_PROTOCOL_DENIED"
    );

    assert.throws(
      () =>
        normalizeDevPreviewUrl(
          "http://example.com",
          {
            noonOrigin:
              NOON_ORIGIN,
          }
        ),
      (error) =>
        error.code ===
        "DEV_PREVIEW_HOST_DENIED"
    );

    assert.throws(
      () =>
        normalizeDevPreviewUrl(
          "http://localhost:3000",
          {
            noonOrigin:
              NOON_ORIGIN,
          }
        ),
      (error) =>
        error.code ===
        "DEV_PREVIEW_NOON_ORIGIN_DENIED"
    );
  }
);

test(
  "les ressources Preview restent locales avec HMR websocket",
  () => {
    assert.equal(
      isAllowedDevPreviewResourceUrl(
        "http://localhost:5173/src/main.js",
        {
          noonOrigin:
            NOON_ORIGIN,
        }
      ),
      true
    );

    assert.equal(
      isAllowedDevPreviewResourceUrl(
        "ws://localhost:5173/",
        {
          noonOrigin:
            NOON_ORIGIN,
        }
      ),
      true
    );

    assert.equal(
      isAllowedDevPreviewResourceUrl(
        "https://cdn.example.com/app.js",
        {
          noonOrigin:
            NOON_ORIGIN,
        }
      ),
      false
    );

    assert.equal(
      isAllowedDevPreviewResourceUrl(
        "http://localhost:3000/app",
        {
          noonOrigin:
            NOON_ORIGIN,
        }
      ),
      false
    );
  }
);

test(
  "les bounds sont bornés au contenu de la fenêtre",
  () => {
    assert.deepEqual(
      sanitizeDevPreviewBounds(
        {
          x: 100,
          y: 80,
          width: 2000,
          height: 2000,
        },
        {
          width: 1200,
          height: 800,
        }
      ),
      {
        x: 100,
        y: 80,
        width: 1100,
        height: 720,
      }
    );

    assert.throws(
      () =>
        sanitizeDevPreviewBounds(
          {
            x: 1190,
            y: 790,
            width: 20,
            height: 20,
          },
          {
            width: 1200,
            height: 800,
          }
        ),
      (error) =>
        error.code ===
        "DEV_PREVIEW_BOUNDS_TOO_SMALL"
    );
  }
);

test(
  "WebContentsView utilise une session mémoire séparée et reste sandboxé",
  async () => {
    const data =
      fixture();

    await data.controller.open({
      url:
        "http://localhost:5173",
      bounds: {
        x: 100,
        y: 100,
        width: 800,
        height: 500,
      },
    });

    assert.equal(
      data.partitionCalls.length,
      1
    );

    assert.equal(
      data.partitionCalls[0]
        .partition,
      DEV_PREVIEW_PARTITION
    );

    assert.deepEqual(
      data.partitionCalls[0]
        .options,
      {
        cache: false,
      }
    );

    const view =
      FakeWebContentsView
        .instances[0];

    const prefs =
      view.options.webPreferences;

    assert.equal(
      prefs.nodeIntegration,
      false
    );

    assert.equal(
      prefs.nodeIntegrationInWorker,
      false
    );

    assert.equal(
      prefs.nodeIntegrationInSubFrames,
      false
    );

    assert.equal(
      prefs.contextIsolation,
      true
    );

    assert.equal(
      prefs.sandbox,
      true
    );

    assert.equal(
      prefs.webSecurity,
      true
    );

    assert.equal(
      prefs.allowRunningInsecureContent,
      false
    );

    assert.equal(
      prefs.session,
      data.previewSession
    );

    assert.equal(
      data.added.length,
      1
    );
  }
);

test(
  "la session Preview refuse permissions et réseau externe",
  async () => {
    const data =
      fixture();

    await data.controller.open({
      url:
        "http://localhost:5173",
      bounds: {
        x: 100,
        y: 100,
        width: 800,
        height: 500,
      },
    });

    assert.equal(
      data.previewSession
        .permissionCheckHandler(),
      false
    );

    let granted = true;

    data.previewSession
      .permissionRequestHandler(
        null,
        "media",
        (value) => {
          granted = value;
        }
      );

    assert.equal(
      granted,
      false
    );

    const listener =
      data.beforeRequest();

    assert.equal(
      typeof listener,
      "function"
    );

    let localResult = null;

    listener(
      {
        url:
          "http://localhost:5173/main.js",
      },
      (result) => {
        localResult = result;
      }
    );

    assert.deepEqual(
      localResult,
      {
        cancel: false,
      }
    );

    let remoteResult = null;

    listener(
      {
        url:
          "https://example.com/track",
      },
      (result) => {
        remoteResult = result;
      }
    );

    assert.deepEqual(
      remoteResult,
      {
        cancel: true,
      }
    );
  }
);

test(
  "une navigation externe est empêchée et déléguée au navigateur système",
  async () => {
    const data =
      fixture();

    await data.controller.open({
      url:
        "http://localhost:5173",
      bounds: {
        x: 100,
        y: 100,
        width: 800,
        height: 500,
      },
    });

    const view =
      FakeWebContentsView
        .instances[0];

    let prevented = false;

    view.webContents.emit(
      "will-navigate",
      {
        preventDefault() {
          prevented = true;
        },
      },
      "https://example.com/"
    );

    await new Promise(
      (resolve) =>
        setImmediate(resolve)
    );

    assert.equal(
      prevented,
      true
    );

    assert.deepEqual(
      data.external,
      [
        "https://example.com/",
      ]
    );
  }
);

test(
  "close retire la vue et ferme explicitement son WebContents",
  async () => {
    const data =
      fixture();

    await data.controller.open({
      url:
        "http://127.0.0.1:4321",
      bounds: {
        x: 20,
        y: 20,
        width: 900,
        height: 600,
      },
    });

    const view =
      FakeWebContentsView
        .instances[0];

    data.controller.close();

    assert.equal(
      data.removed.length,
      1
    );

    assert.equal(
      data.removed[0],
      view
    );

    assert.equal(
      view.webContents.closed,
      true
    );

    assert.equal(
      data.controller.state()
        .status,
      "CLOSED"
    );
  }
);


test(
  "did-stop-loading ne masque pas une erreur de chargement",
  async () => {
    const data =
      fixture();

    await data.controller.open({
      url:
        "http://localhost:5173",
      bounds: {
        x: 100,
        y: 100,
        width: 800,
        height: 500,
      },
    });

    const view =
      FakeWebContentsView
        .instances[0];

    view.webContents.emit(
      "did-fail-load",
      {},
      -105,
      "ERR_NAME_NOT_RESOLVED",
      "http://localhost:5173/broken",
      true
    );

    view.webContents.emit(
      "did-stop-loading"
    );

    assert.equal(
      data.controller.state().status,
      "ERROR"
    );

    assert.equal(
      data.controller.state()
        .error?.code,
      -105
    );
  }
);
