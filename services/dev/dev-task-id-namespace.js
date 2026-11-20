"use strict";

/*
 * Espace de noms réservé des taskId Native DEV.
 *
 * `goal-mode-dev-` est réservé aux tâches dérivées d'une réservation Goal
 * Mode (projection 4B → réservation 4C-0 → CAS 4C-1B). Aucune entrée HTTP,
 * UI, retry ou benchmark ne peut choisir un taskId dans cet espace : sinon
 * une tâche pourrait partager l'identité d'une réservation sans passer par
 * la réservation ni le CAS.
 *
 * La comparaison se fait après normalisation : trim, Unicode NFKC, casse,
 * suppression des caractères invisibles (format, espaces) et repli des
 * variantes de tiret sur « - », pour qu'une variante visuelle ne passe pas.
 */

const RESERVED_GOAL_MODE_DEV_TASK_PREFIX = "goal-mode-dev-";

function normalizeDevTaskIdForNamespace(value) {
  if (value === undefined || value === null) return "";
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\p{Cf}\p{Z}\s]/gu, "")
    .replace(/[\p{Pd}−﹣－]/gu, "-");
}

function isReservedGoalModeDevTaskId(value) {
  return normalizeDevTaskIdForNamespace(value).startsWith(RESERVED_GOAL_MODE_DEV_TASK_PREFIX);
}

function assertDevTaskIdNotReserved(value) {
  if (isReservedGoalModeDevTaskId(value)) {
    throw Object.assign(
      new Error("Ce taskId est réservé aux exécutions Goal Mode."),
      { code: "DEV_TASK_ID_RESERVED", statusCode: 400 }
    );
  }
  return value;
}

module.exports = {
  RESERVED_GOAL_MODE_DEV_TASK_PREFIX,
  assertDevTaskIdNotReserved,
  isReservedGoalModeDevTaskId,
  normalizeDevTaskIdForNamespace,
};
