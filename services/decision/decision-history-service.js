"use strict";

const crypto = require("node:crypto");

function createDecisionHistoryService({ repository = null, now = () => new Date() } = {}) {
  const records = new Map();
  const put = (record) => repository?.save ? repository.save(record) : (records.set(record.decisionRecordId, structuredClone(record)), record);
  const all = () => repository?.list ? repository.list() : [...records.values()].map((item) => structuredClone(item));
  function recordChoice(input = {}) {
    if (input.userConfirmed !== true) throw Object.assign(new Error("Choix explicite requis."), { code: "DECISION_CONFIRMATION_REQUIRED" });
    const previous = input.supersedesDecisionRecordId ? get(input.supersedesDecisionRecordId, input) : null;
    const record = { decisionRecordId: input.decisionRecordId || `decision_record_${crypto.randomUUID()}`, decisionId: String(input.decisionId),
      chosenOptionId: String(input.chosenOptionId), decidedAt: now().toISOString(), workspaceId: input.workspaceId || null,
      projectId: input.projectId || null, profileScope: input.profileScope || "arnaud", userConfirmed: true,
      keyCriteria: (input.keyCriteria || []).map(String).slice(0, 20), rationaleSummary: input.rationaleSummary ? String(input.rationaleSummary).slice(0, 1200) : null,
      evidenceRefs: (input.evidenceRefs || []).map(String).slice(0, 100), supersedesDecisionRecordId: previous?.decisionRecordId || null,
      status: "ACTIVE", memoryPreferenceCreated: false };
    if (previous) put({ ...previous, status: "SUPERSEDED", supersededAt: record.decidedAt });
    put(record); return structuredClone(record);
  }
  function get(id, scope = {}) { const found = all().find((item) => item.decisionRecordId === id); if (!found) return null;
    if (scope.workspaceId && found.workspaceId !== scope.workspaceId) return null; if (scope.profileScope && found.profileScope !== scope.profileScope) return null; return found; }
  function list(scope = {}) { return all().filter((item) => (!scope.workspaceId || item.workspaceId === scope.workspaceId) && (!scope.profileScope || item.profileScope === scope.profileScope)); }
  function markStale(id, reasonCode) { const found = get(id); if (!found) return null; return put({ ...found, status: "REVIEW_NEEDED", staleReasonCode: reasonCode, staleAt: now().toISOString() }); }
  return { get, list, markStale, recordChoice };
}

module.exports = { createDecisionHistoryService };
