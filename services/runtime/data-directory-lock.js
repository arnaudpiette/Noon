"use strict";

/*
 * 5.0D-4C-2 / B3b — Verrou exclusif sur DATA_DIRECTORY.
 *
 * Garantit qu'un seul processus Noon réconcilie à partir des mêmes données
 * (journal, ledger, base des runs). Création atomique (open wx, fsync du
 * fichier puis du dossier). Libéré à l'arrêt, seulement si le jeton correspond.
 *
 * Verrou existant :
 * - processus vivant (ou EPERM, ou sonde indéterminée) → HELD, jamais repris ;
 * - autre hostname → HELD (aucune vérification de processus possible) ;
 * - même hostname et kill(pid, 0) → ESRCH exactement → STALE ;
 * - fichier illisible → UNREADABLE.
 *
 * B3b — reprise :
 * - automatique (acquire({ autoTakeover: true }), au démarrage) : seulement
 *   STALE (même hostname + ESRCH) ;
 * - explicite (takeover({ expectedHolderPid })) : STALE, UNREADABLE ou autre
 *   hostname ; refusée si le détenteur est vivant (ou indéterminé) sur la même
 *   machine, ou si le détenteur a changé.
 * Toute reprise passe par le mutex de reprise (open wx) : relecture du verrou
 * sous le mutex, renommage en .stale-<uuid> (conservé), recréation en wx.
 * Un mutex laissé par un crash n'est écarté que par la reprise explicite.
 * L'heure de démarrage de la machine (bootTime) est enregistrée pour
 * l'affichage seulement : elle n'entre dans aucune décision.
 */

const crypto = require("node:crypto");
const nodeFs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LOCK_FILE = "noon-data.lock";
const TAKEOVER_FILE = `${LOCK_FILE}.takeover`;
const BOOT_TIME_TOLERANCE_MS = 60_000;

// ALIVE | DEAD (ESRCH exactement) | UNKNOWN (toute autre erreur).
function probeProcessDefault(candidate, kill = (target, signal) => process.kill(target, signal)) {
  try {
    kill(candidate, 0);
    return "ALIVE";
  } catch (error) {
    if (error?.code === "ESRCH") return "DEAD";
    if (error?.code === "EPERM") return "ALIVE";
    return "UNKNOWN";
  }
}

