"use strict";

// V3-L6 (G.4) — politique « plus petit modèle capable », en MODE OMBRE uniquement.
// À partir d'une décision du routeur existant, dit si gpt-5.6-luna aurait suffi et, sinon,
// pourquoi l'escalade est justifiée. Ne modifie jamais la route active : la décision est
// seulement tracée (journal d'audit, traces) pour mesurer avant de changer quoi que ce soit.

const SMALL_MODEL = "gpt-5.6-luna";
const DEFAULT_MODEL = "gpt-5.6-terra";
const LIMITS = Object.freeze({ textLength: 400, estimatedTokens: 4000, sourceCount: 1, attachments: 0, expectedTools: 1 });

function smallFirstDecision(route, { webSearchEnabled = false, channel = "chat" } = {}) {
  if (!route || typeof route !== "object") return null;
  // Seul le choix par défaut (profil équilibré) est candidat : une escalade déjà motivée par le
  // routeur (complexité multiple, qualité maximale demandée, budget) n'est pas remise en cause.
  if (route.model !== DEFAULT_MODEL || route.selectedProfile !== "balanced") return { eligible: false, model: null, reasons: ["NOT_DEFAULT_ROUTE"], channel };
  const signals = route.signals || {};
  const reasons = [];
  for (const [dimension, level] of Object.entries(signals.complexity || {})) if (Number(level) >= 2) reasons.push(`COMPLEXITY_${dimension.replace(/[A-Z]/g, (char) => `_${char}`).toUpperCase()}`);
  if (Number(signals.textLength) > LIMITS.textLength) reasons.push("LONG_REQUEST");
  if (Number(signals.context?.estimatedTokens) > LIMITS.estimatedTokens || signals.context?.truncated) reasons.push("LARGE_CONTEXT");
  if (Number(signals.context?.sourceCount) > LIMITS.sourceCount) reasons.push("MULTIPLE_SOURCES");
  if (Number(signals.context?.attachments) > LIMITS.attachments) reasons.push("ATTACHMENTS");
  if (Number(signals.tools?.expectedCount) > LIMITS.expectedTools) reasons.push("MULTIPLE_TOOLS");
  if (signals.output?.expectedLength === "long") reasons.push("LONG_OUTPUT");
  if (["medium", "high"].includes(signals.output?.artifactComplexity)) reasons.push("ARTIFACT");
  if (["medium", "high"].includes(signals.consequence?.level)) reasons.push("CONSEQUENCE");
  if (webSearchEnabled) reasons.push("WEB_RESEARCH");
  if (signals.userRequestedMaxQuality) reasons.push("MAX_QUALITY_REQUESTED");
  return { eligible: reasons.length === 0, model: reasons.length === 0 ? SMALL_MODEL : null, reasons, channel };
}

module.exports = { DEFAULT_MODEL, LIMITS, SMALL_MODEL, smallFirstDecision };
