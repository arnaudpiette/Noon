"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { PROVIDERS } = require("../services/models/model-registry");
const { createOpenAIProviderAdapter } = require("../services/models/providers/openai-provider");
const {
  DATA_CLASSES,
  DECISIONS,
  REASON_CODES,
  createProviderPrivacyPolicy,
} = require("../services/security/provider-privacy-policy");

function policy() {
  return createProviderPrivacyPolicy({ providerRegistry: PROVIDERS });
}

test("la matrice canonique autorise OpenAI pour public, personnel et privé", () => {
  assert.deepEqual(DATA_CLASSES, ["PUBLIC", "PERSONAL", "PRIVATE", "HIGHLY_SENSITIVE", "LOCAL_ONLY"]);
  assert.deepEqual(DECISIONS, ["ALLOW", "DENY", "REDACT_REQUIRED", "LOCAL_ONLY"]);
  for (const classification of ["PUBLIC", "PERSONAL", "PRIVATE"]) {
    const result = policy().evaluateProviderAccess({
      provider: "openai",
      contextMetadata: { fragments: [{ source: "fixture", classification }] },
    });
    assert.equal(result.decision, "ALLOW");
    assert.ok(result.permissionToken);
  }
});

test("la matrice refuse provider inconnu, non configuré et classification inconnue", () => {
  const privacy = policy();
  assert.equal(privacy.evaluateProviderAccess({ provider: "unknown", contextMetadata: { fragments: [{ source: "fixture", classification: "PUBLIC" }] } }).decision, "DENY");
  assert.equal(privacy.evaluateProviderAccess({ provider: "anthropic", contextMetadata: { fragments: [{ source: "fixture", classification: "PUBLIC" }] } }).decision, "DENY");
  const unknownClass = privacy.evaluateProviderAccess({ provider: "openai", contextMetadata: { fragments: [{ source: "fixture", classification: "UNLISTED" }] } });
  assert.equal(unknownClass.decision, "DENY");
  assert.ok(unknownClass.reasonCodes.includes(REASON_CODES.CLASSIFICATION_UNKNOWN));
  assert.equal(privacy.evaluateProviderAccess({ provider: "openai" }).decision, "DENY");
});

test("les sources V1 privées restent explicitement autorisées pour OpenAI", () => {
  const privacy = policy();
  for (const source of ["memory", "gmail", "calendar", "apple_notes", "apple_reminders", "private_file", "artifact"]) {
    const result = privacy.evaluateProviderAccess({
      provider: "openai",
      contextMetadata: { fragments: [{ source, classification: "PRIVATE" }] },
    });
    assert.equal(result.decision, "ALLOW");
    assert.deepEqual(result.allowedSources, [source]);
    assert.deepEqual(result.blockedSources, []);
  }
  const publicResearch = privacy.evaluateProviderAccess({
    provider: "openai",
    contextMetadata: { fragments: [{ source: "public_web", classification: "PUBLIC" }] },
  });
  assert.equal(publicResearch.decision, "ALLOW");
});

test("local-only, hautement sensible, restriction provider et secret ferment le flux", () => {
  const privacy = policy();
  const cases = [
    [{ source: "fixture", classification: "LOCAL_ONLY" }, "LOCAL_ONLY"],
    [{ source: "fixture", classification: "HIGHLY_SENSITIVE" }, "DENY"],
    [{ source: "fixture", classification: "PRIVATE", providerRestrictions: ["local"] }, "DENY"],
    [{ source: "fixture", classification: "PRIVATE", content: "client_secret=fixture_secret_value" }, "DENY"],
    [{ source: "fixture", classification: "PRIVATE", content: "safeStoragePayload=encrypted_fixture_value" }, "DENY"],
  ];
  for (const [fragment, expected] of cases) {
    const result = privacy.evaluateProviderAccess({ provider: "openai", contextMetadata: { fragments: [fragment] } });
    assert.equal(result.decision, expected);
    assert.equal(result.permissionToken, null);
  }
});

test("redaction requise ne délivre aucun jeton avant redaction déterministe", () => {
  const result = policy().evaluateProviderAccess({
    provider: "openai",
    contextMetadata: { fragments: [{ source: "fixture", classification: "PERSONAL", redactionRequired: true }] },
  });
  assert.equal(result.decision, "REDACT_REQUIRED");
  assert.equal(result.permissionToken, null);
});

test("sans jeton valide l'adaptateur refuse avant de résoudre le client réseau", async () => {
  let clientCalls = 0;
  const privacy = policy();
  const adapter = createOpenAIProviderAdapter({
    privacyPolicy: privacy,
    clientProvider() {
      clientCalls += 1;
      return { responses: { create: async () => ({ output_text: "inattendu", output: [] }) } };
    },
  });
  await assert.rejects(
    adapter.execute({ model: "gpt-5.6-luna", input: [] }),
    (error) => error.code === "REMOTE_PROVIDER_POLICY_REQUIRED"
  );
  assert.equal(clientCalls, 0);
});

test("une décision local-only produit zéro appel provider", async () => {
  let clientCalls = 0;
  const privacy = policy();
  const decision = privacy.evaluateProviderAccess({
    provider: "openai",
    contextMetadata: { fragments: [{ source: "private_fixture", classification: "LOCAL_ONLY" }] },
  });
  const adapter = createOpenAIProviderAdapter({
    privacyPolicy: privacy,
    clientProvider() {
      clientCalls += 1;
      return { responses: { create: async () => ({ output_text: "inattendu", output: [] }) } };
    },
  });
  await assert.rejects(
    adapter.execute({ model: "gpt-5.6-luna", input: [] }, { privacyDecisionToken: decision.permissionToken }),
    (error) => error.code === "REMOTE_PROVIDER_POLICY_REQUIRED"
  );
  assert.equal(clientCalls, 0);
});

test("les diagnostics ne recopient jamais le contenu inspecté", () => {
  const privacy = policy();
  const fragment = privacy.inspectContextFragment({
    source: "fixture",
    classification: "PRIVATE",
    content: "donnée privée de test",
  });
  assert.equal(Object.hasOwn(fragment, "content"), false);
  const result = privacy.evaluateProviderAccess({ provider: "openai", contextMetadata: { fragments: [fragment] } });
  assert.doesNotMatch(JSON.stringify(result), /donnée privée/);
});
