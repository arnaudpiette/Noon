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

function problemsUiSource() {
  const start =
    app.indexOf(
      "// DEV_PROBLEMS_UI_START"
    );

  const end =
    app.indexOf(
      "// DEV_PROBLEMS_UI_END"
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
  "le panneau Problems est intégré statiquement au Terminal et reste borné",
  () => {
    const tabsIndex =
      html.indexOf(
        'id="devTerminalTabs"'
      );

    const problemsIndex =
      html.indexOf(
        'id="devProblemsPanel"'
      );

    const outputIndex =
      html.indexOf(
        'id="devTerminalOutput"'
      );

    assert.ok(
      tabsIndex >= 0 &&
      problemsIndex > tabsIndex &&
      outputIndex > problemsIndex
    );

    for (const id of [
      "devProblemsTotal",
      "devProblemsErrors",
      "devProblemsWarnings",
      "devProblemsInfos",
      "devProblemsState",
      "devProblemsList",
      "devProblemsTruncated",
    ]) {
      assert.match(
        html,
        new RegExp(`id="${id}"`)
      );
    }

    assert.match(
      css,
      /\.dev-problems-panel\{[\s\S]*min-height:49px;[\s\S]*max-height:min\(150px,35%\)/
    );

    assert.match(
      css,
      /\.dev-problems-list\{[\s\S]*overflow:auto/
    );

    assert.match(
      css,
      /\.dev-terminal-panel\.is-collapsed[\s\S]*\.dev-problems-panel/
    );
  }
);

test(
  "Problems rend les quatre états et l'indication de troncature",
  () => {
    const source =
      problemsUiSource();

    for (const expected of [
      "RUNNING",
      "EMPTY",
      "READY",
      "UNRESOLVED",
      "Validation en cours",
      "Aucun problème détecté",
      "Validation échouée sans diagnostic localisable",
      "Liste tronquée",
    ]) {
      assert.ok(
        source.includes(expected),
        expected
      );
    }
  }
);

test(
  "Problems construit les diagnostics sans HTML dynamique ni données terminal brutes",
  () => {
    const source =
      problemsUiSource();

    assert.match(
      source,
      /document\.createElement\("article"\)/
    );

    assert.match(
      source,
      /\.textContent\s*=/
    );

    assert.match(
      source,
      /devProblemsList\.replaceChildren/
    );

    assert.doesNotMatch(
      source,
      /innerHTML/
    );

    for (const forbidden of [
      "repositoryRoot",
      "cwd",
      "stdout",
      "stderr",
    ]) {
      assert.doesNotMatch(
        source,
        new RegExp(`\\b${forbidden}\\b`)
      );
    }
  }
);

test(
  "Problems refuse les chemins absolus et les traversées",
  () => {
    const source =
      problemsUiSource();

    assert.match(
      source,
      /file\.startsWith\("\/"\)/
    );

    assert.match(
      source,
      /\^\[A-Za-z\]:\\\//
    );

    assert.match(
      source,
      /split\("\/"\)\.includes\("\.\."\)/
    );

    assert.match(
      source,
      /problem\?\.file/
    );
  }
);

test(
  "Problems rafraîchit la session par la route GET dans le polling existant",
  () => {
    const problemsSource =
      problemsUiSource();

    const terminalSource =
      terminalUiSource();

    assert.match(
      problemsSource,
      /devTerminalRequest\(\s*`\/api\/dev\/workspace-terminal\/sessions\//
    );

    assert.match(
      terminalSource,
      /async function pollActiveDevTerminal[\s\S]*shouldRefreshDevProblems\(\)[\s\S]*await refreshDevProblems\(\)/
    );

    assert.doesNotMatch(
      problemsSource,
      /setInterval|setTimeout|window\.noon|ipcRenderer/
    );
  }
);

test(
  "Problems évite les GET session quand aucune validation ne peut évoluer",
  () => {
    const problemsSource =
      problemsUiSource();

    const terminalSource =
      terminalUiSource();

    assert.match(
      problemsSource,
      /function shouldRefreshDevProblems\(\)[\s\S]*problemsRefreshPending[\s\S]*problems\?\.status[\s\S]*"RUNNING"/
    );

    assert.match(
      terminalSource,
      /data\.result\?\.classification ===[\s\S]*"SAFE_READ"[\s\S]*problemsRefreshPending\s*=\s*true/
    );
  }
);

test(
  "Problems calcule les compteurs depuis les diagnostics réellement affichables",
  () => {
    const source =
      problemsUiSource();

    assert.match(
      source,
      /const total = diagnostics\.length/
    );

    assert.match(
      source,
      /const severityCount = \(severity\) =>[\s\S]*diagnostic\.severity === severity/
    );

    assert.doesNotMatch(
      source,
      /value\.counts/
    );
  }
);

test(
  "Problems capture session contexte et serial avant la requête",
  () => {
    const source =
      problemsUiSource();

    const sessionIndex =
      source.indexOf(
        "const sessionId ="
      );

    const contextIndex =
      source.indexOf(
        "const contextKey =",
        sessionIndex
      );

    const serialIndex =
      source.indexOf(
        "const syncSerial =",
        contextIndex
      );

    const awaitIndex =
      source.indexOf(
        "await devTerminalRequest(",
        serialIndex
      );

    assert.ok(
      sessionIndex >= 0 &&
      contextIndex > sessionIndex &&
      serialIndex > contextIndex &&
      awaitIndex > serialIndex
    );
  }
);

test(
  "Problems vérifie Mode Focus session contexte et serial après la réponse",
  () => {
    const source =
      problemsUiSource();

    const awaitIndex =
      source.indexOf(
        "await devTerminalRequest("
      );

    const modeIndex =
      source.indexOf(
        'currentMode !== "DEV"',
        awaitIndex
      );

    const focusIdIndex =
      source.indexOf(
        "!currentFocusId",
        awaitIndex
      );

    const focusPathIndex =
      source.indexOf(
        "!currentFocusPath",
        awaitIndex
      );

    const serialIndex =
      source.indexOf(
        "devTerminalState.syncSerial",
        awaitIndex
      );

    const contextIndex =
      source.indexOf(
        "devTerminalState.contextKey",
        awaitIndex
      );

    const sessionIndex =
      source.indexOf(
        "devTerminalState.session?.id",
        awaitIndex
      );

    const renderIndex =
      source.indexOf(
        "renderDevProblems(",
        awaitIndex
      );

    assert.ok(
      awaitIndex >= 0 &&
      modeIndex > awaitIndex &&
      focusIdIndex > awaitIndex &&
      focusPathIndex > awaitIndex &&
      serialIndex > awaitIndex &&
      contextIndex > awaitIndex &&
      sessionIndex > awaitIndex &&
      renderIndex > modeIndex &&
      renderIndex > serialIndex &&
      renderIndex > contextIndex &&
      renderIndex > sessionIndex
    );
  }
);

test(
  "Problems ignore aussi une erreur tardive d'un ancien Focus",
  () => {
    const source =
      problemsUiSource();

    const catchIndex =
      source.indexOf("} catch (error) {");

    const clearIndex =
      source.indexOf(
        "clearDevProblemsPanel();",
        catchIndex
      );

    const guard = source.slice(
      catchIndex,
      clearIndex
    );

    assert.ok(catchIndex >= 0);
    assert.ok(clearIndex > catchIndex);

    for (const expected of [
      'currentMode !== "DEV"',
      "!currentFocusId",
      "!currentFocusPath",
      "devTerminalState.syncSerial",
      "devTerminalState.contextKey",
      "devTerminalState.session?.id",
      "`${currentFocusId}:${currentFocusPath}`",
    ]) {
      assert.ok(
        guard.includes(expected),
        expected
      );
    }
  }
);

test(
  "Problems est masqué sans DEV Focus chemin ou session correspondante",
  () => {
    const source =
      problemsUiSource();

    assert.match(
      source,
      /function devProblemsPanelIsAllowed\(\)[\s\S]*currentMode !== "DEV"/
    );

    assert.match(
      source,
      /function devProblemsPanelIsAllowed\(\)[\s\S]*!currentFocusId[\s\S]*!currentFocusPath[\s\S]*!devTerminalState\.session/
    );

    assert.match(
      source,
      /devTerminalState\.contextKey ===[\s\S]*currentFocusId[\s\S]*currentFocusPath/
    );
  }
);

test(
  "la fermeture du contexte masque Problems avant toute requête réseau",
  () => {
    const source =
      terminalUiSource();

    const closeIndex =
      source.indexOf(
        "async function closeDevTerminalSession"
      );

    const clearIndex =
      source.indexOf(
        "clearDevProblemsPanel();",
        closeIndex
      );

    const requestIndex =
      source.indexOf(
        "await devTerminalRequest(",
        closeIndex
      );

    assert.ok(
      closeIndex >= 0 &&
      clearIndex > closeIndex &&
      requestIndex > clearIndex
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

test(
  "Terminal DEV V2 expose réduction, maximisation et resize",
  () => {
    assert.match(
      html,
      /id="devTerminalCollapse"/
    );

    assert.match(
      html,
      /id="devTerminalMaximize"/
    );

    assert.match(
      html,
      /id="devTerminalResizeHandle"/
    );

    assert.match(
      css,
      /DEV TERMINAL V2 ERGONOMY/
    );

    assert.match(
      css,
      /\.dev-terminal-panel\.is-collapsed/
    );

    assert.match(
      css,
      /\.dev-terminal-panel\.is-maximized/
    );
  }
);

test(
  "la hauteur du terminal est bornée et persistée localement",
  () => {
    const source =
      terminalUiSource();

    assert.match(
      source,
      /DEV_TERMINAL_HEIGHT_STORAGE_KEY/
    );

    assert.match(
      source,
      /DEV_TERMINAL_MIN_HEIGHT/
    );

    assert.match(
      source,
      /setDevTerminalHeight/
    );

    assert.match(
      source,
      /localStorage\.setItem/
    );
  }
);

test(
  "l'historique terminal utilise les flèches sans exécution automatique",
  () => {
    const source =
      terminalUiSource();

    assert.match(
      source,
      /DEV_TERMINAL_HISTORY_STORAGE_KEY/
    );

    assert.match(
      source,
      /navigateDevTerminalHistory/
    );

    assert.match(
      source,
      /"ArrowUp"/
    );

    assert.match(
      source,
      /"ArrowDown"/
    );

    assert.doesNotMatch(
      source,
      /navigateDevTerminalHistory[\s\S]{0,300}requestSubmit/
    );
  }
);

test(
  "le raccourci terminal est réservé au Mode DEV",
  () => {
    const source =
      terminalUiSource();

    assert.match(
      source,
      /event\.key\.toLowerCase\(\) !== "j"/
    );

    assert.match(
      source,
      /currentMode !== "DEV"/
    );

    assert.match(
      source,
      /toggleDevTerminalCollapsed/
    );
  }
);

test(
  "stdout et stderr sont rendus par textContent et jamais par HTML injecté",
  () => {
    const source =
      terminalUiSource();

    assert.match(
      source,
      /dev-terminal-output-chunk--/
    );

    assert.match(
      source,
      /line\.textContent/
    );

    assert.doesNotMatch(
      source,
      /devTerminalOutput\.innerHTML/
    );

    assert.match(
      css,
      /dev-terminal-output-chunk--stderr/
    );
  }
);

test(
  "le polling masque l'écho input serveur pour éviter une commande en double",
  () => {
    const source =
      terminalUiSource();

    assert.match(
      source,
      /event\?\.type !== "input"/
    );
  }
);
