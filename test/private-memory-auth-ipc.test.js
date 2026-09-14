"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const main = fs.readFileSync(path.join(__dirname, "..", "electron", "main.js"), "utf8");
const preload = fs.readFileSync(path.join(__dirname, "..", "electron", "preload.js"), "utf8");

test("la confirmation privée reste derrière des IPC bornés", () => {
  assert.match(preload, /getPrivateMemoryProtection: \(\) => invoke\("noon:get-private-memory-protection"\)/);
  assert.match(preload, /authenticatePrivateMemory: \(payload\) => invoke\("noon:authenticate-private-memory", payload\)/);
  assert.match(main, /systemPreferences\.promptTouchID\("afficher les données de la mémoire privée"\)/);
  assert.match(main, /privateMemoryAuthFailures >= 5/);
  assert.doesNotMatch(main, /console\.[a-z]+\([^\n]*(?:payload\.password|private-memory-display-password)/);
});
