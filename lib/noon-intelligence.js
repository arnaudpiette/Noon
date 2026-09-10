"use strict";

// Source unique du routage Luna / Terra / Sol / Astra. Les signaux et raisons sont
// déterministes afin d'être testables et observables sans conserver la requête.
const ROUTING_POLICY_VERSION = "2.1.0";
const PROFILES = Object.freeze({ economical: "gpt-5.6-luna", balanced: "gpt-5.6-terra", maximum: "gpt-5.6-sol", exceptional: "gpt-6-astra" });
const ROUTING_THRESHOLDS = Object.freeze({ lunaMaximum: 10, solMinimum: 44, astraMinimum: 88 });
const LIGHT_PATTERN = /^(bonjour|bonsoir|salut|merci|ok|d'accord|oui|non|reformule|résume brièvement)\b/i;
const SIMPLE_TASK_PATTERN = /^(traduis|corrige l'orthographe|donne une définition courte|convertis|calcule)\b/i;
const REASONING_PATTERN = /\b(analyse|analyser|audit|diagnosti(?:que|quer)|démontre|raisonne|réfléchis|vérifie tout|en profondeur|cause racine)\b/i;
const DEEP_REASONING_PATTERN = /\b(analyse en profondeur|audit complet|cause racine|vérifie tout|raisonnement détaillé|réfléchis bien)\b/i;
const PLANNING_PATTERN = /\b(architecture|stratégie|plan de migration|feuille de route|roadmap|orchestr|refonte|système complet)\b/i;
const SYNTHESIS_PATTERN = /\b(compare|comparatif|croise|synthèse|plusieurs sources|plusieurs documents|consolide)\b/i;
const CODE_PATTERN = /\b(code|bug|erreur|stack|routeur|router|api|fonction|classe|module|test)\b/i;
const DEEP_CODE_PATTERN = /\b(débogage difficile|architecture logicielle|régression|race condition|sécurité|refactor(?:ing)?|migration|performance)\b/i;
const AMBIGUITY_PATTERN = /^(et après|fais pareil|fais la même chose|publie-le|corrige-le|continue|reprends)\b/i;
const TOOL_PATTERN = /\b(fichier|dossier|web|internet|mail|e-mail|agenda|calendrier|terminal|github|document|image)\b/i;
const HIGH_CONSEQUENCE_PATTERN = /\b(supprime|efface|publie|envoie|paie|virement|contrat|juridique|médical|production|déploie|push)\b/i;
const LONG_OUTPUT_PATTERN = /\b(complet|détaillé|exhaustif|rapport|documentation|pas à pas|toutes les étapes)\b/i;
const EXPLICIT_ASTRA_PATTERN = /\b(utilise|utiliser|passe sur|avec)\s+(?:gpt[- ]?6\s+)?astra\b/i;
const EXCEPTIONAL_CODE_PATTERN = /\b(gros repo|tout (?:ce |le )?repo|analyse transversale|plusieurs systèmes|architecture distribuée|race condition|grande refactorisation|migration complexe)\b/i;
const EXCEPTIONAL_RESEARCH_PATTERN = /\b(recherche profonde|sources contradictoires|(?:20|30|quarante|nombreuses) sources|rapport professionnel exhaustif|analyse multi[- ]sources)\b/i;
const PROFESSIONAL_WORKFLOW_PATTERN = /\b(de bout en bout|plusieurs outils|nombreuses contraintes|plusieurs documents|production finale|replanification)\b/i;
const MODEL_CAPABILITIES = Object.freeze({
  "gpt-5.6-luna": new Set(["TEXT", "VISION", "LONG_DOCUMENT", "STRUCTURED_OUTPUT"]),
  "gpt-5.6-terra": new Set(["TEXT", "VISION", "LONG_DOCUMENT", "STRUCTURED_OUTPUT"]),
  "gpt-5.6-sol": new Set(["TEXT", "VISION", "LONG_DOCUMENT", "STRUCTURED_OUTPUT"]),
  "gpt-6-astra": new Set(["TEXT", "VISION", "LONG_DOCUMENT", "STRUCTURED_OUTPUT", "FUNCTION_CALLING"]),
});

const ASTRA_AVAILABILITY = Object.freeze(["AVAILABLE", "UNAVAILABLE", "RATE_LIMITED", "NOT_AUTHORIZED", "UNKNOWN"]);

function normalizeIntelligenceProfile(value) { return Object.hasOwn(PROFILES, value) ? value : "balanced"; }
function boundedInteger(value, minimum = 0, maximum = 10_000) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.round(number))) : minimum;
}
function signalLevel(text, regularPattern, strongPattern = null) {
  if (strongPattern?.test(text)) return 4;
  return regularPattern.test(text) ? 2 : 0;
}

