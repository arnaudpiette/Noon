"use strict";

// Outils Figma du modèle : lecture libre ; écriture (apply_changes) en EXTERNAL, donc ordre
// explicite + confirmation (approbation exacte) avant exécution ; plan validé strictement ;
// exécution du plan par le plugin vérifiée sur une fausse API Figma.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readServerSource } = require("./helpers/server-source");
const test = require("node:test");
const vm = require("node:vm");
const { createSkillRegistry } = require("../skills/registry");
const { registerFigmaSkills, validateFigmaPlan } = require("../services/figma-bridge/figma-skills");

const op = (fields) => ({ op: "create_frame", ref: null, nodeId: null, parentId: null, name: null, x: null, y: null, width: null, height: null, fill: null, cornerRadius: null, characters: null, fontFamily: null, fontStyle: null, fontSize: null, layoutMode: null, itemSpacing: null, padding: null, visible: null, ...fields });

function setup() {
  const calls = [];
  const bridge = { request: async (type, params, options) => { calls.push({ type, params, options }); return { ok: true, type }; } };
  const registry = createSkillRegistry(undefined, {});
  registerFigmaSkills({ skillRegistry: registry, bridge });
  const byShortName = (name) => registry.getAllSkills().find((skill) => skill.definition.name === `figma.${name}`);
  return { registry, calls, byShortName };
}

test("lecture libre, écriture EXTERNAL : ordre explicite puis confirmation exigés", () => {
  const { registry, byShortName } = setup();
  for (const name of ["get_selection", "get_page", "get_node", "get_design_tokens"]) assert.equal(byShortName(name).permissions.level, "read", name);
  const write = byShortName("apply_changes");
  assert.equal(write.permissions.level, "external");
  assert.equal(write.permissions.confirmationRequired, true);
  assert.equal(registry.authorize("figma.apply_changes", {}, {}).code, "EXPLICIT_ORDER_REQUIRED");
  assert.equal(registry.authorize("figma.apply_changes", {}, { explicitOrder: true }).code, "CONFIRMATION_REQUIRED");
  assert.equal(registry.authorize("figma.apply_changes", {}, { explicitOrder: true, confirmed: true }).allowed, true);
  assert.equal(registry.authorize("figma.get_page", {}, {}).allowed, true);
});

