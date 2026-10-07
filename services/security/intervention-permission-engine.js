"use strict";

const crypto = require("node:crypto");

const DECISIONS = Object.freeze({
  PROCEED: "PROCEED",
  CONFIRM: "CONFIRM",
  DENY: "DENY",
  GUIDE: "GUIDE",
});

const SUPPORTED_ACTION_CLASSES = new Set([
  "READ",
  "SUGGEST",
  "PREPARE",
  "WRITE",
  "EXECUTE",
  "DESTRUCTIVE",
]);

const SECURITY_OUTCOMES = Object.freeze({
  ALLOW: "ALLOW",
  ALLOW_WITH_CONSTRAINTS: "ALLOW_WITH_CONSTRAINTS",
  REQUIRE_APPROVAL: "REQUIRE_APPROVAL",
  DENY: "DENY",
  UNAVAILABLE: "UNAVAILABLE",
});

function normalizeString(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function canonicalize(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : null;
  }

  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter(
          (key) =>
            value[key] !== undefined
        )
        .map(
          (key) => [
            key,
            canonicalize(value[key]),
          ]
        )
    );
  }

  return String(value);
}

function fingerprintAction({
  actionRequest = {},
  profileScope = null,
  workspaceId = null,
} = {}) {
  const payload = canonicalize({
    version: 1,

    profileScope:
      normalizeString(profileScope),

    workspaceId:
      normalizeString(workspaceId),

    action: {
      origin:
        normalizeString(
          actionRequest.origin
        ),

      skillId:
        normalizeString(
          actionRequest.skillId
        ),

      operation:
        normalizeString(
          actionRequest.operation
        ),

      actionClass:
        normalizeString(
          actionRequest.actionClass
        ),

      args:
        canonicalize(
          actionRequest.args || {}
        ),

      target:
        canonicalize(
          actionRequest.target || {}
        ),
    },
  });

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

function normalizeReasons(reasons) {
  if (!Array.isArray(reasons)) {
    return [];
  }

  return [
    ...new Set(
      reasons
        .map(normalizeString)
        .filter(Boolean)
    ),
  ];
}

function buildResult({
  decision,
  reasons,
  securityOutcome,
  actionFingerprint,
  policyVersion,
}) {
  return Object.freeze({
    decision,

    executable:
      decision === DECISIONS.PROCEED,

    requiresApproval:
      decision === DECISIONS.CONFIRM,

    guidanceOnly:
      decision === DECISIONS.GUIDE,

    denied:
      decision === DECISIONS.DENY,

    reasons:
      Object.freeze([...reasons]),

    securityOutcome,
    actionFingerprint,
    policyVersion,
  });
}

function createInterventionPermissionEngine({
  policyVersion =
    "intervention-permission-v1",
} = {}) {
  function evaluate(input = {}) {
    const actionRequest =
      input.actionRequest || {};

    const securityDecision =
      input.securityDecision || {};

    const actionFingerprint =
      fingerprintAction({
        actionRequest,
        profileScope:
          input.profileScope,
        workspaceId:
          input.workspaceId,
      });

    const securityOutcome =
      normalizeString(
        securityDecision.outcome
      );

    const securityReasons =
      normalizeReasons(
        securityDecision.reasons
      );

    /*
     * OperationalSecurityPolicy
     * reste l'autorité supérieure.
     *
     * Un DENY ne peut jamais devenir
     * CONFIRM ou PROCEED.
     */
    if (
      securityOutcome ===
      SECURITY_OUTCOMES.DENY
    ) {
      return buildResult({
        decision: DECISIONS.DENY,

        reasons: [
          "SECURITY_POLICY_DENIED",
          ...securityReasons,
        ],

        securityOutcome,
        actionFingerprint,
        policyVersion,
      });
    }

    /*
     * Un service indisponible ne donne
     * aucune autorité d'exécution.
     * GUIDE permet seulement d'expliquer
     * la situation / prochaine action.
     */
    if (
      securityOutcome ===
      SECURITY_OUTCOMES.UNAVAILABLE
    ) {
      return buildResult({
        decision: DECISIONS.GUIDE,

        reasons: [
          "SECURITY_SERVICE_UNAVAILABLE",
          ...securityReasons,
        ],

        securityOutcome,
        actionFingerprint,
        policyVersion,
      });
    }

    /*
     * Contrat natif Noon :
     * - ALLOW
     * - ALLOW_WITH_CONSTRAINTS
     * - REQUIRE_APPROVAL
     *
     * Tout autre outcome échoue fermé.
     */
    if (
      ![
        SECURITY_OUTCOMES.ALLOW,
        SECURITY_OUTCOMES.ALLOW_WITH_CONSTRAINTS,
        SECURITY_OUTCOMES.REQUIRE_APPROVAL,
      ].includes(securityOutcome)
    ) {
      return buildResult({
        decision: DECISIONS.DENY,

        reasons: [
          "SECURITY_DECISION_REQUIRED",
        ],

        securityOutcome:
          securityOutcome || null,

        actionFingerprint,
        policyVersion,
      });
    }

    /*
     * GUIDE n'accorde aucune
     * autorité d'exécution.
     */
    if (
      actionRequest.guidanceOnly === true ||
      actionRequest.executionSupported === false
    ) {
      return buildResult({
        decision: DECISIONS.GUIDE,

        reasons: [
          actionRequest.executionSupported === false
            ? "EXECUTION_UNAVAILABLE"
            : "GUIDANCE_REQUESTED",
        ],

        securityOutcome,
        actionFingerprint,
        policyVersion,
      });
    }

    const actionClass =
      normalizeString(
        actionRequest.actionClass
      );

    if (
      !actionClass ||
      !SUPPORTED_ACTION_CLASSES.has(
        actionClass
      )
    ) {
      return buildResult({
        decision: DECISIONS.DENY,

        reasons: [
          actionClass
            ? "ACTION_CLASS_UNSUPPORTED"
            : "ACTION_CLASS_REQUIRED",
        ],

        securityOutcome,
        actionFingerprint,
        policyVersion,
      });
    }

    /*
     * REQUIRE_APPROVAL est l'outcome
     * canonique de OperationalSecurityPolicy.
     *
     * Les signaux locaux restent utiles
     * pour les adaptateurs qui construisent
     * directement un ActionRequest.
     */
    if (
      securityOutcome ===
        SECURITY_OUTCOMES.REQUIRE_APPROVAL ||
      actionRequest.confirmationRequired === true ||
      actionRequest.externalSideEffect === true ||
      actionRequest.irreversible === true ||
      actionClass === "DESTRUCTIVE" ||
      String(
        actionRequest.sensitivity || ""
      ).toUpperCase() === "HIGH"
    ) {
      return buildResult({
        decision: DECISIONS.CONFIRM,

        reasons: [
          "USER_CONFIRMATION_REQUIRED",
        ],

        securityOutcome,
        actionFingerprint,
        policyVersion,
      });
    }

    return buildResult({
      decision: DECISIONS.PROCEED,

      reasons: [
        securityOutcome ===
          SECURITY_OUTCOMES.ALLOW_WITH_CONSTRAINTS
          ? "SECURITY_ALLOWED_WITH_CONSTRAINTS"
          : "SECURITY_ALLOWED",
        ...securityReasons,
      ],

      securityOutcome,
      actionFingerprint,
      policyVersion,
    });
  }

  return Object.freeze({
    evaluate,
    fingerprintAction,
    decisions: DECISIONS,
    policyVersion,
  });
}

module.exports = {
  DECISIONS,
  fingerprintAction,
  createInterventionPermissionEngine,
};
