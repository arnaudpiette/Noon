"use strict";

const assert =
  require("node:assert/strict");
const test =
  require("node:test");

const {
  EventEmitter,
} = require("node:events");

const {
  createDevPreviewController,
} = require(
  "../electron/dev-preview-controller"
);

function fixture() {
  const image = {
    isEmpty: () => false,
    getSize: () => ({
      width: 1800,
      height: 1000,
    }),
    resize: ({ width }) => ({
      isEmpty: () => false,
      getSize: () => ({
        width,
        height: 800,
      }),
      toJPEG: (quality) => {
        assert.equal(quality, 78);
        return Buffer.from("preview");
      },
    }),
  };

  const contents =
    new EventEmitter();

  Object.assign(contents, {
    navigationHistory: {
      canGoBack: () => false,
      canGoForward: () => false,
    },
    isDestroyed: () => false,
    getURL: () =>
      "http://127.0.0.1:4321/",
    getTitle: () => "Preview",
    isLoading: () => false,
    capturePage: async () => image,
    setWindowOpenHandler: () => {},
    loadURL: async () => {
      contents.emit(
        "did-start-loading"
      );
      contents.emit(
        "did-finish-load"
      );
      contents.emit(
        "did-stop-loading"
      );
      contents.emit(
        "dom-ready"
      );
    },
  });

  class FakeView {
    constructor() {
      this.webContents = contents;
    }

    setBackgroundColor() {}
    setVisible() {}
    setBounds() {}
  }

  const previewSession = {
    setPermissionCheckHandler() {},
    setPermissionRequestHandler() {},
    webRequest: {
      onBeforeRequest() {},
    },
  };

  const window = {
    isDestroyed: () => false,
    getContentSize: () => [
      1600,
      1000,
    ],
    contentView: {
      addChildView() {},
      removeChildView() {},
    },
  };

  const controller =
    createDevPreviewController({
      WebContentsView: FakeView,
      session: {
        fromPartition() {
          return previewSession;
        },
      },
      getMainWindow: () => window,
      noonOrigin:
        "http://127.0.0.1:3000",
    });

  return {
    controller,
    contents,
  };
}

test(
  "capture la Preview locale sans écrire sur disque",
  async () => {
    const { controller } = fixture();

    await controller.open({
      url:
        "http://127.0.0.1:4321/",
      bounds: {
        x: 0,
        y: 0,
        width: 1200,
        height: 800,
      },
    });

    const capture =
      await controller.capture();

    assert.equal(
      capture.status,
      "READY"
    );

    assert.equal(
      capture.source,
      "DEV_PREVIEW"
    );

    assert.equal(
      capture.url,
      "http://127.0.0.1:4321/"
    );

    assert.equal(
      capture.mimeType,
      "image/jpeg"
    );

    assert.equal(
      capture.width,
      1440
    );

    assert.equal(
      capture.height,
      800
    );

    assert.equal(
      capture.bytes,
      Buffer.byteLength("preview")
    );

    assert.match(
      capture.dataUrl,
      /^data:image\/jpeg;base64,/
    );
  }
);

test(
  "la capture refuse une Preview non prête sans créer de vue",
  async () => {
    const { controller } = fixture();

    assert.equal(
      controller.state().status,
      "CLOSED"
    );

    await assert.rejects(
      controller.capture(),
      {
        code:
          "DEV_PREVIEW_CAPTURE_NOT_READY",
      }
    );

    assert.equal(
      controller.state().status,
      "CLOSED"
    );
  }
);
