"use strict";

const assert =
  require("node:assert/strict");

const test =
  require("node:test");

const fs =
  require("node:fs");

const main =
  fs.readFileSync(
    "electron/main.js",
    "utf8"
  );

const preload =
  fs.readFileSync(
    "electron/preload.js",
    "utf8"
  );

test(
  "Preview DEV utilise WebContentsView sans réactiver webviewTag",
  () => {
    assert.ok(
      main.includes(
        "WebContentsView"
      )
    );

    assert.ok(
      main.includes(
        "createDevPreviewController"
      )
    );

    assert.ok(
      main.includes(
        "webviewTag: false"
      )
    );

    assert.equal(
      main.includes(
        "webviewTag: true"
      ),
      false
    );
  }
);

test(
  "toutes les actions Preview utilisent le registrar IPC de confiance",
  () => {
    const channels = [
      "noon:dev-preview-open",
      "noon:dev-preview-navigate",
      "noon:dev-preview-set-bounds",
      "noon:dev-preview-set-visible",
      "noon:dev-preview-reload",
      "noon:dev-preview-back",
      "noon:dev-preview-forward",
      "noon:dev-preview-close",
      "noon:dev-preview-state",
      "noon:dev-preview-capture",
      "noon:dev-preview-open-external",
    ];

    for (const channel of channels) {
      assert.ok(
        main.includes(
          `"${channel}"`
        ),
        channel
      );
    }

    assert.ok(
      main.includes(
        "registerTrustedHandler"
      )
    );
  }
);

test(
  "le preload expose uniquement un pont IPC Preview",
  () => {
    for (
      const symbol of [
        "devPreviewOpen",
        "devPreviewNavigate",
        "devPreviewSetBounds",
        "devPreviewSetVisible",
        "devPreviewReload",
        "devPreviewBack",
        "devPreviewForward",
        "devPreviewClose",
        "devPreviewState",
        "devPreviewCapture",
        "devPreviewOpenExternal",
        "onDevPreviewState",
      ]
    ) {
      assert.ok(
        preload.includes(symbol),
        symbol
      );
    }

    assert.equal(
      preload.includes(
        "WebContentsView"
      ),
      false
    );

    assert.equal(
      preload.includes(
        "child_process"
      ),
      false
    );
  }
);
