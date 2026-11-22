"use strict";

const { extractAutonomousMemoryCandidates } = require("./candidate-extractor");
const { normalizeForComparison, tokenSimilarity } = require("./document-memory-importer");

function emptyCounts() { return { created: 0, updated: 0, skipped: 0 }; }

const GENERAL_MEMORY_TYPE_BY_CATEGORY = Object.freeze({
  preference: "work_preference",
  identity_role: "identity_role",
  objective: "objective",
  habit: "observed_habit",
  decision: "decision",
  tooling: "tooling",
});
function createReceipt({ automatic = true } = {}) { return { success: true, operation: "none", automatic, persisted: true, general: emptyCounts(), private: emptyCounts(), project: emptyCounts(), categories: { general: {}, private: {}, project: {} }, memoryIds: [], errors: 0 }; }

// Libellés des catégories dans le compte-rendu (jamais le contenu des souvenirs).
const CATEGORY_LABELS = Object.freeze({
  preference: "préférences", identity_role: "rôle professionnel", objective: "objectifs", habit: "habitudes",
  decision: "décisions", tooling: "outils", identity: "identité", family_child: "enfants",
  family_relationship: "relations familiales", address: "adresse", health: "santé", finance: "finances",
  legal: "justice", contact: "coordonnées",
});
function countCategory(receipt, bucketName, category) {
  const bucket = receipt.categories[bucketName];
  const key = String(category || "autre");
  bucket[key] = (bucket[key] || 0) + 1;
}
function candidateText(item) { return typeof item.value === "string" ? item.value : JSON.stringify(item.value || ""); }
function sameText(left, right) { return normalizeForComparison(left) === normalizeForComparison(right); }

function findGeneralMatch(repository, candidate) {
  const profileId = candidate.subjectId || "arnaud";
  const expectedType = GENERAL_MEMORY_TYPE_BY_CATEGORY[candidate.category];

  const items = repository
    .listMemories({ limit: 500 })
    .filter(
      (item) =>
        item.status !== "rejected"
        && item.status !== "expired"
        && (item.metadata?.profileId || "arnaud") === profileId
    );

  return items.find(
    (item) => item.metadata?.memoryKey === candidate.memoryKey
  ) || items.find(
    (item) => sameText(candidateText(item), candidate.statement)
  ) || items.find(
    (item) =>
      item.type === expectedType
      && tokenSimilarity(candidateText(item), candidate.statement) >= 0.72
  );
}

function findPrivateMatch(service, candidate) {
  const items = service.listMemories({
    subjectId: candidate.subjectId,
    includeDeleted: false,
  });

  const exact = items.find(
    (item) =>
      item.category === candidate.category
      && sameText(item.statement, candidate.statement)
  );

  if (exact) return exact;

  // Les mémoires projet utilisent volontairement une clé de slot
  // (ex. voix par défaut) afin qu'une nouvelle décision remplace l'ancienne.
  if (candidate.scope === "project") {
    const keyed = items.find(
      (item) => item.payload?.memoryKey === candidate.memoryKey
    );

    if (keyed) return keyed;
  }

  // Une donnée réellement évolutive peut remplacer sa version précédente,
  // mais uniquement si le contenu reste suffisamment proche.
  if (candidate.stability === "evolving") {
    let best = null;
    let bestScore = 0;

    for (const item of items) {
      if (item.category !== candidate.category) continue;

      const score = tokenSimilarity(item.statement, candidate.statement);

      if (score > 0.65 && score > bestScore) {
        best = item;
        bestScore = score;
      }
    }

    return best;
  }

  // Deux faits privés stables d'une même catégorie doivent pouvoir coexister.
  return null;
}

