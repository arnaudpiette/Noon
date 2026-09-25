"use strict";

// Apple Reminders connector.
// EventKit helper is the primary read path.
// AppleScript remains a temporary fallback when the native helper is absent.

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { createConnector } = require("./base-connector");

const SHORTCUT_NAME = "Noon – Rappel";
const NATIVE_HELPER_NAME = "noon-reminders-helper";

function runShortcut(args, input, runner = execFile) {
  return new Promise((resolve, reject) => {
    const child = runner(
      "shortcuts",
      args,
      { timeout: 15_000, maxBuffer: 256 * 1024 },
      (error, stdout) =>
        error
          ? reject(new Error("Raccourci Apple indisponible."))
          : resolve(String(stdout).trim())
    );

    if (input !== undefined && child?.stdin) {
      child.stdin.end(String(input).slice(0, 4000));
    }
  });
}

function listAppleShortcuts(runner) {
  return runShortcut(["list"], undefined, runner);
}

function runNoonReminderShortcut(input, runner) {
  if (!String(input || "").trim()) {
    throw new Error("Texte du rappel obligatoire.");
  }

  return runShortcut(["run", SHORTCUT_NAME], String(input), runner);
}

async function checkNoonReminderShortcut(runner) {
  const list = await listAppleShortcuts(runner);
  return list
    .split("\n")
    .some((name) => name.trim() === SHORTCUT_NAME);
}

function normalizeLimit(value) {
  return Math.max(1, Math.min(100, Number(value) || 100));
}

function isPackagedRuntime() {
  return __dirname.split(path.sep).includes("app.asar");
}

function resolveRemindersHelperPath() {
  if (isPackagedRuntime()) {
    return path.join(
      process.resourcesPath,
      "native",
      NATIVE_HELPER_NAME
    );
  }

  return path.join(
    __dirname,
    "..",
    "..",
    "resources",
    "native",
    NATIVE_HELPER_NAME
  );
}

function listIncompleteRemindersEventKit(limit = 100, runner = execFile) {
  const boundedLimit = normalizeLimit(limit);
  const helperPath = resolveRemindersHelperPath();

  if (!fs.existsSync(helperPath)) {
    const error = new Error("Helper EventKit Rappels absent.");
    error.code = "REMINDERS_HELPER_MISSING";
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    runner(
      helperPath,
      [String(boundedLimit)],
      {
        timeout: 5_000,
        maxBuffer: 256 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const diagnostic = String(stderr || error.message || "");

          const wrapped = new Error(
            /PERMISSION_DENIED|PERMISSION_ERROR/i.test(diagnostic)
              ? "Accès Apple Rappels non autorisé."
              : "Apple Rappels momentanément indisponible."
          );

          wrapped.status =
            /PERMISSION_DENIED|PERMISSION_ERROR/i.test(diagnostic)
              ? 403
              : 503;

          wrapped.code =
            error.code || "APPLE_REMINDERS_EVENTKIT_UNAVAILABLE";

          return reject(wrapped);
        }

        try {
          const parsed = JSON.parse(String(stdout || "[]"));

          if (!Array.isArray(parsed)) {
            throw new Error("Résultat EventKit invalide.");
          }

          resolve(
            parsed.slice(0, boundedLimit).map((item) => ({
              id: String(item?.id || ""),
              title: String(item?.title || ""),
              dueAt: item?.dueAt || null,
              completed: false,
            }))
          );
        } catch (parseError) {
          const wrapped = new Error(
            "Réponse EventKit Rappels invalide."
          );

          wrapped.status = 503;
          wrapped.code = "APPLE_REMINDERS_INVALID_RESPONSE";
          wrapped.cause = parseError;

          reject(wrapped);
        }
      }
    );
  });
}

function listIncompleteRemindersAppleScript(
  limitOrRunner = 100,
  maybeRunner = execFile
) {
  const runner =
    typeof limitOrRunner === "function"
      ? limitOrRunner
      : maybeRunner;

  const requestedLimit =
    typeof limitOrRunner === "function"
      ? 100
      : Number(limitOrRunner);

  const limit = normalizeLimit(requestedLimit);

  const script = `on run argv
set maxCount to (item 1 of argv) as integer

tell application "Reminders"
set output to ""
set itemCount to 0

repeat with reminderList in lists
repeat with itemRef in (reminders of reminderList whose completed is false)

set dueText to ""

try
set dueValue to due date of itemRef
if dueValue is not missing value then set dueText to dueValue as string
end try

set output to output & (id of itemRef) & tab & (name of itemRef) & tab & dueText & linefeed

set itemCount to itemCount + 1

if itemCount >= maxCount then exit repeat
end repeat

if itemCount >= maxCount then exit repeat
end repeat

return output
end tell
end run`;

  return new Promise((resolve, reject) =>
    runner(
      "osascript",
      ["-e", script, "--", String(limit)],
      {
        timeout: 10_000,
        maxBuffer: 256 * 1024,
      },
      (error, stdout) => {
        if (error) {
          return reject(
            Object.assign(
              new Error(
                "Apple Rappels momentanément indisponible."
              ),
              {
                status:
                  /-1743|not authorized|not permitted/i.test(
                    String(error.code) + error.message
                  )
                    ? 403
                    : 503,
              }
            )
          );
        }

        resolve(
          String(stdout)
            .split("\n")
            .filter(Boolean)
            .slice(0, limit)
            .map((line) => {
              const [id, title, dueAt] = line.split("\t");

              return {
                id,
                title,
                dueAt:
                  dueAt && dueAt !== "missing value"
                    ? dueAt
                    : null,
                completed: false,
              };
            })
        );
      }
    )
  );
}

async function listIncompleteReminders(
  limitOrRunner = 100,
  maybeRunner = execFile
) {
  // Preserve test injection and the historical adapter contract.
  if (typeof limitOrRunner === "function") {
    return listIncompleteRemindersAppleScript(limitOrRunner);
  }

  const limit = normalizeLimit(limitOrRunner);

  try {
    return await listIncompleteRemindersEventKit(
      limit,
      maybeRunner
    );
  } catch (error) {
    // Temporary fallback only if the native helper is physically absent.
    // Permission and EventKit failures must remain visible instead of
    // silently adding another 10-second AppleScript timeout.
    if (error?.code === "REMINDERS_HELPER_MISSING") {
      return listIncompleteRemindersAppleScript(
        limit,
        maybeRunner
      );
    }

    throw error;
  }
}

function createAppleConnector(deps) {
  const base = createConnector(
    {
      id: "apple-reminders",
      local: true,
      displayName: "Apple Rappels",
      capabilities: [
        "shortcut_check",
        "shortcut_run",
        "icloud_inbox",
      ],
      readCapabilities: [
        "shortcut_check",
        "incomplete_reminders",
      ],
      writeCapabilities: ["create_reminder_explicit"],
      scopes: ["macOS Reminders", "macOS Shortcuts"],
    },
    deps
  );

  return Object.assign(base, {
    listAppleShortcuts,
    runNoonReminderShortcut,
    checkNoonReminderShortcut,

    listIncompleteReminders: (...args) =>
      base.run(
        () => listIncompleteReminders(...args),
        {
          idempotent: true,
          maxRetries: 0,
        }
      ),
  });
}

module.exports = {
  SHORTCUT_NAME,
  NATIVE_HELPER_NAME,
  checkNoonReminderShortcut,
  createAppleConnector,
  listAppleShortcuts,
  listIncompleteReminders,
  listIncompleteRemindersAppleScript,
  listIncompleteRemindersEventKit,
  resolveRemindersHelperPath,
  runNoonReminderShortcut,
};