test("apply_changes confirmé : plan normalisé (null retirés) envoyé avec authorizedWrite", async () => {
  const { registry, calls } = setup();
  const result = await registry.executeSkill("figma.apply_changes", {
    summary: "Créer une carte fictive", target: "Maquette · Page 1",
    operations: [op({ ref: "card", name: "Carte", x: 0, y: 0, width: 320, height: 200, fill: "#FFFFFF", layoutMode: "VERTICAL", padding: 24 }), op({ op: "create_text", parentId: "ref:card", characters: "Titre fictif", fontSize: 24 })],
  }, { explicitOrder: true, confirmed: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, "apply_changes");
  assert.equal(calls[0].options.authorizedWrite, true);
  assert.deepEqual(calls[0].params.operations[1], { op: "create_text", parentId: "ref:card", characters: "Titre fictif", fontSize: 24 });
  assert.equal(result.summary, "Créer une carte fictive");
  await assert.rejects(registry.executeSkill("figma.apply_changes", { summary: "x", target: "", operations: [op({ width: 10, height: 10 })] }, { explicitOrder: true }), /CONFIRMATION|confirm/i);
  assert.equal(calls.length, 1, "rien n'est envoyé sans confirmation");
});

test("validation du plan : suppression, champs inconnus, références et bornes refusés", () => {
  const plan = (operations) => ({ summary: "Plan fictif", target: "", operations });
  assert.throws(() => validateFigmaPlan(plan([])), { code: "FIGMA_PLAN_INVALID" });
  assert.throws(() => validateFigmaPlan(plan([{ op: "delete_node", nodeId: "1:2" }])), /non autorisée/);
  assert.throws(() => validateFigmaPlan(plan([{ ...op({ width: 10, height: 10 }), script: "x" }])), /champ inconnu/);
  assert.throws(() => validateFigmaPlan(plan([op({ op: "create_text", parentId: "ref:absent", characters: "a" })])), /n'est pas créé plus haut/);
  assert.throws(() => validateFigmaPlan(plan([op({ width: 10 })])), /vont ensemble/);
  assert.throws(() => validateFigmaPlan(plan([op({ width: 10, height: 10, fill: "rouge" })])), /#RRGGBB/);
  assert.throws(() => validateFigmaPlan(plan([op({ width: 99999, height: 10 })])), /hors limites/);
  assert.throws(() => validateFigmaPlan(plan([op({ op: "update_node", nodeId: "abc" })])), /nodeId/);
  assert.throws(() => validateFigmaPlan(plan([op({ op: "update_node", nodeId: "1:2" })])), /rien à modifier/);
  assert.throws(() => validateFigmaPlan(plan(Array.from({ length: 101 }, () => op({ width: 1, height: 1 })))), { code: "FIGMA_PLAN_INVALID" });
  const ok = validateFigmaPlan(plan([op({ op: "update_node", nodeId: "I12:34;5:6", characters: "Nouveau texte" })]));
  assert.deepEqual(ok.operations, [{ op: "update_node", nodeId: "I12:34;5:6", characters: "Nouveau texte" }]);
});

function fakeFigma() {
  let next = 10;
  const nodes = new Map();
  const page = { type: "PAGE", name: "Page 1", children: [], selection: [], appendChild(child) { child.parent = page; page.children.push(child); } };
  const make = (type) => {
    const node = { id: `1:${next++}`, type, name: type, x: 0, y: 0, width: 100, height: 100, visible: true, fills: [], children: [], parent: null,
      resize(width, height) { this.width = width; this.height = height; }, appendChild(child) { child.parent = this; this.children.push(child); } };
    if (type === "FRAME") Object.assign(node, { layoutMode: "NONE", itemSpacing: 0, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, cornerRadius: 0 });
    if (type === "TEXT") Object.assign(node, { characters: "", fontName: { family: "Inter", style: "Regular" }, fontSize: 12 });
    nodes.set(node.id, node);
    return node;
  };
  const undo = [];
  const figma = {
    mixed: Symbol("mixed"), editorType: "figma", root: { name: "Fichier fictif" }, currentPage: page,
    showUI() {}, on() {}, notify() {}, ui: { postMessage() {} }, clientStorage: {}, viewport: { scrollAndZoomIntoView() {} },
    createFrame: () => make("FRAME"), createRectangle: () => make("RECTANGLE"), createText: () => make("TEXT"),
    loadFontAsync: async () => {}, commitUndo: () => undo.push("commit"),
    getNodeByIdAsync: async (id) => nodes.get(id) || null,
  };
  return { figma, page, nodes, undo };
}

test("plugin : apply_changes crée, imbrique via ref, modifie, puis un seul pas d'annulation", async () => {
  const fake = fakeFigma();
  const sandbox = { figma: fake.figma, __html__: "", Object, Math, String, Number, Array, parseInt, Symbol };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "figma-plugin/noon-bridge/code.js"), "utf8"), sandbox);
  const commands = vm.runInNewContext("COMMANDS", sandbox);
  const result = await commands.apply_changes({ operations: [
    { op: "create_frame", ref: "card", name: "Carte", x: 40, y: 60, width: 320, height: 200, fill: "#FF8800", layoutMode: "VERTICAL", padding: 24 },
    { op: "create_text", parentId: "ref:card", characters: "Titre fictif", fontSize: 24 },
  ] });
  assert.equal(result.complete, true);
  assert.equal(result.applied.length, 2);
  const card = fake.page.children[0];
  assert.equal(card.name, "Carte"); assert.equal(card.width, 320); assert.equal(card.layoutMode, "VERTICAL"); assert.equal(card.paddingLeft, 24);
  assert.deepEqual(JSON.parse(JSON.stringify(card.fills[0].color)), { r: 1, g: 136 / 255, b: 0 });
  assert.equal(card.children[0].characters, "Titre fictif");
  assert.deepEqual(fake.undo, ["commit"], "un seul Cmd+Z pour tout le plan");
  const update = await commands.apply_changes({ operations: [{ op: "update_node", nodeId: card.children[0].id, characters: "Titre modifié" }] });
  assert.equal(update.complete, true);
  assert.equal(card.children[0].characters, "Titre modifié");
  const partial = await commands.apply_changes({ operations: [{ op: "create_rectangle", width: 10, height: 10 }, { op: "update_node", nodeId: "9:99", name: "x" }] });
  assert.equal(partial.complete, false); assert.equal(partial.failedAt, 1); assert.equal(partial.applied.length, 1);
  assert.equal(partial.error.code, "FIGMA_NODE_NOT_FOUND");
});

test("câblage : outils enregistrés seulement si le flag est actif, consigne Figma au modèle", () => {
  const server = readServerSource();
  assert.match(server, /if \(figmaToolsEnabled\) registerFigmaSkills\(\{ skillRegistry, bridge: figmaBridge \}\)/);
  assert.match(server, /figmaInstruction = figmaToolsEnabled/);
  assert.match(server, /creativeImageInstruction \+ " " \+ figmaInstruction/);
});

test("approbation : résumé lisible du plan Figma (créations, modifications, cible)", () => {
  const { createApprovalEngine } = require("../services/approvals/approval-engine");
  const approval = createApprovalEngine({}).prepareAction({ skillName: "ext_figma_apply_changes_8d93072afb", operation: "ext_figma_apply_changes_8d93072afb", target: "Maquette · Page 1",
    normalizedArgs: { summary: "Créer une carte fictive", target: "Maquette · Page 1", operations: [op({ width: 1, height: 1 }), op({ op: "update_node", nodeId: "1:2", name: "x" })] } });
  assert.equal(approval.summary, "Figma — Créer une carte fictive : 1 création(s), 1 modification(s) dans Maquette · Page 1. Aucune suppression ; Cmd+Z dans Figma annule tout le plan.");
});
