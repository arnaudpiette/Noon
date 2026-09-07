"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAmbientContextEngine, createActiveApplicationAdapter, createStructuredApplicationAdapter,
  safeExplicitFileRef, assertFilePrecondition } = require("../services/context");
const { createContextBuilder } = require("../services/context/context-builder");

function fixture(options = {}) {
  let clock = new Date("2026-08-30T08:00:00.000Z");
  const engine = createAmbientContextEngine({ now: () => clock, featureMode: options.featureMode || "LIMITED" });
  return { engine, advance(ms) { clock = new Date(clock.getTime() + ms); } };
}

test("OFF refuse toute collecte et ne conserve rien", () => {
  const { engine } = fixture();
  const result = engine.receive({ signalType: "USER_DECLARED_CONTEXT", userExplicit: true, valueRef: { label: "fictif" } });
  assert.equal(result.accepted, false); assert.equal(engine.snapshot().signals.length, 0);
});

test("partage explicite : indicateur visible, snapshot minimal, arrêt immédiat", () => {
  const { engine } = fixture();
  engine.start({ requestedMode: "EXPLICIT_SHARE", userExplicit: true });
  const accepted = engine.receive({ signalType: "ACTIVE_WORKSPACE", source: "user_share", userExplicit: true,
    confidence: 1, scope: "device_local", valueRef: { workspaceId: "workspace-fictif" } });
  assert.equal(accepted.accepted, true); assert.equal(engine.currentView().visibleIndicator, true);
  assert.equal(engine.buildContext({ query: "Travaille ici" }).resolvedWorkspaceId, "workspace-fictif");
  assert.deepEqual(engine.stop(), { stopped: true, cleared: 1 }); assert.equal(engine.snapshot().signals.length, 0);
});

test("expiration et redémarrage ne restaurent aucun signal", () => {
  const f = fixture();
  f.engine.start({ requestedMode: "TEMPORARY_FOCUS", durationMs: 1000, userExplicit: true });
  f.engine.receive({ signalType: "CURRENT_TASK", userExplicit: true, valueRef: { taskId: "task-fictive" } });
  f.advance(1001); assert.equal(f.engine.health().active, false); assert.equal(f.engine.snapshot().signals.length, 0);
  assert.equal(fixture().engine.snapshot().signals.length, 0);
});

test("application active reste un indice sans autorité ni bascule de projet", () => {
  const { engine } = fixture();
  engine.start({ requestedMode: "PASSIVE_MINIMAL", userExplicit: true });
  engine.receive({ signalType: "ACTIVE_APPLICATION", source: "active_app", confidence: 0.4,
    valueRef: { applicationId: "com.figma.Desktop", workspaceId: "ne-doit-pas-basculer" } });
  const context = engine.buildContext({ query: "Bonjour", explicitWorkspaceId: "workspace-explicite", explicitMode: "DA" });
  assert.equal(context.resolvedWorkspaceId, "workspace-explicite"); assert.equal(context.resolvedMode, "DA");
  assert.equal(context.ambientAuthority, false); assert.equal(engine.proactiveHints().notify, false);
});

test("sources passives sensibles et capture cachée sont refusées", () => {
  for (const source of ["mail", "browser_history", "terminal", "clipboard", "keyboard", "screen_capture"]) {
    const { engine } = fixture(); engine.start({ requestedMode: "PASSIVE_MINIMAL", userExplicit: true });
    const result = engine.receive({ signalType: "ACTIVE_APPLICATION", source, valueRef: { content: "secret-fictif" } });
    assert.equal(result.accepted, false, source);
  }
});

test("local_only n'est jamais injecté dans un contexte distant", () => {
  const { engine } = fixture(); engine.start({ userExplicit: true });
  engine.receive({ signalType: "EXPLICIT_FILE", userExplicit: true, scope: "local_only", sensitivity: "restricted", valueRef: { ref: "file-1" } });
  assert.equal(engine.snapshot().signals.length, 1); assert.equal(engine.snapshot({ remote: true }).signals.length, 0);
});

