"use strict";

// V3-L7 — clients OpenAI/Gemini sortis de server.js : créés au premier appel, refusés en
// validation UI isolée, clé absente → 503, chargeurs de clés Electron appelés seulement à la
// demande. Aucun appel réseau : la construction d'un client n'en fait pas.
const assert = require("node:assert/strict");
const test = require("node:test");
const { createProviderClients } = require("../services/models/provider-clients");
const { readServerSource } = require("./helpers/server-source");

const KEYS = ["OPENAI_API_KEY", "GEMINI_API_KEY", "NOON_UI_VALIDATION"];

function withEnv(values, fn) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, values);
  try { return fn(); } finally {
    for (const key of KEYS) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
}

test("clé absente : 503 explicite, sans client créé", () => withEnv({}, () => {
  const { getOpenAIClient, getGeminiClient } = createProviderClients();
  assert.throws(() => getOpenAIClient(), (error) => error.statusCode === 503 && /Clé OpenAI absente/.test(error.message));
  assert.throws(() => getGeminiClient(), (error) => error.statusCode === 503 && /Credential Gemini absent/.test(error.message));
}));

test("validation UI isolée : fournisseurs refusés même avec une clé", () => withEnv({ NOON_UI_VALIDATION: "1", OPENAI_API_KEY: "sk-test-fausse-cle", GEMINI_API_KEY: "test-fausse-cle" }, () => {
  const { getOpenAIClient, getGeminiClient } = createProviderClients();
  assert.throws(() => getOpenAIClient(), { code: "UI_VALIDATION_EXTERNAL_DISABLED", statusCode: 503 });
  assert.throws(() => getGeminiClient(), { code: "UI_VALIDATION_EXTERNAL_DISABLED", statusCode: 503 });
}));

test("chargeurs Electron appelés seulement à la demande ; client créé une fois puis réutilisé", () => withEnv({}, () => {
  const { getOpenAIClient, getGeminiClient, setProviderKeyLoaders } = createProviderClients();
  const calls = [];
  setProviderKeyLoaders(
    () => { calls.push("openai"); process.env.OPENAI_API_KEY = "sk-test-fausse-cle"; },
    () => { calls.push("gemini"); process.env.GEMINI_API_KEY = "test-fausse-cle"; },
  );
  assert.deepEqual(calls, []);
  const first = getOpenAIClient();
  assert.equal(getOpenAIClient(), first);
  assert.deepEqual(calls, ["openai"]);
  const gemini = getGeminiClient();
  assert.equal(getGeminiClient(), gemini);
  assert.deepEqual(calls, ["openai", "gemini"]);
}));

test("chargeurs invalides ignorés ; instances indépendantes", () => withEnv({}, () => {
  const clients = createProviderClients();
  clients.setProviderKeyLoaders("pas une fonction", null);
  assert.throws(() => clients.getOpenAIClient(), (error) => error.statusCode === 503);
  const other = createProviderClients();
  other.setProviderKeyLoaders(() => { process.env.OPENAI_API_KEY = "sk-test-fausse-cle"; });
  assert.ok(other.getOpenAIClient());
}));

test("server.js crée les clients en tête, avant tout usage", () => {
  const source = readServerSource();
  const call = source.indexOf("\nconst { getOpenAIClient, getGeminiClient, setProviderKeyLoaders } = createProviderClients();\n");
  assert.notEqual(call, -1);
  assert.equal(source.slice(0, call).includes("getOpenAIClient("), false);
});
