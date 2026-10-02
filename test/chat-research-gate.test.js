"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { INTERNET_DECISIONS, decideInternetUse } = require("../services/research/internet-decision-router");
const { executeChatResearchPlan, resolveChatResearchPlan } = require("../services/research/chat-research-gate");
const { createChatRequestPayload } = require("../public/ui-utils");

function plan(query, overrides = {}) {
  return resolveChatResearchPlan({
    internetDecision: decideInternetUse({ query, ...overrides.decision }),
    webSearchPreference: overrides.webSearchPreference === true,
    publicResearchEnabled: overrides.publicResearchEnabled !== false,
    remainingWebCalls: overrides.remainingWebCalls ?? 4,
  });
}

test("stable, local ou explicitement interdit ne lancent aucune recherche", async () => {
  for (const query of ["C’est quoi map en JavaScript ?", "Trouve mon fichier de projet local", "Cherche sur Internet React, mais sans Internet"]) {
    let calls = 0;
    const value = plan(query);
    const result = await executeChatResearchPlan({ plan: value, research: async () => { calls += 1; } });
    assert.equal(result, null);
    assert.equal(calls, 0);
  }
});

test("une information actuelle et une demande Web explicite délèguent une fois au moteur existant", async () => {
  for (const query of ["Quelle est la dernière version de React ?", "Cherche sur Internet les bonnes pratiques Astro"]) {
    const calls = []; const progress = [];
    const result = await executeChatResearchPlan({
      plan: plan(query), input: { query }, onResearchStart: () => progress.push("searching"),
      research: async (input) => { calls.push(input); return { state: "COMPLETED" }; },
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(progress, ["searching"]);
    assert.equal(result.state, "COMPLETED");
  }
});

test("une décision optionnelle garde le local sauf préférence Web explicite", async () => {
  const optional = Object.freeze({
    decision: INTERNET_DECISIONS.WEB_ALLOWED_OPTIONAL,
    reasonCode: "PUBLIC_WEB_USEFUL",
    research: Object.freeze({ scope: "PUBLIC", mode: "QUICK", freshness: "EVERGREEN" }),
  });
  const local = resolveChatResearchPlan({ internetDecision: optional, publicResearchEnabled: true, remainingWebCalls: 4 });
  const requested = resolveChatResearchPlan({ internetDecision: optional, webSearchPreference: true, publicResearchEnabled: true, remainingWebCalls: 4 });
  assert.equal(local.execute, false);
  assert.equal(requested.execute, true);
});

test("Web requis bloqué par flag ou quota ne contacte ni moteur ni provider", async () => {
  for (const overrides of [{ publicResearchEnabled: false }, { remainingWebCalls: 0 }]) {
    const value = plan("Quelle est la dernière version de React ?", overrides);
    let calls = 0; let progress = 0;
    assert.match(value.message, /ne peux pas vérifier|désactivée/i);
    await executeChatResearchPlan({ plan: value, onResearchStart: () => { progress += 1; }, research: async () => { calls += 1; } });
    assert.equal(calls, 0);
    assert.equal(progress, 0);
  }
});

test("ASK_USER n'exécute aucune recherche", async () => {
  const value = plan("Cherche sur Internet ce sujet", { decision: { remoteConsentRequired: true } });
  let calls = 0;
  await executeChatResearchPlan({ plan: value, research: async () => { calls += 1; } });
  assert.equal(value.reasonCode, "REMOTE_CONSENT_REQUIRED");
  assert.equal(calls, 0);
});

test("le payload Envoyer sans Internet bloque la recherche de cette seule demande", async () => {
  const blockedPayload = createChatRequestPayload({ webSearchEnabled: true, webSearchForbidden: true });
  const allowedPayload = createChatRequestPayload({ webSearchEnabled: false });
  const blocked = resolveChatResearchPlan({ internetDecision: decideInternetUse({ query: "Cherche sur Internet la dernière version de React", webAllowed: !blockedPayload.webSearchForbidden }), webSearchPreference: blockedPayload.webSearchEnabled, publicResearchEnabled: true, remainingWebCalls: 4 });
  const allowed = resolveChatResearchPlan({ internetDecision: decideInternetUse({ query: "Quelle est la dernière version de React", webAllowed: !allowedPayload.webSearchForbidden }), webSearchPreference: allowedPayload.webSearchEnabled, publicResearchEnabled: true, remainingWebCalls: 4 });
  let calls = 0;
  await executeChatResearchPlan({ plan: blocked, onResearchStart: () => { calls += 100; }, research: async () => { calls += 1; } });
  assert.equal(blocked.reasonCode, "WEB_DISABLED");
  assert.equal(calls, 0);
  assert.equal(allowed.execute, true);
});
