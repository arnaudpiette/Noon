"use strict";

const assert =
  require("node:assert/strict");

const fs =
  require("node:fs");

const test =
  require("node:test");

const {
  createDevWorkspaceVisualObservationService,
} = require(
  "../services/dev/workspace-visual-observation-service"
);

function jpegDataUrl() {
  return (
    "data:image/jpeg;base64," +
    Buffer.from([
      0xff,
      0xd8,
      0xff,
      0xd9,
    ]).toString("base64")
  );
}

function fixture({
  partial = false,
  evidence = null,
  uncertainties = null,
} = {}) {
  const calls = {
    analyzeTransient: [],
    events: [],
  };

  const multimodalEngine = {
    async analyzeTransient(input) {
      calls.analyzeTransient.push({
        ...input,
        signal: undefined,
      });

      return {
        evidence:
          evidence || [
            {
              type:
                "VISUAL_OBSERVATION",
              content:
                "La page principale est visible.",
              confidence:
                "HIGH",
              observationType:
                "OBSERVATION",
              locator: {
                region: {
                  x: 10,
                  y: 20,
                  width: 300,
                  height: 200,
                },
              },
            },
            {
              type:
                "VISUAL_OBSERVATION",
              content:
                "Un bloc semble déborder.",
              confidence:
                "LOW",
              observationType:
                "INFERENCE",
              derivedFrom: [
                "bord droit coupé",
              ],
            },
          ],

        uncertainties:
          uncertainties || [],

        coverage: {
          requestedAssets: 1,
          analyzedAssets: 1,
          evidenceCount:
            evidence === null
              ? 2
              : evidence.length,
          partial,
        },

        latency: {
          totalMs: 42,
        },
      };
    },
  };

  const service =
    createDevWorkspaceVisualObservationService(
      {
        multimodalEngine,

        observability(
          event,
          metadata
        ) {
          calls.events.push({
            event,
            metadata,
          });
        },
      }
    );

  return {
    service,
    calls,
  };
}

test(
  "transforme une capture Preview en observation visuelle structurée sans exposer l'image",
  async () => {
    const {
      service,
      calls,
    } = fixture();

    const dataUrl =
      jpegDataUrl();

    const result =
      await service.observe({
        dataUrl,
        executionId:
          "exec-1",
        workspaceId:
          "workspace-1",
        task:
          "Vérifier la page",
        allowRemote: true,
      });

    assert.equal(
      result.status,
      "ANALYZED"
    );

    assert.equal(
      result.source,
      "DEV_PREVIEW_VISION"
    );

    assert.equal(
      result.remoteAnalysisRequested,
      true
    );

    assert.equal(
      result.observations.length,
      1
    );

    assert.equal(
      result.inferences.length,
      1
    );

    assert.equal(
      result.observations[0]
        .confidence,
      "HIGH"
    );

    assert.deepEqual(
      result.observations[0]
        .region,
      {
        x: 10,
        y: 20,
        width: 300,
        height: 200,
      }
    );

    assert.equal(
      calls.analyzeTransient.length,
      1
    );

    assert.equal(
      calls.analyzeTransient[0]
        .sourceType,
      "SCREEN_CAPTURE"
    );

    assert.equal(
      calls.analyzeTransient[0]
        .sourceScope,
      "PERSONAL"
    );

    assert.equal(
      calls.analyzeTransient[0]
        .localOnly,
      false
    );

    assert.equal(
      calls.analyzeTransient[0]
        .privacyContext
        .allowRemote,
      true
    );

    assert.equal(
      calls.analyzeTransient[0]
        .privacyContext
        .sourceScope,
      "PERSONAL"
    );

    assert.doesNotMatch(
      JSON.stringify(result),
      /base64|data:image/i
    );

    assert.doesNotMatch(
      JSON.stringify(
        calls.events
      ),
      /base64|data:image|Vérifier la page/i
    );
  }
);

test(
  "le mode sans partage distant marque la capture local-only et transmet allowRemote false au moteur canonique",
  async () => {
    const {
      service,
      calls,
    } = fixture({
      partial: true,
      evidence: [],
      uncertainties: [
        {
          code:
            "MEDIA_REMOTE_NOT_ALLOWED",
          message:
            "Analyse distante désactivée.",
        },
      ],
    });

    const result =
      await service.observe({
        dataUrl:
          jpegDataUrl(),
        allowRemote: false,
      });

    assert.equal(
      calls.analyzeTransient[0]
        .localOnly,
      true
    );

    assert.equal(
      calls.analyzeTransient[0]
        .privacyContext
        .allowRemote,
      false
    );

    assert.equal(
      result.status,
      "UNAVAILABLE"
    );

    assert.equal(
      result.coverage.evidenceCount,
      0
    );

    assert.equal(
      result.uncertainties[0]
        .code,
      "MEDIA_REMOTE_NOT_ALLOWED"
    );
  }
);

test(
  "refuse une source qui n'est pas un JPEG de Preview",
  async () => {
    const {
      service,
      calls,
    } = fixture();

    await assert.rejects(
      service.observe({
        dataUrl:
          "data:image/png;base64,iVBORw0KGgo=",
        allowRemote: true,
      }),
      (error) =>
        error.code ===
        "DEV_VISUAL_CAPTURE_INVALID"
    );

    assert.equal(
      calls.analyzeTransient.length,
      0
    );
  }
);

test(
  "la couche DEV ne duplique ni client distant ni persistance de capture",
  () => {
    const source =
      fs.readFileSync(
        require.resolve(
          "../services/dev/workspace-visual-observation-service"
        ),
        "utf8"
      );

    assert.match(
      source,
      /multimodalEngine\.analyzeTransient/
    );

    assert.doesNotMatch(
      source,
      /multimodalEngine\.(?:ingest|analyze)\s*\(/
    );

    assert.doesNotMatch(
      source,
      /\bnew\s+OpenAI\b|responses\.create|chat\.completions/i
    );

    assert.doesNotMatch(
      source,
      /\bwriteFile(?:Sync)?\b|createWriteStream|appendFile/i
    );

    assert.doesNotMatch(
      source,
      /\bfetch\s*\(|child_process|\bspawn\s*\(|\bexec\s*\(/i
    );
  }
);
