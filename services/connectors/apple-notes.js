"use strict";

const { execFile } = require("child_process");
const { createConnector } = require("./base-connector");

const NOTE_SEARCH_CANDIDATE_LIMIT = 10;
const NOTE_SEARCH_RESULT_LIMIT = 10;
const NOTE_SEARCH_EXCERPT_LIMIT = 1200;
const NOTE_SEARCH_QUERY_LIMIT = 500;

// La requête est passée à osascript comme argument, jamais interpolée dans le
// programme AppleScript. Notes applique le prédicat sur `name` avant que Node
// ne reçoive une seule note ou son corps.
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
const SEARCH_BODY_SCRIPT = `on run argv
if (count argv) < 1 then return ""
set noteId to item 1 of argv
tell application "Notes"
set itemRef to note id noteId
return (id of itemRef) & tab & (plaintext of itemRef)
end tell
end run`;

function normalize(value) {
  return String(value || "").toLocaleLowerCase("fr").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function runAppleScript(script, args, runner = execFile) {
  return new Promise((resolve, reject) => runner("osascript", ["-e", script, "--", ...args.map(String)],
    { timeout: 10_000, maxBuffer: 256 * 1024 }, (error, stdout) => {
      if (error) return reject(Object.assign(new Error("Apple Notes momentanément indisponible."), {
        status: /-1743|not authorized|not permitted/i.test(String(error.code) + error.message) ? 403 : 503,
        code: error.code || "APPLE_NOTES_UNAVAILABLE",
      }));
      resolve(String(stdout));
    }));
}
function noteScore(query, note) {
  const tokens = normalize(query).split(" ").filter((token) => token.length >= 2);
  const title = normalize(note.title);
  if (!tokens.length || !title) return 0;
  if (title === tokens.join(" ")) return 1;
  if (title.startsWith(tokens.join(" "))) return 0.9;
  const hits = tokens.filter((token) => title.includes(token)).length;
  return hits === tokens.length ? 0.8 : hits ? 0.5 * hits / tokens.length : 0;
}

function listRecentNotes(runner = execFile) {
  const script = `tell application "Notes"
set output to ""
set noteItems to notes
set noteCount to count noteItems
repeat with noteIndex from 1 to noteCount
if noteIndex > 50 then exit repeat
set itemRef to item noteIndex of noteItems
set output to output & (id of itemRef) & tab & (name of itemRef) & tab & (plaintext of itemRef) & linefeed
end repeat
return output
end tell`;
  return new Promise((resolve, reject) => runner("osascript", ["-e", script], { timeout: 10_000, maxBuffer: 512 * 1024 }, (error, stdout) => {
    if (error) return reject(Object.assign(new Error("Apple Notes momentanément indisponible."), { status: /-1743|not authorized|not permitted/i.test(String(error.code) + error.message) ? 403 : 503 }));
    resolve(String(stdout).split("\n").filter(Boolean).slice(0, 50).map((line) => {
      const [id, title, ...body] = line.split("\t"); return { id, title, content: body.join(" ").slice(0, 4000) };
    }));
  }));
}

async function searchNotes(query, { limit = 3, includeBody = false, maxExcerptLength = NOTE_SEARCH_EXCERPT_LIMIT } = {}, runner = execFile) {
  const value = String(query || "").trim().slice(0, NOTE_SEARCH_QUERY_LIMIT);
  if (!value) return [];
  const resultLimit = Math.max(1, Math.min(NOTE_SEARCH_RESULT_LIMIT, Number(limit) || 3));
  const candidateLimit = Math.max(resultLimit, Math.min(NOTE_SEARCH_CANDIDATE_LIMIT, resultLimit * 3));
  const metadata = await runAppleScript(SEARCH_METADATA_SCRIPT, [value, candidateLimit], runner);
  const candidates = String(metadata).split("\n").filter(Boolean).map((line) => {
    const [id, title, modifiedAt] = line.split("\t");
    return { id, title: String(title || "").slice(0, 500), modifiedAt: modifiedAt || null };
  }).filter((note) => note.id && note.title).map((note) => ({ ...note, relevance: noteScore(value, note) }))
    .sort((left, right) => right.relevance - left.relevance || String(right.modifiedAt || "").localeCompare(String(left.modifiedAt || "")))
    .slice(0, resultLimit);
  if (!includeBody) return candidates.map((note) => ({ ...note, excerpt: null }));
  const excerptLimit = Math.max(80, Math.min(NOTE_SEARCH_EXCERPT_LIMIT, Number(maxExcerptLength) || NOTE_SEARCH_EXCERPT_LIMIT));
  return Promise.all(candidates.map(async (note) => {
    const body = await runAppleScript(SEARCH_BODY_SCRIPT, [note.id], runner);
    const [, ...content] = String(body).split("\t");
    return { ...note, excerpt: content.join("\t").replace(/\s+/g, " ").trim().slice(0, excerptLimit) || null };
  }));
}

function createAppleNotesConnector(deps) {
  const base = createConnector({ id: "apple-notes", local: true, displayName: "Apple Notes", capabilities: ["recent_notes", "targeted_search"], readCapabilities: ["recent_notes", "targeted_search"], writeCapabilities: [], scopes: ["macOS Automation: Notes"] }, deps);
  return Object.assign(base, {
    listRecentNotes: (runner) => base.run(() => listRecentNotes(runner), { idempotent: true, maxRetries: 0 }),
    searchNotes: (query, options, runner) => base.run(() => searchNotes(query, options, runner), { idempotent: true, maxRetries: 0 }),
  });
}

module.exports = { NOTE_SEARCH_CANDIDATE_LIMIT, NOTE_SEARCH_EXCERPT_LIMIT, NOTE_SEARCH_QUERY_LIMIT, NOTE_SEARCH_RESULT_LIMIT,
  SEARCH_BODY_SCRIPT, SEARCH_METADATA_SCRIPT, createAppleNotesConnector, listRecentNotes, noteScore, searchNotes };
