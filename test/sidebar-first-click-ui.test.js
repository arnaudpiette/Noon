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
  path.join(
    __dirname,
    ".."
  );

const app =
  fs.readFileSync(
    path.join(
      root,
      "public",
      "app.js"
    ),
    "utf8"
  );

const css =
  fs.readFileSync(
    path.join(
      root,
      "public",
      "style.css"
    ),
    "utf8"
  );

const html =
  fs.readFileSync(
    path.join(
      root,
      "public",
      "index.html"
    ),
    "utf8"
  );

function buttonIdFor(label) {
  const buttons =
    [...html.matchAll(
      /<button\b[\s\S]*?<\/button>/gi
    )].map(
      (match) => match[0]
    );

  const button =
    buttons.find(
      (candidate) =>
        candidate
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .includes(label)
    );

  assert.ok(
    button,
    `${label} doit exister`
  );

  const id =
    button.match(
      /\bid="([^"]+)"/i
    )?.[1];

  assert.ok(
    id,
    `${label} doit avoir un id`
  );

  return id;
}

test(
  "un clic de conversation invalide les anciens rendus de sidebar",
  () => {
    assert.match(
      app,
      /let conversationIndexNavigationSerial = 0/
    );

    assert.match(
      app,
      /async function switchConversation[\s\S]*conversationIndexNavigationSerial \+= 1/
    );

    assert.match(
      app,
      /navigationSerial !==[\s\S]*conversationIndexNavigationSerial[\s\S]*return;[\s\S]*renderConversationIndex\(conversations\)/
    );
  }
);

test(
  "un changement de projet invalide aussi un rendu de sidebar obsolète",
  () => {
    assert.match(
      app,
      /function setFocus\(project\)[\s\S]*conversationIndexNavigationSerial \+= 1/
    );
  }
);

test(
  "le démarrage séquence projets puis enregistrement puis index",
  () => {
    const start =
      app.indexOf(
        "async function initializeSidebarNavigation()"
      );

    assert.ok(
      start >= 0
    );

    const block =
      app.slice(
        start,
        start + 1800
      );

    const projects =
      block.indexOf(
        "await loadLocalProjects()"
      );

    const register =
      block.indexOf(
        "await registerConversation("
      );

    const index =
      block.indexOf(
        "await loadConversationIndex()"
      );

    assert.ok(
      projects >= 0 &&
      register > projects &&
      index > register
    );
  }
);

test(
  "Noon est la référence métrique des boutons du terminal",
  () => {
    assert.match(
      app,
      /function syncDevTerminalButtonMetrics\(\)/
    );

    assert.match(
      app,
      /"devWorkspaceAgentRun"/
    );

    assert.match(
      app,
      /window\.getComputedStyle\([\s\S]*reference/
    );

    assert.match(
      app,
      /--dev-terminal-control-height/
    );

    assert.match(
      app,
      /--dev-terminal-control-padding-x/
    );

    assert.match(
      app,
      /--dev-terminal-control-font-size/
    );
  }
);

test(
  "les boutons texte ont même hauteur typo et padding mais une largeur automatique",
  () => {
    for (const id of [
      "devWorkspaceAgentRun",
      "devWorkspaceAgentCancel",
      "devSourceControlToggle",
      "devProjectRulesToggle",
      "devTerminalCopyOutput",
      "devTerminalExportOutput",
      "devTerminalRun",
    ]) {
      assert.match(
        html,
        new RegExp(
          `id=["']${id}["']`
        )
      );
    }

    assert.match(
      css,
      /#devWorkspaceAgentRun,[\s\S]*#devProjectRulesToggle,[\s\S]*#devTerminalRun\{[\s\S]*width:auto!important;[\s\S]*height:var\(--dev-terminal-control-height\)!important;[\s\S]*padding-left:var\(--dev-terminal-control-padding-x\)!important;[\s\S]*font-size:var\(--dev-terminal-control-font-size\)!important;/
    );
  }
);

test(
  "les boutons icônes restent carrés et la flèche pivote autour de son centre",
  () => {
    assert.match(
      css,
      /#devTerminalAdd,[\s\S]*#devTerminalCollapse,[\s\S]*#devTerminalMaximize\{[\s\S]*place-items:center!important;[\s\S]*width:var\(--dev-terminal-control-height\)!important;[\s\S]*height:var\(--dev-terminal-control-height\)!important;/
    );

    assert.match(
      css,
      /#devTerminalCollapse\{[\s\S]*transform-origin:50% 50%!important;/
    );

    assert.match(
      css,
      /#devTerminalCollapse > \*\{[\s\S]*place-items:center!important;[\s\S]*transform-origin:50% 50%!important;/
    );
  }
);
