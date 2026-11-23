// Noon Bridge — fil principal du plugin Figma (accès au fichier ouvert, pas au réseau).
// L'interface (ui.html) parle à Noon sur localhost et transmet ici les commandes reçues.
// Liste blanche stricte : seules les commandes ci-dessous existent.
// Lecture : ping, get_selection, get_page, get_node, get_design_tokens.
// Écriture : apply_changes, uniquement après validation de l'utilisateur dans Noon ; un plan
// complet appliqué en une fois, annulable d'un seul Cmd+Z ; aucune suppression.
/* global figma, __html__ */

var PLUGIN_VERSION = "0.2.0";
var MAX_NODES = 100;
var MAX_DEPTH = 3;
var MAX_OPERATIONS = 100;

figma.showUI(__html__, { width: 320, height: 300, themeColors: true });

// ---------- Lecture ----------

function hexOf(paint) {
  if (!paint || paint.type !== "SOLID" || !paint.color) return null;
  var channel = function (value) { var hex = Math.round(value * 255).toString(16); return hex.length === 1 ? "0" + hex : hex; };
  return "#" + channel(paint.color.r) + channel(paint.color.g) + channel(paint.color.b);
}

function summarize(node) {
  var summary = { id: node.id, name: node.name, type: node.type, visible: node.visible !== false };
  if ("x" in node) { summary.x = Math.round(node.x); summary.y = Math.round(node.y); }
  if ("width" in node) { summary.width = Math.round(node.width); summary.height = Math.round(node.height); }
  if ("children" in node) summary.childCount = node.children.length;
  if (node.type === "TEXT") summary.characters = String(node.characters || "").slice(0, 200);
  return summary;
}

function describe(node, depth) {
  var detail = summarize(node);
  if ("fills" in node && Array.isArray(node.fills)) detail.fills = node.fills.slice(0, 4).map(function (paint) { return { type: paint.type, color: hexOf(paint), opacity: paint.opacity === undefined ? 1 : paint.opacity }; });
  if ("cornerRadius" in node && typeof node.cornerRadius === "number") detail.cornerRadius = node.cornerRadius;
  if ("layoutMode" in node) { detail.layoutMode = node.layoutMode; detail.itemSpacing = node.itemSpacing; detail.padding = [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft]; }
  if (node.type === "TEXT") {
    detail.characters = String(node.characters || "").slice(0, 2000);
    if (typeof node.fontSize === "number") detail.fontSize = node.fontSize;
    if (node.fontName && node.fontName !== figma.mixed) detail.fontName = { family: node.fontName.family, style: node.fontName.style };
  }
  if (depth > 0 && "children" in node) detail.children = node.children.slice(0, MAX_NODES).map(function (child) { return describe(child, depth - 1); });
  return detail;
}

async function findNode(id) {
  var node = await figma.getNodeByIdAsync(String(id || ""));
  if (!node) throw Object.assign(new Error("Élément introuvable : " + id), { code: "FIGMA_NODE_NOT_FOUND" });
  return node;
}

// ---------- Écriture (plan validé dans Noon) ----------

function parseHex(value) {
  var match = /^#?([0-9a-f]{6})$/i.exec(String(value || ""));
  if (!match) return null;
  var int = parseInt(match[1], 16);
  return { r: ((int >> 16) & 255) / 255, g: ((int >> 8) & 255) / 255, b: (int & 255) / 255 };
}

function applyBox(node, op) {
  if (typeof op.name === "string") node.name = op.name;
  if (typeof op.x === "number") node.x = op.x;
  if (typeof op.y === "number") node.y = op.y;
  if (typeof op.width === "number" && typeof op.height === "number" && "resize" in node) node.resize(Math.max(1, op.width), Math.max(1, op.height));
  if (typeof op.fill === "string" && "fills" in node) { var color = parseHex(op.fill); if (color) node.fills = [{ type: "SOLID", color: color }]; }
  if (typeof op.cornerRadius === "number" && "cornerRadius" in node) node.cornerRadius = op.cornerRadius;
  if (typeof op.visible === "boolean") node.visible = op.visible;
  if (typeof op.layoutMode === "string" && "layoutMode" in node) node.layoutMode = op.layoutMode;
  if (typeof op.itemSpacing === "number" && "itemSpacing" in node) node.itemSpacing = op.itemSpacing;
  if (typeof op.padding === "number" && "paddingTop" in node) { node.paddingTop = op.padding; node.paddingRight = op.padding; node.paddingBottom = op.padding; node.paddingLeft = op.padding; }
}

async function resolveParent(op, refs) {
  if (!op.parentId) return figma.currentPage;
  var id = String(op.parentId);
  if (id.indexOf("ref:") === 0) {
    var created = refs[id.slice(4)];
    if (!created) throw Object.assign(new Error("Référence inconnue : " + id), { code: "FIGMA_REF_UNKNOWN" });
    return created;
  }
  var parent = await findNode(id);
  if (!("appendChild" in parent)) throw Object.assign(new Error("Cet élément ne peut pas contenir d'enfants : " + id), { code: "FIGMA_PARENT_INVALID" });
  return parent;
}

async function setText(node, op) {
  var font = { family: op.fontFamily || "Inter", style: op.fontStyle || "Regular" };
  if (node.type === "TEXT" && node.characters && node.fontName !== figma.mixed) await figma.loadFontAsync(node.fontName);
  await figma.loadFontAsync(font);
  node.fontName = font;
  if (typeof op.fontSize === "number") node.fontSize = op.fontSize;
  if (typeof op.characters === "string") node.characters = op.characters;
}

