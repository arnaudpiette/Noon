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
const A3_REMINDER_WINDOW_DAYS = 14;

const A3_REMINDER_METADATA_SCRIPT = `on run argv
set windowDays to (item 1 of argv) as integer
set cutoffDate to (current date) + (windowDays * days)

tell application "Reminders"
set output to ""
repeat with reminderList in lists
repeat with itemRef in (reminders of reminderList whose completed is false)
set dueText to ""
set includeItem to true
try
set dueValue to due date of itemRef
if dueValue is not missing value then
if dueValue > cutoffDate then set includeItem to false
if includeItem then set dueText to dueValue as string
end if
end try
if includeItem then set output to output & (id of itemRef) & tab & dueText & linefeed
end repeat
end repeat
return output
end tell
end run`;

const A3_REMINDER_DETAIL_SCRIPT = `on run argv
set reminderId to item 1 of argv

tell application "Reminders"
set itemRef to reminder id reminderId
set dueText to ""
try
set dueValue to due date of itemRef
if dueValue is not missing value then set dueText to dueValue as string
end try
return (id of itemRef) & tab & (name of itemRef) & tab & dueText
end tell
end run`;

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

function parseReminderMetadata(value) {
  return String(value || "").split("\n").filter(Boolean).map((line) => {
    const [id, dueAt] = line.split("\t");
    return { id: String(id || ""), dueAt: dueAt && dueAt !== "missing value" ? dueAt : null };
  }).filter((item) => item.id);
}

function rankContextReminders(items, now = new Date()) {
  const timestamp = now instanceof Date ? now.getTime() : Date.parse(now);
  return [...items].sort((left, right) => {
    const leftDue = left.dueAt ? Date.parse(left.dueAt) : NaN;
    const rightDue = right.dueAt ? Date.parse(right.dueAt) : NaN;
    const leftBucket = Number.isFinite(leftDue) ? (leftDue < timestamp ? 0 : 1) : 2;
    const rightBucket = Number.isFinite(rightDue) ? (rightDue < timestamp ? 0 : 1) : 2;
    return leftBucket - rightBucket || (Number.isFinite(leftDue) ? leftDue : Infinity) - (Number.isFinite(rightDue) ? rightDue : Infinity) || left.id.localeCompare(right.id);
  });
}

function contextTimeoutError() {
  return Object.assign(new Error("Authorized context source timeout"), { code: "CONTEXT_SOURCE_TIMEOUT" });
}

function runReminderScript(script, args, runner = execFile, { signal, timeoutMs = 5_000 } = {}) {
  if (signal?.aborted) return Promise.reject(signal.reason || contextTimeoutError());
  const boundedTimeoutMs = Math.max(1, Math.min(5_000, Number(timeoutMs) || 5_000));
  return new Promise((resolve, reject) => {
    let child = null;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const abort = () => {
      try { child?.kill?.(); } catch {}
      finish(reject, signal.reason || contextTimeoutError());
    };
    child = runner(
      "osascript", ["-e", script, "--", ...args.map(String)],
      { timeout: boundedTimeoutMs, maxBuffer: 256 * 1024 },
      (error, stdout) => error
        ? finish(reject, error.code === "ETIMEDOUT" || error.killed === true ? contextTimeoutError() : Object.assign(new Error("Apple Rappels momentanément indisponible."), {
          status: /-1743|not authorized|not permitted/i.test(String(error.code) + error.message) ? 403 : 503,
          code: error.code || "APPLE_REMINDERS_UNAVAILABLE",
        }))
        : finish(resolve, String(stdout))
    );
    if (!settled) signal?.addEventListener("abort", abort, { once: true });
  });
}

async function listIncompleteRemindersForContext({ limit = 5, windowDays = A3_REMINDER_WINDOW_DAYS, now = new Date(), signal, timeoutMs = 5_000, clock = Date.now } = {}, runner = execFile) {
  const boundedLimit = Math.max(1, Math.min(5, Number(limit) || 5));
  const boundedWindowDays = Math.max(1, Math.min(31, Number(windowDays) || A3_REMINDER_WINDOW_DAYS));
  const deadline = clock() + Math.max(1, Math.min(5_000, Number(timeoutMs) || 5_000));
  const remaining = () => {
    if (signal?.aborted) throw signal.reason || contextTimeoutError();
    const value = deadline - clock();
    if (value <= 0) throw contextTimeoutError();
    return value;
  };
  const metadata = parseReminderMetadata(await runReminderScript(A3_REMINDER_METADATA_SCRIPT, [boundedWindowDays], runner, { signal, timeoutMs: remaining() }));
  remaining();
  const cutoff = (now instanceof Date ? now.getTime() : Date.parse(now)) + boundedWindowDays * 24 * 60 * 60 * 1000;
  const selected = rankContextReminders(metadata.filter((item) => !item.dueAt || !Number.isFinite(Date.parse(item.dueAt)) || Date.parse(item.dueAt) <= cutoff), now).slice(0, boundedLimit);
  const details = [];
  for (const { id } of selected) {
    const [returnedId, title, dueAt] = (await runReminderScript(A3_REMINDER_DETAIL_SCRIPT, [id], runner, { signal, timeoutMs: remaining() })).split("\t");
    remaining();
    details.push({ id: returnedId || id, title: String(title || ""), dueAt: dueAt && dueAt !== "missing value" ? dueAt : null, completed: false });
  }
  return details;
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
    listIncompleteRemindersForContext: (options, runner) =>
      base.run(
        () => listIncompleteRemindersForContext(options, runner),
        { idempotent: true, maxRetries: 0 }
      ),
  });
}

module.exports = {
  A3_REMINDER_DETAIL_SCRIPT,
  A3_REMINDER_METADATA_SCRIPT,
  A3_REMINDER_WINDOW_DAYS,
  SHORTCUT_NAME,
  NATIVE_HELPER_NAME,
  checkNoonReminderShortcut,
  createAppleConnector,
  listAppleShortcuts,
  listIncompleteReminders,
  listIncompleteRemindersForContext,
  listIncompleteRemindersAppleScript,
  listIncompleteRemindersEventKit,
  resolveRemindersHelperPath,
  rankContextReminders,
  runReminderScript,
  runNoonReminderShortcut,
};
