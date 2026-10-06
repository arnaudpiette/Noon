"use strict";

// Vérifie l’échappement et les états vides utilisés par les panneaux de l’interface.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  escapeHtml,
  parseFocusCommand,
  shouldConvertPastedText,
  createPastedTextFileName,
  createChatRequestPayload,
  maskPrivateMemoryValue,
  privateMemoryCategoryLabel,
  presentDevProgress,
} = require("../public/ui-utils");

test("échappe les valeurs injectées dans les chaînes HTML", () => {
  assert.equal(
    escapeHtml('<script data-label="Noon">Tom & Jerry\'s</script>'),
    "&lt;script data-label=&quot;Noon&quot;&gt;Tom &amp; Jerry&#039;s&lt;/script&gt;"
  );
});

test("accepte les valeurs absentes sans casser le panneau", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});

test("ne confond pas une mention du projet Focus avec une commande", () => {
  assert.equal(parseFocusCommand("dis-moi ce qui manque sur le projet focus"), null);
  assert.deepEqual(parseFocusCommand("Focus sur Kasa"), {
    action: "select",
    name: "Kasa",
  });
  assert.deepEqual(parseFocusCommand("Retire le focus"), {
    action: "clear",
    name: null,
  });
});

test("convertit uniquement les collages dépassant le seuil en fichier", () => {
  assert.equal(shouldConvertPastedText("a".repeat(12_000)), false);
  assert.equal(shouldConvertPastedText("a".repeat(12_001)), true);
  assert.equal(shouldConvertPastedText(null), false);
});

test("génère un nom de fichier texte stable et sûr", () => {
  assert.equal(
    createPastedTextFileName(new Date("2026-09-13T08:09:10.123Z")),
    "texte-colle-2026-09-13T08-09-10-123Z.txt"
  );
});

test("le payload chat distingue une interdiction Web de l'absence de préférence", () => {
  assert.equal(createChatRequestPayload({ webSearchEnabled: false }).webSearchForbidden, false);
  assert.equal(createChatRequestPayload({ webSearchEnabled: true, webSearchForbidden: true }).webSearchForbidden, true);
  assert.equal(createChatRequestPayload({ webSearchForbidden: "true" }).webSearchForbidden, false);
});

test("masque une mémoire privée sans révéler son contenu ni sa longueur", () => {
  const shortMask = maskPrivateMemoryValue("secret court fictif");
  const longMask = maskPrivateMemoryValue("secret fictif ".repeat(50));
  assert.equal(shortMask, "••••••••••••");
  assert.equal(longMask, shortMask);
  assert.doesNotMatch(shortMask, /secret/i);
});

test("conserve la catégorie existante et utilise Autres uniquement si elle manque", () => {
  assert.equal(privateMemoryCategoryLabel("préférences"), "préférences");
  assert.equal(privateMemoryCategoryLabel(""), "Autres");
});


test(
  "présente le cycle Native DEV sans exposer ses données privées",
  () => {
    const cases = [
      [
        {
          source:
            "native_dev",
          state:
            "RUNNING",
          phase:
            "PLAN",
          progress: 10,
        },
        "Analyse · 10%",
      ],
      [
        {
          source:
            "native_dev",
          state:
            "RUNNING",
          phase:
            "VALIDATION",
          progress: 25,
        },
        "Baseline · 25%",
      ],
      [
        {
          source:
            "native_dev",
          state:
            "RUNNING",
          phase:
            "ACTION",
          progress: 45,
        },
        "Implémentation · 45%",
      ],
      [
        {
          source:
            "native_dev",
          state:
            "RUNNING",
          phase:
            "VALIDATION",
          progress: 80,
        },
        "Review · 80%",
      ],
      [
        {
          source:
            "native_dev",
          state:
            "SUCCEEDED",
          phase:
            "VALIDATION",
          progress: 100,
        },
        "Terminé et vérifié · 100%",
      ],
    ];

    for (
      const [
        progress,
        label,
      ] of cases
    ) {
      assert.equal(
        presentDevProgress(
          progress
        ).label,
        label
      );
    }

    const privateProjection =
      presentDevProgress({
        source:
          "native_dev",
        state:
          "RUNNING",
        phase:
          "ACTION",
        progress: 45,

        rawPrompt:
          "SECRET_PROMPT",

        content:
          "SECRET_SOURCE",

        reasoning:
          "SECRET_REASONING",
      });

    assert.doesNotMatch(
      JSON.stringify(
        privateProjection
      ),
      /SECRET_/
    );
  }
);

test(
  "présente échec annulation attente et fallback du Workspace Agent",
  () => {
    assert.equal(
      presentDevProgress({
        source:
          "native_dev",
        state:
          "FAILED",
        phase:
          "FINALIZE",
      }).label,
      "Échec"
    );

    assert.equal(
      presentDevProgress({
        source:
          "native_dev",
        state:
          "CANCELLED",
        phase:
          "ACTION",
      }).label,
      "Annulé"
    );

    assert.equal(
      presentDevProgress({
        source:
          "dev_agent_loop",
        state:
          "WAITING",
        phase:
          "APPROVAL",
      }).label,
      "Validation requise"
    );

    assert.deepEqual(
      presentDevProgress(
        null,
        {
          status:
            "COMPLETED",
          phase:
            "STOP",
        }
      ),
      {
        label:
          "Terminé",
        state:
          "completed",
        progress:
          null,
      }
    );
  }
);
