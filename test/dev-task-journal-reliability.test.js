"use strict";

// Dossiers temporaires uniquement : le vrai dev-task-journal/ n'est jamais ouvert.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  SCHEMA_VERSION,
  createDevTaskJournal,
  hashedJournalName,
  legacyJournalName,
} = require("../services/dev/dev-task-journal");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "noon-journal-reliability-"));
}

function withDir(run) {
  const directory = tempDir();
  try { return run(directory); } finally {
    try { fs.chmodSync(directory, 0o700); } catch {}
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function recordingFs(overrides = {}) {
  const calls = [];
  const proxy = {};
  for (const name of ["mkdirSync", "openSync", "writeSync", "fsyncSync", "closeSync", "linkSync",
    "unlinkSync", "renameSync", "readFileSync", "readdirSync"]) {
    proxy[name] = (...args) => {
      calls.push([name, ...args.map((value) => (typeof value === "string" ? path.basename(value) : value))]);
      if (overrides[name]) return overrides[name](...args);
      return fs[name](...args);
    };
  }
  return { proxy, calls };
}

test("claim : exclusif, atomique, sans temporaire résiduel ni contenu privé", () => withDir((directory) => {
  const journal = createDevTaskJournal({ directory });
  const record = journal.claim("task-alpha", {
    source: "B3", workspaceId: "workspace-1", objective: "SYNTHETIC_PRIVATE_OBJECTIVE",
  });
  assert.equal(record.schemaVersion, SCHEMA_VERSION);
  assert.equal(record.state, "CLAIMED");
  assert.deepEqual(fs.readdirSync(directory), [hashedJournalName("task-alpha")]);
  const before = fs.readFileSync(path.join(directory, hashedJournalName("task-alpha")), "utf8");
  assert.equal(before.includes("SYNTHETIC_PRIVATE_OBJECTIVE"), false);
  assert.throws(() => journal.claim("task-alpha"), { code: "DEV_TASK_ALREADY_EXISTS" });
  assert.equal(fs.readFileSync(path.join(directory, hashedJournalName("task-alpha")), "utf8"), before);
  assert.deepEqual(fs.readdirSync(directory), [hashedJournalName("task-alpha")]);
  assert.throws(() => journal.claim(""), { code: "DEV_TASK_JOURNAL_ID_INVALID" });
  // Après « redémarrage » : nouvelle instance, même refus.
  const restarted = createDevTaskJournal({ directory });
  assert.equal(restarted.lookup("task-alpha").status, "PRESENT");
  assert.throws(() => restarted.claim("task-alpha"), { code: "DEV_TASK_ALREADY_EXISTS" });
}));

test("claim : deux instances concurrentes sur le même dossier, un seul gagnant", () => withDir((directory) => {
  const first = createDevTaskJournal({ directory });
  // La seconde voit ABSENT, puis la première crée le fichier juste avant son link.
  const { proxy } = recordingFs({
    linkSync: (from, to) => { first.claim("task-race"); return fs.linkSync(from, to); },
  });
  const second = createDevTaskJournal({ directory, fs: proxy });
  assert.throws(() => second.claim("task-race"), { code: "DEV_TASK_ALREADY_EXISTS" });
  assert.deepEqual(fs.readdirSync(directory), [hashedJournalName("task-race")]);
}));

test("claim : fsync du temporaire avant le link, puis fsync du dossier parent", () => withDir((directory) => {
  const { proxy, calls } = recordingFs();
  const journal = createDevTaskJournal({ directory, fs: proxy });
  calls.length = 0;
  journal.claim("task-order");
  const names = calls.map(([name]) => name);
  const final = hashedJournalName("task-order");
  const openTemp = calls.findIndex(([name, file, flag]) => name === "openSync" && file.endsWith(".tmp") && flag === "wx");
  const write = names.indexOf("writeSync", openTemp);
  const fsyncTemp = names.indexOf("fsyncSync", write);
  const closeTemp = names.indexOf("closeSync", fsyncTemp);
  const link = calls.findIndex(([name, , to]) => name === "linkSync" && to === final);
  const openDir = calls.findIndex(([name, file, flag], index) => index > link && name === "openSync" &&
    file === path.basename(directory) && flag === "r");
  const fsyncDir = names.indexOf("fsyncSync", openDir);
  for (const index of [openTemp, write, fsyncTemp, closeTemp, link, openDir, fsyncDir]) {
    assert.notEqual(index, -1, JSON.stringify(calls));
  }
  assert.ok(openTemp < write && write < fsyncTemp && fsyncTemp < closeTemp && closeTemp < link &&
    link < openDir && openDir < fsyncDir, JSON.stringify(calls));
  assert.deepEqual(fs.readdirSync(directory), [final]);
}));

test("claim : repli wx sans lien physique, avec fsync du fichier puis du dossier", () => withDir((directory) => {
  const { proxy, calls } = recordingFs({
    linkSync: () => { throw Object.assign(new Error("no hard links"), { code: "ENOTSUP" }); },
  });
  const journal = createDevTaskJournal({ directory, fs: proxy });
  calls.length = 0;
  journal.claim("task-fallback");
  const final = hashedJournalName("task-fallback");
  const names = calls.map(([name]) => name);
  const openFinal = calls.findIndex(([name, file, flag]) => name === "openSync" && file === final && flag === "wx");
  const write = names.indexOf("writeSync", openFinal);
  const fsyncFile = names.indexOf("fsyncSync", write);
  const closeFile = names.indexOf("closeSync", fsyncFile);
  const openDir = calls.findIndex(([name, file, flag], index) => index > closeFile && name === "openSync" &&
    file === path.basename(directory) && flag === "r");
  const fsyncDir = names.indexOf("fsyncSync", openDir);
  for (const index of [openFinal, write, fsyncFile, closeFile, openDir, fsyncDir]) {
    assert.notEqual(index, -1, JSON.stringify(calls));
  }
  assert.ok(openFinal < write && write < fsyncFile && fsyncFile < closeFile && closeFile < openDir &&
    openDir < fsyncDir, JSON.stringify(calls));
  assert.deepEqual(fs.readdirSync(directory), [final]);
  assert.equal(journal.lookup("task-fallback").status, "PRESENT");
  // Repli : un fichier déjà présent reste refusé.
  assert.throws(() => journal.claim("task-fallback"), { code: "DEV_TASK_ALREADY_EXISTS" });
}));

test("claim : échec d'écriture ou de fsync du temporaire → aucun fichier final", () => withDir((directory) => {
  for (const failing of ["writeSync", "fsyncSync"]) {
    let armed = true;
    const { proxy } = recordingFs({
      [failing]: (...args) => {
        if (armed) { armed = false; throw Object.assign(new Error("disk"), { code: "EIO" }); }
        return fs[failing](...args);
      },
    });
    const journal = createDevTaskJournal({ directory, fs: proxy });
    assert.throws(() => journal.claim(`task-${failing}`), { code: "EIO" });
    assert.equal(journal.lookup(`task-${failing}`).status, "ABSENT");
    assert.equal(fs.existsSync(path.join(directory, hashedJournalName(`task-${failing}`))), false);
  }
}));

test("start : suite d'un claim dans le même fichier, jamais d'écrasement", () => withDir((directory) => {
  const journal = createDevTaskJournal({ directory });
  journal.claim("task-start", { source: "B3" });
  const started = journal.start({ taskId: "task-start", workspaceId: "w" }, { branch: "main" });
  assert.equal(started.state, "PREFLIGHT");
  assert.deepEqual(started.phases.map((item) => item.state), ["CLAIMED", "CREATED"]);
  assert.deepEqual(fs.readdirSync(directory), [hashedJournalName("task-start")]);
  assert.throws(() => journal.start({ taskId: "task-start", workspaceId: "w" }, { branch: "main" }),
    { code: "DEV_TASK_ALREADY_EXISTS" });
  // Sans claim (chemin coordinateur) : création exclusive.
  journal.start({ taskId: "task-coordinator", workspaceId: "w" }, { branch: "main" });
  assert.throws(() => journal.start({ taskId: "task-coordinator", workspaceId: "w" }, { branch: "main" }),
    { code: "DEV_TASK_ALREADY_EXISTS" });
  journal.finish("task-coordinator", "PASS");
  assert.throws(() => journal.claim("task-coordinator"), { code: "DEV_TASK_ALREADY_EXISTS" });
}));

test("lookup / load : ABSENT, PRESENT ou UNREADABLE, jamais null sur une erreur", () => withDir((directory) => {
  const journal = createDevTaskJournal({ directory });
  assert.deepEqual({ ...journal.lookup("task-none") }, { status: "ABSENT" });
  assert.equal(journal.load("task-none"), null);
  journal.claim("task-ok");
  assert.equal(journal.lookup("task-ok").status, "PRESENT");
  assert.equal(journal.load("task-ok").taskId, "task-ok");
  const cases = {
    "task-corrupt": (file) => fs.writeFileSync(file, "{not json"),
    "task-mismatch": (file) => fs.writeFileSync(file, JSON.stringify({ taskId: "someone-else", state: "PASS" })),
    "task-array": (file) => fs.writeFileSync(file, "[]"),
    "task-directory": (file) => fs.mkdirSync(file),
    "task-unreadable": (file) => { fs.writeFileSync(file, JSON.stringify({ taskId: "task-unreadable" })); fs.chmodSync(file, 0o000); },
  };
  for (const [taskId, prepare] of Object.entries(cases)) {
    prepare(path.join(directory, hashedJournalName(taskId)));
    const found = journal.lookup(taskId);
    assert.equal(found.status, "UNREADABLE", taskId);
    assert.throws(() => journal.load(taskId), { code: "DEV_TASK_JOURNAL_UNREADABLE" }, taskId);
    assert.throws(() => journal.claim(taskId), { code: "DEV_TASK_JOURNAL_UNREADABLE" }, taskId);
    assert.throws(() => journal.transition(taskId, "EDIT"), { code: "DEV_TASK_JOURNAL_UNREADABLE" }, taskId);
  }
  assert.equal(journal.lookup("task-mismatch").code, "DEV_TASK_JOURNAL_MISMATCH");
  for (const invalid of ["", null, undefined, 42]) {
    assert.equal(journal.lookup(invalid).status, "UNREADABLE");
  }
  assert.throws(() => journal.transition("task-none", "EDIT"), /DEV_TASK_JOURNAL_MISSING/);
}));

test("correspondance exacte : les anciennes collisions safeId donnent des fichiers distincts", () => withDir((directory) => {
  const journal = createDevTaskJournal({ directory });
  const prefix = "x".repeat(160);
  const pairs = [["a/b", "a_b"], [`${prefix}-one`, `${prefix}-two`]];
  for (const [left, right] of pairs) {
    assert.equal(legacyJournalName(left), legacyJournalName(right));
    assert.notEqual(hashedJournalName(left), hashedJournalName(right));
    journal.claim(left);
    journal.claim(right);
    assert.equal(journal.load(left).taskId, left);
    assert.equal(journal.load(right).taskId, right);
  }
}));

test("anciens fichiers safeId : relus seulement si le taskId est exact, jamais réécrits", () => withDir((directory) => {
  const legacy = path.join(directory, legacyJournalName("legacy-task"));
  const legacyRecord = JSON.stringify({ taskId: "legacy-task", state: "EDIT", phases: [], filesRead: [],
    fileOperations: [], commands: [] }, null, 2);
  fs.writeFileSync(legacy, legacyRecord);
  const journal = createDevTaskJournal({ directory });
  const found = journal.lookup("legacy-task");
  assert.equal(found.status, "PRESENT");
  assert.equal(path.basename(found.file), legacyJournalName("legacy-task"));
  assert.throws(() => journal.claim("legacy-task"), { code: "DEV_TASK_ALREADY_EXISTS" });
  assert.throws(() => journal.transition("legacy-task", "PASS"), { code: "DEV_TASK_JOURNAL_LEGACY_READ_ONLY" });
  assert.throws(() => journal.finish("legacy-task", "PASS"), { code: "DEV_TASK_JOURNAL_LEGACY_READ_ONLY" });
  assert.throws(() => journal.start({ taskId: "legacy-task", workspaceId: "w" }, { branch: "main" }),
    { code: "DEV_TASK_ALREADY_EXISTS" });
  assert.equal(fs.readFileSync(legacy, "utf8"), legacyRecord);
  // Ancien fichier partagé par un autre taskId : ce n'est pas cette tâche.
  fs.writeFileSync(path.join(directory, "a_b.json"), JSON.stringify({ taskId: "a_b", state: "PASS" }));
  assert.equal(journal.lookup("a/b").status, "ABSENT");
  journal.claim("a/b");
  assert.equal(journal.lookup("a/b").status, "PRESENT");
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "a_b.json"), "utf8")).taskId, "a_b");
  // Ancien fichier corrompu : illisible, jamais « absent ».
  fs.writeFileSync(path.join(directory, legacyJournalName("legacy-corrupt")), "{oops");
  assert.equal(journal.lookup("legacy-corrupt").status, "UNREADABLE");
}));

test("interrupted : deux formats, terminaux exclus, illisibles signalés", () => withDir((directory) => {
  const journal = createDevTaskJournal({ directory });
  journal.claim("task-claimed");
  journal.claim("task-done");
  journal.finish("task-done", "PASS");
  fs.writeFileSync(path.join(directory, legacyJournalName("legacy-running")),
    JSON.stringify({ taskId: "legacy-running", state: "EDIT" }));
  fs.writeFileSync(path.join(directory, "garbage.json"), "{nope");
  const items = journal.interrupted();
  const ids = items.filter((item) => item.taskId).map((item) => item.taskId).sort();
  assert.deepEqual(ids, ["legacy-running", "task-claimed"]);
  assert.deepEqual(items.filter((item) => item.unreadable), [
    { taskId: null, state: "UNREADABLE", unreadable: true, file: "garbage.json" },
  ]);
}));
