"use strict";

// Dossiers temporaires uniquement.

const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { LOCK_FILE, createDataDirectoryLock } = require("../services/runtime/data-directory-lock");

const LOCK_MODULE = path.join(__dirname, "..", "services", "runtime", "data-directory-lock.js");

function withDir(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-lock-"));
  return Promise.resolve()
    .then(() => run(directory))
    .finally(() => fs.rmSync(directory, { recursive: true, force: true }));
}

test("verrou : acquisition atomique, HELD par un autre, libération réservée au détenteur", () => withDir((directory) => {
  const first = createDataDirectoryLock({ directory });
  assert.deepEqual({ ...first.acquire() }, { acquired: true, reason: "ACQUIRED" });
  assert.equal(first.isHeld(), true);
  const content = JSON.parse(fs.readFileSync(path.join(directory, LOCK_FILE), "utf8"));
  assert.equal(content.pid, process.pid);
  assert.match(content.token, /^[0-9a-f-]{36}$/);
  assert.equal(first.acquire().reason, "ALREADY_HELD");
  const second = createDataDirectoryLock({ directory });
  const refused = second.acquire();
  assert.equal(refused.acquired, false);
  assert.equal(refused.reason, "HELD");
  assert.equal(second.isHeld(), false);
  assert.equal(second.release(), false);
  assert.ok(fs.existsSync(path.join(directory, LOCK_FILE)));
  assert.equal(first.release(), true);
  assert.equal(fs.existsSync(path.join(directory, LOCK_FILE)), false);
  assert.equal(second.acquire().acquired, true);
  // Fichier remplacé par un autre détenteur : plus détenu, jamais supprimé par nous.
  fs.writeFileSync(path.join(directory, LOCK_FILE), JSON.stringify({ pid: process.pid, token: "other", hostname: os.hostname() }));
  assert.equal(second.isHeld(), false);
  assert.equal(second.release(), false);
  assert.ok(fs.existsSync(path.join(directory, LOCK_FILE)));
}));

test("verrou : périmé (processus disparu) ou illisible → jamais repris", () => withDir((directory) => {
  const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
  const deadPid = Number(dead.stdout);
  const file = path.join(directory, LOCK_FILE);
  const stale = JSON.stringify({ pid: deadPid, token: "stale", hostname: os.hostname(), createdAt: "2026-10-13T12:00:00.000Z" });
  fs.writeFileSync(file, stale);
  const lock = createDataDirectoryLock({ directory });
  assert.deepEqual({ ...lock.acquire() }, { acquired: false, reason: "STALE", holderPid: deadPid });
  assert.equal(fs.readFileSync(file, "utf8"), stale); // aucune reprise automatique
  assert.equal(lock.isHeld(), false);
  fs.writeFileSync(file, "{garbage");
  assert.deepEqual({ ...createDataDirectoryLock({ directory }).acquire() }, { acquired: false, reason: "UNREADABLE" });
  // Autre machine : considéré comme détenu (pas de vérification de processus possible).
  fs.writeFileSync(file, JSON.stringify({ pid: deadPid, token: "remote", hostname: "other-host" }));
  assert.equal(createDataDirectoryLock({ directory }).acquire().reason, "HELD");
}));

test("verrou : open wx, fsync du fichier puis du dossier", () => withDir((directory) => {
  const calls = [];
  const proxy = {};
  for (const name of ["mkdirSync", "openSync", "writeSync", "fsyncSync", "closeSync", "readFileSync", "unlinkSync"]) {
    proxy[name] = (...args) => {
      calls.push([name, ...args.map((value) => (typeof value === "string" ? path.basename(value) : value))]);
      return fs[name](...args);
    };
  }
  createDataDirectoryLock({ directory, fs: proxy }).acquire();
  const names = calls.map(([name]) => name);
  const open = calls.findIndex(([name, file, flag]) => name === "openSync" && file === LOCK_FILE && flag === "wx");
  const write = names.indexOf("writeSync", open);
  const fsyncFile = names.indexOf("fsyncSync", write);
  const openDir = calls.findIndex(([name, file, flag], index) => index > fsyncFile && name === "openSync" &&
    file === path.basename(directory) && flag === "r");
  const fsyncDir = names.indexOf("fsyncSync", openDir);
  for (const index of [open, write, fsyncFile, openDir, fsyncDir]) assert.notEqual(index, -1, JSON.stringify(calls));
  assert.ok(open < write && write < fsyncFile && fsyncFile < openDir && openDir < fsyncDir);
}));

function holder(directory) {
  const script = `
    const { createDataDirectoryLock } = require(${JSON.stringify(LOCK_MODULE)});
    const lock = createDataDirectoryLock({ directory: ${JSON.stringify(directory)} });
    const result = lock.acquire();
    process.stdout.write("LOCK=" + result.reason + "\\n");
    process.stdin.on("end", () => { lock.release(); process.exit(0); });
    process.stdin.resume();
  `;
  const child = spawn(process.execPath, ["-e", script], { stdio: ["pipe", "pipe", "inherit"] });
  const reason = new Promise((resolve, reject) => {
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/LOCK=([A-Z_]+)/);
      if (match) resolve(match[1]);
    });
    child.on("exit", () => reject(new Error("holder exited early")));
  });
  return { child, reason };
}

function exited(child) {
  return new Promise((resolve) => child.once("exit", resolve));
}

test("verrou : deux processus sur le même dossier, puis arrêt propre et arrêt brutal", () => withDir(async (directory) => {
  const first = holder(directory);
  assert.equal(await first.reason, "ACQUIRED");
  const second = holder(directory);
  assert.equal(await second.reason, "HELD");
  second.child.stdin.end();
  await exited(second.child);
  assert.equal(createDataDirectoryLock({ directory }).acquire().reason, "HELD");
  // Arrêt propre : verrou libéré, un autre processus peut l'acquérir.
  first.child.stdin.end();
  await exited(first.child);
  assert.equal(fs.existsSync(path.join(directory, LOCK_FILE)), false);
  const third = holder(directory);
  assert.equal(await third.reason, "ACQUIRED");
  // Arrêt brutal : verrou laissé, signalé périmé, jamais repris.
  third.child.kill("SIGKILL");
  await exited(third.child);
  assert.ok(fs.existsSync(path.join(directory, LOCK_FILE)));
  const after = createDataDirectoryLock({ directory }).acquire();
  assert.equal(after.reason, "STALE");
  assert.ok(fs.existsSync(path.join(directory, LOCK_FILE)));
}));
