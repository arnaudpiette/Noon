"use strict";

const assert =
  require("node:assert/strict");

const fs =
  require("node:fs");

const test =
  require("node:test");

const html =
  fs.readFileSync(
    "public/index.html",
    "utf8"
  );

const app =
  fs.readFileSync(
    "public/app.js",
    "utf8"
  );

const css =
  fs.readFileSync(
    "public/style.css",
    "utf8"
  );

function previewSource() {
  const start =
    app.indexOf(
      "// DEV_PREVIEW_UI_START"
    );

  const end =
    app.indexOf(
      "// DEV_PREVIEW_UI_END"
    );

  assert.ok(
    start >= 0,
    "marqueur Preview start absent"
  );

  assert.ok(
    end > start,
    "marqueur Preview end absent"
  );

  return app.slice(
    start,
    end
  );
}

test(
  "le Mode DEV possède un panneau Preview natif avec navigation",
  () => {
    for (
      const id of [
        "devPreviewPanel",
        "devPreviewViewport",
        "devPreviewUrl",
        "devPreviewBack",
        "devPreviewForward",
        "devPreviewReload",
        "devPreviewExternal",
        "devPreviewClose",
      ]
    ) {
      assert.match(
        html,
        new RegExp(
          `id="${id}"`
        )
      );
    }
  }
);

test(
  "aucun iframe ni webview n'est utilisé pour le Preview",
  () => {
    const previewHtml =
      html.slice(
        html.indexOf(
          'id="devPreviewPanel"'
        ),
        html.indexOf(
          "<!-- Terminal sécurisé"
        )
      );

    assert.doesNotMatch(
      previewHtml,
      /<iframe\b/i
    );

    assert.doesNotMatch(
      previewHtml,
      /<webview\b/i
    );
  }
);

test(
  "le renderer pilote uniquement le pont IPC Preview",
  () => {
    const source =
      previewSource();

    assert.match(
      source,
      /window\.noon/
    );

    assert.match(
      source,
      /devPreviewOpen/
    );

    assert.match(
      source,
      /devPreviewSetBounds/
    );

    assert.match(
      source,
      /devPreviewClose/
    );

    assert.doesNotMatch(
      source,
      /WebContentsView/
    );

    assert.doesNotMatch(
      source,
      /child_process/
    );
  }
);

test(
  "le Preview suit le Mode DEV et le Focus actif",
  () => {
    const source =
      previewSource();

    assert.match(
      source,
      /currentMode !== "DEV"/
    );

    assert.match(
      source,
      /currentFocusId/
    );

    assert.match(
      source,
      /currentFocusPath/
    );

    assert.match(
      source,
      /noon-context-change/
    );

    assert.match(
      source,
      /closeDevPreview/
    );
  }
);

test(
  "les bounds natives proviennent uniquement du viewport DOM",
  () => {
    const source =
      previewSource();

    assert.match(
      source,
      /getBoundingClientRect/
    );

    assert.match(
      source,
      /Math\.round\(rect\.left\)/
    );

    assert.match(
      source,
      /Math\.round\(rect\.top\)/
    );

    assert.match(
      source,
      /devPreviewSetBounds/
    );

    assert.match(
      source,
      /125/
    );
  }
);

test(
  "le Preview est masqué nativement lorsque le terminal est maximisé",
  () => {
    const source =
      previewSource();

    assert.match(
      source,
      /dev-terminal-maximized/
    );

    assert.match(
      source,
      /devPreviewSetVisible/
    );

    assert.match(
      source,
      /MutationObserver/
    );
  }
);


test(
  "le Preview natif suit aussi la vue Chat active",
  () => {
    const source =
      previewSource();

    assert.match(
      source,
      /chatView\.classList\.contains\(\s*"active"\s*\)/
    );

    assert.match(
      source,
      /syncDevPreviewNativeVisibility/
    );

    assert.match(
      source,
      /MutationObserver/
    );
  }
);

