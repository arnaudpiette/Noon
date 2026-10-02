"use strict";

const {
  resolveResearchScope,
  inferFreshness,
  inferResearchMode,
} = require(
  "./research-resolver"
);

const INTERNET_DECISIONS =
  Object.freeze({
    LOCAL_ONLY:
      "LOCAL_ONLY",

    WEB_ALLOWED_OPTIONAL:
      "WEB_ALLOWED_OPTIONAL",

    WEB_REQUIRED:
      "WEB_REQUIRED",

    ASK_USER:
      "ASK_USER",
  });

const WEB_CAPABILITY =
  "REMOTE_WEB_SEARCH";

const FRESH_WEB_REQUIREMENTS =
  new Set([
    "LIVE",
    "CURRENT",
    "RECENT",
  ]);

const EXPLICIT_WEB_PATTERN =
  /\b(?:internet|web|en ligne|recherche web|cherche sur|chercher sur|vérifie sur|verifie sur)\b/i;

const PUBLIC_DISCOVERY_PATTERN =
  /\b(?:trouve-moi|trouve moi|cherche-moi|cherche moi|offres?|restaurant|documentation|docs?|tutoriel|tutorial|source|lien|site officiel)\b/i;

function normalizePrivacy(
  privacy
) {
  return String(
    privacy || "STANDARD"
  )
    .trim()
    .toUpperCase();
}

function decisionResult({
  decision,
  reasonCode,
  scope,
  mode,
  freshness,
}) {
  const needsWeb =
    decision ===
      INTERNET_DECISIONS
        .WEB_REQUIRED ||
    decision ===
      INTERNET_DECISIONS
        .WEB_ALLOWED_OPTIONAL;

  return Object.freeze({
    version: "1.0",

    decision,
    reasonCode,

    research:
      Object.freeze({
        scope,
        mode,
        freshness,
      }),

    requiredCapabilities:
      needsWeb
        ? Object.freeze([
            WEB_CAPABILITY,
          ])
        : Object.freeze([]),

    webRequired:
      decision ===
      INTERNET_DECISIONS
        .WEB_REQUIRED,

    webAllowed:
      needsWeb,

    askUser:
      decision ===
      INTERNET_DECISIONS
        .ASK_USER,

    /*
     * Ce routeur ne peut ni effectuer
     * une recherche ni autoriser une
     * action distante.
     */
    executionAuthority: false,
    researchAuthority: false,
    privacyAuthority: false,
  });
}

