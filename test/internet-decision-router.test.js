"use strict";

const test =
  require("node:test");

const assert =
  require("node:assert/strict");

const {
  INTERNET_DECISIONS,
  WEB_CAPABILITY,
  createInternetDecisionRouter,
  decideInternetUse,
} = require(
  "../services/research/internet-decision-router"
);

test(
  "une connaissance stable reste locale",
  () => {
    const result =
      decideInternetUse({
        query:
          "C’est quoi map en JavaScript ?",
      });

    assert.equal(
      result.decision,
      INTERNET_DECISIONS
        .LOCAL_ONLY
    );

    assert.equal(
      result.webRequired,
      false
    );

    assert.deepEqual(
      result.requiredCapabilities,
      []
    );
  }
);

test(
  "une information publique actuelle exige le Web",
  () => {
    const result =
      decideInternetUse({
        query:
          "Quelle est la dernière version de React ?",
      });

    assert.equal(
      result.decision,
      INTERNET_DECISIONS
        .WEB_REQUIRED
    );

    assert.equal(
      result.webRequired,
      true
    );

    assert.deepEqual(
      result.requiredCapabilities,
      [
        WEB_CAPABILITY,
      ]
    );
  }
);

test(
  "une découverte publique trouve-moi exige le Web",
  () => {
    const result =
      decideInternetUse({
        query:
          "Trouve-moi des offres de graphiste à Lille",
      });

    assert.equal(
      result.decision,
      INTERNET_DECISIONS
        .WEB_REQUIRED
    );
  }
);

test(
  "une comparaison personnelle avec des recommandations actuelles exige le Web",
  () => {
    const result =
      decideInternetUse({
        query:
          "Compare mon projet avec les recommandations actuelles",
      });

    assert.equal(
      result.research.scope,
      "MIXED"
    );

    assert.equal(
      result.decision,
      INTERNET_DECISIONS
        .WEB_REQUIRED
    );
  }
);

test(
  "une demande Internet explicite exige le Web",
  () => {
    const result =
      decideInternetUse({
        query:
          "Cherche sur Internet les bonnes pratiques Astro",
      });

    assert.equal(
      result.decision,
      INTERNET_DECISIONS
        .WEB_REQUIRED
    );

    assert.equal(
      result.reasonCode,
      "EXPLICIT_WEB_REQUEST"
    );
  }
);

test(
  "webAllowed false interdit le Web même si la phrase le demande",
  () => {
    const result =
      decideInternetUse({
        query:
          "Cherche sur Internet la dernière version de React",
        webAllowed:
          false,
      });

    assert.equal(
      result.decision,
      INTERNET_DECISIONS
        .LOCAL_ONLY
    );

    assert.equal(
      result.reasonCode,
      "WEB_DISABLED"
    );
  }
);

test(
  "LOCAL_ONLY interdit toujours le Web",
  () => {
    const result =
      decideInternetUse({
        query:
          "Quelle est la dernière version de React ?",
        privacy:
          "LOCAL_ONLY",
      });

    assert.equal(
      result.decision,
      INTERNET_DECISIONS
        .LOCAL_ONLY
    );

    assert.equal(
      result.reasonCode,
      "PRIVACY_LOCAL_ONLY"
    );
  }
);

test(
  "ASK_USER n'apparaît que lorsqu'une policy externe réclame un consentement",
  () => {
    const result =
      decideInternetUse({
        query:
          "Cherche sur Internet des informations sur ce sujet",
        remoteConsentRequired:
          true,
      });

    assert.equal(
      result.decision,
      INTERNET_DECISIONS
        .ASK_USER
    );

    assert.equal(
      result.askUser,
      true
    );
  }
);

test(
  "le routeur ne conserve pas la question dans sa décision",
  () => {
    const secret =
      "PRIVATE_ROUTER_TEST_8291";

    const result =
      decideInternetUse({
        query:
          `C’est quoi map en JavaScript ? ${secret}`,
      });

    assert.equal(
      JSON.stringify(
        result
      ).includes(
        secret
      ),
      false
    );
  }
);

test(
  "le routeur n'obtient aucune autorité d'exécution recherche ou privacy",
  () => {
    const router =
      createInternetDecisionRouter();

    assert.deepEqual(
      {
        executionAuthority:
          router.health()
            .executionAuthority,

        researchAuthority:
          router.health()
            .researchAuthority,

        privacyAuthority:
          router.health()
            .privacyAuthority,
      },
      {
        executionAuthority:
          false,

        researchAuthority:
          false,

        privacyAuthority:
          false,
      }
    );

    assert.equal(
      router.search,
      undefined
    );

    assert.equal(
      router.execute,
      undefined
    );
  }
);
