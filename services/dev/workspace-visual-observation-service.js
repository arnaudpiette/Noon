"use strict";

const MAX_CAPTURE_BYTES =
  4 * 1024 * 1024;

const MAX_CAPTURE_DATA_URL_BYTES =
  6 * 1024 * 1024;

const MAX_TASK_LENGTH = 1000;
const MAX_OBSERVATIONS = 8;
const MAX_INFERENCES = 4;
const MAX_UNCERTAINTIES = 6;

class DevVisualObservationError extends Error {
  constructor(code, message) {
    super(message);
    this.name =
      "DevVisualObservationError";
    this.code = code;
  }
}

function clean(value, max = 500) {
  return String(value || "")
    .replace(/[\0\r\n]+/g, " ")
    .trim()
    .slice(0, max);
}

function safeConfidence(value) {
  const normalized =
    String(value || "")
      .toUpperCase();

  return [
    "HIGH",
    "MEDIUM",
    "LOW",
    "UNKNOWN",
  ].includes(normalized)
    ? normalized
    : "UNKNOWN";
}

function normalizeRegion(region) {
  if (
    !region ||
    typeof region !== "object"
  ) {
    return null;
  }

  const values = [
    region.x,
    region.y,
    region.width,
    region.height,
  ].map(Number);

  if (
    !values.every(Number.isFinite) ||
    !values.every(
      (value) => value >= 0
    )
  ) {
    return null;
  }

  return {
    x: values[0],
    y: values[1],
    width: values[2],
    height: values[3],
  };
}

function normalizeFinding(item) {
  const content =
    clean(item?.content, 700);

  if (!content) {
    return null;
  }

  const observationType =
    item?.observationType ===
    "INFERENCE"
      ? "INFERENCE"
      : "OBSERVATION";

  const allowedTypes =
    new Set([
      "TEXT",
      "VISUAL_OBSERVATION",
      "TABLE",
      "CHART",
      "METADATA",
    ]);

  return {
    type:
      allowedTypes.has(item?.type)
        ? item.type
        : "VISUAL_OBSERVATION",

    content,

    confidence:
      safeConfidence(
        item?.confidence
      ),

    observationType,

    region:
      normalizeRegion(
        item?.locator?.region ||
          item?.region
      ),

    derivedFrom:
      observationType ===
        "INFERENCE" &&
      Array.isArray(
        item?.derivedFrom
      )
        ? item.derivedFrom
            .slice(0, 8)
            .map((value) =>
              clean(value, 160)
            )
            .filter(Boolean)
        : [],
  };
}

function validateCaptureDataUrl(
  rawDataUrl
) {
  const dataUrl =
    String(rawDataUrl || "");

  if (
    Buffer.byteLength(
      dataUrl,
      "utf8"
    ) >
    MAX_CAPTURE_DATA_URL_BYTES
  ) {
    throw new DevVisualObservationError(
      "DEV_VISUAL_CAPTURE_TOO_LARGE",
      "Capture Preview trop volumineuse."
    );
  }

  const prefix =
    "data:image/jpeg;base64,";

  if (
    !dataUrl.startsWith(prefix)
  ) {
    throw new DevVisualObservationError(
      "DEV_VISUAL_CAPTURE_INVALID",
      "La capture Preview doit être un JPEG."
    );
  }

  const encoded =
    dataUrl.slice(prefix.length);

  if (
    !encoded ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(
      encoded
    )
  ) {
    throw new DevVisualObservationError(
      "DEV_VISUAL_CAPTURE_INVALID",
      "Encodage de capture Preview invalide."
    );
  }

  const buffer =
    Buffer.from(
      encoded,
      "base64"
    );

  if (
    buffer.length === 0 ||
    buffer.length >
      MAX_CAPTURE_BYTES
  ) {
    throw new DevVisualObservationError(
      "DEV_VISUAL_CAPTURE_TOO_LARGE",
      "Capture Preview trop volumineuse."
    );
  }

  if (
    buffer.length < 3 ||
    buffer[0] !== 0xff ||
    buffer[1] !== 0xd8 ||
    buffer[2] !== 0xff
  ) {
    throw new DevVisualObservationError(
      "DEV_VISUAL_CAPTURE_INVALID",
      "Signature JPEG invalide."
    );
  }

  return dataUrl;
}

