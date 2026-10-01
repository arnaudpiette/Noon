"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { SEARCH_BODY_METADATA_SCRIPT, SEARCH_BODY_SCRIPT, SEARCH_METADATA_SCRIPT, searchNotes } = require("../services/connectors/apple-notes");

function runnerFor({ metadata = "", bodyMetadata = "", bodies = {}, error = null } = {}) {
  const calls = [];
  const runner = (_command, args, _options, callback) => {
    calls.push(args);
    if (error) return callback(error, "");
    if (args[1] === SEARCH_METADATA_SCRIPT) return callback(null, metadata);
    if (args[1] === SEARCH_BODY_METADATA_SCRIPT) return callback(null, bodyMetadata);
    const id = args.at(-1); return callback(null, `${id}\t${bodies[id] || ""}`);
  };
  return { calls, runner };
}

test("searchNotes filtre dans Apple Notes, normalise la casse et classe les titres", async () => {
  const fixture = runnerFor({ metadata: "1\tQwenta Roadmap\t2026-01-01\n2\tArchive Qwenta\t2026-02-01\n3\tAutre\t2026-03-01\n" });
  const notes = await searchNotes("  QWENTA  ", { limit: 2 }, fixture.runner);
  assert.deepEqual(notes.map((note) => note.id), ["1", "2"]);
  assert.equal(notes[0].excerpt, null);
  assert.equal(fixture.calls.length, 1);
  assert.match(fixture.calls[0][1], /whose name contains queryText/);
  assert.deepEqual(fixture.calls[0].slice(-2), ["QWENTA", "6"]);
});

test("searchNotes ne lit les corps que des candidats retenus", async () => {
  const fixture = runnerFor({ metadata: "1\tNoon\t2026-01-01\n2\tNoon design\t2026-02-01\n3\tNoon archive\t2026-03-01\n", bodies: { 1: "corps un", 2: "corps deux", 3: "corps trois" } });
  const notes = await searchNotes("Noon", { limit: 2, includeBody: true, maxExcerptLength: 8 }, fixture.runner);
  assert.equal(notes.length, 2);
  assert.deepEqual(fixture.calls.map((args) => args[1]), [SEARCH_METADATA_SCRIPT, SEARCH_BODY_SCRIPT, SEARCH_BODY_SCRIPT]);
  assert.ok(notes.every((note) => note.excerpt.length <= 80));
});

test("searchNotes retourne vide sans corps quand aucun titre ne correspond", async () => {
  const fixture = runnerFor({ metadata: "" });
  assert.deepEqual(await searchNotes("inconnue", { limit: 3, includeBody: true }, fixture.runner), []);
  assert.equal(fixture.calls.length, 2);
});

test("searchNotes en portée titre uniquement ne recherche ni ne lit plaintext", async () => {
  const fixture = runnerFor({
    metadata: "1\tNoon roadmap\t2026-01-01\n",
    bodyMetadata: "2\tArchive\t2026-02-01\n",
    bodies: { 1: "corps interdit" },
  });
  const notes = await searchNotes("Noon", { limit: 3, includeBody: false, searchScope: "title" }, fixture.runner);
  assert.deepEqual(notes.map((note) => note.id), ["1"]);
  assert.equal(notes[0].excerpt, null);
  assert.deepEqual(fixture.calls.map((args) => args[1]), [SEARCH_METADATA_SCRIPT]);
  assert.doesNotMatch(fixture.calls[0][1], /plaintext/);
});

test("searchNotes en portée titre uniquement respecte la limite A3 de trois résultats", async () => {
  const fixture = runnerFor({ metadata: ["1", "2", "3", "4"].map((id) => `${id}\tNoon ${id}\t2026-01-${id}`).join("\n") });
  const notes = await searchNotes("Noon", { limit: 3, includeBody: false, searchScope: "title" }, fixture.runner);
  assert.equal(notes.length, 3);
  assert.equal(fixture.calls.length, 1);
});

test("searchNotes conserve le repli contenu hors portée titre uniquement", async () => {
  const fixture = runnerFor({ metadata: "", bodyMetadata: "2\tArchive Noon\t2026-02-01\n" });
  const notes = await searchNotes("Noon", { limit: 3, includeBody: false }, fixture.runner);
  assert.deepEqual(notes.map((note) => note.id), ["2"]);
  assert.deepEqual(fixture.calls.map((args) => args[1]), [SEARCH_METADATA_SCRIPT, SEARCH_BODY_METADATA_SCRIPT]);
  assert.match(fixture.calls[1][1], /plaintext contains queryText/);
});

test("le contrat A3 transmet la portée titre uniquement à Apple Notes", () => {
  const source = require("fs").readFileSync(require("path").join(__dirname, "..", "server.js"), "utf8");
  const adapter = source.slice(source.indexOf("notes: {"), source.indexOf("reminders: {"));
  assert.match(adapter, /searchScope:\s*"title"/);
  assert.match(adapter, /includeBody:\s*false/);
  assert.match(adapter, /limit:\s*request\.limit/);
});

test("searchNotes borne l'appel AppleScript A3 et arrête le processus à l'expiration", async () => {
  let callback;
  let killed = 0;
  let timeout;
  const controller = new AbortController();
  const pending = searchNotes("Noon", { limit: 3, includeBody: false, searchScope: "title", signal: controller.signal, timeoutMs: 5_000 }, (_command, _args, options, done) => {
    timeout = options.timeout;
    callback = done;
    return { kill: () => { killed += 1; } };
  });
  controller.abort(Object.assign(new Error("Authorized context source timeout"), { code: "CONTEXT_SOURCE_TIMEOUT" }));
  await assert.rejects(pending, (error) => error.code === "CONTEXT_SOURCE_TIMEOUT");
  assert.equal(timeout, 5_000);
  assert.equal(killed, 1);
  callback(null, "1\tNoon\t2026-01-01");
});

test("searchNotes conserve son timeout historique hors A3", async () => {
  let receivedOptions;
  await searchNotes("Noon", { searchScope: "title" }, (_command, _args, options, callback) => {
    receivedOptions = options;
    callback(null, "1\tNoon\t2026-01-01");
  });
  assert.equal(receivedOptions.timeout, 10_000);
});

test("searchNotes borne candidats, résultats et requêtes hostiles comme données", async () => {
  const metadata = Array.from({ length: 20 }, (_, index) => `${index}\tProjet Noon ${index}\t2026-01-${String(index + 1).padStart(2, "0")}`).join("\n");
  const fixture = runnerFor({ metadata });
  const hostile = "x' \" \\ \n ) tell application \"Finder\"";
  await searchNotes(hostile, { limit: 99 }, fixture.runner);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0][1].includes(hostile), false);
  assert.equal(fixture.calls[0].at(-2), hostile);
  assert.equal(fixture.calls[0].at(-1), "10");
  const long = runnerFor({ metadata: "" });
  await searchNotes("x".repeat(2_000), { limit: 1 }, long.runner);
  assert.equal(long.calls[0].at(-2).length, 500);
});

test("searchNotes remonte proprement refus Automation et erreur", async () => {
  const denied = runnerFor({ error: Object.assign(new Error("not authorized"), { code: -1743 }) });
  await assert.rejects(searchNotes("Noon", {}, denied.runner), (error) => error.status === 403);
  const unavailable = runnerFor({ error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) });
  await assert.rejects(searchNotes("Noon", {}, unavailable.runner), (error) => error.status === 503);
});
