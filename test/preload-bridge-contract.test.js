"use strict";

// V3-L0/A.4 : contrat du pont IPC. Le preload est exécuté avec un module `electron` simulé :
// l'API publiée doit correspondre au type JSDoc `NoonBridge`, chaque méthode doit viser un canal
// `noon:*` valide, et chaque canal doit être enregistré par le processus principal.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const preloadPath = path.join(__dirname, "..", "electron", "preload.js");
const mainSource = fs.readFileSync(path.join(__dirname, "..", "electron", "main.js"), "utf8");

function loadBridge() {
  const exposed = new Map();
  const invocations = [];
  const listeners = [];
  const electronStub = {
    contextBridge: { exposeInMainWorld: (name, api) => exposed.set(name, api) },
    ipcRenderer: {
      invoke: (channel, payload) => {
        invocations.push({ channel, payload, argCount: payload === undefined ? 1 : 2 });
        return Promise.resolve({ channel });
      },
      on: (channel, listener) => listeners.push({ type: "on", channel, listener }),
      removeListener: (channel, listener) => listeners.push({ type: "remove", channel, listener }),
    },
  };
  const originalLoad = Module._load;
  Module._load = function load(request, ...rest) {
    if (request === "electron") return electronStub;
    return originalLoad.call(this, request, ...rest);
  };
  try {
    delete require.cache[require.resolve(preloadPath)];
    require(preloadPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(preloadPath)];
  }
  return { exposed, invocations, listeners };
}

function bridgeTypedefKeys() {
  const source = fs.readFileSync(preloadPath, "utf8");
  const end = source.indexOf("}} NoonBridge");
  assert.ok(end > 0, "typedef NoonBridge introuvable");
  const block = source.slice(source.lastIndexOf("@typedef {{", end), end);
  return block.split("\n").map((line) => line.match(/^ \*\s+(\w+):/)?.[1]).filter(Boolean);
}

test("le preload publie exactement l'API décrite par le type NoonBridge, gelée", () => {
  const { exposed } = loadBridge();
  assert.deepEqual([...exposed.keys()], ["noon"]);
  const api = exposed.get("noon");
  assert.ok(Object.isFrozen(api));
  assert.deepEqual(Object.keys(api).sort(), bridgeTypedefKeys().sort());
});

test("chaque méthode vise un canal noon:* enregistré par le processus principal", async () => {
  const { exposed, invocations } = loadBridge();
  const api = exposed.get("noon");
  const registered = new Set([...mainSource.matchAll(/registerTrustedHandler\(\s*"(noon:[a-z0-9-]+)"/g)].map((match) => match[1]));
  const methods = Object.entries(api).filter(([name, value]) => typeof value === "function" && !/^on[A-Z]/.test(name));
  assert.equal(methods.length, 39);
  for (const [name, method] of methods) {
    const before = invocations.length;
    const result = await method("x", "y");
    assert.equal(invocations.length, before + 1, `${name} doit appeler ipcRenderer.invoke une fois`);
    const { channel } = invocations.at(-1);
    assert.match(channel, /^noon:[a-z0-9-]+$/, name);
    assert.ok(registered.has(channel), `${name} → ${channel} non enregistré dans electron/main.js`);
    assert.deepEqual(result, { channel });
  }
});

test("les charges utiles gardent leur forme historique", () => {
  const { exposed, invocations } = loadBridge();
  const api = exposed.get("noon");
  void api.getDevProjectRules("workspace-1");
  void api.setPreference("showInDock", true);
  void api.devPreviewSetVisible("oui");
  void api.setLiveActive(0);
  void api.getStatus();
  assert.deepEqual(invocations, [
    { channel: "noon:dev-project-rules", payload: { workspaceId: "workspace-1" }, argCount: 2 },
    { channel: "noon:set-preference", payload: { key: "showInDock", value: true }, argCount: 2 },
    { channel: "noon:dev-preview-set-visible", payload: true, argCount: 2 },
    { channel: "noon:set-live-active", payload: false, argCount: 2 },
    { channel: "noon:get-status", payload: undefined, argCount: 1 },
  ]);
});

test("les abonnements filtrent l'événement Electron et se désabonnent", () => {
  const { exposed, listeners } = loadBridge();
  const api = exposed.get("noon");
  for (const [method, channel] of [["onDevPreviewState", "noon:dev-preview-state"], ["onDeepLink", "noon:deep-link"], ["onSystemState", "noon:system-state"]]) {
    assert.equal(typeof api[method]("pas une fonction"), "function");
    const received = [];
    const unsubscribe = api[method]((value) => received.push(value));
    const subscription = listeners.at(-1);
    assert.equal(subscription.type, "on");
    assert.equal(subscription.channel, channel);
    subscription.listener({ sender: "event" }, { ok: true });
    assert.deepEqual(received, [{ ok: true }]);
    unsubscribe();
    assert.deepEqual(listeners.at(-1), { type: "remove", channel, listener: subscription.listener });
  }
});
