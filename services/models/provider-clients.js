"use strict";

// V3-L7 — clients OpenAI et Gemini créés au premier appel, et chargeurs de clés fournis par
// Electron au démarrage, sortis de server.js. Bloc déplacé tel quel : mêmes refus en
// validation UI isolée, même clé lue dans `process.env` (chargée à la demande par Electron),
// aucun secret conservé ailleurs que dans le client créé.

const OpenAI = require("openai");
const { GoogleGenAI } = require("@google/genai");

function createProviderClients() {
  // Le client est créé au premier appel afin que l’application locale puisse
  // démarrer et rester utile hors ligne même sans clé OpenAI configurée.
  let openai = null;
  let loadOpenAIKeyOnDemand = null;
  function getOpenAIClient() {
    if (process.env.NOON_UI_VALIDATION === "1") {
      throw Object.assign(new Error("Le fournisseur OpenAI est désactivé pendant la validation UI isolée."), { code: "UI_VALIDATION_EXTERNAL_DISABLED", statusCode: 503 });
    }
    if (openai) return openai;
    if (!process.env.OPENAI_API_KEY && loadOpenAIKeyOnDemand) loadOpenAIKeyOnDemand();
    if (!process.env.OPENAI_API_KEY) {
      const error = new Error("Clé OpenAI absente. Configurez-la dans Noon.");
      error.statusCode = 503;
      throw error;
    }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return openai;
  }
  let gemini = null;
  let loadGeminiKeyOnDemand = null;
  function getGeminiClient() {
    if (process.env.NOON_UI_VALIDATION === "1") {
      throw Object.assign(new Error("Le fournisseur Gemini est désactivé pendant la validation UI isolée."), { code: "UI_VALIDATION_EXTERNAL_DISABLED", statusCode: 503 });
    }
    if (gemini) return gemini;
    if (!process.env.GEMINI_API_KEY && loadGeminiKeyOnDemand) loadGeminiKeyOnDemand();
    if (!process.env.GEMINI_API_KEY) throw Object.assign(new Error("Credential Gemini absent."), { statusCode: 503 });
    gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    return gemini;
  }
  // Chargeurs de clés fournis par Electron au démarrage (lus par les deux clients ci-dessus).
  function setProviderKeyLoaders(loadOpenAIKey, loadGeminiKey) {
    loadOpenAIKeyOnDemand = typeof loadOpenAIKey === "function" ? loadOpenAIKey : null;
    loadGeminiKeyOnDemand = typeof loadGeminiKey === "function" ? loadGeminiKey : null;
  }

  return { getOpenAIClient, getGeminiClient, setProviderKeyLoaders };
}

module.exports = { createProviderClients };
