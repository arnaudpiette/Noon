"use strict";

const SPECIALIST_DEFINITION_VERSION = "1.0.0";

const DEFINITIONS = Object.freeze([
  { specialistId: "DEV", name: "DEV Specialist", description: "Code, architecture, debugging, tests et plans d’implémentation.", capabilities: ["code_analysis", "architecture_review", "debugging", "implementation_plan"], requiredCapabilities: ["TEXT", "STRUCTURED_OUTPUT"], acceptsEvidence: ["code", "project"], canProduceArtifactPlan: false },
  { specialistId: "DA", name: "DA Specialist", description: "Direction artistique, identité, UX/UI, composition et cohérence graphique.", capabilities: ["visual_analysis", "art_direction", "ux_review"], requiredCapabilities: ["TEXT", "STRUCTURED_OUTPUT"], acceptsEvidence: ["multimodal", "design"], canProduceArtifactPlan: true },
  { specialistId: "RESEARCH", name: "Research Specialist", description: "Planification de recherche et analyse d’Evidence Packs existants.", capabilities: ["research_planning", "evidence_analysis", "source_gaps"], requiredCapabilities: ["TEXT", "STRUCTURED_OUTPUT"], acceptsEvidence: ["public_research", "personal_search"], canProduceArtifactPlan: false },
  { specialistId: "DOCUMENT", name: "Document Specialist", description: "Structure, rédaction et organisation de contenus avant ArtifactEngine.", capabilities: ["document_structure", "content_adaptation", "presentation_plan"], requiredCapabilities: ["TEXT", "STRUCTURED_OUTPUT"], acceptsEvidence: ["specialist_result", "document"], canProduceArtifactPlan: true },
  { specialistId: "ANALYSIS", name: "Analysis Specialist", description: "Comparaison complexe, diagnostic multi-source et analyse stratégique.", capabilities: ["cross_source_analysis", "strategic_diagnosis", "comparison"], requiredCapabilities: ["TEXT", "STRUCTURED_OUTPUT"], acceptsEvidence: ["evidence_pack"], canProduceArtifactPlan: false },
].map((definition) => Object.freeze({
  ...definition,
  specialistDefinitionVersion: SPECIALIST_DEFINITION_VERSION,
  promptVersion: "bounded-specialist-1",
  executionBackend: definition.specialistId === "DEV" ? "MODEL_OR_CODEX_ADAPTER" : "MODEL",
  authority: "ANALYSIS_ONLY",
  allowedDelegatedOperations: Object.freeze([]),
  defaultBudgetProfile: "standard",
  capabilities: Object.freeze([...definition.capabilities]),
  requiredCapabilities: Object.freeze([...definition.requiredCapabilities]),
  acceptsEvidence: Object.freeze([...definition.acceptsEvidence]),
})));

function createSpecialistRegistry(definitions = DEFINITIONS) {
  const specialists = new Map();
  for (const definition of definitions) {
    if (!definition?.specialistId || specialists.has(definition.specialistId)) {
      throw new TypeError(`Spécialiste invalide : ${definition?.specialistId || "missing"}`);
    }
    if (definition.authority !== "ANALYSIS_ONLY" || definition.allowedDelegatedOperations?.length) {
      throw new TypeError(`Autorité spécialiste interdite : ${definition.specialistId}`);
    }
    specialists.set(definition.specialistId, Object.freeze({ ...definition }));
  }
  return {
    get(id) { return specialists.get(String(id).toUpperCase()) || null; },
    list() { return [...specialists.values()]; },
    has(id) { return specialists.has(String(id).toUpperCase()); },
    version: SPECIALIST_DEFINITION_VERSION,
  };
}

module.exports = { DEFINITIONS, SPECIALIST_DEFINITION_VERSION, createSpecialistRegistry };
