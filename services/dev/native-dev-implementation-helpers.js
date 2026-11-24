"use strict";

// V3-L7 — aides du moteur d'implémentation Native DEV (phases autorisées, erreurs sûres,
// normalisation du raisonnement, dépendances locales, échecs de validation bloquants), sorties
// telles quelles de native-dev-implementation-engine.js. Fonctions pures et constantes.

const path = require("node:path");
const { CONTENT_SECRET } = require("./native-repository-tools");

const ALLOWED_PHASES = new Set([
  "PLAN",
  "EDIT",
  "DIAGNOSE",
  "REPAIR",
]);

function safeError(error, fallback = "TASK_FAILURE") {
  return {
    code: String(error?.code || fallback).slice(0, 80),
    message: String(
      error?.message ||
        "Échec de la tâche DEV."
    ).slice(0, 240),
  };
}

function normalizeReasoning(value = {}) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw Object.assign(
      new Error(
        "Réponse DEV mal formée."
      ),
      {
        code:
          "MALFORMED_PROVIDER_RESPONSE",
      }
    );
  }

  const files =
    Array.isArray(value.files)
      ? value.files
          .map(String)
          .slice(0, 30)
      : [];

  const searchTerms =
    Array.isArray(
      value.searchTerms
    )
      ? value.searchTerms
          .map(String)
          .filter(Boolean)
          .slice(0, 12)
      : [];

  const operations =
    Array.isArray(
      value.operations
    )
      ? value.operations.slice(
          0,
          20
        )
      : [];

  const validationCommands =
    Array.isArray(
      value.validationCommands
    )
      ? value.validationCommands
          .map(String)
          .slice(0, 12)
      : [];

  const providerMetrics =
    value.providerMetrics &&
    typeof value.providerMetrics ===
      "object"
      ? {
          provider: String(
            value.providerMetrics
              .provider ||
              "unknown"
          ).slice(0, 40),

          model: String(
            value.providerMetrics
              .model ||
              "unknown"
          ).slice(0, 100),

          latencyMs: Math.max(
            0,
            Number(
              value.providerMetrics
                .latencyMs
            ) || 0
          ),

          usage:
            value.providerMetrics
              .usage &&
            typeof value
              .providerMetrics
              .usage === "object"
              ? value
                  .providerMetrics
                  .usage
              : null,

          estimatedCost:
            value.providerMetrics
                .estimatedCost !=
              null &&
            Number.isFinite(
              Number(
                value
                  .providerMetrics
                  .estimatedCost
              )
            )
              ? Number(
                  value
                    .providerMetrics
                    .estimatedCost
                )
              : null,

          actualCost:
            value.providerMetrics
                .actualCost != null &&
            Number.isFinite(
              Number(
                value
                  .providerMetrics
                  .actualCost
              )
            )
              ? Number(
                  value
                    .providerMetrics
                    .actualCost
                )
              : null,

          routeReasonCodes:
            Array.isArray(
              value
                .providerMetrics
                .routeReasonCodes
            )
              ? value
                  .providerMetrics
                  .routeReasonCodes
                  .map(String)
                  .slice(0, 20)
              : [],

          reservationId:
            value.providerMetrics
              .reservationId
              ? String(
                  value
                    .providerMetrics
                    .reservationId
                ).slice(0, 160)
              : null,

          budgetBefore:
            value.providerMetrics
              .budgetBefore ||
            null,

          budgetAfter:
            value.providerMetrics
              .budgetAfter ||
            null,
        }
      : null;

  return {
    summary: String(
      value.summary || ""
    ).slice(0, 2000),
    files,
    searchTerms,
    operations,
    validationCommands,
    providerMetrics,
  };
}

function unique(items) {
  return [
    ...new Set(
      items.filter(Boolean)
    ),
  ];
}


const CONTEXT_FALLBACK_MAX_FILES =
  12;

const LOCAL_DEPENDENCY_MAX_FILES =
  12;

const LOCAL_DEPENDENCY_EXTENSIONS =
  Object.freeze([
    ".js",
    ".cjs",
    ".mjs",
    ".jsx",
    ".ts",
    ".tsx",
  ]);

function relativeDependencySpecifiers(
  content
) {
  const source =
    String(content || "");

  const found = [];

  const patterns = [
    /\brequire\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g,
    /\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g,
    /\b(?:import|export)\s+(?:[^"'`;]*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/g,
  ];

  for (const pattern of patterns) {
    let match;

    while (
      (match = pattern.exec(source)) !==
      null
    ) {
      const specifier =
        String(match[1] || "");

      if (
        specifier.startsWith("./") ||
        specifier.startsWith("../")
      ) {
        found.push(specifier);
      }

      if (
        found.length >=
        LOCAL_DEPENDENCY_MAX_FILES
      ) {
        break;
      }
    }
  }

  return unique(found).slice(
    0,
    LOCAL_DEPENDENCY_MAX_FILES
  );
}

function localDependencyCandidates(
  sourceRelative,
  specifier
) {
  const base =
    path.posix.normalize(
      path.posix.join(
        path.posix.dirname(
          String(sourceRelative || "")
        ),
        String(specifier || "")
      )
    );

  if (
    !base ||
    base === ".." ||
    base.startsWith("../") ||
    path.posix.isAbsolute(base) ||
    base
      .split("/")
      .includes("node_modules")
  ) {
    return [];
  }

  if (
    path.posix.extname(base)
  ) {
    return [base];
  }

  return unique([
    base,

    ...LOCAL_DEPENDENCY_EXTENSIONS.map(
      (extension) =>
        `${base}${extension}`
    ),

    ...LOCAL_DEPENDENCY_EXTENSIONS.map(
      (extension) =>
        `${base}/index${extension}`
    ),
  ]);
}

function isBlockingValidationFailure(
  result = {}
) {
  if (
    result.status === "PASS"
  ) {
    return false;
  }

  // Une commande optionnelle proposée par le modèle reste
  // une donnée non fiable : son refus par l'allowlist
  // prouve que la sécurité fonctionne, pas que le patch est faux.
  return (
    result.failureCategory !==
    "COMMAND_NOT_ALLOWLISTED"
  );
}

function modelFiles(
  snapshots
) {
  return [
    ...snapshots.values(),
  ].map((item) =>
    CONTENT_SECRET.test(
      item.content
    )
      ? {
          path:
            item.relative,
          hash: item.hash,
          content: null,
          omitted:
            "SENSITIVE_CONTENT",
        }
      : {
          path:
            item.relative,
          hash: item.hash,
          content:
            item.content.slice(
              0,
              80_000
            ),
          omitted:
            item.content.length >
            80_000
              ? "TRUNCATED"
              : null,
        }
  );
}

module.exports = {
  ALLOWED_PHASES,
  safeError,
  normalizeReasoning,
  unique,
  CONTEXT_FALLBACK_MAX_FILES,
  LOCAL_DEPENDENCY_MAX_FILES,
  LOCAL_DEPENDENCY_EXTENSIONS,
  relativeDependencySpecifiers,
  localDependencyCandidates,
  isBlockingValidationFailure,
  modelFiles,
};
