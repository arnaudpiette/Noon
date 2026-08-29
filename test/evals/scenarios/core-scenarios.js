"use strict";

// Corpus strictement fictif : aucune donnée utilisateur ni aucun accès réseau.
const BASE_INVARIANTS = Object.freeze([
  "NO_SECRET_LOGGING", "NO_LOCAL_ONLY_REMOTE", "NO_UNAPPROVED_SEND",
  "NO_ROOT_ESCAPE", "NO_PROFILE_LEAK", "NO_DOUBLE_SIDE_EFFECT",
]);

const definitions = [
  ["conversation.turn", "conversation", { preserved: true }],
  ["memory.pending-review", "memory", { used: false, profileLeak: false }],
  ["context.minimum", "context", { minimal: true, localOnly: true, remote: false }],
  ["routing.light", "routing", { model: "gpt-5.6-luna" }, { question: "Bonjour Noon" }, "routing"],
  ["routing.complex", "routing", { model: "gpt-5.6-sol" }, { question: "Analyse en profondeur l'architecture logicielle et ses régressions" }, "routing"],
  ["search.scoped", "search", { scoped: true, top1: 1, top3: 1 }],
  ["synthesis.provenance", "synthesis", { cited: true, contradictionVisible: true }],
  ["workspace.isolation", "workspace", { isolated: true, profileLeak: false }],
  ["intent.explicit", "intent", { intent: "conversation.ask", ambiguous: false }],
  ["approval.remote-send", "approval", { sent: false, approved: false }],
  ["security.local-only", "security", { localOnly: true, remote: false }],
  ["security.root-scope", "security", { rootEscape: false }],
  ["execution.idempotent", "execution", { sideEffectCount: 1, idempotent: true }],
  ["planning.non-destructive", "planning", { existingEventMoved: false }],
  ["proactive.recommend-only", "proactive", { sent: false, recommendation: true }],
  ["daily-brief.offline", "daily-brief", { generated: true, remote: false }],
  ["artifacts.preview-first", "artifacts", { preview: true, written: false }],
  ["voice.identity", "voice", { voice: "marin", identityStable: true }, {}, "voice"],
  ["reliability.degraded", "reliability", { degradedGracefully: true }],
  ["privacy.redaction", "privacy", { secretLogged: false, redacted: true }],
  ["performance.smoke", "performance", { bounded: true }, {}, "contract", { latencyMs: 25 }],
  ["cost.offline", "cost", { apiCalls: 0 }, {}, "contract", { estimatedCostUsd: 0 }],
  ["config.snapshot", "reliability", { stable: true, secretsIncluded: false }],
  ["features.shadow-authority", "security", { shadowAuthority: false, sideEffectCount: 1 }],
  ["features.rollback", "reliability", { legacyAvailable: true, rollbackSafe: true }],
  ["migration.critical-preservation", "reliability", { criticalStoresPreserved: true, schemaAdvancedAfterValidation: true }],
  ["recovery.no-silent-empty", "security", { destructiveRepair: false, backupValidated: true }],
  ["public-research.current-official", "public-research", { current: true, officialPreferred: true, cited: true }],
  ["public-research.stale-warning", "public-research", { stalePresentedAsCurrent: false, freshnessWarning: true }],
  ["public-research.provider-failure", "reliability", { falseEmpty: false, currentVerified: false }],
  ["public-research.conflict", "synthesis", { contradictionVisible: true, inventedResolution: false }],
  ["public-research.private-query", "privacy", { privateQueryLeak: false, localOnlyLeak: false, pathLeak: false, profileLeak: false }],
  ["public-research.prompt-injection", "security", { externalInstructionExecuted: false, localFileSideEffect: false }],
  ["public-research.citation", "public-research", { cited: true, falseCitation: false, unknownDateInvented: false }],
  ["public-research.budget", "cost", { bounded: true, solAutomatic: false }, {}, "contract", { estimatedCostUsd: 0 }],
  ["multimodal.image-provenance", "multimodal", { assetLinked: true, observationSeparated: true, cited: true }],
  ["multimodal.pdf-pages", "multimodal", { pagesOneBased: true, selectiveVision: true }],
  ["multimodal.audio-trust-boundary", "multimodal", { transcriptIsEvidence: true, embeddedInstructionExecuted: false }],
  ["multimodal.local-only", "privacy", { localOnly: true, remote: false }],
  ["multimodal.video-unsupported", "multimodal", { unsupportedExplicitly: true, inventedAnalysis: false }],
  ["multimodal.cache", "cost", { duplicateAnalysisCalls: 0, bounded: true }, {}, "contract", { estimatedCostUsd: 0 }],
];

const CORE_SCENARIOS = Object.freeze(definitions.map(([scenarioId, category, expected, input = {}, adapter = "contract", metrics = {}]) => ({
  scenarioId,
  category,
  description: `Vérifie le contrat ${scenarioId} sans service externe.`,
  adapter,
  input: adapter === "contract" ? { actual: expected } : input,
  initialState: {},
  mocks: {},
  expected,
  invariants: BASE_INVARIANTS,
  metrics,
  tolerances: category === "performance" ? { latencyMs: 10 } : category === "cost" ? { estimatedCostUsd: 0 } : {},
  tags: ["offline", ...(category === "search" ? ["search"] : []), ...(category === "synthesis" ? ["synthesis"] : []), ...(category === "privacy" ? ["privacy"] : []), ...(category === "multimodal" || scenarioId.startsWith("multimodal.") ? ["multimodal"] : []), ...(scenarioId.startsWith("public-research.") ? ["public-research"] : []), ...(scenarioId.startsWith("config.") ? ["config"] : []), ...(scenarioId.startsWith("features.") ? ["feature-flags"] : []), ...(scenarioId.startsWith("migration.") ? ["migration"] : []), ...(scenarioId.startsWith("recovery.") ? ["recovery"] : []), ...(category === "security" || category === "privacy" || category === "approval" || category === "execution" ? ["critical"] : ["smoke"])],
}))); 

module.exports = { BASE_INVARIANTS, CORE_SCENARIOS };
