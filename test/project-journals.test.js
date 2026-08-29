"use strict";

// Vérifie la persistance, la récupération et la déduplication des journaux de projet.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createProjectJournalStore, validateSessionSummary } = require("../lib/project-journals");
const { inspectGitStatus } = require("../lib/git-status");

function temporaryStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-journal-"));
  const filePath = path.join(directory, "project-journals.json");
  return { directory, filePath, store: createProjectJournalStore({ filePath }) };
}

test("crée, sauvegarde et recharge un journal", () => {
  const { filePath, store } = temporaryStore();
  store.updateProjectJournal("project-kasa", { objective: "Livrer Kasa" }, "Kasa");
  assert.equal(fs.existsSync(`${filePath}.tmp`), false);
  const restarted = createProjectJournalStore({ filePath });
  assert.equal(restarted.getProjectJournal("project-kasa").objective, "Livrer Kasa");
});

test("récupère la sauvegarde si le JSON principal est corrompu", () => {
  const { filePath, store } = temporaryStore();
  store.updateProjectJournal("project-kasa", { decisions: ["React Router"] }, "Kasa");
  store.updateProjectJournal("project-kasa", { objective: "Nouvel objectif" }, "Kasa");
  fs.writeFileSync(filePath, "{cassé");
  const restarted = createProjectJournalStore({ filePath });
  assert.deepEqual(restarted.getProjectJournal("project-kasa").decisions, ["React Router"]);
});

test("déduplique les décisions, conserve les anciennes et met à jour la prochaine action", () => {
  const { store } = temporaryStore();
  store.updateProjectJournal("project-kasa", { decisions: ["Décision A"] }, "Kasa");
  const journal = store.appendProjectSession("project-kasa", {
    mode: "DEV", summary: "Bilan", completed: [], inProgress: ["Router"],
    decisions: ["Décision A", "Décision B"], blockers: [], nextAction: "Tester le router",
    filesMentioned: ["src/App.jsx"], sourceConversationId: "noon-local",
  }, "Kasa");
  assert.deepEqual(journal.decisions, ["Décision A", "Décision B"]);
  assert.equal(journal.nextActions[0], "Tester le router");
  assert.equal(journal.sessions[0].mode, "DEV");
});

test("refuse un résumé incomplet et masque les secrets", () => {
  assert.equal(validateSessionSummary({ summary: "partiel" }), null);
  const { store } = temporaryStore();
  const journal = store.updateProjectJournal("project-x", {
    decisions: ["OPENAI_API_KEY=sk-supersecret000000"],
  }, "X");
  assert.doesNotMatch(JSON.stringify(journal), /sk-supersecret/);
});

test("le contrôle Git n’exécute que status et log", async () => {
  const calls = [];
  const runner = (command, args, options, callback) => {
    calls.push({ command, args, options });
    callback(null, args[0] === "status" ? "## main...origin/main [ahead 1]\n M app.js\n?? note.md" : "abcdef\t2026-08-23T10:00:00Z\tTest");
  };
  const git = await inspectGitStatus("/tmp/project", runner);
  assert.equal(git.branch, "main");
  assert.equal(git.modified, 1);
  assert.equal(git.untracked, 1);
  assert.deepEqual(calls.map((call) => call.args[0]), ["status", "log"]);
  assert.equal(calls.some((call) => ["commit", "push", "pull", "reset", "checkout"].includes(call.args[0])), false);
});
