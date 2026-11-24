// @ts-check
"use strict";

// V3-L7 — primitives du bac à sable des processus DEV (niveaux, statuts, capacités OS, limites
// par défaut et maximales, clés de contrat, erreur typée, contrôles de clés, empreinte,
// racine existante canonique, résolution d'exécutable, environnement minimal, normalisation des
// limites, capacités et autorité, gel profond), sorties telles quelles de dev-process-runner.js.
// Aucune règle de sécurité n'est modifiée ; dev-process-runner.js réexporte les mêmes valeurs.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SANDBOX_LEVELS = Object.freeze({
  APPLICATION_CONSTRAINED:
    "APPLICATION_CONSTRAINED",
  OS_SANDBOXED:
    "OS_SANDBOXED",
});

const RESULT_STATUSES = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  CANCELLED: "CANCELLED",
  TIMEOUT: "TIMEOUT",
  CLEANUP_UNCONFIRMED:
    "CLEANUP_UNCONFIRMED",
});

const OS_CAPABILITIES = Object.freeze([
  "filesystemContainment",
  "networkDenied",
  "descendantContainment",
]);

const MAX_LIMITS = Object.freeze({
  wallTimeMs: 30 * 60_000,
  terminateGraceMs: 10_000,
  stdoutBytes: 10 * 1024 * 1024,
  stderrBytes: 10 * 1024 * 1024,
});

const DEFAULT_LIMITS = Object.freeze({
  wallTimeMs: 120_000,
  terminateGraceMs: 2_000,
  stdoutBytes: 2 * 1024 * 1024,
  stderrBytes: 2 * 1024 * 1024,
});

const CONTRACT_KEYS = new Set([
  "version",
  "executionId",
  "owner",
  "purpose",
  "workspaceId",
  "workspaceSessionId",
  "canonicalWorkspaceRoot",
  "commandProfileId",
  "canonicalCommand",
  "commandFingerprint",
  "executableIdentity",
  "argv",
  "environmentProfileId",
  "limits",
  "requiredCapabilities",
  "authority",
  "isolation",
  "createdAt",
  "expiresAt",
]);

const BUILD_INPUT_KEYS = new Set([
  "executionId",
  "workspaceId",
  "workspaceSessionId",
  "canonicalWorkspaceRoot",
  "command",
  "limits",
  "requiredCapabilities",
  "authority",
  "createdAt",
  "expiresAt",
]);

class DevProcessRunnerError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "DevProcessRunnerError";
    this.code = code;
  }
}

/**
 * Lève toujours une DevProcessRunnerError.
 * @param {string} code
 * @param {string} message
 * @returns {never}
 */
function fail(code, message) {
  throw new DevProcessRunnerError(
    code,
    message
  );
}

/**
 * @param {unknown} value
 * @param {number} [max]
 */
function clean(value, max = 180) {
  return String(value ?? "")
    .replace(/[\0\r\n]+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * @param {unknown} value
 * @param {Set<string>} allowed
 * @param {string} code
 */
function assertKnownKeys(
  value,
  allowed,
  code
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    fail(
      code,
      "Objet Sandbox invalide."
    );
  }

  const unknown =
    Object.keys(value)
      .filter(
        (key) =>
          !allowed.has(key)
      );

  if (unknown.length) {
    fail(
      code,
      "Champ Sandbox inconnu."
    );
  }
}

/** @param {unknown} value */
function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value))
    .digest("hex");
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function canonicalExistingRoot(
  value
) {
  const requested =
    path.resolve(
      String(value || "")
    );

  let real;

  try {
    real =
      fs.realpathSync(requested);
  } catch {
    fail(
      "SANDBOX_WORKSPACE_UNAVAILABLE",
      "Racine Workspace indisponible."
    );
  }

  if (requested !== real) {
    fail(
      "SANDBOX_ROOT_NOT_CANONICAL",
      "La racine Workspace doit déjà être canonique."
    );
  }

  let stat;

  try {
    stat = fs.statSync(real);
  } catch {
    fail(
      "SANDBOX_WORKSPACE_UNAVAILABLE",
      "Racine Workspace indisponible."
    );
  }

  if (!stat.isDirectory()) {
    fail(
      "SANDBOX_WORKSPACE_INVALID",
      "La racine Workspace doit être un dossier."
    );
  }

  return real;
}

/**
 * @param {unknown} executable
 * @param {NodeJS.ProcessEnv} [environment]
 * @returns {string}
 */