function buildRoutingSignals({ question = "", profile = "balanced", attachments = 0, context = {}, tools = {}, output = {}, risk = {}, failedPreviousAttempt = false, artifact = {} } = {}) {
  const text = String(question || "").trim();
  const normalizedProfile = normalizeIntelligenceProfile(profile);
  const attachmentCount = boundedInteger(attachments, 0, 20);
  const estimatedTokens = boundedInteger(context.estimatedTokens, 0, 1_000_000);
  const requestedToolCount = boundedInteger(tools.expectedCount ?? tools.requestedCount ?? (tools.hasTools ? 1 : 0), 0, 50);
  const userRequestedMaxQuality = normalizedProfile === "maximum" || /\b(utilise|passe sur|avec)\s+(sol|la qualité maximale|le mode maximum)\b/i.test(text);
  const userRequestedAstra = EXPLICIT_ASTRA_PATTERN.test(text);
  const isLight = text.length > 0 && text.length < 180 && LIGHT_PATTERN.test(text) && attachmentCount === 0 && requestedToolCount === 0;
  const isSimple = text.length > 0 && text.length < 240 && SIMPLE_TASK_PATTERN.test(text) && attachmentCount === 0 && requestedToolCount === 0;
  return {
    userRequestedMaxQuality,
    userRequestedAstra,
    isLight,
    isSimple,
    textLength: text.length,
    complexity: {
      reasoning: signalLevel(text, REASONING_PATTERN, DEEP_REASONING_PATTERN),
      ambiguity: AMBIGUITY_PATTERN.test(text) ? 2 : 0,
      planning: PLANNING_PATTERN.test(text) ? 3 : 0,
      synthesis: SYNTHESIS_PATTERN.test(text) ? 3 : 0,
      codeDepth: signalLevel(text, CODE_PATTERN, DEEP_CODE_PATTERN),
      exceptionalCode: EXCEPTIONAL_CODE_PATTERN.test(text) ? 4 : 0,
      exceptionalResearch: EXCEPTIONAL_RESEARCH_PATTERN.test(text) ? 4 : 0,
      professionalWorkflow: PROFESSIONAL_WORKFLOW_PATTERN.test(text) ? 3 : 0,
      failedPreviousAttempt: failedPreviousAttempt === true ? 4 : 0,
    },
    context: {
      estimatedTokens,
      attachments: attachmentCount,
      memoryRequired: context.memoryRequired === true,
      sourceCount: boundedInteger(context.sourceCount, 0, 10_000),
      truncated: context.truncated === true,
    },
    tools: {
      likely: tools.likely === true || tools.hasTools === true || requestedToolCount > 0 || TOOL_PATTERN.test(text),
      expectedCount: requestedToolCount,
    },
    output: {
      expectedLength: ["short", "medium", "long"].includes(output.expectedLength) ? output.expectedLength : LONG_OUTPUT_PATTERN.test(text) ? "long" : "medium",
      artifactComplexity: ["low", "medium", "high"].includes(artifact.complexity) ? artifact.complexity : "low",
    },
    consequence: { level: ["low", "medium", "high"].includes(risk.level) ? risk.level : HIGH_CONSEQUENCE_PATTERN.test(text) ? "high" : "low" },
  };
}

function scoreRoutingSignals(signals) {
  const { complexity, context, tools, output, consequence } = signals;
  let score = 0;
  const reasons = [];
  const add = (points, code) => { if (points > 0) { score += points; reasons.push(code); } };
  add(complexity.reasoning * 8, "reasoning");
  add(complexity.ambiguity * 4, "ambiguity");
  add(complexity.planning * 7, "planning");
  add(complexity.synthesis * 6, "synthesis");
  add(complexity.codeDepth * 8, "code_depth");
  add(complexity.exceptionalCode * 8, "exceptional_code");
  add(complexity.exceptionalResearch * 8, "exceptional_research");
  add(complexity.professionalWorkflow * 6, "professional_workflow");
  add(complexity.failedPreviousAttempt * 7, "failed_previous_attempt");
  add(context.estimatedTokens >= 12_000 ? 8 : context.estimatedTokens >= 4_000 ? 4 : 0, "large_context");
  add(Math.min(8, context.attachments * 3), "attachments");
  add(context.memoryRequired ? 3 : 0, "memory_context");
  add(context.sourceCount >= 6 ? 6 : context.sourceCount >= 2 ? 3 : 0, "multiple_sources");
  add(context.truncated ? 4 : 0, "truncated_context");
  add(tools.likely ? 4 : 0, "tool_use");
  add(Math.min(6, tools.expectedCount * 2), "multiple_tools");
  add(output.expectedLength === "long" ? 6 : 0, "long_output");
  add(output.artifactComplexity === "high" ? 10 : output.artifactComplexity === "medium" ? 4 : 0, "artifact_complexity");
  add(consequence.level === "high" ? 10 : consequence.level === "medium" ? 4 : 0, "consequence");
  if (signals.userRequestedMaxQuality) { score = Math.max(score, 100); reasons.push("explicit_max_quality"); }
  if (signals.isLight || signals.isSimple) {
    score = 0; reasons.length = 0;
    reasons.push(signals.isLight ? "light_request" : "simple_deterministic_task");
  }
  return { score, reasonCodes: [...new Set(reasons)] };
}