async function runOperation(op, refs) {
  var node;
  if (op.op === "create_frame" || op.op === "create_rectangle") {
    node = op.op === "create_frame" ? figma.createFrame() : figma.createRectangle();
    (await resolveParent(op, refs)).appendChild(node);
    applyBox(node, op);
  } else if (op.op === "create_text") {
    node = figma.createText();
    (await resolveParent(op, refs)).appendChild(node);
    await setText(node, op);
    applyBox(node, Object.assign({}, op, { width: undefined, height: undefined }));
  } else if (op.op === "update_node") {
    node = await findNode(op.nodeId);
    if (node.type === "TEXT" && (typeof op.characters === "string" || op.fontFamily || typeof op.fontSize === "number")) await setText(node, op);
    applyBox(node, op);
  } else {
    throw Object.assign(new Error("Opération inconnue : " + op.op), { code: "FIGMA_OPERATION_UNKNOWN" });
  }
  if (op.ref) refs[op.ref] = node;
  return { op: op.op, ref: op.ref || null, id: node.id, name: node.name };
}

async function applyChanges(params) {
  var operations = Array.isArray(params.operations) ? params.operations : [];
  if (!operations.length || operations.length > MAX_OPERATIONS) throw Object.assign(new Error("Plan vide ou trop long."), { code: "FIGMA_PLAN_INVALID" });
  var refs = {}; var done = [];
  for (var index = 0; index < operations.length; index += 1) {
    try { done.push(await runOperation(operations[index], refs)); }
    catch (error) {
      figma.commitUndo();
      return { applied: done, failedAt: index, error: { code: error.code || "FIGMA_OPERATION_FAILED", message: String(error.message || error).slice(0, 300) }, complete: false };
    }
  }
  // Un seul pas d'annulation pour tout le plan ; la sélection montre ce qui a été créé ou modifié.
  figma.commitUndo();
  var touched = [];
  for (var i = 0; i < done.length; i += 1) { var found = await figma.getNodeByIdAsync(done[i].id); if (found && found.parent && found.parent.type === "PAGE") touched.push(found); }
  if (touched.length) { figma.currentPage.selection = touched; figma.viewport.scrollAndZoomIntoView(touched); }
  figma.notify("Noon : " + done.length + " modification(s) appliquée(s).");
  return { applied: done, complete: true };
}

var COMMANDS = {
  ping: function () { return { pong: true, pluginVersion: PLUGIN_VERSION }; },
  get_selection: function () {
    var selection = figma.currentPage.selection;
    return { pageName: figma.currentPage.name, count: selection.length, nodes: selection.slice(0, MAX_NODES).map(function (node) { return describe(node, 1); }), truncated: selection.length > MAX_NODES };
  },
  get_page: function () {
    var children = figma.currentPage.children;
    return { fileName: figma.root.name, pageName: figma.currentPage.name, childCount: children.length, nodes: children.slice(0, MAX_NODES).map(summarize), truncated: children.length > MAX_NODES };
  },
  get_node: async function (params) {
    var depth = Math.max(0, Math.min(MAX_DEPTH, Number(params.depth) || 1));
    return describe(await findNode(params.nodeId), depth);
  },
  get_design_tokens: async function () {
    var paints = await figma.getLocalPaintStylesAsync();
    var texts = await figma.getLocalTextStylesAsync();
    var variables = await figma.variables.getLocalVariablesAsync();
    return {
      paintStyles: paints.slice(0, 200).map(function (style) { return { id: style.id, name: style.name, color: hexOf(style.paints && style.paints[0]) }; }),
      textStyles: texts.slice(0, 200).map(function (style) { return { id: style.id, name: style.name, fontName: style.fontName, fontSize: style.fontSize }; }),
      variables: variables.slice(0, 300).map(function (variable) { return { id: variable.id, name: variable.name, type: variable.resolvedType }; }),
    };
  },
  apply_changes: applyChanges,
};

function context() {
  return { fileName: figma.root.name, pageName: figma.currentPage.name, editorType: figma.editorType, pluginVersion: PLUGIN_VERSION };
}

figma.on("currentpagechange", function () {
  figma.ui.postMessage({ type: "context", context: context() });
});

figma.ui.onmessage = async function (message) {
  if (!message || typeof message.type !== "string") return;
  if (message.type === "context") { figma.ui.postMessage({ type: "context", context: context() }); return; }
  // Le jeton est rangé dans le stockage local du plugin sur ce Mac (clientStorage), jamais dans le fichier.
  if (message.type === "token:get") { figma.ui.postMessage({ type: "token", token: (await figma.clientStorage.getAsync("noonToken")) || null }); return; }
  if (message.type === "token:set") { await figma.clientStorage.setAsync("noonToken", typeof message.token === "string" ? message.token : ""); return; }
  if (message.type === "token:clear") { await figma.clientStorage.deleteAsync("noonToken"); return; }
  if (message.type !== "command" || !message.command) return;
  var command = message.command;
  var handler = Object.prototype.hasOwnProperty.call(COMMANDS, command.type) ? COMMANDS[command.type] : null;
  if (!handler) {
    figma.ui.postMessage({ type: "result", id: command.id, ok: false, error: { code: "FIGMA_PLUGIN_COMMAND_UNKNOWN", message: "Commande inconnue du plugin." } });
    return;
  }
  try {
    var result = await handler(command.params || {});
    figma.ui.postMessage({ type: "result", id: command.id, ok: true, result: result });
  } catch (error) {
    figma.ui.postMessage({ type: "result", id: command.id, ok: false, error: { code: error.code || "FIGMA_PLUGIN_ERROR", message: String((error && error.message) || error).slice(0, 300) } });
  }
};
