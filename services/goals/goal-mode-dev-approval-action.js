"use strict";

/*
 * 5.0D-4C-1C — Identité de l'action exacte approuvée pour un dispatch DEV
 * Goal Mode. Module sans dépendance : ApprovalEngine l'importe pour sa
 * surface de lecture bornée, le service de dispatch pour lier l'approbation
 * au contrat exact.
 */

const crypto = require("node:crypto");

const SKILL_NAME = "goal_mode_dev";
const OPERATION = "dispatch_exact_contract";
// v2 (branchement B1) : le binding lie aussi l'empreinte des règles projet.
const BINDING_VERSION = "goal-mode-dev-approval-binding-v2";

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

// Empreinte de toute la copie gelée remise par 4C-1A (contrat DEV, limites,
// permissions, références) : une approbation ne vaut que pour ce contenu.
function contractFingerprint(exactProjection) {
  return sha256(canonicalJson(exactProjection));
}

// Empreinte des règles projet approuvées (liste ordonnée de textes).
function rulesFingerprint(rules) {
  return sha256(canonicalJson(rules));
}

module.exports = {
  BINDING_VERSION,
  OPERATION,
  SKILL_NAME,
  canonicalJson,
  contractFingerprint,
  rulesFingerprint,
};