function resolveExecutableFromPath(
  executable,
  environment = process.env
) {
  const name =
    String(executable || "");

  if (!name) {
    fail(
      "SANDBOX_EXECUTABLE_UNAVAILABLE",
      "Exécutable Sandbox absent."
    );
  }

  const candidates =
    path.isAbsolute(name)
      ? [name]
      : String(
          environment.PATH || ""
        )
          .split(path.delimiter)
          .filter(Boolean)
          .map(
            (directory) =>
              path.join(
                directory,
                name
              )
          );

  for (
    const candidate of
    candidates
  ) {
    try {
      fs.accessSync(
        candidate,
        fs.constants.X_OK
      );

      return fs.realpathSync(
        candidate
      );
    } catch {}
  }

  fail(
    "SANDBOX_EXECUTABLE_UNAVAILABLE",
    "Exécutable Sandbox introuvable."
  );
}

/**
 * @param {NodeJS.ProcessEnv} [source]
 * @returns {Record<string, string>}
 */
function minimalEnvironment(
  source = process.env
) {
  /** @type {Record<string, string>} */
  const environment = {
    CI: "1",
    NO_COLOR: "1",
  };

  for (const key of [
    "PATH",
    "LANG",
    "LC_ALL",
    "TERM",
    "TMPDIR",
  ]) {
    if (
      source[key] != null
    ) {
      environment[key] =
        String(source[key]);
    }
  }

  if (!environment.PATH) {
    environment.PATH =
      "/usr/bin:/bin:/usr/sbin:/sbin";
  }

  return environment;
}

/**
 * @param {Record<string, unknown>} [input]
 * @returns {Record<string, number>}
 */
function normalizedLimits(
  input = {}
) {
  /** @type {Record<string, number>} */
  const result = {};

  for (
    const key of
    Object.keys(DEFAULT_LIMITS)
  ) {
    const value =
      input[key] == null
        ? /** @type {Record<string, number>} */ (DEFAULT_LIMITS)[key]
        : Number(input[key]);

    if (
      !Number.isInteger(value) ||
      value <= 0 ||
      value >
        /** @type {Record<string, number>} */ (MAX_LIMITS)[key]
    ) {
      fail(
        "SANDBOX_LIMIT_INVALID",
        "Limite Sandbox invalide."
      );
    }

    result[key] = value;
  }

  const unknown =
    Object.keys(input)
      .filter(
        (key) =>
          !Object.prototype
            .hasOwnProperty.call(
              DEFAULT_LIMITS,
              key
            )
      );

  if (unknown.length) {
    fail(
      "SANDBOX_LIMIT_INVALID",
      "Limite Sandbox inconnue."
    );
  }

  return result;
}

/**
 * @param {Record<string, unknown>} [input]
 * @returns {Record<string, boolean>}
 */
function normalizedCapabilities(
  input = {}
) {
  const unknown =
    Object.keys(input)
      .filter(
        (key) =>
          !OS_CAPABILITIES
            .includes(key)
      );

  if (unknown.length) {
    fail(
      "SANDBOX_CAPABILITY_INVALID",
      "Capacité Sandbox inconnue."
    );
  }

  return Object.fromEntries(
    OS_CAPABILITIES.map(
      (key) => [
        key,
        input[key] === true,
      ]
    )
  );
}

/**
 * @param {Record<string, unknown>} [value]
 */
function normalizedAuthority(
  value = {}
) {
  const allowed =
    new Set([
      "policyDecisionId",
      "policyVersion",
      "actionFingerprint",
      "budgetDecisionId",
      "approvalId",
    ]);

  assertKnownKeys(
    value,
    allowed,
    "SANDBOX_AUTHORITY_INVALID"
  );

  return {
    policyDecisionId:
      clean(
        value.policyDecisionId
      ) || null,

    policyVersion:
      clean(
        value.policyVersion
      ) || null,

    actionFingerprint:
      clean(
        value.actionFingerprint,
        256
      ) || null,

    budgetDecisionId:
      clean(
        value.budgetDecisionId
      ) || null,

    approvalId:
      clean(
        value.approvalId
      ) || null,
  };
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  Object.freeze(value);

  for (
    const child of
    Object.values(value)
  ) {
    deepFreeze(child);
  }

  return value;
}

module.exports = {
  SANDBOX_LEVELS,
  RESULT_STATUSES,
  OS_CAPABILITIES,
  MAX_LIMITS,
  DEFAULT_LIMITS,
  CONTRACT_KEYS,
  BUILD_INPUT_KEYS,
  DevProcessRunnerError,
  fail,
  clean,
  assertKnownKeys,
  sha256,
  canonicalExistingRoot,
  resolveExecutableFromPath,
  minimalEnvironment,
  normalizedLimits,
  normalizedCapabilities,
  normalizedAuthority,
  deepFreeze,
};
