"use strict";

const PROGRESS_EVENT_VERSION = "1.0";

const STATES = Object.freeze({
  PLANNED: "PLANNED",
  RUNNING: "RUNNING",
  WAITING: "WAITING",
  BLOCKED: "BLOCKED",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
});

const PHASES = Object.freeze({
  PLAN: "PLAN",
  ACTION: "ACTION",
  TOOL: "TOOL",
  VALIDATION: "VALIDATION",
  APPROVAL: "APPROVAL",
  RECOVERY: "RECOVERY",
  FINALIZE: "FINALIZE",
});

const SOURCES = new Set([
  "orchestrator",
  "transactional_execution",
  "background_job",
  "dev_agent_loop",
  "native_dev",
  "execution_tracking",
  "system",
]);

const STATE_VALUES = new Set(
  Object.values(STATES),
);

const PHASE_VALUES = new Set(
  Object.values(PHASES),
);

const FORBIDDEN_FIELDS =
  /(?:chain|reasoning|thought|prompt|raw|content|message|args?|arguments?|input|output|secret|password|token|credential)/i;

const LABELS = Object.freeze({
  "PLANNED:PLAN": "Planifié",
  "RUNNING:PLAN": "Planification",
  "RUNNING:ACTION": "Exécution en cours",
  "RUNNING:TOOL": "Outil en cours",
  "RUNNING:VALIDATION": "Vérification",
  "RUNNING:RECOVERY": "Reprise en cours",
  "RUNNING:FINALIZE": "Finalisation",
  "WAITING:APPROVAL": "Validation requise",
  "WAITING:ACTION": "En attente",
  "BLOCKED:APPROVAL": "Bloqué — validation requise",
  "BLOCKED:ACTION": "Bloqué",
  "SUCCEEDED:FINALIZE": "Terminé",
  "SUCCEEDED:VALIDATION": "Terminé et vérifié",
  "FAILED:ACTION": "Erreur",
  "FAILED:TOOL": "Erreur pendant l’exécution",
  "FAILED:VALIDATION": "Échec de la vérification",
  "FAILED:RECOVERY": "Échec de la reprise",
  "CANCELLED:ACTION": "Annulé",
});

function progressError(
  code,
  message,
) {
  return Object.assign(
    new Error(message),
    { code },
  );
}

function cleanIdentifier(
  value,
  field,
  {
    required = false,
    max = 160,
  } = {},
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    if (required) {
      throw progressError(
        "PROGRESS_ID_REQUIRED",
        `${field} requis.`,
      );
    }

    return null;
  }

  const normalized =
    String(value).trim();

  if (
    !normalized ||
    normalized.length > max ||
    !/^[A-Za-z0-9._:/-]+$/.test(
      normalized,
    )
  ) {
    throw progressError(
      "PROGRESS_ID_INVALID",
      `${field} invalide.`,
    );
  }

  return normalized;
}

function normalizeProgress(
  value,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const number =
    Number(value);

  if (!Number.isFinite(number)) {
    throw progressError(
      "PROGRESS_PERCENT_INVALID",
      "Progression invalide.",
    );
  }

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(number),
    ),
  );
}

function normalizeStepNumber(
  value,
  field,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const number =
    Number(value);

  if (
    !Number.isInteger(number) ||
    number < 1 ||
    number > 10_000
  ) {
    throw progressError(
      "PROGRESS_STEP_INVALID",
      `${field} invalide.`,
    );
  }

  return number;
}

function safeReasonCode(
  value,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const code =
    String(value)
      .trim()
      .toUpperCase();

  if (
    code.length > 80 ||
    !/^[A-Z0-9_-]+$/.test(code)
  ) {
    throw progressError(
      "PROGRESS_REASON_CODE_INVALID",
      "reasonCode invalide.",
    );
  }

  return code;
}

function assertNoUnsafeFields(
  input,
) {
  for (
    const key of Object.keys(
      input || {},
    )
  ) {
    if (FORBIDDEN_FIELDS.test(key)) {
      throw progressError(
        "PROGRESS_UNSAFE_FIELD",
        `Champ interdit : ${key}`,
      );
    }
  }
}

function labelFor(
  state,
  phase,
) {
  return (
    LABELS[`${state}:${phase}`] ||
    LABELS[`${state}:ACTION`] ||
    (
      state === STATES.SUCCEEDED
        ? "Terminé"
        : state === STATES.FAILED
          ? "Erreur"
          : state === STATES.BLOCKED
            ? "Bloqué"
            : state === STATES.CANCELLED
              ? "Annulé"
              : "En cours"
    )
  );
}

