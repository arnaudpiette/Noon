"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/style.css"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const source = app.slice(app.indexOf("// DEV_WORKSPACE_AGENT_UI_START"), app.indexOf("// DEV_WORKSPACE_AGENT_UI_END"));

test("l’Agent Loop ajoute uniquement des contrôles compacts au header Terminal", () => {
  for (const id of ["devWorkspaceAgentState", "devWorkspaceAgentRun", "devWorkspaceAgentCancel"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.ok(html.indexOf('id="devWorkspaceAgentRun"') < html.indexOf('id="devTerminalAdd"'));
  assert.match(html, /class="dev-terminal-action-group dev-workspace-agent-actions"/);
  assert.match(html, /class="dev-terminal-action-group dev-workspace-actions"/);
  assert.match(html, /id="devWorkspaceAgentCancel"[^>]*disabled/);
  assert.doesNotMatch(source, /appendChild|insertBefore|replaceWith/);
});

test("l’UI expose les phases et STOP sans HTML dynamique", () => {
  for (const label of ["Planning…", "Running…", "Validating…", "Observing…", "Deciding…", "Done", "Blocked", "Failed"]) assert.ok(source.includes(label), label);
  assert.match(source, /\.textContent\s*=/);
  assert.doesNotMatch(source, /\.innerHTML/);
});

test("l’UI lie l’exécution à la session Focus active", () => {
  for (const value of ["devTerminalState.session?.id", "devTerminalState.contextKey", "currentMode", "devWorkspaceAgentSerial"]) assert.ok(source.includes(value), value);
});

test("l’UI utilise seulement les routes Agent bornées", () => {
  assert.match(source, /\/api\/dev\/workspace-agent\/executions/);
  assert.match(source, /\/cancel/);
  assert.doesNotMatch(source, /repositoryRoot|git add|git commit|git push/i);
});

test("la Preview est transmise comme état structuré et non depuis le DOM visuel", () => {
  assert.match(source, /devPreviewState\.native\.url/);
  assert.match(source, /devPreviewIsOpen\(\)/);
  assert.doesNotMatch(source, /screenshot|canvas|innerText/);
});

test("les routes serveur exigent l’UI locale de confiance", () => {
  const route = server.slice(server.indexOf('requestPath === "/api/dev/workspace-agent/executions"'), server.indexOf('requestPath === "/api/dev/native/tasks"'));
  assert.match(route, /requireTrustedDevUi\(req\)/);
  assert.match(route, /devWorkspaceAgentExecutionLoop\.start/);
  assert.match(route, /devWorkspaceAgentExecutionLoop\.cancel/);
  assert.match(route, /devWorkspaceAgentExecutionLoop\.get/);
});

test("aucune route Agent Git ou remote mutante n’est ajoutée", () => {
  const route = server.slice(server.indexOf('requestPath === "/api/dev/workspace-agent/executions"'), server.indexOf('requestPath === "/api/dev/native/tasks"'));
  assert.doesNotMatch(route, /git(?:-|\s)(?:add|commit|restore|reset|checkout|clean|push|pull|rebase)/i);
  assert.doesNotMatch(route, /repositoryRoot/);
});

test("les styles n’introduisent aucun nouveau panneau ou positionnement", () => {
  const styles = css.slice(
    css.indexOf(".dev-workspace-agent-state"),
    css.indexOf(".dev-terminal-panel.is-source-control", css.indexOf(".dev-workspace-agent-state"))
  );
  assert.doesNotMatch(styles, /position:(?:absolute|fixed)|grid-template/);
});

test("les contrôles Agent restent accessibles et espacés sans nouveau panneau", () => {
  assert.match(css, /\.dev-terminal-actions\{[\s\S]*?gap:12px/);
  assert.match(css, /\.dev-terminal-action-group\{[\s\S]*?gap:8px/);
  assert.match(css, /\.dev-terminal-actions button:focus-visible/);
  assert.match(html, /aria-label="Agent Noon"/);
  assert.match(html, /aria-label="Workspace"/);
});

test("l’Agent transmet des objets au helper JSON sans double sérialisation", () => {
  assert.match(
    app,
    /async function devTerminalRequest[\s\S]{0,1200}JSON\.stringify\(body\)/
  );

  assert.doesNotMatch(
    source,
    /body:\s*JSON\.stringify\s*\(/
  );

  assert.match(
    source,
    /workspaceSessionId:\s*sessionId/
  );

  assert.match(
    source,
    /body:\s*\{\s*\}/
  );
});

test("le POST stocke l’exécution, démarre le polling et Stop cible son identifiant actif", () => {
  assert.match(source, /devWorkspaceAgentExecutionId\s*=\s*data\.execution\.executionId/);
  assert.match(source, /void refreshDevWorkspaceAgent\(\)/);
  assert.match(source, /executions\/\$\{encodeURIComponent\(executionId\)\}\/cancel/);
  assert.match(source, /devWorkspaceAgentCancel\.disabled\s*=\s*true/);
  assert.match(source, /devWorkspaceAgentRun\.disabled\s*=\s*!terminal/);
});

test("Noon réutilise seulement la dernière validation SAFE_READ réellement exécutée", () => {
  const terminalSource = app.slice(app.indexOf("devTerminalForm.addEventListener"), app.indexOf("// DEV_WORKSPACE_AGENT_UI_START"));
  assert.match(app, /lastAuthorizedValidationCommand:\s*null/);
  assert.match(terminalSource, /devTerminalInput\.value\s*=\s*""/);
  assert.match(terminalSource, /data\.result\?\.classification ===[\s\S]*"SAFE_READ"[\s\S]*lastAuthorizedValidationCommand\s*=\s*command/);
  assert.ok(terminalSource.indexOf("lastAuthorizedValidationCommand = command") > terminalSource.indexOf("await devTerminalRequest"));
  assert.match(source, /const command = lastAuthorizedDevValidationForActiveSession\(\)/);
  assert.doesNotMatch(source, /const command = devTerminalInput\.value\.trim\(\)/);
  assert.match(source, /Exécute d’abord une validation autorisée pour Noon\./);
});

test("la dernière validation est bornée à la session et au Focus actifs", () => {
  const closeSource = app.slice(app.indexOf("async function closeDevTerminalSession"), app.indexOf("async function openDevTerminalSession"));
  assert.match(app, /function lastAuthorizedDevValidationForActiveSession\(\)[\s\S]*lastAuthorizedValidationSessionId !== sessionId[\s\S]*lastAuthorizedValidationContextKey !== devTerminalState\.contextKey/);
  assert.match(closeSource, /clearLastAuthorizedDevValidation\(\)/);
});

test("le polling Agent sélectionne le terminal NOON associé et réutilise le flux Terminal", () => {
  assert.match(source, /terminalExecutionRefs\?\.at\(-1\)\?\.terminalSessionId/);
  assert.match(source, /workspace-terminal\/sessions\/\$\{encodeURIComponent\(sessionId\)\}/);
  assert.match(source, /devTerminalState\.activeTerminalId\s*=\s*terminal\.id/);
  assert.match(source, /await pollActiveDevTerminal\(\)/);
});