test(
  "le splitter est resynchronisé après l'état hidden du panneau",
  () => {
    const source =
      previewSource();

    const hiddenIndex =
      source.indexOf(
        "devPreviewPanel.hidden ="
      );

    const toggleIndex =
      source.indexOf(
        "chatView.classList.toggle(",
        hiddenIndex
      );

    const handleIndex =
      source.indexOf(
        "syncDevPreviewResizeHandle();",
        toggleIndex
      );

    const inactiveIndex =
      source.indexOf(
        "if (!active)",
        toggleIndex
      );

    assert.ok(
      hiddenIndex >= 0 &&
      toggleIndex > hiddenIndex &&
      handleIndex > toggleIndex &&
      inactiveIndex > handleIndex,
      "le splitter doit être recalculé après hidden et avant le retour inactive"
    );
  }
);

test(
  "l'UI Preview n'injecte aucun HTML dynamique",
  () => {
    const source =
      previewSource();

    assert.doesNotMatch(
      source,
      /\.innerHTML\s*=/
    );

    assert.match(
      source,
      /\.textContent\s*=/
    );

    assert.match(
      css,
      /DEV PREVIEW WORKSPACE/
    );

    assert.match(
      css,
      /\.chat-view\.dev-preview-active[\s\S]*\.dev-terminal-panel/
    );
  }
);


test(
  "le workspace DEV reste au-dessus du composeur dynamique",
  () => {
    const source =
      previewSource();

    assert.match(
      source,
      /syncDevWorkspaceBottomInset/
    );

    assert.match(
      source,
      /devWorkspaceComposer/
    );

    assert.match(
      source,
      /composerRect/
    );

    assert.match(
      source,
      /chatRect/
    );

    assert.match(
      source,
      /--dev-workspace-bottom/
    );

    assert.match(
      source,
      /ResizeObserver/
    );

    assert.match(
      css,
      /\.dev-terminal-panel\{[\s\S]*bottom:var\(--dev-workspace-bottom,104px\)/
    );

    assert.match(
      css,
      /\.dev-preview-panel\{[\s\S]*bottom:var\(--dev-workspace-bottom,104px\)/
    );
  }
);


test(
  "le resize Preview V5 conserve la structure DOM du chat",
  () => {
    const fs =
      require("node:fs");

    const path =
      require("node:path");

    const html =
      fs.readFileSync(
        path.join(
          __dirname,
          "../public/index.html"
        ),
        "utf8"
      );

    const source =
      previewSource();

    assert.match(
      html,
      /id="devPreviewResizeHandle"/
    );

    assert.match(
      source,
      /DEV_WORKSPACE_CONSERVATIVE_V5_START/
    );

    assert.match(
      source,
      /DEV_PREVIEW_WIDTH_STORAGE_KEY/
    );

    assert.match(
      source,
      /devPreviewResizeHandle\.addEventListener/
    );

    assert.doesNotMatch(
      source,
      /\.appendChild\(/
    );

    assert.doesNotMatch(
      source,
      /devWorkspaceShell/
    );

    assert.match(
      css,
      /DEV WORKSPACE CONSERVATIVE V5/
    );

    assert.match(
      css,
      /--dev-preview-width/
    );
  }
);


test(
  "le Terminal est reclampé après un changement de géométrie du composeur",
  () => {
    const source =
      previewSource();

    assert.match(
      source,
      /scheduleDevTerminalWorkspaceClamp/
    );

    assert.match(
      source,
      /requestAnimationFrame/
    );

    assert.match(
      source,
      /setDevTerminalHeight\(\s*devTerminalState\.height,\s*false\s*\)/
    );

    const syncIndex =
      source.indexOf(
        "function syncDevWorkspaceBottomInset"
      );

    const clampIndex =
      source.indexOf(
        "scheduleDevTerminalWorkspaceClamp();",
        syncIndex
      );

    assert.ok(
      syncIndex >= 0 &&
      clampIndex > syncIndex,
      "le reclamp doit suivre le recalcul du composeur"
    );
  }
);
