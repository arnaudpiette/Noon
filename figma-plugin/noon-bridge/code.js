// Noon Bridge — fil principal du plugin Figma (accès au fichier ouvert, pas au réseau).
// L'interface (ui.html) parle à Noon sur 127.0.0.1 et transmet ici les commandes reçues.
// Liste blanche stricte : seules les commandes ci-dessous existent. Cette version ne fait que lire.
/* global figma, __html__ */

var PLUGIN_VERSION = "0.1.0";
var MAX_NODES = 100;

figma.showUI(__html__, { width: 320, height: 300, themeColors: true });

function summarize(node) {
  var summary = { id: node.id, name: node.name, type: node.type, visible: node.visible !== false };
  if ("x" in node) { summary.x = Math.round(node.x); summary.y = Math.round(node.y); }
  if ("width" in node) { summary.width = Math.round(node.width); summary.height = Math.round(node.height); }
  if ("children" in node) summary.childCount = node.children.length;
  if (node.type === "TEXT") summary.characters = String(node.characters || "").slice(0, 200);
  return summary;
}

var COMMANDS = {
  ping: function () {
    return { pong: true, pluginVersion: PLUGIN_VERSION };
  },
  get_selection: function () {
    var selection = figma.currentPage.selection;
    return { pageName: figma.currentPage.name, count: selection.length, nodes: selection.slice(0, MAX_NODES).map(summarize), truncated: selection.length > MAX_NODES };
  },
  get_page: function () {
    var children = figma.currentPage.children;
    return { fileName: figma.root.name, pageName: figma.currentPage.name, childCount: children.length, nodes: children.slice(0, MAX_NODES).map(summarize), truncated: children.length > MAX_NODES };
  },
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
    figma.ui.postMessage({ type: "result", id: command.id, ok: false, error: { code: "FIGMA_PLUGIN_ERROR", message: String((error && error.message) || error).slice(0, 300) } });
  }
};