function selectModelRoute(input = {}) {
  const startedAt = process.hrtime.bigint();
  const normalized = normalizeIntelligenceProfile(input.profile);
  const budgetMode = String(input.budgetMode || "NORMAL").toUpperCase();
  const signals = buildRoutingSignals({ ...input, profile: normalized });
  const scored = scoreRoutingSignals(signals);
  const highDimensions = Object.values(signals.complexity).filter((level) => level >= 2).length;
  const exceptionalDimensions = [signals.complexity.exceptionalCode, signals.complexity.exceptionalResearch, signals.complexity.professionalWorkflow, signals.complexity.failedPreviousAttempt]
    .filter((level) => level >= 3).length;
  const strongSignalCount = [
    signals.complexity.reasoning >= 4,
    signals.complexity.codeDepth >= 4,
    exceptionalDimensions >= 1,
    signals.context.estimatedTokens >= 12_000,
    signals.context.sourceCount >= 6,
    signals.context.attachments >= 3,
    signals.tools.expectedCount >= 3,
    signals.output.expectedLength === "long",
    signals.output.artifactComplexity === "high",
    signals.consequence.level === "high",
  ].filter(Boolean).length;
  const astraMode = ["OFF", "SHADOW", "LIMITED", "ON"].includes(String(input.astraMode).toUpperCase()) ? String(input.astraMode).toUpperCase() : "OFF";
  const astraAvailability = ASTRA_AVAILABILITY.includes(String(input.astraAvailability).toUpperCase()) ? String(input.astraAvailability).toUpperCase() : "UNKNOWN";
  const astraLimitedEligible = signals.complexity.exceptionalCode >= 4 || signals.complexity.exceptionalResearch >= 4 || signals.complexity.professionalWorkflow >= 3;
  const astraThresholdMet = !signals.isLight && !signals.isSimple && (
    signals.userRequestedAstra ||
    (scored.score >= ROUTING_THRESHOLDS.astraMinimum && exceptionalDimensions >= 1 && strongSignalCount >= 4) ||
    (signals.complexity.failedPreviousAttempt >= 4 && scored.score >= ROUTING_THRESHOLDS.solMinimum && strongSignalCount >= 3)
  );
  const astraPolicyAllows = astraMode === "ON" || (astraMode === "LIMITED" && astraLimitedEligible);
  const remoteAllowed = !["LOCAL_ONLY", "OFFLINE"].includes(String(input.networkState || "ONLINE").toUpperCase());
  const astraAvailable = remoteAllowed && !["UNAVAILABLE", "RATE_LIMITED", "NOT_AUTHORIZED"].includes(astraAvailability);
  let selectedProfile = "balanced";
  const reasonCodes = [...scored.reasonCodes];
  if (signals.isLight || signals.isSimple) selectedProfile = "economical";
  else if (["ECO", "PROTECTION"].includes(budgetMode) || normalized === "economical") {
    selectedProfile = "economical";
    reasonCodes.push(budgetMode === "NORMAL" ? "economical_profile" : "budget_restricted");
  } else if (astraThresholdMet && astraPolicyAllows && astraAvailable) {
    selectedProfile = "exceptional";
    if (signals.userRequestedAstra) reasonCodes.push("EXPLICIT_ASTRA_REQUEST");
    if (signals.complexity.exceptionalCode) reasonCodes.push("COMPLEX_CODEBASE_ANALYSIS");
    if (signals.complexity.exceptionalResearch) reasonCodes.push("LARGE_CROSS_SOURCE_SYNTHESIS");
    if (signals.complexity.professionalWorkflow) reasonCodes.push("MULTI_TOOL_COMPLEXITY");
    if (signals.complexity.failedPreviousAttempt) reasonCodes.push("SOL_INSUFFICIENT");
    if (!signals.userRequestedAstra) reasonCodes.push("EXCEPTIONAL_REASONING");
  } else if (signals.userRequestedMaxQuality || signals.userRequestedAstra) {
    selectedProfile = "maximum";
    if (signals.userRequestedAstra) reasonCodes.push(astraAvailable ? "ASTRA_POLICY_DISABLED" : `ASTRA_${astraAvailability}`);
  }
  else if (scored.score >= ROUTING_THRESHOLDS.solMinimum && highDimensions >= 2) {
    selectedProfile = "maximum";
    reasonCodes.push("multi_signal_complexity");
  } else {
    selectedProfile = "balanced";
    reasonCodes.push("balanced_default");
  }
  const routes = {
    economical: { model: PROFILES.economical, effort: "low", verbosity: "low" },
    balanced: { model: PROFILES.balanced, effort: "medium", verbosity: "medium" },
    maximum: { model: PROFILES.maximum, effort: "high", verbosity: "medium" },
    exceptional: {
      model: PROFILES.exceptional,
      effort: input.reasoningEffort === "max" && signals.complexity.failedPreviousAttempt >= 4 ? "max" : scored.score >= 120 ? "xhigh" : "high",
      verbosity: "medium",
    },
  };
  const requiredCapabilities = [...new Set((input.requiredCapabilities || []).map(String))];
  const unsupportedCapabilities = requiredCapabilities.filter((capability) =>
    capability !== "AUDIO_TRANSCRIPTION" && !MODEL_CAPABILITIES[routes[selectedProfile].model]?.has(capability));
  if (unsupportedCapabilities.length) {
    const error = new Error(`Aucun modèle compatible avec : ${unsupportedCapabilities.join(", ")}`);
    error.code = "MODEL_CAPABILITY_UNAVAILABLE";
    throw error;
  }
  return {
    ...routes[selectedProfile], profile: normalized, selectedProfile, score: scored.score, signals,
    requiredCapabilities,
    reasonCodes: [...new Set(reasonCodes)], routingPolicyVersion: ROUTING_POLICY_VERSION,
    astra: {
      mode: astraMode, availability: remoteAllowed ? astraAvailability : "UNAVAILABLE", candidate: astraThresholdMet,
      wouldSelectAstra: astraThresholdMet && astraAvailable,
      policyAllows: astraPolicyAllows, selected: selectedProfile === "exceptional",
    },
    routingMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
  };
}