function createDevWorkspaceVisualObservationService({
  multimodalEngine,
  observability = null,
} = {}) {
  if (
    !multimodalEngine?.analyzeTransient
  ) {
    throw new TypeError(
      "MultimodalEngine requis."
    );
  }

  const emit = (
    event,
    metadata = {}
  ) => {
    try {
      observability?.(
        event,
        metadata
      );
    } catch {}
  };

  async function observe(
    input = {}
  ) {
    const dataUrl =
      validateCaptureDataUrl(
        input.dataUrl
      );

    const executionId =
      clean(
        input.executionId,
        180
      ) || null;

    const workspaceId =
      clean(
        input.workspaceId,
        180
      ) || null;

    const task =
      clean(
        input.task,
        MAX_TASK_LENGTH
      ) ||
      "Inspecter la Preview DEV.";

    const allowRemote =
      input.allowRemote === true;

    emit(
      "visual_observation_started",
      {
        executionId,
        workspaceId,
        remoteRequested:
          allowRemote,
      }
    );

    try {
      const pack =
        await multimodalEngine.analyzeTransient(
          {
            source: {
              dataUrl,
              filename:
                "noon-dev-preview.jpg",
              mimeType:
                "image/jpeg",
            },

            sourceType:
              "SCREEN_CAPTURE",

            sourceScope:
              "PERSONAL",

            workspaceId,

            conversationId:
              executionId,

            localOnly:
              !allowRemote,

            userIntent:
              [
                "Inspecte la Preview DEV après l'exécution et la validation.",
                "Décris uniquement ce qui est réellement visible.",
                "Repère notamment page blanche, erreur affichée, overlay bloquant, élément manifestement cassé, débordement ou incohérence visuelle observable.",
                `Tâche DEV : ${task}`,
              ].join(" "),

            requestedOutputs: [
              "SUMMARY",
              "EVIDENCE",
            ],

            analysisDepth:
              "STANDARD",

            privacyContext: {
              sourceScope:
                "PERSONAL",
              allowRemote,
            },

            modelProfile:
              input.modelProfile ||
              "balanced",

            budgetMode:
              input.budgetMode ||
              "NORMAL",

            signal:
              input.signal,
          }
        );

      const normalized =
        (
          Array.isArray(
            pack?.evidence
          )
            ? pack.evidence
            : []
        )
          .map(
            normalizeFinding
          )
          .filter(Boolean);

      const observations =
        normalized
          .filter(
            (item) =>
              item.observationType ===
              "OBSERVATION"
          )
          .slice(
            0,
            MAX_OBSERVATIONS
          );

      const inferences =
        normalized
          .filter(
            (item) =>
              item.observationType ===
              "INFERENCE"
          )
          .slice(
            0,
            MAX_INFERENCES
          );

      const uncertainties =
        (
          Array.isArray(
            pack?.uncertainties
          )
            ? pack.uncertainties
            : []
        )
          .slice(
            0,
            MAX_UNCERTAINTIES
          )
          .map((item) => ({
            code:
              clean(
                item?.code,
                100
              ) ||
              "UNKNOWN",

            message:
              clean(
                item?.message,
                300
              ),
          }));

      const partial =
        pack?.coverage
          ?.partial === true;

      const findingCount =
        observations.length +
        inferences.length;

      const status =
        findingCount > 0
          ? partial
            ? "PARTIAL"
            : "ANALYZED"
          : partial
            ? "UNAVAILABLE"
            : "EMPTY";

      const result = {
        status,

        source:
          "DEV_PREVIEW_VISION",

        remoteAnalysisRequested:
          allowRemote,

        summary:
          observations[0]
            ?.content ||
          inferences[0]
            ?.content ||
          null,

        observations,

        inferences,

        uncertainties,

        coverage: {
          requestedAssets:
            Number(
              pack?.coverage
                ?.requestedAssets
            ) || 1,

          analyzedAssets:
            Number(
              pack?.coverage
                ?.analyzedAssets
            ) || 0,

          evidenceCount:
            Number(
              pack?.coverage
                ?.evidenceCount
            ) || 0,

          partial,
        },

        latencyMs:
          Math.max(
            0,
            Number(
              pack?.latency
                ?.totalMs
            ) || 0
          ),
      };

      emit(
        "visual_observation_completed",
        {
          executionId,
          workspaceId,
          status:
            result.status,
          observations:
            observations.length,
          inferences:
            inferences.length,
          uncertainties:
            uncertainties.length,
          remoteRequested:
            allowRemote,
        }
      );

      return result;
    } catch (error) {
      emit(
        "visual_observation_failed",
        {
          executionId,
          workspaceId,
          code:
            clean(
              error?.code ||
                error?.name ||
                "DEV_VISUAL_OBSERVATION_FAILED",
              100
            ),
        }
      );

      throw error;
    }
  }

  return {
    observe,
  };
}

module.exports = {
  DevVisualObservationError,
  createDevWorkspaceVisualObservationService,
  normalizeFinding,
  validateCaptureDataUrl,
};
