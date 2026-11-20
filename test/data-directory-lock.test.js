"use strict";

// Dossiers temporaires uniquement.

const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { LOCK_FILE, TAKEOVER_FILE, createDataDirectoryLock, probeProcessDefault } = require("../services/runtime/data-directory-lock");

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

// ---- B3b : reprise ----

const HOST = os.hostname();
const lockPath = (directory) => path.join(directory, LOCK_FILE);
const mutexPath = (directory) => path.join(directory, TAKEOVER_FILE);
const write = (file, value) => fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
const staleFiles = (directory, prefix) => fs.readdirSync(directory).filter((name) => name.startsWith(`${prefix}.stale-`));

// Sonde injectée : PID → ALIVE | DEAD | UNKNOWN, appels enregistrés.
function probe(map) {
  const calls = [];
  const fn = (pid) => { calls.push(pid); return map[pid] ?? "ALIVE"; };
  fn.calls = calls;
  return fn;
}

test("sonde par défaut : ESRCH exactement → DEAD, vivant ou EPERM → ALIVE", () => {
  const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
  assert.equal(probeProcessDefault(Number(dead.stdout)), "DEAD");
  assert.equal(probeProcessDefault(process.pid), "ALIVE");
  // PID 1 (launchd) : EPERM pour un utilisateur normal, succès pour root → ALIVE dans les deux cas.
  assert.equal(probeProcessDefault(1), "ALIVE");
  // Toute autre erreur : indéterminé (jamais « mort »), donc jamais de reprise.
  const throwing = (code) => () => { throw Object.assign(new Error(code), { code }); };
  assert.equal(probeProcessDefault(123, throwing("ESRCH")), "DEAD");
  assert.equal(probeProcessDefault(123, throwing("EPERM")), "ALIVE");
  for (const code of ["EINVAL", "EACCES", undefined]) assert.equal(probeProcessDefault(123, throwing(code)), "UNKNOWN");
  assert.equal(probeProcessDefault(123, () => true), "ALIVE");
});

test("reprise automatique : même hostname + DEAD seulement, sous mutex, ancien verrou conservé", () => withDir((directory) => {
  const stale = { pid: 4242, hostname: HOST, token: "stale", createdAt: "2026-10-13T12:00:00.000Z", bootTime: 1 };
  write(lockPath(directory), stale);
  const sonde = probe({ 4242: "DEAD" });
  const lock = createDataDirectoryLock({ directory, probeProcess: sonde, bootTime: () => 2 });
  // Sans option : signalé périmé, jamais repris.
  assert.deepEqual({ ...lock.acquire() }, { acquired: false, reason: "STALE", holderPid: 4242 });
  assert.equal(JSON.parse(fs.readFileSync(lockPath(directory), "utf8")).token, "stale");
  const result = lock.acquire({ autoTakeover: true });
  assert.equal(result.acquired, true);
  assert.equal(result.reason, "TAKEN_OVER");
  assert.deepEqual({ ...result.previous }, { pid: 4242, hostname: HOST, createdAt: "2026-10-13T12:00:00.000Z", bootTime: 1 });
  assert.equal(lock.isHeld(), true);
  const current = JSON.parse(fs.readFileSync(lockPath(directory), "utf8"));
  assert.equal(current.pid, process.pid);
  assert.equal(current.bootTime, 2); // enregistrée pour l'affichage
  assert.deepEqual(staleFiles(directory, LOCK_FILE), [result.staleFile]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, result.staleFile), "utf8")).token, "stale");
  assert.equal(fs.existsSync(mutexPath(directory)), false); // mutex libéré
  assert.equal(lock.release(), true);
}));

test("reprise automatique refusée : vivant (PID réutilisé, machine redémarrée), EPERM, indéterminé, autre machine, illisible", () => withDir((directory) => {
  for (const [liveness, expected] of [["ALIVE", "HELD"], ["UNKNOWN", "HELD"]]) {
    const holder = { pid: 5151, hostname: HOST, token: "t", createdAt: "2026-10-13T12:00:00.000Z", bootTime: 0 };
    write(lockPath(directory), holder);
    const lock = createDataDirectoryLock({ directory, probeProcess: probe({ 5151: liveness }), bootTime: () => 10 * 86_400_000 });
    assert.deepEqual({ ...lock.acquire({ autoTakeover: true }) }, { acquired: false, reason: expected, holderPid: 5151 });
    const view = lock.inspect();
    assert.equal(view.state, liveness === "ALIVE" ? "HELD" : "UNVERIFIED");
    assert.equal(view.canTakeOver, false);
    if (liveness === "ALIVE") assert.equal(view.machineRestarted, true); // affichage seulement
    assert.equal(JSON.parse(fs.readFileSync(lockPath(directory), "utf8")).token, "t");
  }
  // Autre machine : jamais sondée, jamais reprise automatiquement.
  write(lockPath(directory), { pid: 6161, hostname: "other-host", token: "remote" });
  const sonde = probe({ 6161: "DEAD" });
  const remote = createDataDirectoryLock({ directory, probeProcess: sonde });
  assert.equal(remote.acquire({ autoTakeover: true }).reason, "HELD");
  assert.deepEqual(sonde.calls, []);
  assert.equal(remote.inspect().state, "FOREIGN_HOST");
  write(lockPath(directory), "{garbage");
  assert.equal(createDataDirectoryLock({ directory }).acquire({ autoTakeover: true }).reason, "UNREADABLE");
  assert.equal(fs.readFileSync(lockPath(directory), "utf8"), "{garbage");
  assert.deepEqual(staleFiles(directory, LOCK_FILE), []);
}));

