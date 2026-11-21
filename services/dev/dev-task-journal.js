"use strict";

/*
 * Journal Native DEV persistant, un fichier JSON par taskId.
 *
 * Fiabilité :
 * - claim() : enregistrement de démarrage synchrone, exclusif et atomique
 *   (temporaire complet + fsync, link vers le nom final, fsync du dossier ;
 *   repli wx + fsync si le lien physique est indisponible). Jamais
 *   d'écrasement : un taskId déjà connu est refusé.
 * - lookup() distingue ABSENT (ENOENT seulement), PRESENT (taskId exact) et
 *   UNREADABLE (corrompu, illisible, taskId différent). load() est strict :
 *   null seulement si absent, erreur sinon.
 * - Nom exact : task-<sha256(taskId)>.json. Les anciens fichiers safeId sont
 *   relus seulement si leur taskId est exactement celui demandé, et ne sont
 *   jamais réécrits ailleurs ni renommés.
 * - Aucune consigne ni contenu source n'est enregistré.
 */

const crypto = require("node:crypto");
const nodeFs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = 2;
const TERMINAL = new Set(["PASS", "PARTIAL", "FAIL", "CANCELLED", "TIMEOUT"]);
const LINK_UNSUPPORTED = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV", "EMLINK"]);

function legacySafeId(value) { return String(value || "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 160); }
function hashedName(taskId) {
  return `task-${crypto.createHash("sha256").update(String(taskId)).digest("hex")}.json`;
}

function journalError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function createDevTaskJournal({ directory, now = () => Date.now(), fs = nodeFs } = {}) {
  if (!directory) throw new TypeError("Répertoire de journal DEV requis.");
  const root = path.resolve(directory);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const hashedPath = (taskId) => path.join(root, hashedName(taskId));
  const legacyPath = (taskId) => path.join(root, `${legacySafeId(taskId)}.json`);
  const iso = () => new Date(now()).toISOString();
  const temporaryFor = (file) => `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;

  function fsyncDirectory() {
    const fd = fs.openSync(root, "r");
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }

  function writeDurable(file, data, flag) {
    const fd = fs.openSync(file, flag, 0o600);
    try {
      fs.writeSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  function removeQuietly(file) {
    try { fs.unlinkSync(file); } catch {}
  }

  // Création exclusive : le fichier final n'apparaît que complet et durable.
  function createExclusive(file, record) {
    const data = JSON.stringify(record, null, 2);
    const temporary = temporaryFor(file);
    writeDurable(temporary, data, "wx");
    try {
      fs.linkSync(temporary, file);
    } catch (error) {
      removeQuietly(temporary);
      if (error?.code === "EEXIST") {
        throw journalError("DEV_TASK_ALREADY_EXISTS", "Tâche DEV déjà présente dans le journal.");
      }
      if (!LINK_UNSUPPORTED.has(error?.code)) throw error;
      // Repli sans lien physique : création exclusive directe, puis fsync.
      try {
        writeDurable(file, data, "wx");
      } catch (fallbackError) {
        if (fallbackError?.code === "EEXIST") {
          throw journalError("DEV_TASK_ALREADY_EXISTS", "Tâche DEV déjà présente dans le journal.");
        }
        throw fallbackError;
      }
      fsyncDirectory();
      return record;
    }
    removeQuietly(temporary);
    fsyncDirectory();
    return record;
  }

  // Mise à jour d'un enregistrement existant, dans son propre fichier.
  function replaceDurable(file, record) {
    record.updatedAt = iso();
    const temporary = temporaryFor(file);
    writeDurable(temporary, JSON.stringify(record, null, 2), "wx");
    try {
      fs.renameSync(temporary, file);
    } catch (error) {
      removeQuietly(temporary);
      throw error;
    }
    fsyncDirectory();
    return record;
  }

  function readCandidate(file, taskId, legacy) {
    let raw;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      return { status: "UNREADABLE", code: "DEV_TASK_JOURNAL_UNREADABLE", file };
    }
    let record;
    try { record = JSON.parse(raw); } catch {
      return { status: "UNREADABLE", code: "DEV_TASK_JOURNAL_CORRUPT", file };
    }
    if (!record || typeof record !== "object" || Array.isArray(record) ||
        typeof record.taskId !== "string") {
      return { status: "UNREADABLE", code: "DEV_TASK_JOURNAL_CORRUPT", file };
    }
    if (record.taskId !== taskId) {
      // Ancien nom safeId partagé par un autre taskId : pas cette tâche.
      if (legacy) return null;
      return { status: "UNREADABLE", code: "DEV_TASK_JOURNAL_MISMATCH", file };
    }
    return { status: "PRESENT", record, file };
  }

  function lookup(taskId) {
    if (typeof taskId !== "string" || !taskId) {
      return Object.freeze({ status: "UNREADABLE", code: "DEV_TASK_JOURNAL_ID_INVALID" });
    }
    const hashed = readCandidate(hashedPath(taskId), taskId, false);
    if (hashed) return Object.freeze(hashed);
    const legacy = readCandidate(legacyPath(taskId), taskId, true);
    if (legacy) return Object.freeze(legacy);
    return Object.freeze({ status: "ABSENT" });
  }

  function load(taskId) {
    const found = lookup(String(taskId ?? ""));
    if (found.status === "ABSENT") return null;
    if (found.status === "UNREADABLE") {
      throw journalError("DEV_TASK_JOURNAL_UNREADABLE", "Journal DEV illisible pour cette tâche.", {
        reason: found.code,
      });
    }
    return found.record;
  }

  function present(taskId) {
    const found = lookup(String(taskId ?? ""));
    if (found.status === "ABSENT") throw new Error("DEV_TASK_JOURNAL_MISSING");
    if (found.status === "UNREADABLE") {
      throw journalError("DEV_TASK_JOURNAL_UNREADABLE", "Journal DEV illisible pour cette tâche.", {
        reason: found.code,
      });
    }
    return found;
  }

  function mutate(taskId, update) {
    const { record, file } = present(taskId);
    // Anciens fichiers safeId : relus seulement, jamais réécrits.
    if (path.basename(file) !== hashedName(record.taskId)) {
      throw journalError("DEV_TASK_JOURNAL_LEGACY_READ_ONLY",
        "Ancien enregistrement du journal DEV en lecture seule.");
    }
    update(record);
    return replaceDurable(file, record);
  }

  function claim(taskId, meta = {}) {
    if (typeof taskId !== "string" || !taskId.trim()) {
      throw journalError("DEV_TASK_JOURNAL_ID_INVALID", "taskId DEV invalide pour le journal.");
    }
    const found = lookup(taskId);
    if (found.status === "PRESENT") {
      throw journalError("DEV_TASK_ALREADY_EXISTS", "Tâche DEV déjà présente dans le journal.");
    }
    if (found.status === "UNREADABLE") {
      throw journalError("DEV_TASK_JOURNAL_UNREADABLE", "Journal DEV illisible pour cette tâche.", {
        reason: found.code,
      });
    }
    const at = iso();
    return createExclusive(hashedPath(taskId), {
      schemaVersion: SCHEMA_VERSION,
      taskId,
      workspaceId: typeof meta.workspaceId === "string" ? meta.workspaceId.slice(0, 200) : null,
      executionMode: "NATIVE_NOON",
      source: String(meta.source || "UNKNOWN").slice(0, 40),
      state: "CLAIMED",
      iteration: 0,
      branch: null,
      filesRead: [],
      fileOperations: [],
      commands: [],
      phases: [{ state: "CLAIMED", at }],
      createdAt: at,
      updatedAt: at,
      finalVerdict: null,
      failureCategory: null,
    });
  }

  function start(contract, preflight) {
    const found = lookup(String(contract?.taskId ?? ""));
    if (found.status === "UNREADABLE") {
      throw journalError("DEV_TASK_JOURNAL_UNREADABLE", "Journal DEV illisible pour cette tâche.", {
        reason: found.code,
      });
    }
    const at = iso();
    if (found.status === "PRESENT") {
      if (found.record.state !== "CLAIMED" ||
          path.basename(found.file) !== hashedName(found.record.taskId)) {
        throw journalError("DEV_TASK_ALREADY_EXISTS", "Tâche DEV déjà présente dans le journal.");
      }
      // Suite d'un claim : même fichier, jamais d'écrasement d'un autre état.
      const record = found.record;
      record.workspaceId = contract.workspaceId;
      record.state = "PREFLIGHT";
      record.branch = preflight.branch;
      record.phases.push({ state: "CREATED", at });
      return replaceDurable(found.file, record);
    }
    return createExclusive(hashedPath(contract.taskId), {
      schemaVersion: SCHEMA_VERSION,
      taskId: contract.taskId, workspaceId: contract.workspaceId, executionMode: "NATIVE_NOON", state: "PREFLIGHT", iteration: 0,
      branch: preflight.branch, filesRead: [], fileOperations: [], commands: [], phases: [{ state: "CREATED", at }],
      createdAt: at, updatedAt: at, finalVerdict: null, failureCategory: null,
    });
  }

  function transition(taskId, state, details = {}) {
    return mutate(taskId, (record) => {
      record.state = state;
      record.iteration = Number(details.iteration ?? record.iteration) || 0;
      record.phases.push({ state, at: iso(), durationMs: Number(details.durationMs) || 0 });
    });
  }
  function read(taskId, relativePath, hash) {
    return mutate(taskId, (record) => {
      if (!record.filesRead.some((item) => item.path === relativePath && item.hash === hash)) {
        record.filesRead.push({ path: relativePath, hash });
      }
    });
  }
  function fileOperation(taskId, operation) {
    return mutate(taskId, (record) => {
      record.fileOperations.push({ type: operation.type, path: operation.path, status: operation.status, preHash: operation.preHash || null, postHash: operation.postHash || null, iteration: operation.iteration, at: iso() });
    });
  }
  function command(taskId, result, iteration) {
    return mutate(taskId, (record) => {
      record.commands.push({ command: result.command, status: result.status, exitCode: result.exitCode ?? null, signal: result.signal || null, durationMs: Number(result.durationMs) || 0, failureCategory: result.failureCategory || null, iteration });
    });
  }
  function finish(taskId, finalVerdict, failureCategory = null) {
    return mutate(taskId, (record) => {
      record.state = finalVerdict;
      record.finalVerdict = finalVerdict;
      record.failureCategory = failureCategory;
      record.completedAt = iso();
    });
  }

  // Tâches non terminales, plus les fichiers illisibles signalés explicitement.
  function interrupted() {
    const output = [];
    for (const name of fs.readdirSync(root).filter((item) => item.endsWith(".json")).sort()) {
      let record;
      try { record = JSON.parse(fs.readFileSync(path.join(root, name), "utf8")); } catch { record = null; }
      if (!record || typeof record !== "object" || typeof record.taskId !== "string") {
        output.push({ taskId: null, state: "UNREADABLE", unreadable: true, file: name });
      } else if (!TERMINAL.has(record.state)) {
        output.push(record);
      }
    }
    return output;
  }

  return {
    claim, lookup, start, load, transition,
    recordRead: read, recordFileOperation: fileOperation, recordCommand: command,
    finish, interrupted,
  };
}

module.exports = { SCHEMA_VERSION, TERMINAL_STATES: TERMINAL, createDevTaskJournal, hashedJournalName: hashedName, legacyJournalName: (taskId) => `${legacySafeId(taskId)}.json` };
