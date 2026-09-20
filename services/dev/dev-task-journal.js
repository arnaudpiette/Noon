"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const TERMINAL = new Set(["PASS", "PARTIAL", "FAIL", "CANCELLED", "TIMEOUT"]);
function safeId(value) { return String(value || "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 160); }
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function createDevTaskJournal({ directory, now = () => Date.now() } = {}) {
  if (!directory) throw new TypeError("Répertoire de journal DEV requis.");
  const root = path.resolve(directory); fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const recordPath = (taskId) => path.join(root, `${safeId(taskId)}.json`);
  const load = (taskId) => { try { return JSON.parse(fs.readFileSync(recordPath(taskId), "utf8")); } catch { return null; } };
  function save(record) { record.updatedAt = new Date(now()).toISOString(); atomicJson(recordPath(record.taskId), record); return record; }
  function start(contract, preflight) {
    return save({ taskId: contract.taskId, workspaceId: contract.workspaceId, executionMode: "NATIVE_NOON", state: "PREFLIGHT", iteration: 0,
      branch: preflight.branch, filesRead: [], fileOperations: [], commands: [], phases: [{ state: "CREATED", at: new Date(now()).toISOString() }],
      createdAt: new Date(now()).toISOString(), finalVerdict: null, failureCategory: null });
  }
  function transition(taskId, state, details = {}) { const record = load(taskId); if (!record) throw new Error("DEV_TASK_JOURNAL_MISSING"); record.state = state; record.iteration = Number(details.iteration ?? record.iteration) || 0; record.phases.push({ state, at: new Date(now()).toISOString(), durationMs: Number(details.durationMs) || 0 }); return save(record); }
  function read(taskId, relativePath, hash) { const record = load(taskId); if (!record) throw new Error("DEV_TASK_JOURNAL_MISSING"); if (!record.filesRead.some((item) => item.path === relativePath && item.hash === hash)) record.filesRead.push({ path: relativePath, hash }); return save(record); }
  function fileOperation(taskId, operation) { const record = load(taskId); if (!record) throw new Error("DEV_TASK_JOURNAL_MISSING"); record.fileOperations.push({ type: operation.type, path: operation.path, status: operation.status, preHash: operation.preHash || null, postHash: operation.postHash || null, iteration: operation.iteration, at: new Date(now()).toISOString() }); return save(record); }
  function command(taskId, result, iteration) { const record = load(taskId); if (!record) throw new Error("DEV_TASK_JOURNAL_MISSING"); record.commands.push({ command: result.command, status: result.status, exitCode: result.exitCode ?? null, signal: result.signal || null, durationMs: Number(result.durationMs) || 0, failureCategory: result.failureCategory || null, iteration }); return save(record); }
  function finish(taskId, finalVerdict, failureCategory = null) { const record = load(taskId); if (!record) throw new Error("DEV_TASK_JOURNAL_MISSING"); record.state = finalVerdict; record.finalVerdict = finalVerdict; record.failureCategory = failureCategory; record.completedAt = new Date(now()).toISOString(); return save(record); }
  function interrupted() { return fs.readdirSync(root).filter((name) => name.endsWith(".json")).map((name) => load(name.slice(0, -5))).filter((item) => item && !TERMINAL.has(item.state)); }
  return { start, load, transition, recordRead: read, recordFileOperation: fileOperation, recordCommand: command, finish, interrupted };
}

module.exports = { createDevTaskJournal };