function decideInternetUse({
  query,
  webAllowed = true,
  privacy = "STANDARD",
  remoteConsentRequired = false,
} = {}) {
  const text =
    String(query || "").trim();

  if (!text) {
    throw new TypeError(
      "Une question est requise."
    );
  }

  const privacyMode =
    normalizePrivacy(
      privacy
    );

  /*
   * Les interdictions explicites ont
   * priorité sur toute déduction.
   */
  if (
    webAllowed === false
  ) {
    const mode =
      inferResearchMode(
        text
      );

    return decisionResult({
      decision:
        INTERNET_DECISIONS
          .LOCAL_ONLY,

      reasonCode:
        "WEB_DISABLED",

      scope: "PERSONAL",

      mode,

      freshness:
        inferFreshness(
          text,
          mode
        ),
    });
  }

  if (
    privacyMode ===
      "LOCAL_ONLY"
  ) {
    const mode =
      inferResearchMode(
        text
      );

    return decisionResult({
      decision:
        INTERNET_DECISIONS
          .LOCAL_ONLY,

      reasonCode:
        "PRIVACY_LOCAL_ONLY",

      scope: "PERSONAL",

      mode,

      freshness:
        inferFreshness(
          text,
          mode
        ),
    });
  }

  const mode =
    inferResearchMode(
      text
    );

  const freshness =
    inferFreshness(
      text,
      mode
    );

  const resolution =
    resolveResearchScope({
      query: text,
      webAllowed: true,
    });

  const scope =
    resolution?.scope ||
    "PERSONAL";

  if (
    resolution?.reasonCodes?.includes(
      "user_disabled_web"
    )
  ) {
    return decisionResult({
      decision:
        INTERNET_DECISIONS
          .LOCAL_ONLY,

      reasonCode:
        "WEB_DISABLED",

      scope,
      mode,
      freshness,
    });
  }

  const explicitWeb =
    EXPLICIT_WEB_PATTERN.test(
      text
    );

  /*
   * ASK_USER reste exceptionnel.
   * Il n'est utilisé que lorsqu'une
   * policy externe a déjà conclu qu'un
   * consentement distant est requis.
   *
   * Le routeur ne déduit jamais lui-même
   * la sensibilité de données privées.
   */
  if (
    remoteConsentRequired === true &&
    (
      explicitWeb ||
      scope === "PUBLIC" ||
      scope === "MIXED"
    )
  ) {
    return decisionResult({
      decision:
        INTERNET_DECISIONS
          .ASK_USER,

      reasonCode:
        "REMOTE_CONSENT_REQUIRED",

      scope,
      mode,
      freshness,
    });
  }

  /*
   * Une demande Web explicite doit
   * utiliser le Web.
   */
  if (explicitWeb) {
    return decisionResult({
      decision:
        INTERNET_DECISIONS
          .WEB_REQUIRED,

      reasonCode:
        "EXPLICIT_WEB_REQUEST",

      scope,
      mode,
      freshness,
    });
  }

  /*
   * Une information publique dont la
   * fraîcheur compte ne peut pas être
   * satisfaite honnêtement par une
   * connaissance locale potentiellement
   * périmée.
   */
  if (
    (
      scope === "PUBLIC" ||
      scope === "MIXED"
    ) &&
    FRESH_WEB_REQUIREMENTS.has(
      freshness
    )
  ) {
    return decisionResult({
      decision:
        INTERNET_DECISIONS
          .WEB_REQUIRED,

      reasonCode:
        scope === "MIXED"
          ? "MIXED_FRESHNESS_REQUIRED"
          : "PUBLIC_FRESHNESS_REQUIRED",

      scope,
      mode,
      freshness,
    });
  }

  /*
   * "Trouve-moi..." implique une
   * découverte publique réelle plutôt
   * qu'une réponse de connaissance.
   */
  if (
    scope === "PUBLIC" &&
    PUBLIC_DISCOVERY_PATTERN.test(
      text
    )
  ) {
    return decisionResult({
      decision:
        INTERNET_DECISIONS
          .WEB_REQUIRED,

      reasonCode:
        "PUBLIC_DISCOVERY_REQUIRED",

      scope,
      mode,
      freshness,
    });
  }

  /*
   * Pour une question publique stable,
   * le Web peut améliorer la réponse,
   * mais n'est pas obligatoire.
   */
  if (
    scope === "PUBLIC" ||
    scope === "MIXED"
  ) {
    return decisionResult({
      decision:
        INTERNET_DECISIONS
          .WEB_ALLOWED_OPTIONAL,

      reasonCode:
        scope === "MIXED"
          ? "MIXED_WEB_USEFUL"
          : "PUBLIC_WEB_USEFUL",

      scope,
      mode,
      freshness,
    });
  }

  /*
   * Connaissance stable, mémoire,
   * fichiers, projet ou contexte local :
   * pas de Web par défaut.
   */
  return decisionResult({
    decision:
      INTERNET_DECISIONS
        .LOCAL_ONLY,

    reasonCode:
      "LOCAL_CONTEXT_SUFFICIENT",

    scope,
    mode,
    freshness,
  });
}

function createInternetDecisionRouter() {
  return Object.freeze({
    decide:
      decideInternetUse,

    decisions:
      INTERNET_DECISIONS,

    version:
      () => "1.0",

    health() {
      return Object.freeze({
        ok: true,
        version: "1.0",

        executionAuthority:
          false,

        researchAuthority:
          false,

        privacyAuthority:
          false,
      });
    },
  });
}

module.exports = {
  INTERNET_DECISIONS,
  WEB_CAPABILITY,
  createInternetDecisionRouter,
  decideInternetUse,
};
