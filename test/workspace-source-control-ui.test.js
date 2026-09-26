"use strict";

const assert =
  require("node:assert/strict");
const fs =
  require("node:fs");
const path =
  require("node:path");
const test =
  require("node:test");

const root =
  path.join(__dirname, "..");

const html =
  fs.readFileSync(
    path.join(
      root,
      "public/index.html"
    ),
    "utf8"
  );

const app =
  fs.readFileSync(
    path.join(
      root,
      "public/app.js"
    ),
    "utf8"
  );

const css =
  fs.readFileSync(
    path.join(
      root,
      "public/style.css"
    ),
    "utf8"
  );

function sourceControlUiSource() {
  const start =
    app.indexOf(
      "// DEV_SOURCE_CONTROL_UI_START"
    );

  const end =
    app.indexOf(
      "// DEV_SOURCE_CONTROL_UI_END"
    );

  assert.ok(start >= 0);
  assert.ok(end > start);

  return app.slice(
    start,
    end
  );
}

test(
  "Source Control est statique dans le Terminal sans reparentage",
  () => {
    const tabs =
      html.indexOf(
        'id="devTerminalTabs"'
      );

    const source =
      html.indexOf(
        'id="devSourceControlPanel"'
      );

    const problems =
      html.indexOf(
        'id="devProblemsPanel"'
      );

    assert.ok(
      tabs >= 0 &&
      source > tabs &&
      problems > source
    );

    for (const id of [
      "devSourceControlToggle",
      "devSourceControlRefresh",
      "devSourceControlBranch",
      "devSourceControlFiles",
      "devSourceControlSelected",
      "devSourceControlWorktree",
      "devSourceControlStagedScope",
      "devSourceControlPatch",
      "devSourceControlState",
    ]) {
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
  "Source Control réutilise la géométrie du Terminal au lieu de créer un workspace parallèle",
  () => {
    assert.match(
      css,
      /\.dev-terminal-panel\.is-source-control\{[\s\S]*grid-template-rows:auto minmax\(0,1fr\)/
    );

    assert.match(
      css,
      /\.dev-terminal-panel\.is-source-control[\s\S]*\.dev-terminal-output[\s\S]*display:none/
    );

    assert.match(
      css,
      /\.dev-terminal-panel\.is-source-control[\s\S]*\.dev-source-control-panel\{[\s\S]*display:grid/
    );

    assert.doesNotMatch(
      css,
      /\.dev-source-control-panel\{[\s\S]{0,300}position:absolute/
    );
  }
);

test(
  "Source Control utilise uniquement les deux GET Git Diff read-only",
  () => {
    const source =
      sourceControlUiSource();

    assert.match(
      source,
      /\/git-diff`/
    );

    assert.match(
      source,
      /\/git-diff\/file\?file=/
    );

    assert.match(
      source,
      /encodeURIComponent\(file\)/
    );

    assert.match(
      source,
      /encodeURIComponent\(scope\)/
    );

    assert.doesNotMatch(
      source,
      /method:\s*"POST"/
    );

    assert.doesNotMatch(
      source,
      /\bgit\s+(?:add|commit|restore|reset|checkout|clean|push|pull|rebase)\b/i
    );
  }
);

test(
  "Source Control rend fichiers et patch sans injection HTML",
  () => {
    const source =
      sourceControlUiSource();

    assert.match(
      source,
      /document\.createElement\("button"\)/
    );

    assert.match(
      source,
      /\.textContent\s*=/
    );

    assert.match(
      source,
      /devSourceControlFiles\.replaceChildren/
    );

    assert.doesNotMatch(
      source,
      /\.innerHTML/
    );
  }
);

test(
  "Source Control protège les réponses tardives de Focus et de sélection",
  () => {
    const source =
      sourceControlUiSource();

    for (const expected of [
      "refreshSerial",
      "patchSerial",
      "devTerminalState.syncSerial",
      "devTerminalState.contextKey",
      "devTerminalState.session?.id",
      "currentFocusId",
      "currentFocusPath",
    ]) {
      assert.ok(
        source.includes(expected),
        expected
      );
    }
  }
);

test(
  "Source Control respecte les protections untracked et sensitive du backend",
  () => {
    const source =
      sourceControlUiSource();

    assert.match(
      source,
      /status === "REDACTED"/
    );

    assert.match(
      source,
      /status === "UNTRACKED"/
    );

    assert.match(
      source,
      /fichier sensible/
    );

    assert.match(
      source,
      /contenu n’est pas lu automatiquement/
    );
  }
);

test(
  "Source Control sépare WORKTREE et STAGED selon le fichier sélectionné",
  () => {
    const source =
      sourceControlUiSource();

    assert.match(
      source,
      /DEV_SOURCE_CONTROL_SCOPES/
    );

    assert.match(
      source,
      /sourceControlScopeAvailable/
    );

    assert.match(
      source,
      /entry\.staged === true/
    );

    assert.match(
      source,
      /entry\.unstaged === true/
    );

    assert.match(
      source,
      /entry\.untracked === true/
    );
  }
);

test(
  "fermer la session DEV invalide et masque Source Control",
  () => {
    const start =
      app.indexOf(
        "async function closeDevTerminalSession"
      );

    const end =
      app.indexOf(
        "async function openDevTerminalSession",
        start
      );

    assert.ok(start >= 0);
    assert.ok(end > start);

    const source =
      app.slice(start, end);

    assert.match(
      source,
      /clearDevSourceControl\(\{[\s\S]*close:\s*true/
    );
  }
);

test(
  "le Terminal rafraîchit Source Control après une commande seulement si sa vue est ouverte",
  () => {
    const source =
      app.slice(
        app.indexOf(
          "devTerminalForm.addEventListener"
        ),
        app.indexOf(
          "// DEV_TERMINAL_UI_END"
        )
      );

    assert.match(
      source,
      /devSourceControlView\.open[\s\S]*await refreshDevSourceControl\(\)/
    );
  }
);

test(
  "Source Control expose les entrées Git masquées pour sécurité",
  () => {
    const source =
      sourceControlUiSource();

    assert.match(
      source,
      /inventory\.unsafeOmitted/
    );

    assert.match(
      source,
      /masquée/
    );
  }
);

test(
  "le bouton Source Control conserve un libellé accessible cohérent",
  () => {
    const source =
      sourceControlUiSource();

    assert.match(
      source,
      /sourceControlToggleLabel/
    );

    assert.match(
      source,
      /"aria-label"/
    );

    assert.match(
      source,
      /Retour au Terminal/
    );

    assert.match(
      source,
      /Afficher Source Control/
    );
  }
);

test(
  "les trois états visuels Source Control ciblent le même élément de statut",
  () => {
    for (const state of [
      "running",
      "error",
      "ready",
    ]) {
      assert.ok(
        css.includes(
          `#devSourceControlState[data-state="${state}"]`
        ),
        state
      );
    }
  }
);
