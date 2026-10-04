"use strict";

const TERMINAL_EXECUTION_PROFILES =
  Object.freeze({
    AUTONOMOUS:
      "AUTONOMOUS",

    STANDARD:
      "STANDARD",

    STEP_BY_STEP:
      "STEP_BY_STEP",
  });

const DEFAULT_TERMINAL_EXECUTION_PROFILE =
  TERMINAL_EXECUTION_PROFILES
    .AUTONOMOUS;

const PROFILE_MARKER =
  /^\[NOON_TERMINAL_PROFILE:(AUTONOMOUS|STANDARD|STEP_BY_STEP)\]$/;

const PROFILE_INSTRUCTIONS =
  Object.freeze({
    AUTONOMOUS:
      [
        "Mode terminal AUTONOMOUS.",
        "Pour une tâche DEV, privilégie une séquence autonome et regroupée plutôt que de multiplier les allers-retours.",
        "Regroupe dans un même bloc les opérations compatibles et les validations sûres.",
        "Pour les commandes shell proposées, privilégie une syntaxe compatible zsh et utilise && quand les étapes doivent s'arrêter au premier échec.",
        "Enchaîne autant que raisonnablement possible inspection ciblée, modification, tests ciblés, régressions, build/lint, git diff --check et revue finale.",
        "Préserve les modifications existantes et les artefacts non suivis.",
        "Ne propose jamais git add .",
        "Ne propose jamais de push sans demande explicite.",
        "N'effectue aucune opération destructive sans autorisation explicite.",
      ].join(" "),

    STANDARD:
      [
        "Mode terminal STANDARD.",
        "Regroupe les opérations compatibles mais conserve des points de contrôle entre inspection, mutation et validation.",
        "Privilégie une syntaxe shell compatible zsh.",
        "Arrête l'exécution au premier échec significatif.",
        "Préserve les modifications existantes et les artefacts non suivis.",
        "Ne propose jamais git add . ni push sans demande explicite.",
      ].join(" "),

    STEP_BY_STEP:
      [
        "Mode terminal STEP_BY_STEP.",
        "Traite une seule étape significative à la fois.",
        "Valide fréquemment avant de poursuivre.",
        "Ne regroupe pas plusieurs mutations indépendantes dans le même bloc.",
        "Préserve les modifications existantes et les artefacts non suivis.",
        "Ne propose jamais git add . ni push sans demande explicite.",
      ].join(" "),
  });

function normalizeTerminalExecutionProfile(
  value
) {
  const normalized =
    String(
      value || ""
    )
      .trim()
      .toUpperCase();

  return Object.prototype
    .hasOwnProperty.call(
      TERMINAL_EXECUTION_PROFILES,
      normalized
    )
    ? normalized
    : null;
}

function terminalExecutionProfileMarker(
  profile
) {
  const normalized =
    normalizeTerminalExecutionProfile(
      profile
    );

  if (!normalized) {
    throw Object.assign(
      new Error(
        "Profil terminal invalide."
      ),
      {
        code:
          "TERMINAL_EXECUTION_PROFILE_INVALID",
      }
    );
  }

  return `[NOON_TERMINAL_PROFILE:${normalized}]`;
}

function terminalExecutionProfileFromInstruction(
  value
) {
  const match =
    String(
      value || ""
    )
      .trim()
      .match(
        PROFILE_MARKER
      );

  return match
    ? match[1]
    : null;
}

function resolveTerminalExecutionProfile(
  projectInstructions = []
) {
  const instructions =
    Array.isArray(
      projectInstructions
    )
      ? projectInstructions
          .map(String)
          .map(
            (item) =>
              item.trim()
          )
          .filter(Boolean)
      : [];

  let projectProfile =
    null;

  const visibleInstructions =
    [];

  for (
    const instruction
    of instructions
  ) {
    const candidate =
      terminalExecutionProfileFromInstruction(
        instruction
      );

    if (candidate) {
      projectProfile =
        candidate;

      continue;
    }

    visibleInstructions.push(
      instruction
    );
  }

  const profile =
    projectProfile ||
    DEFAULT_TERMINAL_EXECUTION_PROFILE;

  return {
    profile,

    source:
      projectProfile
        ? "PROJECT"
        : "GLOBAL_DEFAULT",

    projectInstructions: [
      PROFILE_INSTRUCTIONS[
        profile
      ],
      ...visibleInstructions,
    ],
  };
}

module.exports = {
  TERMINAL_EXECUTION_PROFILES,
  DEFAULT_TERMINAL_EXECUTION_PROFILE,
  PROFILE_INSTRUCTIONS,
  normalizeTerminalExecutionProfile,
  terminalExecutionProfileMarker,
  terminalExecutionProfileFromInstruction,
  resolveTerminalExecutionProfile,
};
