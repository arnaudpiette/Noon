"use strict";

const { execFile } = require("child_process");
const { createConnector } = require("./base-connector");
const SHORTCUT_NAME = "Noon – Rappel";

function runShortcut(args, input, runner = execFile) {
  return new Promise((resolve, reject) => {
    const child = runner("shortcuts", args, { timeout: 15_000, maxBuffer: 256 * 1024 },
      (error, stdout) => error ? reject(new Error("Raccourci Apple indisponible.")) : resolve(String(stdout).trim()));
    if (input !== undefined && child?.stdin) { child.stdin.end(String(input).slice(0, 4000)); }
  });
}
function listAppleShortcuts(runner) { return runShortcut(["list"], undefined, runner); }
function runNoonReminderShortcut(input, runner) {
  if (!String(input || "").trim()) throw new Error("Texte du rappel obligatoire.");
  return runShortcut(["run", SHORTCUT_NAME], String(input), runner);
}
async function checkNoonReminderShortcut(runner) {
  const list = await listAppleShortcuts(runner);
  return list.split("\n").some((name) => name.trim() === SHORTCUT_NAME);
}
function createAppleConnector(deps) {
  return { ...createConnector({ id: "apple-reminders", displayName: "Apple Rappels",
    capabilities: ["shortcut_check", "shortcut_run", "icloud_inbox"],
    readCapabilities: ["shortcut_check"], writeCapabilities: ["create_reminder_explicit"], scopes: ["macOS Shortcuts"],
  }, deps), listAppleShortcuts, runNoonReminderShortcut, checkNoonReminderShortcut };
}
module.exports = { SHORTCUT_NAME, createAppleConnector, listAppleShortcuts, runNoonReminderShortcut, checkNoonReminderShortcut };
