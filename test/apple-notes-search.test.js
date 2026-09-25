"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { SEARCH_BODY_SCRIPT, SEARCH_METADATA_SCRIPT, searchNotes } = require("../services/connectors/apple-notes");

function runnerFor({ metadata = "", bodies = {}, error = null } = {}) {
  const calls = [];
  const runner = (_command, args, _options, callback) => {
    calls.push(args);
    if (error) return callback(error, "");
    if (args[1] === SEARCH_METADATA_SCRIPT) return callback(null, metadata);
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
