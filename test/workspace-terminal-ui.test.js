"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

const html = fs.readFileSync(
  path.join(root, "public/index.html"),
  "utf8"
);

const app = fs.readFileSync(
  path.join(root, "public/app.js"),
  "utf8"
);

const css = fs.readFileSync(
  path.join(root, "public/style.css"),
  "utf8"
);

function terminalUiSource() {
  const start =
    app.indexOf(
      "// DEV_TERMINAL_UI_START"
    );

  const end =
    app.indexOf(
      "// DEV_TERMINAL_UI_END"
    );

  assert.ok(start >= 0);
  assert.ok(end > start);

  return app.slice(start, end);
}

test(
  "le terminal DEV existe uniquement comme panneau du chat",
  () => {
    assert.match(
      html,
      /id="devTerminalPanel"/
    );

    assert.match(
      html,
      /id="devTerminalOutput"/
    );

    assert.match(
      html,
      /id="devTerminalInput"/
    );

    assert.match(
      html,
      /id="devTerminalTabs"/
    );
  }
);

test(
  "le terminal DEV suit le mode et le Focus actifs",
  () => {
    const source =
      terminalUiSource();

    assert.match(
      source,
      /currentMode === "DEV"/
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
  }
);

test(
  "le renderer utilise exclusivement les routes terminal locales sécurisées",
  () => {
    const source =
      terminalUiSource();

    assert.match(
      source,
      /\/api\/dev\/workspace-terminal\/sessions/
    );

    assert.match(
      source,
      /"X-Noon-Request": "1"/
    );

    assert.doesNotMatch(
      source,
      /\bspawn\s*\(/
    );

    assert.doesNotMatch(
      source,
      /\bexec(?:File|Sync)?\s*\(/
    );

    assert.doesNotMatch(
      source,
      /child_process/
    );
  }
);

test(
  "le renderer ne peut pas demander une identité NOON",
  () => {
    const source =
      terminalUiSource();

    assert.doesNotMatch(
      source,
      /owner\s*:/
    );

    assert.doesNotMatch(
      source,
      /origin\s*:/
    );

    assert.doesNotMatch(
      source,
      /"NOON"/
    );
  }
);

test(
  "les sorties terminal passent uniquement par textContent",
  () => {
    const source =
      terminalUiSource();

    assert.match(
      source,
      /devTerminalOutput\.textContent/
    );

    assert.doesNotMatch(
      source,
      /devTerminalOutput\.innerHTML/
    );
  }
);

test(
  "le terminal supporte plusieurs onglets et leur fermeture",
  () => {
    const source =
      terminalUiSource();

    assert.match(
      source,
      /createDevTerminal/
    );

    assert.match(
      source,
      /closeDevTerminal/
    );

    assert.match(
      source,
      /devTerminalState\.terminals/
    );
  }
);

test(
  "la feuille de style contient le workspace terminal DEV",
  () => {
    assert.match(
      css,
      /DEV TERMINAL WORKSPACE/
    );

    assert.match(
      css,
      /\.dev-terminal-panel/
    );

    assert.match(
      css,
      /\.dev-terminal-output/
    );

    assert.match(
      css,
      /\.dev-terminal-command/
    );
  }
);