function createDataDirectoryLock({
  directory,
  fs = nodeFs,
  pid = process.pid,
  hostname = os.hostname(),
  probeProcess = probeProcessDefault,
  now = () => Date.now(),
  bootTime = () => Date.now() - Math.round(os.uptime() * 1000),
  randomId = () => crypto.randomUUID(),
} = {}) {
  if (!directory) throw new TypeError("Répertoire de données requis pour le verrou.");
  const root = path.resolve(directory);
  const file = path.join(root, LOCK_FILE);
  const takeoverFile = path.join(root, TAKEOVER_FILE);
  let token = null;

  function fsyncDirectory() {
    const fd = fs.openSync(root, "r");
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }

  // { status: ABSENT | UNREADABLE | PRESENT, raw, record }
  function readState(target = file) {
    let raw;
    try {
      raw = fs.readFileSync(target, "utf8");
    } catch (error) {
      return error?.code === "ENOENT" ? { status: "ABSENT", raw: null, record: null } : { status: "UNREADABLE", raw: null, record: null };
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || !Number.isSafeInteger(parsed.pid) || parsed.pid <= 0 || typeof parsed.token !== "string") {
        return { status: "UNREADABLE", raw, record: null };
      }
      return { status: "PRESENT", raw, record: parsed };
    } catch {
      return { status: "UNREADABLE", raw, record: null };
    }
  }

  function readExisting() {
    const state = readState();
    return state.status === "PRESENT" ? state.record : null;
  }

  // Liveness du détenteur : jamais sondée pour un autre hostname.
  function holderLiveness(record) {
    if (record.hostname !== hostname) return "FOREIGN_HOST";
    const probed = probeProcess(record.pid);
    return probed === "ALIVE" || probed === "DEAD" ? probed : "UNKNOWN";
  }

  function content(candidate) {
    return JSON.stringify({
      pid, hostname, token: candidate, createdAt: new Date(now()).toISOString(), bootTime: safeBootTime(),
    });
  }

  function safeBootTime() {
    try {
      const value = bootTime();
      return Number.isFinite(value) ? Math.round(value) : null;
    } catch {
      return null;
    }
  }

  // Écrit un nouveau fichier en wx. Renvoie le jeton, ou lève (EEXIST, …).
  function writeExclusive(target, text) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const fd = fs.openSync(target, "wx", 0o600);
    try {
      fs.writeSync(fd, text);
      fs.fsyncSync(fd);
    } catch (error) {
      try { fs.closeSync(fd); } catch {}
      try { fs.unlinkSync(target); } catch {}
      throw Object.assign(new Error("lock write failed"), { code: "LOCK_WRITE_FAILED", cause: error });
    }
    fs.closeSync(fd);
    try { fsyncDirectory(); } catch {}
  }

  function createLock() {
    const candidate = randomId();
    writeExclusive(file, content(candidate));
    token = candidate;
  }

  function refused(reason, extra = {}) {
    return Object.freeze({ acquired: false, reason, ...extra });
  }

  function previousOf(state) {
    if (state.status !== "PRESENT") return null;
    const { pid: holderPid, hostname: holderHost, createdAt, bootTime: holderBoot } = state.record;
    return Object.freeze({
      pid: holderPid,
      hostname: typeof holderHost === "string" ? holderHost.slice(0, 255) : null,
      createdAt: typeof createdAt === "string" ? createdAt.slice(0, 40) : null,
      bootTime: Number.isFinite(holderBoot) ? holderBoot : null,
    });
  }

  // ---- Mutex de reprise ----

  function acquireMutex({ explicit }) {
    const mutexToken = randomId();
    const text = JSON.stringify({ pid, hostname, token: mutexToken, createdAt: new Date(now()).toISOString() });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        writeExclusive(takeoverFile, text);
        return { ok: true, token: mutexToken };
      } catch (error) {
        if (error?.code !== "EEXIST") return { ok: false, reason: "UNAVAILABLE" };
      }
      // Mutex présent : jamais écarté automatiquement.
      if (!explicit || attempt > 0) return { ok: false, reason: "TAKEOVER_BUSY" };
      const existing = readState(takeoverFile);
      if (existing.status === "ABSENT") continue;
      const liveness = existing.status === "PRESENT" ? holderLiveness(existing.record) : null;
      if (liveness === "ALIVE" || liveness === "UNKNOWN") return { ok: false, reason: "TAKEOVER_BUSY" };
      // Reprise explicite : mutex d'un processus disparu, d'une autre machine
      // ou illisible → renommé (conservé), puis nouvel essai en wx.
      try {
        fs.renameSync(takeoverFile, path.join(root, `${TAKEOVER_FILE}.stale-${randomId()}`));
      } catch (error) {
        if (error?.code !== "ENOENT") return { ok: false, reason: "UNAVAILABLE" };
      }
    }
    return { ok: false, reason: "TAKEOVER_BUSY" };
  }

  function releaseMutex(mutexToken) {
    const existing = readState(takeoverFile);
    if (existing.status !== "PRESENT" || existing.record.token !== mutexToken) return;
    try { fs.unlinkSync(takeoverFile); } catch {}
    try { fsyncDirectory(); } catch {}
  }

  // Reprise sous mutex : le verrou doit être exactement celui observé
  // (mêmes octets) et toujours éligible selon `eligible`.
  function takeoverUnderMutex(observed, { explicit, eligible }) {
    const mutex = acquireMutex({ explicit });
    if (!mutex.ok) return refused(mutex.reason);
    try {
      const current = readState();
      if (current.status === "ABSENT") {
        try { createLock(); } catch (error) {
          return refused(error?.code === "EEXIST" ? "HELD" : "UNAVAILABLE");
        }
        return Object.freeze({ acquired: true, reason: "ACQUIRED" });
      }
      if (current.status !== observed.status || current.raw !== observed.raw) return refused("TAKEOVER_CHANGED");
      const verdict = eligible(current);
      if (verdict !== true) return refused(verdict);
      const staleFile = `${LOCK_FILE}.stale-${randomId()}`;
      try {
        fs.renameSync(file, path.join(root, staleFile));
      } catch {
        return refused("UNAVAILABLE");
      }
      // Le fichier renommé doit être celui vérifié (aucun remplacement entre-temps).
      const moved = readState(path.join(root, staleFile));
      if (moved.raw !== current.raw) {
        // Restauration sans jamais écraser un verrou apparu entre-temps (link, pas rename).
        try {
          fs.linkSync(path.join(root, staleFile), file);
          fs.unlinkSync(path.join(root, staleFile));
        } catch {}
        return refused("TAKEOVER_CHANGED");
      }
      try { createLock(); } catch (error) {
        // Un autre processus a obtenu le verrou libéré par un acquire normal.
        return refused(error?.code === "EEXIST" ? "HELD" : "UNAVAILABLE");
      }
      return Object.freeze({
        acquired: true, reason: "TAKEN_OVER", previous: previousOf(current), staleFile,
      });
    } finally {
      releaseMutex(mutex.token);
    }
  }

  // Éligibilité automatique : même hostname et ESRCH exactement.
  function automaticallyEligible(state) {
    if (state.status !== "PRESENT") return "UNREADABLE";
    const liveness = holderLiveness(state.record);
    return liveness === "DEAD" ? true : "HELD";
  }

  // ---- API ----

  function acquire({ autoTakeover = false } = {}) {
    if (token) return Object.freeze({ acquired: true, reason: "ALREADY_HELD" });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        createLock();
        return Object.freeze({ acquired: true, reason: "ACQUIRED" });
      } catch (error) {
        if (error?.code !== "EEXIST") return refused("UNAVAILABLE");
      }
      const existing = readState();
      if (existing.status === "ABSENT") continue; // libéré entre-temps : nouvel essai
      if (existing.status === "UNREADABLE") return refused("UNREADABLE");
      const liveness = holderLiveness(existing.record);
      if (liveness !== "DEAD") return refused("HELD", { holderPid: existing.record.pid });
      if (!autoTakeover) return refused("STALE", { holderPid: existing.record.pid });
      return takeoverUnderMutex(existing, { explicit: false, eligible: automaticallyEligible });
    }
    return refused("UNAVAILABLE");
  }

  // Reprise explicite (maintenance) : le détenteur attendu doit correspondre.
  function takeover({ expectedHolderPid } = {}) {
    if (token) return Object.freeze({ acquired: true, reason: "ALREADY_HELD" });
    const expected = expectedHolderPid === null ? null : expectedHolderPid;
    if (expected !== null && !(Number.isSafeInteger(expected) && expected > 0)) return refused("EXPECTED_HOLDER_INVALID");
    const observed = readState();
    if (observed.status === "ABSENT") return acquire();
    const eligible = (state) => {
      if (state.status === "UNREADABLE") return expected === null ? true : "EXPECTED_HOLDER_MISMATCH";
      if (state.record.pid !== expected) return "EXPECTED_HOLDER_MISMATCH";
      const liveness = holderLiveness(state.record);
      if (liveness === "ALIVE") return "HOLDER_ALIVE";
      if (liveness === "UNKNOWN") return "HOLDER_UNVERIFIED";
      return true; // DEAD ou FOREIGN_HOST
    };
    const precheck = eligible(observed);
    if (precheck !== true) return refused(precheck);
    return takeoverUnderMutex(observed, { explicit: true, eligible });
  }

  // État pour la maintenance (affichage) : aucune écriture, aucune reprise.
  function inspect() {
    const takeoverPending = readState(takeoverFile).status !== "ABSENT";
    if (isHeld()) return Object.freeze({ state: "HELD_BY_THIS", takeoverPending, canTakeOver: false });
    const observed = readState();
    if (observed.status === "ABSENT") return Object.freeze({ state: "ABSENT", takeoverPending, canTakeOver: true });
    if (observed.status === "UNREADABLE") {
      return Object.freeze({ state: "UNREADABLE", holderPid: null, takeoverPending, canTakeOver: true });
    }
    const previous = previousOf(observed);
    const liveness = holderLiveness(observed.record);
    const state = { ALIVE: "HELD", DEAD: "STALE", FOREIGN_HOST: "FOREIGN_HOST", UNKNOWN: "UNVERIFIED" }[liveness];
    const currentBoot = safeBootTime();
    // Indication seulement (PID probablement réutilisé) : n'autorise aucune reprise.
    const machineRestarted = liveness === "FOREIGN_HOST" || previous.bootTime === null || currentBoot === null
      ? null : currentBoot - previous.bootTime > BOOT_TIME_TOLERANCE_MS;
    return Object.freeze({
      state,
      holderPid: previous.pid,
      holderHostname: previous.hostname,
      holderCreatedAt: previous.createdAt,
      sameHost: liveness !== "FOREIGN_HOST",
      machineRestarted,
      takeoverPending,
      canTakeOver: state === "STALE" || state === "FOREIGN_HOST",
    });
  }

  function isHeld() {
    if (!token) return false;
    const existing = readExisting();
    return existing?.token === token && existing.pid === pid;
  }

  function release() {
    if (!token) return false;
    const existing = readExisting();
    const ours = existing?.token === token;
    token = null;
    if (!ours) return false;
    try { fs.unlinkSync(file); return true; } catch { return false; }
  }

  return Object.freeze({ acquire, takeover, inspect, isHeld, release, file });
}

module.exports = { LOCK_FILE, TAKEOVER_FILE, createDataDirectoryLock, probeProcessDefault };
