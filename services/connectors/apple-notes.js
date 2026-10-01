"use strict";

const { execFile } = require("child_process");
const { createConnector } = require("./base-connector");

const NOTE_SEARCH_CANDIDATE_LIMIT = 10;
const NOTE_SEARCH_RESULT_LIMIT = 10;
const NOTE_SEARCH_EXCERPT_LIMIT = 1200;
const NOTE_SEARCH_QUERY_LIMIT = 500;

const RECENT_NOTES_DEFAULT_LIMIT = 5;
const RECENT_NOTES_MAX_LIMIT = 10;

const SEARCH_METADATA_SCRIPT = `on run argv
if (count argv) < 2 then return ""
set queryText to item 1 of argv
set maxCount to (item 2 of argv) as integer

tell application "Notes"
set output to ""

ignoring case
set noteItems to every note whose name contains queryText
end ignoring

set noteIndex to 0

repeat with itemRef in noteItems
set noteIndex to noteIndex + 1
if noteIndex > maxCount then exit repeat

set output to output & (id of itemRef) & tab & (name of itemRef) & tab & ((modification date of itemRef) as string) & linefeed
end repeat

return output
end tell
end run`;

const SEARCH_BODY_METADATA_SCRIPT = `on run argv
if (count argv) < 2 then return ""
set queryText to item 1 of argv
set maxCount to (item 2 of argv) as integer

tell application "Notes"
set output to ""

ignoring case
set noteItems to every note whose plaintext contains queryText
end ignoring

set noteIndex to 0

repeat with itemRef in noteItems
set noteIndex to noteIndex + 1
if noteIndex > maxCount then exit repeat

set output to output & (id of itemRef) & tab & (name of itemRef) & tab & ((modification date of itemRef) as string) & linefeed
end repeat

return output
end tell
end run`;

const SEARCH_BODY_SCRIPT = `on run argv
if (count argv) < 1 then return ""
set noteId to item 1 of argv

tell application "Notes"
set itemRef to note id noteId
return (id of itemRef) & tab & (plaintext of itemRef)
end tell
end run`;

const RECENT_METADATA_SCRIPT = `on run argv
set maxCount to (item 1 of argv) as integer

tell application "Notes"
set output to ""
set noteItems to notes
set noteCount to count noteItems

repeat with noteIndex from 1 to noteCount
if noteIndex > maxCount then exit repeat

set itemRef to item noteIndex of noteItems

set output to output & (id of itemRef) & tab & (name of itemRef) & tab & ((modification date of itemRef) as string) & linefeed
end repeat

return output
end tell
end run`;

const RECENT_BODY_SCRIPT = `on run argv
set maxCount to (item 1 of argv) as integer

tell application "Notes"
set output to ""
set noteItems to notes
set noteCount to count noteItems

repeat with noteIndex from 1 to noteCount
if noteIndex > maxCount then exit repeat

set itemRef to item noteIndex of noteItems

set output to output & (id of itemRef) & tab & (name of itemRef) & tab & ((modification date of itemRef) as string) & tab & (plaintext of itemRef) & linefeed
end repeat

return output
end tell
end run`;

function normalize(value) {
  return String(value || "")
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function runAppleScript(script, args, runner = execFile, { signal, timeoutMs = 10_000 } = {}) {
  if (signal?.aborted) {
    return Promise.reject(signal.reason || Object.assign(new Error("Apple Notes annulé."), { code: "ABORT_ERR" }));
  }
  const boundedTimeoutMs = Math.max(1, Math.min(10_000, Number(timeoutMs) || 10_000));
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
      finish(reject, signal.reason || Object.assign(new Error("Apple Notes annulé."), { code: "ABORT_ERR" }));
    };
    child = runner(
      "osascript",
      ["-e", script, "--", ...args.map(String)],
      { timeout: boundedTimeoutMs, maxBuffer: 512 * 1024 },
      (error, stdout) => {
        if (error) {
          return finish(reject,
            Object.assign(
              new Error("Apple Notes momentanément indisponible."),
              {
                status:
                  /-1743|not authorized|not permitted/i.test(
                    String(error.code) + error.message
                  )
                    ? 403
                    : 503,
                code: error.code || "APPLE_NOTES_UNAVAILABLE",
              }
            )
          );
        }

        finish(resolve, String(stdout));
      }
    );
    if (!settled) signal?.addEventListener("abort", abort, { once: true });
  });
}

function noteScore(query, note) {
  const tokens = normalize(query)
    .split(" ")
    .filter((token) => token.length >= 2);

  const title = normalize(note.title);

  if (!tokens.length || !title) return 0;
  if (title === tokens.join(" ")) return 1;
  if (title.startsWith(tokens.join(" "))) return 0.9;

  const hits = tokens.filter((token) =>
    title.includes(token)
  ).length;

  return hits === tokens.length
    ? 0.8
    : hits
      ? (0.5 * hits) / tokens.length
      : 0;
}

function normalizeRecentOptions(optionsOrRunner) {
  if (
    optionsOrRunner &&
    typeof optionsOrRunner === "object" &&
    typeof optionsOrRunner !== "function"
  ) {
    return {
      limit: Math.max(
        1,
        Math.min(
          RECENT_NOTES_MAX_LIMIT,
          Number(optionsOrRunner.limit) ||
            RECENT_NOTES_DEFAULT_LIMIT
        )
      ),
      includeBody: optionsOrRunner.includeBody === true,
    };
  }

  return {
    limit: RECENT_NOTES_DEFAULT_LIMIT,
    includeBody: false,
  };
}

