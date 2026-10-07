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
      "CANCELLED",
      "UNRESOLVED",
      "Validation en cours",
      "Aucun problème détecté",
      "Validation arrêtée par l’utilisateur",
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
  "la fin Native relit Problems via le consommateur UI réel",
  () => {
    const terminalSource = terminalUiSource();

    assert.match(
      terminalSource,
      /async function refreshDevNativeExecution[\s\S]*data\.execution\?\.status[\s\S]*await refreshDevProblems\(\)/
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


// TERMINAL UX #5.3 — scroll, sélection, copie et export

test(
  "Terminal #5.3 conserve un scroll indépendant par terminal",
  () => {
    const source =
      terminalUiSource();

    assert.match(
      source,
      /scrollByTerminal:\s*new Map\(\)/
    );

    assert.match(
      source,
      /followOutputByTerminal:\s*new Map\(\)/
    );

    assert.match(
      source,
      /function isDevTerminalNearBottom\(\)/
    );

    assert.match(
      source,
      /remaining <= 24/
    );

    assert.match(
      source,
      /shouldFollow[\s\S]*followOutputByTerminal/
    );

    assert.match(
      source,
      /savedScrollTop[\s\S]*scrollByTerminal/
    );

    assert.match(
      source,
      /if \(shouldFollow\)[\s\S]*scrollHeight[\s\S]*else[\s\S]*savedScrollTop/
    );
  }
);

test(
  "Terminal #5.3 ne force pas le rendu pendant une sélection utilisateur",
  () => {
    const source =
      terminalUiSource();

    assert.match(
      source,
      /let devTerminalSelectingOutput = false/
    );

    assert.match(
      source,
      /function hasActiveDevTerminalSelection\(\)/
    );

    assert.match(
      source,
      /window\.getSelection\(\)/
    );

    assert.match(
      source,
      /selection\.isCollapsed/
    );

    assert.match(
      source,
      /devTerminalOutput\.contains/
    );

    assert.match(
      source,
      /devTerminalSelectingOutput \|\|[\s\S]*hasActiveDevTerminalSelection\(\)[\s\S]*return/
    );

    assert.match(
      source,
      /"pointerdown"[\s\S]*devTerminalSelectingOutput = true/
    );

    assert.match(
      source,
      /"pointerup"[\s\S]*devTerminalSelectingOutput = false/
    );
  }
);

test(
  "Terminal #5.3 expose Copier et Exporter dans le Workspace existant",
  () => {
    assert.match(
      html,
      /id="devTerminalCopyOutput"/
    );

    assert.match(
      html,
      /id="devTerminalExportOutput"/
    );

    assert.match(
      html,
      /aria-label="Copier la sortie du terminal"/
    );

    assert.match(
      html,
      /aria-label="Exporter le log du terminal"/
    );

    assert.doesNotMatch(
      html,
      /id="devTerminalExportOutput"[\s\S]{0,300}<form/
    );
  }
);

test(
  "Terminal #5.3 copie uniquement le buffer public du terminal actif",
  () => {
    const source =
      terminalUiSource();

    assert.match(
      source,
      /function getActiveDevTerminalOutputText\(\)/
    );

    assert.match(
      source,
      /devTerminalState\.activeTerminalId/
    );

    assert.match(
      source,
      /devTerminalBuffer\(terminalId\)/
    );

    assert.match(
      source,
      /\.map\(\(event\)[\s\S]*formatDevTerminalEvent\(event\)/
    );

    assert.match(
      source,
      /navigator\.clipboard\.writeText/
    );

    assert.doesNotMatch(
      source,
      /clipboard\.writeText\([\s\S]{0,120}(stdout|stderr|child|repositoryRoot)/
    );
  }
);

test(
  "Terminal #5.3 exporte seulement la sortie publique en fichier texte local",
  () => {
    const source =
      terminalUiSource();

    assert.match(
      source,
      /function exportActiveDevTerminalOutput\(\)/
    );

    assert.match(
      source,
      /new Blob\([\s\S]*text\/plain;charset=utf-8/
    );

    assert.match(
      source,
      /URL\.createObjectURL/
    );

    assert.match(
      source,
      /link\.download\s*=[\s\S]*safeDevTerminalLogName/
    );

    assert.match(
      source,
      /URL\.revokeObjectURL/
    );

    assert.doesNotMatch(
      source,
      /shell\s*:\s*true/
    );

    assert.doesNotMatch(
      source,
      /exec\(|spawn\(|writeFile/
    );
  }
);

test(
  "Terminal #5.3 autorise sélection et scroll natifs sans casser la sécurité du rendu",
  () => {
    assert.match(
      css,
      /\.dev-terminal-output\{[\s\S]*overflow:auto/
    );

    assert.match(
      css,
      /\.dev-terminal-output\{[\s\S]*overscroll-behavior:contain/
    );

    assert.match(
      css,
      /\.dev-terminal-output\{[\s\S]*scrollbar-gutter:stable/
    );

    assert.match(
      css,
      /\.dev-terminal-output\{[\s\S]*user-select:text/
    );

    const source =
      terminalUiSource();

    assert.doesNotMatch(
      source,
      /devTerminalOutput\.innerHTML/
    );

    assert.match(
      source,
      /line\.textContent/
    );
  }
);



// TERMINAL UX #5.4 — navigation, longues sorties, persistance, completion

test(
  "Terminal #5.4A expose navigation clavier et accès direct aux terminaux",
  () => {
    const source =
      terminalUiSource();

    assert.match(
      source,
      /function moveDevTerminalSelection\(/
    );

    assert.match(
      source,
      /ArrowLeft/
    );

    assert.match(
      source,
      /ArrowRight/
    );

    assert.match(
      source,
      /event\.key === "Home"/
    );

    assert.match(
      source,
      /event\.key === "End"/
    );

    assert.match(
      source,
      /event\.ctrlKey[\s\S]*event\.key !== "Tab"/
    );

    assert.match(
      source,
      /event\.shiftKey[\s\S]*\?\s*-1[\s\S]*:\s*1/
    );

    assert.match(
      source,
      /event\.code\.match\([\s\S]*Digit\(\[1-9\]\)/
    );

    assert.match(
      source,
      /activateDevTerminal\(\s*terminalId/
    );
  }
);

test(
  "Terminal #5.4A garde le scroll indépendant lors d'un changement d'onglet",
  () => {
    const source =
      terminalUiSource();

    assert.match(
      source,
      /function activateDevTerminal\(/
    );

    assert.match(
      source,
      /rememberDevTerminalScrollState\(\)/
    );

    assert.match(
      source,
      /scrollByTerminal:\s*new Map\(\)/
    );

    assert.match(
      source,
      /followOutputByTerminal:\s*new Map\(\)/
    );
  }
);

test(
  "Terminal #5.4B expose retour en bas et compteur de nouvelles sorties",
  () => {
    const source =
      terminalUiSource();

    assert.match(
      html,
      /id="devTerminalJumpBottom"/
    );

    assert.match(
      source,
      /pendingOutputByTerminal:\s*new Map\(\)/
    );

    assert.match(
      source,
      /function devTerminalPendingOutputCount\(/
    );

    assert.match(
      source,
      /function renderDevTerminalJumpBottom\(/
    );

    assert.match(
      source,
      /function followDevTerminalOutput\(/
    );

    assert.match(
      source,
      /resetDevTerminalPendingOutput\(/
    );
  }
);

test(
  "Terminal #5.4B incrémente les sorties en attente uniquement hors auto-follow",
  () => {
    const source =
      terminalUiSource();

    assert.match(
      source,
      /pendingOutputByTerminal\.set/
    );

    assert.match(
      source,
      /followOutputByTerminal/
    );

    assert.match(
      source,
      /publicOutput/
    );

    assert.match(
      source,
      /renderDevTerminalJumpBottom\(\)/
    );
  }
);

test(
  "Terminal #5.4C persiste uniquement la disposition ergonomique des terminaux USER",
  () => {
    const source =
      terminalUiSource();

    assert.match(
      source,
      /DEV_TERMINAL_LAYOUT_STORAGE_PREFIX/
    );

    assert.match(
      source,
      /DEV_TERMINAL_RESTORE_MAX\s*=\s*9/
    );

    assert.match(
      source,
      /function persistDevTerminalLayout\(/
    );

    assert.match(
      source,
      /userCount/
    );

    assert.match(
      source,
      /activeIndex/
    );

    assert.match(
      source,
      /function loadDevTerminalLayout\(/
    );

    assert.match(
      source,
      /restoredUserTerminals/
    );

    assert.match(
      source,
      /await createDevTerminal\(\)/
    );
  }
);

test(
  "Terminal #5.4C ne restaure ni sortie ni process ancien",
  () => {
    const source =
      terminalUiSource();

    const start =
      source.indexOf(
        "const restoredLayout"
      );

    const end =
      source.indexOf(
        "startDevTerminalPolling",
        start
      );

    assert.ok(
      start >= 0 &&
      end > start
    );

    const restoreBlock =
      source.slice(
        start,
        end
      );

    assert.doesNotMatch(
      restoreBlock,
      /outputByTerminal\.set\([^,]+,\s*[^[]/
    );

    assert.doesNotMatch(
      restoreBlock,
      /runCommand|\/run|child|spawn|exec/
    );

    assert.doesNotMatch(
      restoreBlock,
      /owner\s*:\s*["']NOON["']/
    );
  }
);

test(
  "Terminal #5.4D expose popup et navigation Tab Shift+Tab Esc",
  () => {
    const source =
      terminalUiSource();

    assert.match(
      source,
      /devTerminalCompletionPopup/
    );

    assert.match(
      source,
      /role",\s*"listbox"/
    );

    assert.match(
      source,
      /function closeDevTerminalCompletion\(/
    );

    assert.match(
      source,
      /async function cycleDevTerminalCompletion\(/
    );

    assert.match(
      source,
      /event\.key === "Tab"/
    );

    assert.match(
      source,
      /event\.shiftKey/
    );

    assert.match(
      source,
      /event\.key === "Escape"/
    );

    assert.match(
      source,
      /event\.preventDefault\(\)/
    );
  }
);

test(
  "Terminal #5.4D combine historique local et suggestions projet sans exécuter de shell",
  () => {
    const source =
      terminalUiSource();

    assert.match(
      source,
      /DEV_TERMINAL_STATIC_COMPLETIONS/
    );

    assert.match(
      source,
      /devTerminalState\.history/
    );

    assert.match(
      source,
      /fetchDevTerminalProjectCompletions/
    );

    assert.match(
      source,
      /\/completions\?q=/
    );

    assert.match(
      source,
      /currentHasParentTraversal/
    );

    assert.match(
      source,
      /\.includes\(".."\)/
    );

    assert.doesNotMatch(
      source,
      /\bexec(?:File|Sync)?\s*\(/
    );

    assert.doesNotMatch(
      source,
      /\bspawn\s*\(/
    );
  }
);

test(
  "Terminal #5.4D possède le style de popup de completion",
  () => {
    assert.match(
      css,
      /\.dev-terminal-completion\{/
    );

    assert.match(
      css,
      /\.dev-terminal-completion-item\{/
    );

    assert.match(
      css,
      /\.dev-terminal-completion\[hidden\]/
    );
  }
);
