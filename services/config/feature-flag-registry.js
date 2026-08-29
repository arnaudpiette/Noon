"use strict";

const FEATURE_FLAG_SCHEMA_VERSION = 1;
const FLAG_MODES = Object.freeze(["OFF", "SHADOW", "LIMITED", "ON"]);
const FLAG_LIFECYCLES = Object.freeze(["EXPERIMENTAL", "ROLLOUT", "STABLE", "DEPRECATED", "REMOVED"]);

const FEATURE_FLAGS = Object.freeze([
  { flagId: "router.policy.v2", description: "Routage déterministe Luna / Terra / Sol", owner: "routing", defaultMode: "ON", allowedModes: FLAG_MODES, scopes: ["GLOBAL", "WORKSPACE", "SESSION"], lifecycle: "STABLE", createdAt: "2026-08-01", reviewAfter: "2026-11-01", requires: [], incompatibleWith: [], rollbackSafe: true, migrationDependencies: [], legacyPath: "selectLegacyModelRoute", newPath: "selectModelRoute", killSwitchAllowed: true },
  { flagId: "search.unified", description: "PersonalSearchEngine unifié", owner: "search", defaultMode: "OFF", allowedModes: FLAG_MODES, scopes: ["GLOBAL", "WORKSPACE"], lifecycle: "EXPERIMENTAL", createdAt: "2026-08-29", reviewAfter: "2026-10-01", requires: [], incompatibleWith: [], rollbackSafe: true, migrationDependencies: [], legacyPath: "legacy search adapters", newPath: "PersonalSearchEngine", killSwitchAllowed: true },
  { flagId: "intent.engine.v2", description: "Moteur unifié d’intentions", owner: "intent", defaultMode: "OFF", allowedModes: FLAG_MODES, scopes: ["GLOBAL", "WORKSPACE"], lifecycle: "EXPERIMENTAL", createdAt: "2026-08-29", reviewAfter: "2026-10-01", requires: [], incompatibleWith: [], rollbackSafe: true, migrationDependencies: [], legacyPath: "legacy intent parser", newPath: "IntentCommandEngine", killSwitchAllowed: true },
  { flagId: "execution.transactional.files", description: "Exécution transactionnelle des fichiers", owner: "execution", defaultMode: "OFF", allowedModes: FLAG_MODES, scopes: ["GLOBAL", "WORKSPACE"], lifecycle: "EXPERIMENTAL", createdAt: "2026-08-29", reviewAfter: "2026-10-01", requires: [], incompatibleWith: [], rollbackSafe: true, migrationDependencies: ["execution_schema_v10"], legacyPath: "direct file execution", newPath: "TransactionalExecutionEngine", killSwitchAllowed: true },
  { flagId: "research.public.v1", description: "Recherche Internet publique avec fraîcheur et citations", owner: "research", defaultMode: "ON", allowedModes: FLAG_MODES, scopes: ["GLOBAL", "WORKSPACE", "SESSION"], lifecycle: "ROLLOUT", createdAt: "2026-08-29", reviewAfter: "2026-10-15", requires: [], incompatibleWith: [], rollbackSafe: true, migrationDependencies: [], legacyPath: "direct Responses web_search", newPath: "PublicResearchEngine", killSwitchAllowed: true },
  { flagId: "research.mixed", description: "Fusion Personal Search et Public Research sous frontière privée", owner: "research", defaultMode: "OFF", allowedModes: FLAG_MODES, scopes: ["GLOBAL", "WORKSPACE", "SESSION"], lifecycle: "EXPERIMENTAL", createdAt: "2026-08-29", reviewAfter: "2026-10-15", requires: ["research.public.v1"], incompatibleWith: [], rollbackSafe: true, migrationDependencies: [], legacyPath: "manual mixed tool use", newPath: "PublicResearchEngine + PersonalSearchEngine", killSwitchAllowed: true },
  { flagId: "multimodal.unified", description: "Façade multimodale unifiée pour images, PDF et audio", owner: "multimodal", defaultMode: "ON", allowedModes: FLAG_MODES, scopes: ["GLOBAL", "WORKSPACE", "SESSION"], lifecycle: "ROLLOUT", createdAt: "2026-08-30", reviewAfter: "2026-10-30", requires: [], incompatibleWith: [], rollbackSafe: true, migrationDependencies: [], legacyPath: "direct attachment blocks", newPath: "MultimodalEngine", killSwitchAllowed: true },
  { flagId: "multimodal.pdfHybrid", description: "Sélection hybride texte/Vision pour PDF", owner: "multimodal", defaultMode: "LIMITED", allowedModes: FLAG_MODES, scopes: ["GLOBAL", "WORKSPACE", "SESSION"], lifecycle: "EXPERIMENTAL", createdAt: "2026-08-30", reviewAfter: "2026-10-30", requires: ["multimodal.unified"], incompatibleWith: [], rollbackSafe: true, migrationDependencies: [], legacyPath: "direct PDF input", newPath: "MultimodalEngine strategy selector", killSwitchAllowed: true },
]);

function createFeatureFlagRegistry(definitions = FEATURE_FLAGS) {
  const flags = new Map();
  for (const definition of definitions) {
    if (!definition?.flagId || flags.has(definition.flagId)) throw new TypeError(`Feature flag invalide : ${definition?.flagId || "missing"}`);
    if (!FLAG_MODES.includes(definition.defaultMode) || !FLAG_LIFECYCLES.includes(definition.lifecycle)) throw new TypeError(`Mode ou lifecycle invalide : ${definition.flagId}`);
    flags.set(definition.flagId, Object.freeze({ ...definition, allowedModes: Object.freeze([...definition.allowedModes]) }));
  }
  for (const flag of flags.values()) {
    for (const required of flag.requires) if (!flags.has(required)) throw new TypeError(`Dépendance inconnue ${required}`);
    for (const incompatible of flag.incompatibleWith) if (!flags.has(incompatible)) throw new TypeError(`Incompatibilité inconnue ${incompatible}`);
  }
  function get(flagId) { const flag = flags.get(flagId); if (!flag) throw Object.assign(new Error(`Feature flag inconnu : ${flagId}`), { code: "FLAG_UNKNOWN" }); return flag; }
  return { get, has: (id) => flags.has(id), list: () => [...flags.values()], schemaVersion: FEATURE_FLAG_SCHEMA_VERSION };
}

module.exports = { FEATURE_FLAGS, FEATURE_FLAG_SCHEMA_VERSION, FLAG_LIFECYCLES, FLAG_MODES, createFeatureFlagRegistry };
