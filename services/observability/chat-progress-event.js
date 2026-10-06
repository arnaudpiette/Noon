"use strict";

const STATES =
  new Set([
    "PLANNED",
    "RUNNING",
    "WAITING",
    "BLOCKED",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
  ]);

const PHASES =
  new Set([
    "PLAN",
    "ACTION",
    "TOOL",
    "VALIDATION",
    "APPROVAL",
    "RECOVERY",
    "FINALIZE",
  ]);

const SOURCES =
  new Set([
    "orchestrator",
    "transactional_execution",
    "background_job",
    "dev_agent_loop",
    "native_dev",
    "execution_tracking",
    "system",
  ]);

function boundedString(
  value,
  maxLength,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(
    0,
    maxLength,
  );
}

function safeInteger(
  value,
  {
    min = 0,
    max = 10_000,
  } = {},
) {
  const numeric =
    Number(value);

  if (
    !Number.isInteger(numeric) ||
    numeric < min ||
    numeric > max
  ) {
    return null;
  }

  return numeric;
}

function safeProgress(value) {
  const numeric =
    Number(value);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(numeric),
    ),
  );
}

function safeReasonCode(value) {
  const normalized =
    boundedString(
      value,
      80,
    )?.toUpperCase();

  if (
    !normalized ||
    !/^[A-Z0-9_-]+$/.test(
      normalized,
    )
  ) {
    return null;
  }

  return normalized;
}

function toChatProgressEvent(
  event,
) {
  if (
    !event ||
    typeof event !== "object"
  ) {
    return null;
  }

  const executionId =
    boundedString(
      event.executionId,
      160,
    );

  const state =
    boundedString(
      event.state,
      32,
    )?.toUpperCase();

  const phase =
    boundedString(
      event.phase,
      32,
    )?.toUpperCase();

  const source =
    boundedString(
      event.source,
      64,
    )?.toLowerCase();

  if (
    !executionId ||
    !STATES.has(state) ||
    !PHASES.has(phase) ||
    !SOURCES.has(source)
  ) {
    return null;
  }

  return Object.freeze({
    version:
      boundedString(
        event.version,
        16,
      ) ||
      "1.0",

    executionId,

    sequence:
      safeInteger(
        event.sequence,
        {
          min: 1,
          max: 1_000_000_000,
        },
      ),

    source,
    state,
    phase,

    progress:
      safeProgress(
        event.progress,
      ),

    currentStep:
      safeInteger(
        event.currentStep,
        {
          min: 1,
        },
      ),

    totalSteps:
      safeInteger(
        event.totalSteps,
        {
          min: 1,
        },
      ),

    reasonCode:
      safeReasonCode(
        event.reasonCode,
      ),
  });
}

module.exports = {
  toChatProgressEvent,
};