// Politique 1 disponible uniquement pour le shadow test, jamais en production.
function selectLegacyModelRoute({ question = "", profile = "balanced", budgetMode = "NORMAL", attachments = 0 } = {}) {
  const normalized = normalizeIntelligenceProfile(profile);
  const text = String(question).trim();
  if (["PROTECTION", "ECO"].includes(String(budgetMode).toUpperCase()) || normalized === "economical") return PROFILES.economical;
  if (text.length < 180 && LIGHT_PATTERN.test(text) && Number(attachments) === 0) return PROFILES.economical;
  if (normalized === "maximum" || /\b(réfléchis bien|analyse en profondeur|vérifie tout|audit|architecture|débogage difficile|compare précisément|meilleure solution|stratégie complète)\b/i.test(text)) return PROFILES.maximum;
  return PROFILES.balanced;
}
function compareRoutingPolicies(cases = []) {
  return cases.map((scenario) => {
    const previousModel = selectLegacyModelRoute(scenario);
    const current = selectModelRoute(scenario);
    return { id: String(scenario.id || "scenario"), previousModel, currentModel: current.model, changed: previousModel !== current.model, score: current.score, reasonCodes: current.reasonCodes };
  });
}
function modelFallbacks(primary) {
  if (primary === "gpt-6-astra") return ["gpt-6-astra", "gpt-5.6-sol"];
  return [...new Set([primary, "gpt-5.6-terra", "gpt-5.6-luna"])];
}
function trimHistoryByCharacters(history, maximumCharacters = 32000) {
  const kept = []; let used = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]; const size = String(message?.content || "").length;
    if (kept.length && used + size > maximumCharacters) break;
    kept.unshift(message); used += size;
  }
  return kept;
}
function updateConversationSummary(previousSummary = "", messages = [], maximumCharacters = 8000) {
  const facts = [];
  for (const message of messages) {
    const role = message?.role === "assistant" ? "Noon" : "Arnaud";
    const text = String(message?.content || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    const useful = sentences.filter((sentence) => /\b(décid|choix|préfér|doit|souhaite|contrainte|reste|prochaine|à faire|todo|projet|erreur|solution|validé|focus)\b/i.test(sentence));
    for (const sentence of (useful.length ? useful : sentences.slice(0, 1)).slice(0, 3)) facts.push(`- ${role} : ${sentence.slice(0, 700)}`);
  }
  return [previousSummary, facts.join("\n")].filter(Boolean).join("\n").slice(-maximumCharacters);
}

module.exports = { ASTRA_AVAILABILITY, MODEL_CAPABILITIES, PROFILES, ROUTING_POLICY_VERSION, ROUTING_THRESHOLDS, buildRoutingSignals, compareRoutingPolicies, modelFallbacks, normalizeIntelligenceProfile, scoreRoutingSignals, selectLegacyModelRoute, selectModelRoute, trimHistoryByCharacters, updateConversationSummary };
