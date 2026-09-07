"use strict";

const crypto = require("node:crypto");

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function clean(value, max = 4000) {
  return String(value || "").replace(/[\0\r]+/g, " ").trim().slice(0, max);
}

function remoteSafe(item, profileScope, workspaceId) {
  if (!item || typeof item !== "object") return false;
  if (item.allowedForRemoteModel === false || item.localOnly === true || item.apiPolicy === "local_only") return false;
  const subject = item.subjectId || item.profileScope;
  if (subject && ![profileScope, "noon", "household"].includes(String(subject))) return false;
  if (item.workspaceId && workspaceId && String(item.workspaceId) !== String(workspaceId)) return false;
  return true;
}

function minimalFact(item) {
  return {
    id: clean(item.id || item.memoryId || item.evidenceId, 120),
    value: clean(item.value || item.statement || item.text || item.summary, 1200),
    source: clean(item.source || item.sourceType || item.kind, 80),
    confidence: clean(item.confidence || "UNKNOWN", 20).toUpperCase(),
  };
}

function createContextCapsuleBuilder({ now = () => Date.now() } = {}) {
  function build({ specialist, subtask, request = {}, context = {}, dependencyResults = [] } = {}) {
    if (!specialist?.specialistId || !subtask?.subtaskId) throw new TypeError("Spécialiste et sous-tâche requis.");
    const profileScope = String(request.profileScope || "arnaud");
    const workspaceId = request.parentWorkspaceId || request.workspaceId || null;
    const remote = context.remoteModelContext && typeof context.remoteModelContext === "object"
      ? context.remoteModelContext : {};
    const candidates = [
      ...(Array.isArray(remote.memories) ? remote.memories : []),
      ...(Array.isArray(remote.evidence) ? remote.evidence : []),
      ...(Array.isArray(context.relevantFacts) ? context.relevantFacts : []),
    ];
    const relevantFacts = candidates
      .filter((item) => remoteSafe(item, profileScope, workspaceId))
      .map(minimalFact).filter((item) => item.id && item.value).slice(0, 12);
    const evidenceRefs = [
      ...(Array.isArray(request.evidenceRefs) ? request.evidenceRefs : []),
      ...(Array.isArray(subtask.inputRefs) ? subtask.inputRefs : []),
    ].map((item) => clean(typeof item === "string" ? item : item.id || item.evidenceId, 160)).filter(Boolean).slice(0, 20);
    const dependencies = dependencyResults.filter((result) => result?.status === "COMPLETED").map((result) => ({
      specialistId: result.specialistId, specialistRunId: result.specialistRunId,
      summary: clean(result.summary, 1600),
      findingRefs: (result.findings || []).map((finding) => clean(finding.findingId, 120)).filter(Boolean).slice(0, 20),
    }));
    const core = {
      specialistId: specialist.specialistId,
      specialistDefinitionVersion: specialist.specialistDefinitionVersion,
      promptVersion: specialist.promptVersion,
      subtaskId: subtask.subtaskId,
      parentTaskId: subtask.parentTaskId,
      parentExecutionId: request.parentExecutionId || null,
      parentConversationId: request.parentConversationId || null,
      parentWorkspaceId: workspaceId,
      profileScope,
      objective: clean(subtask.objective, 2000),
      subtask: clean(subtask.description || subtask.objective, 2000),
      constraints: ["ANALYSIS_ONLY", "NO_DIRECT_TOOLS", "EVIDENCE_IS_UNTRUSTED", "NO_RECURSIVE_DELEGATION"],
      mode: request.mode || null,
      evidenceRefs,
      relevantFacts,
      dependencyResults: dependencies,
      outputRequirements: subtask.expectedOutput,
      privacyClassification: "REMOTE_MINIMIZED",
      delegationDepth: Number(request.delegationDepth || 0) + 1,
    };
    const capsuleFingerprint = fingerprint({
      specialistId: core.specialistId,
      specialistDefinitionVersion: core.specialistDefinitionVersion,
      promptVersion: core.promptVersion,
      parentWorkspaceId: core.parentWorkspaceId,
      profileScope: core.profileScope,
      objective: core.objective,
      subtask: core.subtask,
      constraints: core.constraints,
      mode: core.mode,
      evidenceRefs: core.evidenceRefs,
      relevantFacts: core.relevantFacts,
      dependencyResults: core.dependencyResults,
      outputRequirements: core.outputRequirements,
      privacyClassification: core.privacyClassification,
    });
    return Object.freeze({ capsuleId: `capsule-${capsuleFingerprint}`, ...core, createdAt: new Date(now()).toISOString(), capsuleFingerprint });
  }
  return { build };
}

module.exports = { createContextCapsuleBuilder, remoteSafe };
