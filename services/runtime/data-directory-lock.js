"use strict";

/*
 * 5.0D-4C-2 — Verrou exclusif sur DATA_DIRECTORY.
 *
 * Garantit qu'un seul processus Noon réconcilie à partir des mêmes données
 * (journal, ledger, base des runs). Création atomique (open wx, fsync du
 * fichier puis du dossier). Un verrou existant n'est jamais repris :
 * - processus vivant  → HELD ;
 * - processus absent  → STALE (signalé, pas de reprise automatique) ;
 * - fichier illisible → UNREADABLE.
 * Libéré à l'arrêt, seulement si le jeton correspond.
 */

const crypto = require("node:crypto");
const nodeFs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LOCK_FILE = "noon-data.lock";

function createDataDirectoryLock({
  directory,
  fs = nodeFs,
  pid = process.pid,
  hostname = os.hostname(),
  isProcessAlive = (candidate) => {
    try { process.kill(candidate, 0); return true; } catch (error) { return error?.code === "EPERM"; }
  },
  now = () => Date.now(),
} = {}) {
  if (!directory) throw new TypeError("Répertoire de données requis pour le verrou.");
  const file = path.join(path.resolve(directory), LOCK_FILE);
  let token = null;

  function fsyncDirectory() {
    const fd = fs.openSync(path.dirname(file), "r");
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }

  function readExisting() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!parsed || !Number.isSafeInteger(parsed.pid) || typeof parsed.token !== "string") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function acquire() {
    if (token) return Object.freeze({ acquired: true, reason: "ALREADY_HELD" });
    const candidate = crypto.randomUUID();
    const content = JSON.stringify({
      pid, hostname, token: candidate, createdAt: new Date(now()).toISOString(),
    });
    let fd;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fd = fs.openSync(file, "wx", 0o600);
    } catch (error) {
      if (error?.code !== "EEXIST") return Object.freeze({ acquired: false, reason: "UNAVAILABLE" });
      const existing = readExisting();
      if (!existing) return Object.freeze({ acquired: false, reason: "UNREADABLE" });
      const alive = existing.hostname === hostname ? isProcessAlive(existing.pid) : true;
      return Object.freeze({ acquired: false, reason: alive ? "HELD" : "STALE", holderPid: existing.pid });
    }
    try {
      fs.writeSync(fd, content);
      fs.fsyncSync(fd);
    } catch {
      try { fs.closeSync(fd); } catch {}
      try { fs.unlinkSync(file); } catch {}
      return Object.freeze({ acquired: false, reason: "UNAVAILABLE" });
    }
    fs.closeSync(fd);
    try { fsyncDirectory(); } catch {}
    token = candidate;
    return Object.freeze({ acquired: true, reason: "ACQUIRED" });
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

  return Object.freeze({ acquire, isHeld, release, file });
}

module.exports = { LOCK_FILE, createDataDirectoryLock };
