"use strict";

// V3-L7 — choix du modèle selon les drapeaux du routeur (politique v2, Astra, multi-fournisseur,
// small-first et apprentissage adaptatif en ombre), sorti de server.js. Le routeur lui-même reste
// dans lib ; ce module ne fait qu'appliquer les drapeaux et journaliser les décisions en ombre.
// Domaine déplacé tel quel depuis server.js. Dépendances déjà déclarées quand server.js le
// construit : lues une fois ; les autres (`deps.x`) : lues à chaque usage, par accesseur.

const DEPENDENCIES = Object.freeze(["MODEL_DEFINITIONS","adaptiveRoutingService","featureFlags","normalizeIntelligenceProfile","reliabilityEngine","selectLegacyModelRoute","selectModelRoute","shadowComparator","smallFirstDecision","toolAuditLog"]);

function createConfiguredModelRoute(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  const {
    MODEL_DEFINITIONS,
    featureFlags,
    normalizeIntelligenceProfile,
    selectLegacyModelRoute,
    selectModelRoute,
    shadowComparator,
    smallFirstDecision,
    toolAuditLog,
  } = deps;

  function legacyRoute(input) {
    const model = selectLegacyModelRoute(input);
    const selectedProfile = model.endsWith("luna") ? "economical" : model.endsWith("sol") ? "maximum" : "balanced";
    return { model, selectedProfile, profile: normalizeIntelligenceProfile(input.profile), effort: selectedProfile === "maximum" ? "high" : selectedProfile === "economical" ? "low" : "medium", verbosity: selectedProfile === "economical" ? "low" : "medium", routingPolicyVersion: "legacy-v1", reasonCodes: ["feature_legacy_path"], score: 0 };
  }

  function selectConfiguredModelRoute(input = {}) {
    const evaluation = featureFlags.evaluate("router.policy.v2", {
      workspaceId: input.workspaceId || null,
      sessionId: input.sessionId || null,
      channel: input.channel || "chat",
    });
    if (evaluation.mode === "OFF") return legacyRoute(input);
    const astraEvaluation = featureFlags.evaluate("router.astra", {
      workspaceId: input.workspaceId || null,
      sessionId: input.sessionId || null,
      channel: input.channel || "chat",
    });
    const multiProvider = featureFlags.evaluate("router.multi-provider", input);
    const costAware = featureFlags.evaluate("router.cost-aware", input);
    const geminiLimited = featureFlags.evaluate("router.gemini-limited", input);
    const secondOpinion = featureFlags.evaluate("router.second-opinion", input);
    const crossProviderFallback = featureFlags.evaluate("router.cross-provider-fallback", input);
    const adaptiveLearning = featureFlags.evaluate("router.adaptive-learning", input);
    let astraAvailability = "UNKNOWN";
    try {
      const health = deps.reliabilityEngine?.snapshot?.("gpt-6-astra");
      if (health?.state === "HEALTHY") astraAvailability = "AVAILABLE";
      else if (health?.state === "UNAUTHORIZED") astraAvailability = "NOT_AUTHORIZED";
      else if (health?.reasonCode === "RATE_LIMITED" || health?.circuitState === "open") astraAvailability = "RATE_LIMITED";
      else if (["UNAVAILABLE", "MISCONFIGURED"].includes(health?.state)) astraAvailability = "UNAVAILABLE";
    } catch {}
    const componentAvailability = (componentId) => {
      try {
        const health = deps.reliabilityEngine?.snapshot?.(componentId);
        return ["UNAVAILABLE", "MISCONFIGURED", "UNAUTHORIZED"].includes(health?.state) || health?.circuitState === "open" ? "UNAVAILABLE" : "AVAILABLE";
      } catch { return "AVAILABLE"; }
    };
    const astraInput = {
      ...input,
      astraMode: astraEvaluation.mode,
      astraAvailability,
      multiProviderRouting: multiProvider.enabled,
      costAwareRouting: costAware.enabled,
      providerRollouts: { ...input.providerRollouts, google_ai: geminiLimited.enabled ? "LIMITED" : "SHADOW" },
      secondOpinion: secondOpinion.enabled && input.secondOpinion === true,
      crossProviderFallback: crossProviderFallback.enabled,
      providerHealth: input.providerHealth || {
        openai: componentAvailability("openai-models"),
        google_ai: componentAvailability("google-ai-models"),
      },
      modelAvailability: input.modelAvailability || Object.fromEntries(MODEL_DEFINITIONS.map((definition) => [definition.id, componentAvailability(definition.id)])),
    };
    if (evaluation.mode === "SHADOW") {
      const active = legacyRoute(input);
      const shadow = selectModelRoute(astraInput);
      shadowComparator.compare({ flagId: evaluation.flagId, legacyResult: active, shadowResult: shadow });
      return active;
    }
    if (astraEvaluation.shadow) {
      const active = selectModelRoute({ ...input, astraMode: "OFF", astraAvailability });
      const shadow = selectModelRoute({ ...input, astraMode: "ON", astraAvailability });
      shadowComparator.compare({ flagId: astraEvaluation.flagId, legacyResult: active, shadowResult: shadow });
      toolAuditLog.append(shadow.astra?.wouldSelectAstra ? "routing.astra_selected" : "routing.astra_not_selected", {
        selectedModel: active.model,
        shadowModel: shadow.model,
        score: shadow.score,
        reasonCodes: shadow.reasonCodes,
        estimatedCostMultiplier: shadow.model === "gpt-6-astra" ? 2.5 : 1,
      });
      return { ...active, astra: shadow.astra, shadowModel: shadow.model };
    }
    const baseRoute = selectModelRoute(astraInput);
    // V3-L6 (G.4) : décision « luna aurait suffi » calculée en ombre ; la route active ne change pas.
    const smallFirstFlag = featureFlags.evaluate("router.small-first", input);
    const route = smallFirstFlag.shadow
      ? { ...baseRoute, smallFirst: smallFirstDecision(baseRoute, { webSearchEnabled: input.webSearchEnabled === true, channel: input.channel || "chat" }) }
      : baseRoute;

    if (adaptiveLearning.shadow) {
      const adaptiveShadow = deps.adaptiveRoutingService.evaluate(
        {
          ...astraInput,
          taskDomain: input.taskDomain || route.taskDomain || "GENERAL",
          requiredQuality: input.requiredQuality || route.requiredQuality || "NORMAL",
        },
        route,
        { flagId: adaptiveLearning.flagId }
      );

      if (adaptiveShadow.shadowRoute) {
        toolAuditLog.append("routing.adaptive_shadow", {
          activeModel: route.model,
          shadowModel: adaptiveShadow.shadowRoute.model,
          status: adaptiveShadow.status,
          sampleCount: adaptiveShadow.sampleCount,
          evidenceCount: adaptiveShadow.evidenceCount,
        });
      }

      return {
        ...route,
        adaptiveShadow: {
          status: adaptiveShadow.status,
          model: adaptiveShadow.shadowRoute?.model || null,
          sampleCount: adaptiveShadow.sampleCount,
          evidenceCount: adaptiveShadow.evidenceCount || 0,
        },
      };
    }

    if (route.model === "gpt-6-astra") toolAuditLog.append("routing.astra_selected", {
      selectedModel: route.model, score: route.score, reasonCodes: route.reasonCodes, effort: route.effort,
    });

    return route;
  }

  return { selectConfiguredModelRoute };
}

module.exports = { DEPENDENCIES, createConfiguredModelRoute };