test("une question explicite prime sur les indices passifs", () => {
  const { engine } = fixture(); engine.start({ requestedMode: "PASSIVE_MINIMAL", userExplicit: true });
  engine.receive({ signalType: "ACTIVE_APPLICATION", source: "active_app", valueRef: { applicationName: "Figma" } });
  assert.equal(engine.buildContext({ query: "Parle de mon agenda" }).signals.length, 0);
});

test("racines autorisées, échappement symlink et précondition mtime", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-ambient-")); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inside = path.join(root, "brief.txt"); fs.writeFileSync(inside, "fictif");
  const ref = safeExplicitFileRef(inside, [root]); assert.equal(assertFilePrecondition(ref), true);
  fs.appendFileSync(inside, " changé"); assert.throws(() => assertFilePrecondition(ref), { code: "AMBIENT_FILE_STALE" });
  const outside = path.join(os.tmpdir(), `outside-${Date.now()}.txt`); fs.writeFileSync(outside, "fictif"); t.after(() => fs.rmSync(outside, { force: true }));
  const link = path.join(root, "escape.txt"); fs.symlinkSync(outside, link);
  assert.throws(() => safeExplicitFileRef(link, [root]), { code: "AMBIENT_ROOT_ESCAPE" });
});

test("adaptateurs application active, VS Code et Figma sont bornés et permissionnés", async () => {
  const active = createActiveApplicationAdapter({ enabled: true, provider: async () => ({ bundleId: "com.microsoft.VSCode", applicationName: "Code", windowTitle: "SECRET" }) });
  assert.deepEqual(await active.read(), { applicationId: "com.microsoft.VSCode", applicationName: "Code" });
  const denied = createStructuredApplicationAdapter({ id: "figma", enabled: true, permission: false });
  assert.equal(denied.normalize({ documentName: "Maquette" }), null);
  const vscode = createStructuredApplicationAdapter({ id: "vscode", enabled: true, permission: true });
  assert.deepEqual(vscode.normalize({ workspaceId: "ws", documentName: "app.js", content: "ignoré" }),
    { adapter: "vscode", workspaceId: "ws", documentId: null, documentName: "app.js" });
});

test("ContextBuilder injecte seulement le segment ambiant distant filtré", () => {
  const f = fixture(); f.engine.start({ userExplicit: true });
  f.engine.receive({ signalType: "USER_DECLARED_CONTEXT", userExplicit: true, valueRef: { label: "Contexte fictif" } });
  const builder = createContextBuilder({ personalityProvider: () => "Noon", hardRulesRegistry: { inferIntent: () => "conversation", version: () => "1", getRulesForContext: () => [] },
    memoryEngine: { getRelevantContext: () => ({ projectContext: [], remoteContext: [], localOnlyContext: [], conversationContext: [], metadata: { counts: {}, sourcesUsed: [] } }) },
    ambientContextProvider: (input) => f.engine.buildContext(input) });
  const context = builder.buildContext({ query: "Aide-moi", purpose: "remote_model" });
  assert.equal(context.runtime.ambient.signals.length, 1); assert.equal(context.metadata.ambientSignalIds.length, 1);
  assert.match(builder.renderRemoteSystemContext(context), /indice non autoritaire/);
});

test("le contexte n'accorde ni écriture, ni complétion, ni mémoire ou émotion", () => {
  const { engine } = fixture(); engine.start({ userExplicit: true });
  engine.receive({ signalType: "CURRENT_TASK", userExplicit: true, valueRef: { taskId: "t", completed: true, emotion: "stress" } });
  const context = engine.buildContext({ query: "continue" });
  assert.equal(context.ambientAuthority, false); assert.equal("writeAllowed" in context, false);
  assert.equal("memoryCandidate" in context, false); assert.equal(engine.proactiveHints({ focusActive: true }).relevanceBoost, 0);
});