function persistGeneral(repository, candidate, receipt) {
  if (!repository) throw new Error("GENERAL_MEMORY_UNAVAILABLE");
  const existing = findGeneralMatch(repository, candidate);
  if (existing && sameText(candidateText(existing), candidate.statement)) { receipt.general.skipped += 1; receipt.memoryIds.push(existing.id); return; }
  const now = new Date().toISOString();
  const requestedType = GENERAL_MEMORY_TYPE_BY_CATEGORY[candidate.category];
  if (!requestedType) {
    throw Object.assign(
      new Error("Type de mémoire générale non supporté."),
      { code: "UNSUPPORTED_GENERAL_MEMORY_TYPE" }
    );
  }

  const item = repository.upsertMemory({ ...(existing || {}), type: requestedType, subject: candidate.category === "preference" ? "Préférence personnelle" : "Information personnelle durable", value: candidate.statement, status: "confirmed", confidence: candidate.scores.confidence, explicitConfirmation: true, sensitivity: "normal", useAllowed: true, sourceType: candidate.sourceType, sourceReference: candidate.sourceReference, metadata: { ...(existing?.metadata || {}), memoryKey: candidate.memoryKey, stability: candidate.stability, automatic: true, profileId: candidate.subjectId || "arnaud", observedAt: now, versions: existing ? [...(existing.metadata?.versions || []), { previousValue: existing.value, supersededAt: now }].slice(-10) : [] } });
  const verified = repository.getMemory(item.id);
  if (!verified || !sameText(candidateText(verified), candidate.statement)) throw new Error("MEMORY_READ_BACK_FAILED");
  receipt.general[existing ? "updated" : "created"] += 1; receipt.memoryIds.push(item.id);
  countCategory(receipt, "general", candidate.category);
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
  countCategory(receipt, candidate.scope === "project" ? "project" : "private", candidate.category);
}

// Compte-rendu factuel de ce qui a réellement été écrit, par destination et par catégorie.
// Il est ajouté après la réponse du modèle, qui ne voit pas cette mémorisation : le libellé le
// dit, pour ne pas contredire une réponse du type « je ne peux pas enregistrer ».
function describeCategories(categories = {}) {
  return Object.entries(categories).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, count]) => `${CATEGORY_LABELS[category] || category.replace(/_/g, " ")} ${count}`).join(", ");
}

function notificationFor(receipt, projectName = null) {
  const totals = {
    general: receipt.general.created + receipt.general.updated,
    private: receipt.private.created + receipt.private.updated,
    project: receipt.project.created + receipt.project.updated,
  };
  const total = totals.general + totals.private + totals.project;
  if (!total) return "";
  const created = receipt.general.created + receipt.private.created + receipt.project.created;
  const updated = receipt.general.updated + receipt.private.updated + receipt.project.updated;
  const categories = receipt.categories || { general: {}, private: {}, project: {} };
  const plural = (count, word) => `${count} ${word}${count > 1 ? "s" : ""}`;
  const lines = [`Mémorisation automatique de Noon (faite après cette réponse) : ${plural(total, "élément")} enregistré${total > 1 ? "s" : ""} — ${created} nouveau${created > 1 ? "x" : ""}, ${updated} mis à jour.`];
  const detail = (count, label, bucket) => {
    if (!count) return;
    const list = describeCategories(categories[bucket]);
    lines.push(`• ${label} : ${count}${list ? ` (${list})` : ""}`);
  };
  detail(totals.general, "Mémoire générale", "general");
  detail(totals.private, "Mémoire privée locale (chiffrée)", "private");
  detail(totals.project, `Projet ${projectName || "actif"}`, "project");
  lines.push("Tu peux les relire, corriger ou oublier dans Mémoire.");
  return lines.join("\n");
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
      : unique.length > 0 ? "Mémorisation automatique de Noon : la mise à jour de ma mémoire persistante a échoué." : "";
    audit("memory.write", { success: receipt.success, automatic: true, created: receipt.general.created + receipt.private.created + receipt.project.created, updated: receipt.general.updated + receipt.private.updated + receipt.project.updated });
    return { candidates: unique, receipt, notification };
  }
  return { process };
}

module.exports = { createAutonomousMemoryPipeline, createReceipt, notificationFor };
