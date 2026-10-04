"use strict";

/*
 * Capability interne non sérialisable.
 *
 * Une requête HTTP/JSON ne peut pas fabriquer cette clé Symbol.
 *
 * Même avec cette capability, OFF n'est accepté que pour
 * un input portant un contexte benchmark cohérent :
 * - sessionId non vide ;
 * - benchmark.id === sessionId ;
 * - budget positif ;
 * - workspace explicitement autorisé ;
 * - au moins une racine workspace autorisée.
 */
const CONTEXT_MANIFEST_EXPERIMENT =
  Symbol(
    "NOON_BENCHMARK_CONTEXT_MANIFEST_EXPERIMENT"
  );

function normalizeContextManifestMode(
  value
) {
  return value === "OFF"
    ? "OFF"
    : "ON";
}

function isCanonicalBenchmarkInput(
  input
) {
  const sessionId =
    String(
      input?.sessionId || ""
    );

  const benchmarkId =
    String(
      input?.benchmark?.id || ""
    );

  const limitUsd =
    Number(
      input?.benchmark?.limitUsd
    );

  return (
    sessionId.length > 0 &&
    benchmarkId === sessionId &&
    Number.isFinite(
      limitUsd
    ) &&
    limitUsd > 0 &&
    input?.workspaceAuthorized ===
      true &&
    Array.isArray(
      input?.workspaceRoots
    ) &&
    input.workspaceRoots.length >
      0
  );
}

function contextManifestModeFromInput(
  input
) {
  const requested =
    normalizeContextManifestMode(
      input?.[
        CONTEXT_MANIFEST_EXPERIMENT
      ]
    );

  if (
    requested !== "OFF"
  ) {
    return "ON";
  }

  return isCanonicalBenchmarkInput(
    input
  )
    ? "OFF"
    : "ON";
}

module.exports = {
  CONTEXT_MANIFEST_EXPERIMENT,
  contextManifestModeFromInput,
  isCanonicalBenchmarkInput,
  normalizeContextManifestMode,
};
