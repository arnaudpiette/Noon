"use strict";

const VERSION =
  "goal-dev-retry-http-contract-v1";

function fail(
  code,
  message
) {
  throw Object.assign(
    new Error(message),
    { code }
  );
}

function object(
  value,
  label
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    fail(
      "GOAL_DEV_RETRY_HTTP_BODY_INVALID",
      `${label} invalide.`
    );
  }

  return value;
}

function exactKeys(
  value,
  allowed,
  label
) {
  for (
    const key of
      Object.keys(value)
  ) {
    if (
      !allowed.has(key)
    ) {
      fail(
        "GOAL_DEV_RETRY_HTTP_BODY_INVALID",
        `${label}.${key} non autorisé.`
      );
    }
  }
}

function string(
  value,
  label,
  {
    max = 200,
    pattern = null,
  } = {}
) {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > max ||
    (
      pattern &&
      !pattern.test(value)
    )
  ) {
    fail(
      "GOAL_DEV_RETRY_HTTP_BODY_INVALID",
      `${label} invalide.`
    );
  }

  return value;
}

function frozen(
  value
) {
  if (
    !value ||
    typeof value !== "object" ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  for (
    const child of
      Object.values(value)
  ) {
    frozen(child);
  }

  return Object.freeze(value);
}

function normalizeGoalDevRetryPrepareRequest(
  body
) {
  const source =
    object(
      body,
      "body"
    );

  exactKeys(
    source,
    new Set([
      "chainId",
    ]),
    "body"
  );

  return frozen({
    chainId:
      string(
        source.chainId,
        "chainId"
      ),
  });
}

function normalizeGoalDevRetryResumeRequest(
  body
) {
  const source =
    object(
      body,
      "body"
    );

  exactKeys(
    source,
    new Set([
      "approvalId",
      "resumeToken",
      "decision",
    ]),
    "body"
  );

  const decision =
    string(
      source.decision,
      "decision",
      {
        max: 10,
      }
    );

  if (
    ![
      "approve",
      "reject",
    ].includes(
      decision
    )
  ) {
    fail(
      "GOAL_DEV_RETRY_HTTP_BODY_INVALID",
      "decision doit valoir approve ou reject."
    );
  }

  return frozen({
    approvalId:
      string(
        source.approvalId,
        "approvalId",
        {
          max: 80,
          pattern:
            /^approval_[0-9a-f-]{36}$/,
        }
      ),

    resumeToken:
      string(
        source.resumeToken,
        "resumeToken",
        {
          max: 43,
          pattern:
            /^[A-Za-z0-9_-]{43}$/,
        }
      ),

    decision,
  });
}

function safeApproval(
  approval
) {
  const source =
    object(
      approval,
      "approval"
    );

  const approvalId =
    string(
      source.approvalId ||
        source.id,
      "approval.approvalId",
      {
        max: 80,
        pattern:
          /^approval_[0-9a-f-]{36}$/,
      }
    );

  const status =
    string(
      source.status,
      "approval.status",
      {
        max: 40,
      }
    );

  return frozen({
    approvalId,
    status,

    expiresAt:
      typeof source.expiresAt ===
        "string"
        ? source.expiresAt
        : null,
  });
}

function projectGoalDevRetryPermitResponse(
  permit
) {
  const source =
    object(
      permit,
      "permit"
    );

  if (
    source.permitState !==
      "PENDING_APPROVAL" ||
    source.approval?.status !==
      "pending" ||
    source.authority
      ?.retryAuthorized !==
      false ||
    source.authority
      ?.executionAuthorized !==
      false ||
    source.authority
      ?.approvalGranted !==
      false ||
    source.authority
      ?.securityBypassed !==
      false
  ) {
    fail(
      "GOAL_DEV_RETRY_HTTP_RESPONSE_INVALID",
      "Retry Permit public invalide."
    );
  }

  const binding =
    object(
      source.binding,
      "permit.binding"
    );

  const approval =
    safeApproval(
      source.approval
    );

  const resumeToken =
    string(
      source.approval
        .resumeToken,
      "approval.resumeToken",
      {
        max: 43,
        pattern:
          /^[A-Za-z0-9_-]{43}$/,
      }
    );

  return frozen({
    version: VERSION,

    permitState:
      "PENDING_APPROVAL",

    preparedAt:
      typeof source.preparedAt ===
        "string"
        ? source.preparedAt
        : null,

    chainId:
      string(
        binding.chainId,
        "binding.chainId"
      ),

    taskId:
      string(
        binding.taskId,
        "binding.taskId"
      ),

    attemptIndex:
      Number.isSafeInteger(
        binding.attemptIndex
      )
        ? binding.attemptIndex
        : null,

    approval: {
      ...approval,
      resumeToken,
    },

    authority: {
      retryAuthorized: false,
      executionAuthorized:
        false,
      approvalGranted: false,
      securityBypassed: false,
    },
  });
}

function terminalResult(
  result
) {
  const source =
    object(
      result,
      "result"
    );

  if (
    source.authority
      ?.approvalConsumedBy !==
      "ApprovalEngine" ||
    source.authority
      ?.retrySelfAuthorized !==
      false ||
    source.authority
      ?.securityBypassed !==
      false
  ) {
    fail(
      "GOAL_DEV_RETRY_HTTP_RESPONSE_INVALID",
      "Résultat Retry public invalide."
    );
  }

  return frozen({
    version:
      string(
        source.version,
        "result.version"
      ),

    chainId:
      string(
        source.chainId,
        "result.chainId"
      ),

    taskId:
      string(
        source.taskId,
        "result.taskId"
      ),

    attemptIndex:
      Number.isSafeInteger(
        source.attemptIndex
      )
        ? source.attemptIndex
        : null,

    finalVerdict:
      string(
        source.finalVerdict,
        "result.finalVerdict",
        {
          max: 40,
        }
      ),

    failureCategory:
      typeof source
        .failureCategory ===
        "string"
        ? source
            .failureCategory
            .slice(0, 120)
        : null,

    continuationState:
      string(
        source.continuationState,
        "result.continuationState",
        {
          max: 40,
        }
      ),

    estimatedCost:
      typeof source
        .estimatedCost ===
        "number" &&
      Number.isFinite(
        source.estimatedCost
      )
        ? source.estimatedCost
        : null,

    actualCost:
      typeof source
        .actualCost ===
        "number" &&
      Number.isFinite(
        source.actualCost
      )
        ? source.actualCost
        : null,

    chainRevision:
      Number.isSafeInteger(
        source.chainRevision
      )
        ? source.chainRevision
        : null,

    authority: {
      approvalConsumedBy:
        "ApprovalEngine",

      retrySelfAuthorized:
        false,

      securityBypassed:
        false,
    },
  });
}

function projectGoalDevRetryResumeResponse(
  value
) {
  const source =
    object(
      value,
      "resume"
    );

  if (
    ![
      "consumed",
      "rejected",
    ].includes(
      source.status
    )
  ) {
    fail(
      "GOAL_DEV_RETRY_HTTP_RESPONSE_INVALID",
      "État Approval Retry invalide."
    );
  }

  const approval =
    safeApproval(
      source.approval
    );

  if (
    source.status ===
      "rejected"
  ) {
    if (
      source.result !==
        null
    ) {
      fail(
        "GOAL_DEV_RETRY_HTTP_RESPONSE_INVALID",
        "Un Retry rejeté ne peut exposer de résultat d'exécution."
      );
    }

    return frozen({
      version: VERSION,
      status: "rejected",
      approval,
      execution: null,
    });
  }

  return frozen({
    version: VERSION,
    status: "consumed",
    approval,

    execution:
      terminalResult(
        source.result
      ),
  });
}

function goalDevRetryHttpStatus(
  error
) {
  const code =
    String(
      error?.code || ""
    );

  if (
    [
      "TRUSTED_UI_REQUIRED",
      "APPROVAL_TOKEN_INVALID",
      "GOAL_DEV_RETRY_PERMISSION_DENIED",
      "GOAL_DEV_RETRY_SECURITY_DENIED",
      "GOAL_DEV_RETRY_WRITE_PERMISSION_REQUIRED",
      "GOAL_DEV_RETRY_PROFILE_MISMATCH",
      "GOAL_DEV_RETRY_PROJECT_MISMATCH",
      "HARD_RULE_RECHECK_FAILED",
      "PERMISSION_RECHECK_FAILED",
      "CONNECTOR_RECHECK_FAILED",
    ].includes(code)
  ) {
    return 403;
  }

  if (
    [
      "APPROVAL_NOT_FOUND",
      "GOAL_DEV_RETRY_CHAIN_NOT_FOUND",
      "GOAL_DEV_RETRY_PROJECT_UNAVAILABLE",
      "GOAL_DEV_RETRY_WORKSPACE_UNAVAILABLE",
    ].includes(code)
  ) {
    return 404;
  }

  if (
    code ===
      "approval_expired"
  ) {
    return 410;
  }

  if (
    [
      "APPROVAL_CONSUMED",
      "APPROVAL_IN_FLIGHT",
      "APPROVAL_INVALID",
      "APPROVAL_ACTION_CHANGED",
      "approval_stale",
      "GOAL_DEV_RETRY_APPROVED_BINDING_STALE",
      "GOAL_DEV_RETRY_PERSISTENCE_CONFLICT",
      "GOAL_DEV_RETRY_NOT_ELIGIBLE",
    ].includes(code)
  ) {
    return 409;
  }

  if (
    [
      "GOAL_DEV_RETRY_ATOMIC_PERSISTENCE_REQUIRED",
      "GOAL_DEV_RETRY_SECURITY_UNAVAILABLE",
    ].includes(code)
  ) {
    return 503;
  }

  const explicit =
    Number(
      error?.statusCode
    );

  if (
    Number.isInteger(explicit) &&
    explicit >= 400 &&
    explicit <= 599
  ) {
    return explicit;
  }

  return 400;
}

module.exports = {
  VERSION,
  goalDevRetryHttpStatus,
  normalizeGoalDevRetryPrepareRequest,
  normalizeGoalDevRetryResumeRequest,
  projectGoalDevRetryPermitResponse,
  projectGoalDevRetryResumeResponse,
};
