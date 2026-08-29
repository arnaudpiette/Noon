"use strict";

// Connecteur Apple Rappels : prépare des opérations locales via des commandes strictement bornées.

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
function listIncompleteReminders(runner = execFile) {
  const script = `tell application "Reminders"
set output to ""
repeat with reminderList in lists
repeat with itemRef in (reminders of reminderList whose completed is false)
set dueText to ""
try
set dueValue to due date of itemRef
if dueValue is not missing value then set dueText to dueValue as string
end try
set output to output & (id of itemRef) & tab & (name of itemRef) & tab & dueText & linefeed
if (count paragraphs of output) > 100 then exit repeat
end repeat
end repeat
return output
end tell`;
  return new Promise((resolve, reject) => runner("osascript", ["-e", script], { timeout: 10_000, maxBuffer: 256 * 1024 }, (error, stdout) => {
    if (error) return reject(new Error("Apple Rappels momentanément indisponible."));
    const reminders = String(stdout).split("\n").filter(Boolean).slice(0, 100).map((line) => {
      const [id, title, dueAt] = line.split("\t"); return { id, title, dueAt: dueAt && dueAt !== "missing value" ? dueAt : null, completed: false };
    });
    resolve(reminders);
  }));
}
function createAppleConnector(deps) {
  return { ...createConnector({ id: "apple-reminders", displayName: "Apple Rappels",
    capabilities: ["shortcut_check", "shortcut_run", "icloud_inbox"],
    readCapabilities: ["shortcut_check"], writeCapabilities: ["create_reminder_explicit"], scopes: ["macOS Shortcuts"],
  }, deps), listAppleShortcuts, runNoonReminderShortcut, checkNoonReminderShortcut, listIncompleteReminders };
}
module.exports = { SHORTCUT_NAME, createAppleConnector, listAppleShortcuts, runNoonReminderShortcut, checkNoonReminderShortcut, listIncompleteReminders };
