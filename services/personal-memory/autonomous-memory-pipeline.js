"use strict";

const { extractAutonomousMemoryCandidates } = require("./candidate-extractor");
const { normalizeForComparison, tokenSimilarity } = require("./document-memory-importer");

function emptyCounts() { return { created: 0, updated: 0, skipped: 0 }; }
function createReceipt({ automatic = true } = {}) { return { success: true, operation: "none", automatic, persisted: true, general: emptyCounts(), private: emptyCounts(), project: emptyCounts(), memoryIds: [], errors: 0 }; }
function candidateText(item) { return typeof item.value === "string" ? item.value : JSON.stringify(item.value || ""); }
function sameText(left, right) { return normalizeForComparison(left) === normalizeForComparison(right); }

function findGeneralMatch(repository, candidate) {
  const items = repository.listMemories({ limit: 500 }).filter((item) => item.status !== "rejected" && item.status !== "expired");
  return items.find((item) => item.metadata?.memoryKey === candidate.memoryKey) || items.find((item) => sameText(candidateText(item), candidate.statement)) || items.find((item) => item.type === candidate.category && tokenSimilarity(candidateText(item), candidate.statement) >= 0.72);
}

function findPrivateMatch(service, candidate) {
  const items = service.listMemories({ subjectId: candidate.subjectId, includeDeleted: false });
  return items.find((item) => item.payload?.memoryKey === candidate.memoryKey) || items.find((item) => item.category === candidate.category && sameText(item.statement, candidate.statement)) || items.find((item) => item.category === candidate.category && tokenSimilarity(item.statement, candidate.statement) >= 0.72);
}

function persistGeneral(repository, candidate, receipt) {
  if (!repository) throw new Error("GENERAL_MEMORY_UNAVAILABLE");
  const existing = findGeneralMatch(repository, candidate);
  if (existing && sameText(candidateText(existing), candidate.statement)) { receipt.general.skipped += 1; receipt.memoryIds.push(existing.id); return; }
  const now = new Date().toISOString();
  const allowedTypes = new Set(["identity_role", "objective", "decision", "work_preference"]);
  const requestedType = candidate.category === "preference" ? "work_preference" : candidate.category;
  const item = repository.upsertMemory({ ...(existing || {}), type: allowedTypes.has(requestedType) ? requestedType : "work_preference", subject: candidate.category === "preference" ? "Préférence personnelle" : "Information personnelle durable", value: candidate.statement, status: "confirmed", confidence: candidate.scores.confidence, explicitConfirmation: true, sensitivity: "normal", useAllowed: true, sourceType: candidate.sourceType, sourceReference: candidate.sourceReference, metadata: { ...(existing?.metadata || {}), memoryKey: candidate.memoryKey, stability: candidate.stability, automatic: true, profileId: "arnaud", observedAt: now, versions: existing ? [...(existing.metadata?.versions || []), { previousValue: existing.value, supersededAt: now }].slice(-10) : [] } });
  const verified = repository.getMemory(item.id);
  if (!verified || !sameText(candidateText(verified), candidate.statement)) throw new Error("MEMORY_READ_BACK_FAILED");
  receipt.general[existing ? "updated" : "created"] += 1; receipt.memoryIds.push(item.id);
}

function persistPrivate(service, candidate, receipt) {
  if (!service?.available) throw new Error("PRIVATE_MEMORY_UNAVAILABLE");
  const bucket = candidate.scope === "project" ? receipt.project : receipt.private;
  const existing = findPrivateMatch(service, candidate);
  if (existing && sameText(existing.statement, candidate.statement)) { bucket.skipped += 1; receipt.memoryIds.push(existing.id); return; }
  const payload = { ...(existing?.payload || {}), memoryKey: candidate.memoryKey, stability: candidate.stability, automatic: true, projectName: candidate.projectName || null, observedAt: new Date().toISOString() };
  const item = existing ? service.updateMemory(existing.id, { statement: candidate.statement, category: candidate.category, sensitivity: candidate.sensitivity, status: "confirmed", confidence: candidate.scores.confidence, consentStatus: "granted", apiPolicy: candidate.apiPolicy, payload }, "correction automatique vérifiée") : service.createMemory({ subjectId: candidate.subjectId, category: candidate.category, statement: candidate.statement, sensitivity: candidate.sensitivity, status: "confirmed", confidence: candidate.scores.confidence, consentStatus: "granted", apiPolicy: candidate.apiPolicy, sourceType: candidate.sourceType, sourceReference: candidate.sourceReference, tags: ["automatic-memory", candidate.stability], payload });
  const verified = item?.id ? service.getMemory(item.id) : null;
  if (!verified || !sameText(verified.statement, candidate.statement) || verified.apiPolicy !== candidate.apiPolicy) throw new Error("MEMORY_READ_BACK_FAILED");
  bucket[existing ? "updated" : "created"] += 1; receipt.memoryIds.push(item.id);
}

function notificationFor(receipt, projectName = null) {
  const general = receipt.general.created + receipt.general.updated, privateCount = receipt.private.created + receipt.private.updated, project = receipt.project.created + receipt.project.updated;
  if (!general && !privateCount && !project) return "";
  if (privateCount && (general || project)) return "J’ai aussi retenu quelques informations utiles ; les données sensibles ont été conservées uniquement dans ta mémoire privée locale.";
  if (privateCount) return "J’ai conservé cette information dans ta mémoire privée locale.";
  if (project) return `J’ai également retenu cette décision pour le projet ${projectName || "actif"}.`;
  return "J’ai aussi retenu cette information pour la suite.";
}

function createAutonomousMemoryPipeline({ personalRepository, privateMemoryService, audit = () => {} } = {}) {
  function process({ text = "", attachments = [], projectId = null, projectName = null } = {}) {
    const receipt = createReceipt();
    const candidates = extractAutonomousMemoryCandidates(text, { projectId, projectName, sourceType: "automatic-conversation" });
    for (const attachment of attachments) candidates.push(...extractAutonomousMemoryCandidates(String(attachment.extractedText || attachment.content || ""), { projectId, projectName, sourceType: "automatic-document", sourceReference: attachment.filename || attachment.name || null }));
    const unique = candidates.filter((candidate, index, list) => list.findIndex((item) => item.memoryKey === candidate.memoryKey && sameText(item.statement, candidate.statement)) === index);
    for (const candidate of unique) {
      try {
        audit("memory.candidate", { detected: true, category: candidate.category, classification: candidate.scope, automatic: true });
        if (candidate.scope === "general") persistGeneral(personalRepository, candidate, receipt); else persistPrivate(privateMemoryService, candidate, receipt);
      } catch (error) {
        receipt.success = false; receipt.persisted = false; receipt.errors += 1;
        audit("memory.write", { success: false, automatic: true, code: String(error?.code || error?.message || "ERROR").slice(0, 80) });
      }
    }
    const changed = [receipt.general, receipt.private, receipt.project].reduce((sum, item) => sum + item.created + item.updated, 0);
    receipt.operation = changed ? "upsert" : "none";
    receipt.success = receipt.errors === 0; receipt.persisted = receipt.errors === 0;
    const notification = receipt.success
      ? notificationFor(receipt, projectName)
      : unique.length > 0 ? "La mise à jour de ma mémoire persistante a échoué." : "";
    audit("memory.write", { success: receipt.success, automatic: true, created: receipt.general.created + receipt.private.created + receipt.project.created, updated: receipt.general.updated + receipt.private.updated + receipt.project.updated });
    return { candidates: unique, receipt, notification };
  }
  return { process };
}

module.exports = { createAutonomousMemoryPipeline, createReceipt, notificationFor };