function createUserProgressEngine({
  now = () => Date.now(),
  onEvent = null,
  historyLimit = 200,
} = {}) {
  const listeners =
    new Set();

  const histories =
    new Map();

  const lastSignatures =
    new Map();

  const sequences =
    new Map();

  const boundedHistoryLimit =
    Math.max(
      1,
      Math.min(
        2_000,
        Number(historyLimit) || 200,
      ),
    );

  function normalize(
    input = {},
  ) {
    assertNoUnsafeFields(input);

    const executionId =
      cleanIdentifier(
        input.executionId,
        "executionId",
        { required: true },
      );

    const stepId =
      cleanIdentifier(
        input.stepId,
        "stepId",
      );

    const state =
      String(
        input.state || "",
      ).toUpperCase();

    const phase =
      String(
        input.phase || "",
      ).toUpperCase();

    const source =
      String(
        input.source || "",
      ).toLowerCase();

    if (!STATE_VALUES.has(state)) {
      throw progressError(
        "PROGRESS_STATE_INVALID",
        "État de progression invalide.",
      );
    }

    if (!PHASE_VALUES.has(phase)) {
      throw progressError(
        "PROGRESS_PHASE_INVALID",
        "Phase de progression invalide.",
      );
    }

    if (!SOURCES.has(source)) {
      throw progressError(
        "PROGRESS_SOURCE_INVALID",
        "Source de progression invalide.",
      );
    }

    const currentStep =
      normalizeStepNumber(
        input.currentStep,
        "currentStep",
      );

    const totalSteps =
      normalizeStepNumber(
        input.totalSteps,
        "totalSteps",
      );

    if (
      currentStep !== null &&
      totalSteps !== null &&
      currentStep > totalSteps
    ) {
      throw progressError(
        "PROGRESS_STEP_RANGE_INVALID",
        "currentStep dépasse totalSteps.",
      );
    }

    return {
      executionId,
      stepId,
      state,
      phase,
      source,
      progress:
        normalizeProgress(
          input.progress,
        ),
      currentStep,
      totalSteps,
      reasonCode:
        safeReasonCode(
          input.reasonCode,
        ),
    };
  }

  function signatureFor(
    event,
  ) {
    return JSON.stringify({
      executionId:
        event.executionId,
      stepId:
        event.stepId,
      state:
        event.state,
      phase:
        event.phase,
      source:
        event.source,
      progress:
        event.progress,
      currentStep:
        event.currentStep,
      totalSteps:
        event.totalSteps,
      reasonCode:
        event.reasonCode,
    });
  }

  function publish(
    input = {},
  ) {
    const normalized =
      normalize(input);

    const signature =
      signatureFor(
        normalized,
      );

    if (
      lastSignatures.get(
        normalized.executionId,
      ) === signature
    ) {
      const previous =
        latest(
          normalized.executionId,
        );

      return {
        emitted: false,
        event: previous,
      };
    }

    const sequence =
      (
        sequences.get(
          normalized.executionId,
        ) || 0
      ) + 1;

    sequences.set(
      normalized.executionId,
      sequence,
    );

    const event =
      Object.freeze({
        version:
          PROGRESS_EVENT_VERSION,

        eventId:
          `${normalized.executionId}:${sequence}`,

        executionId:
          normalized.executionId,

        stepId:
          normalized.stepId,

        state:
          normalized.state,

        phase:
          normalized.phase,

        label:
          labelFor(
            normalized.state,
            normalized.phase,
          ),

        progress:
          normalized.progress,

        currentStep:
          normalized.currentStep,

        totalSteps:
          normalized.totalSteps,

        source:
          normalized.source,

        userVisible: true,

        reasonCode:
          normalized.reasonCode,

        at:
          new Date(
            now(),
          ).toISOString(),
      });

    const history =
      histories.get(
        normalized.executionId,
      ) || [];

    history.push(event);

    if (
      history.length >
      boundedHistoryLimit
    ) {
      history.splice(
        0,
        history.length -
          boundedHistoryLimit,
      );
    }

    histories.set(
      normalized.executionId,
      history,
    );

    lastSignatures.set(
      normalized.executionId,
      signature,
    );

    if (
      typeof onEvent ===
      "function"
    ) {
      onEvent(event);
    }

    for (
      const listener of
      listeners
    ) {
      listener(event);
    }

    return {
      emitted: true,
      event,
    };
  }

  function latest(
    executionId,
  ) {
    const id =
      cleanIdentifier(
        executionId,
        "executionId",
        { required: true },
      );

    const history =
      histories.get(id) || [];

    return (
      history[
        history.length - 1
      ] || null
    );
  }

  function list(
    executionId,
  ) {
    const id =
      cleanIdentifier(
        executionId,
        "executionId",
        { required: true },
      );

    return [
      ...(
        histories.get(id) ||
        []
      ),
    ];
  }

  function subscribe(
    listener,
  ) {
    if (
      typeof listener !==
      "function"
    ) {
      throw new TypeError(
        "Listener requis.",
      );
    }

    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  }

  function clear(
    executionId,
  ) {
    const id =
      cleanIdentifier(
        executionId,
        "executionId",
        { required: true },
      );

    histories.delete(id);
    lastSignatures.delete(id);
    sequences.delete(id);
  }

  return {
    clear,
    latest,
    list,
    normalize,
    publish,
    subscribe,

    phases: PHASES,
    states: STATES,

    version:
      PROGRESS_EVENT_VERSION,
  };
}

module.exports = {
  LABELS,
  PHASES,
  PROGRESS_EVENT_VERSION,
  SOURCES,
  STATES,
  createUserProgressEngine,
};
