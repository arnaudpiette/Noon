"use strict";

const { createHardRulesRegistry } = require("../rules/hard-rules-registry");

// Ces lignes restent enregistrées pour préserver les anciennes données et
// écrans. Leur définition canonique vit dans le Hard Rules Registry.
const PERMANENT_RULES = Object.freeze(
  createHardRulesRegistry().legacyOperationalRules()
);

function createOperationalProfileService(repository) {
  function ensurePermanentRules() {
    for (const rule of PERMANENT_RULES) repository.upsertMemory({
      id: `rule-${Buffer.from(rule).toString("base64url").slice(0, 36)}`,
      type: "permanent_constraint", subject: rule, value: { rule },
      sourceType: "explicit-user-instruction", sourceReference: "product-requirements",
      status: "confirmed", confidence: 1, useAllowed: true,
      lastConfirmedAt: new Date().toISOString(), metadata: { immutableOrigin: true },
    });
    return PERMANENT_RULES.length;
  }
  function portrait() {
    const items = repository.listMemories({ limit: 500 });
    return {
      permanentRules: items.filter((x) => x.type === "permanent_constraint" && x.status === "confirmed"),
      confirmedPreferences: items.filter((x) => x.type === "work_preference" && x.status === "confirmed"),
      inferredPreferences: items.filter((x) => x.type === "work_preference" && x.status === "inferred"),
      temporaryConstraints: items.filter((x) => x.status === "temporary"),
      objectives: items.filter((x) => x.type === "objective"),
      observedHabits: items.filter((x) => x.type === "observed_habit"),
      autonomyLimits: items.filter((x) => x.type === "permanent_constraint" && /aucun|sans ordre|validation/i.test(x.subject)),
    };
  }
  function proposePreference({ subject, value, confidence = 0.55, sourceReference = null }) {
    return repository.upsertMemory({ type: "work_preference", subject, value, sourceType: "observed-behavior", sourceReference, status: "inferred", confidence, useAllowed: true, metadata: { needsConfirmation: true } });
  }
  function respondToInference(id, action, value = null, expiresAt = null) {
    if (action === "confirm") return repository.confirmMemory(id);
    if (action === "correct") return repository.updateMemory(id, { value, status: "confirmed", confidence: 1, explicitConfirmation: true });
    if (action === "temporary") return repository.updateMemory(id, { value: value ?? repository.getMemory(id)?.value, status: "temporary", expiresAt, confidence: 1 });
    if (action === "reject") return repository.forgetMemory(id);
    if (action === "block") return repository.blockMemory(id);
    throw new Error("Réponse de préférence inconnue.");
  }
  return { ensurePermanentRules, portrait, proposePreference, respondToInference };
}

module.exports = { PERMANENT_RULES, createOperationalProfileService };