async function listRecentNotes(
  optionsOrRunner = {},
  maybeRunner = execFile
) {
  const runner =
    typeof optionsOrRunner === "function"
      ? optionsOrRunner
      : maybeRunner;

  const options = normalizeRecentOptions(optionsOrRunner);

  const script = options.includeBody
    ? RECENT_BODY_SCRIPT
    : RECENT_METADATA_SCRIPT;

  const stdout = await runAppleScript(
    script,
    [options.limit],
    runner
  );

  return String(stdout)
    .split("\n")
    .filter(Boolean)
    .slice(0, options.limit)
    .map((line) => {
      const [id, title, modifiedAt, ...body] =
        line.split("\t");

      return {
        id,
        title: String(title || "").slice(0, 500),
        modifiedAt: modifiedAt || null,
        content: options.includeBody
          ? body.join("\t").slice(0, 4000)
          : null,
      };
    });
}

function parseMetadata(stdout, matchType, query) {
  return String(stdout)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, title, modifiedAt] = line.split("\t");

      const note = {
        id,
        title: String(title || "").slice(0, 500),
        modifiedAt: modifiedAt || null,
        matchType,
      };

      return {
        ...note,
        relevance:
          matchType === "title"
            ? noteScore(query, note)
            : 0.7,
      };
    })
    .filter((note) => note.id && note.title);
}

async function searchNotes(
  query,
  {
    limit = 3,
    includeBody = false,
    searchScope = "all",
    maxExcerptLength = NOTE_SEARCH_EXCERPT_LIMIT,
    signal,
    timeoutMs,
  } = {},
  runner = execFile
) {
  const value = String(query || "")
    .trim()
    .slice(0, NOTE_SEARCH_QUERY_LIMIT);

  if (!value) return [];

  const resultLimit = Math.max(
    1,
    Math.min(
      NOTE_SEARCH_RESULT_LIMIT,
      Number(limit) || 3
    )
  );

  const candidateLimit = Math.max(
    resultLimit,
    Math.min(
      NOTE_SEARCH_CANDIDATE_LIMIT,
      resultLimit * 3
    )
  );

  const titleRaw = await runAppleScript(
    SEARCH_METADATA_SCRIPT,
    [value, candidateLimit],
    runner,
    { signal, timeoutMs }
  );

  const titleCandidates = parseMetadata(
    titleRaw,
    "title",
    value
  );

  let bodyCandidates = [];

  if (searchScope !== "title" && titleCandidates.length < resultLimit) {
    const bodyRaw = await runAppleScript(
      SEARCH_BODY_METADATA_SCRIPT,
      [value, candidateLimit],
      runner,
      { signal, timeoutMs }
    );

    bodyCandidates = parseMetadata(
      bodyRaw,
      "body",
      value
    );
  }

  const byId = new Map();

  for (const note of [
    ...titleCandidates,
    ...bodyCandidates,
  ]) {
    const existing = byId.get(note.id);

    if (
      !existing ||
      note.relevance > existing.relevance
    ) {
      byId.set(note.id, note);
    }
  }

  const candidates = [...byId.values()]
    .sort(
      (left, right) =>
        right.relevance - left.relevance
    )
    .slice(0, resultLimit);

  if (!includeBody) {
    return candidates.map((note) => ({
      ...note,
      excerpt: null,
    }));
  }

  const excerptLimit = Math.max(
    80,
    Math.min(
      NOTE_SEARCH_EXCERPT_LIMIT,
      Number(maxExcerptLength) ||
        NOTE_SEARCH_EXCERPT_LIMIT
    )
  );

  const results = [];

  for (const note of candidates) {
    const body = await runAppleScript(
      SEARCH_BODY_SCRIPT,
      [note.id],
      runner,
      { signal, timeoutMs }
    );

    const [, ...content] = String(body).split("\t");

    results.push({
      ...note,
      excerpt:
        content
          .join("\t")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, excerptLimit) || null,
    });
  }

  return results;
}

function createAppleNotesConnector(deps) {
  const base = createConnector(
    {
      id: "apple-notes",
      local: true,
      displayName: "Apple Notes",
      capabilities: [
        "recent_notes",
        "targeted_search",
      ],
      readCapabilities: [
        "recent_notes",
        "targeted_search",
      ],
      writeCapabilities: [],
      scopes: ["macOS Automation: Notes"],
    },
    deps
  );

  return Object.assign(base, {
    listRecentNotes: (optionsOrRunner, maybeRunner) =>
      base.run(
        () =>
          listRecentNotes(
            optionsOrRunner,
            maybeRunner
          ),
        {
          idempotent: true,
          maxRetries: 0,
        }
      ),

    searchNotes: (query, options, runner) =>
      base.run(
        () => searchNotes(query, options, runner),
        {
          idempotent: true,
          maxRetries: 0,
        }
      ),
  });
}

module.exports = {
  NOTE_SEARCH_CANDIDATE_LIMIT,
  NOTE_SEARCH_EXCERPT_LIMIT,
  NOTE_SEARCH_QUERY_LIMIT,
  NOTE_SEARCH_RESULT_LIMIT,
  RECENT_NOTES_DEFAULT_LIMIT,
  RECENT_NOTES_MAX_LIMIT,
  RECENT_METADATA_SCRIPT,
  RECENT_BODY_SCRIPT,
  SEARCH_BODY_METADATA_SCRIPT,
  SEARCH_BODY_SCRIPT,
  SEARCH_METADATA_SCRIPT,
  createAppleNotesConnector,
  listRecentNotes,
  noteScore,
  searchNotes,
};