test("mutex de reprise laissé par un crash : jamais écarté automatiquement, écarté par la reprise explicite", () => withDir((directory) => {
  write(lockPath(directory), { pid: 7171, hostname: HOST, token: "stale" });
  write(mutexPath(directory), { pid: 7272, hostname: HOST, token: "crashed-mutex" });
  const sonde = probe({ 7171: "DEAD", 7272: "DEAD" });
  const lock = createDataDirectoryLock({ directory, probeProcess: sonde });
  assert.equal(lock.acquire({ autoTakeover: true }).reason, "TAKEOVER_BUSY");
  assert.equal(JSON.parse(fs.readFileSync(lockPath(directory), "utf8")).token, "stale");
  assert.equal(JSON.parse(fs.readFileSync(mutexPath(directory), "utf8")).token, "crashed-mutex");
  assert.equal(lock.inspect().takeoverPending, true);
  // Mutex d'un processus vivant : même la reprise explicite attend.
  const busy = createDataDirectoryLock({ directory, probeProcess: probe({ 7171: "DEAD", 7272: "ALIVE" }) });
  assert.equal(busy.takeover({ expectedHolderPid: 7171 }).reason, "TAKEOVER_BUSY");
  const result = lock.takeover({ expectedHolderPid: 7171 });
  assert.equal(result.reason, "TAKEN_OVER");
  assert.equal(staleFiles(directory, TAKEOVER_FILE).length, 1);
  assert.equal(fs.existsSync(mutexPath(directory)), false);
  assert.equal(lock.isHeld(), true);
}));

test("reprise explicite : détenteur attendu, vivant refusé, autre machine et illisible acceptés, absent acquis", () => withDir((directory) => {
  write(lockPath(directory), { pid: 8181, hostname: HOST, token: "live" });
  const lock = createDataDirectoryLock({ directory, probeProcess: probe({ 8181: "ALIVE", 8282: "UNKNOWN" }) });
  assert.equal(lock.takeover({}).reason, "EXPECTED_HOLDER_INVALID");
  assert.equal(lock.takeover({ expectedHolderPid: 0 }).reason, "EXPECTED_HOLDER_INVALID");
  assert.equal(lock.takeover({ expectedHolderPid: 9999 }).reason, "EXPECTED_HOLDER_MISMATCH");
  assert.equal(lock.takeover({ expectedHolderPid: 8181 }).reason, "HOLDER_ALIVE");
  write(lockPath(directory), { pid: 8282, hostname: HOST, token: "unknown" });
  assert.equal(lock.takeover({ expectedHolderPid: 8282 }).reason, "HOLDER_UNVERIFIED");
  assert.deepEqual(staleFiles(directory, LOCK_FILE), []);
  write(lockPath(directory), { pid: 8383, hostname: "other-host", token: "remote" });
  assert.equal(lock.takeover({ expectedHolderPid: 8383 }).reason, "TAKEN_OVER");
  assert.equal(lock.release(), true);
  write(lockPath(directory), "{garbage");
  assert.equal(lock.takeover({ expectedHolderPid: 1 }).reason, "EXPECTED_HOLDER_MISMATCH");
  const unreadable = lock.takeover({ expectedHolderPid: null });
  assert.equal(unreadable.reason, "TAKEN_OVER");
  assert.equal(unreadable.previous, null);
  assert.equal(lock.release(), true);
  assert.equal(lock.takeover({ expectedHolderPid: null }).reason, "ACQUIRED");
  assert.equal(lock.takeover({ expectedHolderPid: null }).reason, "ALREADY_HELD");
}));

