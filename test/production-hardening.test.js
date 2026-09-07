"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  assertBoundedIpcArguments,
  createTrustedIpcRegistrar,
  isTrustedRendererUrl,
  readPreviousStartupState,
  resolveBuildProfile,
  writeStartupState,
} = require("../electron/production-hardening");

const ORIGIN = "http://127.0.0.1:3000";

test("les profils de build ont des valeurs fermées et un défaut lié au packaging", () => {
  assert.equal(resolveBuildProfile({ value: "release", packaged: false }), "release");
  assert.equal(resolveBuildProfile({ value: "injected", packaged: true }), "production");
});

test("seule la page renderer Noon exacte est une origine IPC de confiance", () => {
  assert.equal(isTrustedRendererUrl(`${ORIGIN}/app`, ORIGIN), true);
  assert.equal(isTrustedRendererUrl(`${ORIGIN}/control-center.js`, ORIGIN), false);
  assert.equal(isTrustedRendererUrl("https://example.com/app", ORIGIN), false);
  assert.equal(isTrustedRendererUrl("file:///app", ORIGIN), false);
});

test("un renderer compromis ne peut invoquer aucun handler IPC", async () => {
  let registered;
  let effects = 0;
  const register = createTrustedIpcRegistrar({ ipcMain: { handle: (_channel, handler) => { registered = handler; } }, trustedOrigin: ORIGIN });
  register("noon:test", () => { effects += 1; return true; });
  await assert.rejects(registered({ senderFrame: { url: "https://attacker.invalid/app" }, sender: { id: 9 } }), /Origine IPC refusée/);
  assert.equal(effects, 0);
});

test("l'IPC de confiance est borné en taille et en débit", async () => {
  let registered;
  let time = 10;
  const register = createTrustedIpcRegistrar({ ipcMain: { handle: (_channel, handler) => { registered = handler; } }, trustedOrigin: ORIGIN, now: () => time, maxCalls: 1 });
  register("noon:test", (_event, value) => value);
  const event = { senderFrame: { url: `${ORIGIN}/app` }, sender: { id: 1 } };
  assert.equal(await registered(event, "ok"), "ok");
  await assert.rejects(registered(event, "encore"), /Trop de requêtes IPC/);
  assert.throws(() => assertBoundedIpcArguments(["x".repeat(513 * 1024)]), /trop volumineuse/);
  time += 11_000;
  assert.equal(await registered(event, "après fenêtre"), "après fenêtre");
});

test("le marqueur de cycle détecte un arrêt non propre puis s'écrit atomiquement", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-lifecycle-test-"));
  const marker = path.join(directory, "startup-state.json");
  assert.equal(readPreviousStartupState(marker), "first-run");
  writeStartupState(marker, "running", { profile: "test" });
  assert.equal(readPreviousStartupState(marker), "unclean");
  writeStartupState(marker, "clean", { profile: "test" });
  assert.equal(readPreviousStartupState(marker), "clean");
  assert.equal(fs.existsSync(`${marker}.tmp`), false);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("la configuration Electron et le serveur conservent les frontières production", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "electron", "main.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "electron", "preload.js"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /webSecurity:\s*true/);
  assert.match(main, /requestSingleInstanceLock/);
  assert.doesNotMatch(preload, /\brequire\(["'](?:fs|child_process|net|http)["']\)/);
  assert.match(server, /DEFAULT_HOST\s*=\s*["']127\.0\.0\.1["']/);
  assert.match(server, /X-Noon-Local-Auth|x-noon-local-auth/);
  assert.doesNotMatch(server, /Access-Control-Allow-Origin[^\n]*\*/);
});
