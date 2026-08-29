"use strict";

const fs = require("node:fs");
const path = require("node:path");
const STATES = Object.freeze(["PREPARING", "BACKING_UP", "MIGRATING", "VALIDATING", "ACTIVATING", "SUCCEEDED", "FAILED", "RECOVERING", "ROLLED_BACK"]);

function createUpdateJournal(filePath, { now = () => Date.now() } = {}) {
  function load() { try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return { updates: [], lastKnownGood: null }; } }
  function save(state) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); const temporary = `${filePath}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 }); fs.renameSync(temporary, filePath); }
  function begin(record) { const state = load(); if (state.updates.some((item) => !["SUCCEEDED", "FAILED", "ROLLED_BACK"].includes(item.state))) throw Object.assign(new Error("Une migration est déjà active."), { code: "MIGRATION_ACTIVE" }); const entry = { ...record, state: "PREPARING", migrationIds: [], startedAt: new Date(now()).toISOString(), completedAt: null, failure: null }; state.updates.unshift(entry); save(state); return structuredClone(entry); }
  function transition(updateId, nextState, patch = {}) { if (!STATES.includes(nextState)) throw new TypeError("État update invalide."); const state = load(); const entry = state.updates.find((item) => item.updateId === updateId); if (!entry) throw new Error("Update inconnue."); Object.assign(entry, patch, { state: nextState }); if (["SUCCEEDED", "FAILED", "ROLLED_BACK"].includes(nextState)) entry.completedAt = new Date(now()).toISOString(); save(state); return structuredClone(entry); }
  function markLastKnownGood(value) { const state = load(); state.lastKnownGood = { ...value, markedAt: new Date(now()).toISOString() }; save(state); return structuredClone(state.lastKnownGood); }
  function incomplete() { return load().updates.find((item) => !["SUCCEEDED", "FAILED", "ROLLED_BACK"].includes(item.state)) || null; }
  return { begin, incomplete, load, markLastKnownGood, transition, states: STATES };
}

module.exports = { STATES, createUpdateJournal };