test("reprise : verrou modifié après l'observation → TAKEOVER_CHANGED, rien n'est écrasé", () => withDir((directory) => {
  write(lockPath(directory), { pid: 9191, hostname: HOST, token: "stale" });
  const replaced = JSON.stringify({ pid: process.pid, hostname: HOST, token: "new-holder" });
  // Un autre détenteur remplace le verrou juste après la prise du mutex.
  const proxy = { ...fs, openSync: (file, flag, mode) => {
    const fd = fs.openSync(file, flag, mode);
    if (path.basename(String(file)) === TAKEOVER_FILE && flag === "wx") fs.writeFileSync(lockPath(directory), replaced);
    return fd;
  } };
  const lock = createDataDirectoryLock({ directory, fs: proxy, probeProcess: probe({ 9191: "DEAD" }) });
  assert.equal(lock.acquire({ autoTakeover: true }).reason, "TAKEOVER_CHANGED");
  assert.equal(fs.readFileSync(lockPath(directory), "utf8"), replaced);
  assert.equal(fs.existsSync(mutexPath(directory)), false);
  assert.equal(lock.isHeld(), false);
}));

test("reprise : mutex wx, renommage, recréation wx, fsync, puis suppression du mutex", () => withDir((directory) => {
  write(lockPath(directory), { pid: 9393, hostname: HOST, token: "stale" });
  const calls = [];
  const proxy = {};
  for (const name of ["mkdirSync", "openSync", "writeSync", "fsyncSync", "closeSync", "readFileSync", "unlinkSync", "renameSync", "linkSync"]) {
    proxy[name] = (...args) => {
      calls.push([name, ...args.slice(0, 2).map((value) => (typeof value === "string" ? path.basename(value) : value))]);
      return fs[name](...args);
    };
  }
  createDataDirectoryLock({ directory, fs: proxy, probeProcess: probe({ 9393: "DEAD" }) }).acquire({ autoTakeover: true });
  const index = (predicate) => calls.findIndex(predicate);
  const mutex = index(([name, file, flag]) => name === "openSync" && file === TAKEOVER_FILE && flag === "wx");
  const rename = index(([name, file, target]) => name === "renameSync" && file === LOCK_FILE && String(target).startsWith(`${LOCK_FILE}.stale-`));
  const create = calls.findIndex(([name, file, flag], i) => i > rename && name === "openSync" && file === LOCK_FILE && flag === "wx");
  const fsync = calls.findIndex(([name], i) => i > create && name === "fsyncSync");
  const unlink = calls.findIndex(([name, file], i) => i > fsync && name === "unlinkSync" && file === TAKEOVER_FILE);
  for (const value of [mutex, rename, create, fsync, unlink]) assert.notEqual(value, -1, JSON.stringify(calls));
  assert.ok(mutex < rename && rename < create && create < fsync && fsync < unlink);
}));

function contender(directory) {
  const script = `
    const { createDataDirectoryLock } = require(${JSON.stringify(LOCK_MODULE)});
    const lock = createDataDirectoryLock({ directory: ${JSON.stringify(directory)} });
    process.stdout.write("READY\\n");
    process.stdin.once("data", () => {
      const result = lock.acquire({ autoTakeover: true });
      process.stdout.write("LOCK=" + result.reason + "\\n");
      process.stdin.on("end", () => { lock.release(); process.exit(0); });
    });
    process.stdin.resume();
  `;
  const child = spawn(process.execPath, ["-e", script], { stdio: ["pipe", "pipe", "inherit"] });
  let output = "";
  const ready = new Promise((resolve) => child.stdout.on("data", (chunk) => {
    output += chunk;
    if (output.includes("READY")) resolve();
  }));
  const reason = new Promise((resolve, reject) => {
    child.stdout.on("data", () => { const match = output.match(/LOCK=([A-Z_]+)/); if (match) resolve(match[1]); });
    child.on("exit", () => reject(new Error("contender exited early")));
  });
  return { child, ready, reason };
}

test("reprise automatique concurrente : plusieurs processus sur le même verrou périmé, un seul gagne", () => withDir(async (directory) => {
  for (let round = 0; round < 3; round += 1) {
    const dead = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
    write(lockPath(directory), { pid: Number(dead.stdout), hostname: HOST, token: `stale-${round}` });
    const contenders = Array.from({ length: 4 }, () => contender(directory));
    await Promise.all(contenders.map((item) => item.ready));
    for (const item of contenders) item.child.stdin.write("go\n");
    const reasons = await Promise.all(contenders.map((item) => item.reason));
    const winners = reasons.filter((reason) => reason === "TAKEN_OVER" || reason === "ACQUIRED");
    assert.equal(winners.length, 1, JSON.stringify(reasons));
    for (const reason of reasons) assert.ok(["TAKEN_OVER", "ACQUIRED", "HELD", "TAKEOVER_BUSY", "TAKEOVER_CHANGED"].includes(reason), reason);
    assert.equal(fs.existsSync(mutexPath(directory)), false);
    for (const item of contenders) item.child.stdin.end();
    await Promise.all(contenders.map((item) => exited(item.child)));
    assert.equal(fs.existsSync(lockPath(directory)), false); // libéré par le gagnant
  }
}));
