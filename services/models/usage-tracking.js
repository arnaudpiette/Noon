"use strict";

// V3-L7 : suivi d'usage et budgets (recherche web, voix, modèles, transcription, images),
// déplacé tel quel depuis server.js avec son état (compteur quotidien de recherche web).
// Domaine déplacé tel quel depuis server.js. Dépendances déjà déclarées quand server.js le
// construit : lues une fois ; les autres (`deps.x`) : lues à chaque usage, par accesseur.

const fs = require("node:fs");
const { appendUniqueRealtimeResponse, calculateRealtimeCost } = require("../../lib/voice-utils");
const { parisDate } = require("../daily-brief/brief-usage-log");
const { withDailyCost } = require("../observability/noon-health-report");
const { countWebSearchCalls } = require("./model-response");

const DEPENDENCIES = Object.freeze(["CACHED_INPUT_DISCOUNT","IMAGE_GENERATION_ESTIMATED_COST_USD","LUNA_INPUT_PRICE","LUNA_OUTPUT_PRICE","MODEL_PRICES","MONTHLY_BUDGET_USD","TRANSCRIPTION_PRICE_PER_MINUTE","USAGE_FILE","VOICE_BUDGET_USD","VOICE_USAGE_FILE","WEB_SEARCH_DAILY_LIMIT","WEB_SEARCH_PRICE_PER_CALL","WEB_SEARCH_USAGE_FILE","metricsService"]);

function createUsageTracking(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  const {
    CACHED_INPUT_DISCOUNT,
    IMAGE_GENERATION_ESTIMATED_COST_USD,
    LUNA_INPUT_PRICE,
    LUNA_OUTPUT_PRICE,
    MODEL_PRICES,
    MONTHLY_BUDGET_USD,
    TRANSCRIPTION_PRICE_PER_MINUTE,
    USAGE_FILE,
    VOICE_BUDGET_USD,
    VOICE_USAGE_FILE,
    WEB_SEARCH_DAILY_LIMIT,
    WEB_SEARCH_PRICE_PER_CALL,
    WEB_SEARCH_USAGE_FILE,
  } = deps;

  function getCurrentDateKey() {
    const parts = new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value])
    );

    return `${values.year}-${values.month}-${values.day}`;
  }

  function loadWebSearchUsage() {
    const today = getCurrentDateKey();

    try {
      const savedUsage = JSON.parse(
        fs.readFileSync(WEB_SEARCH_USAGE_FILE, "utf8")
      );

      if (savedUsage.date === today) {
        return {
          date: today,
          calls: Math.max(0, Number(savedUsage.calls) || 0),
        };
      }
    } catch {
      // Le fichier n’existe pas encore ou il est incorrect.
    }

    return { date: today, calls: 0 };
  }

  function saveWebSearchUsage(usage) {
    fs.writeFileSync(
      WEB_SEARCH_USAGE_FILE,
      JSON.stringify(usage, null, 2),
      "utf8"
    );
  }

  let webSearchUsage = loadWebSearchUsage();

  function refreshDailyWebSearchUsage() {
    const today = getCurrentDateKey();

    if (webSearchUsage.date !== today) {
      webSearchUsage = { date: today, calls: 0 };
      saveWebSearchUsage(webSearchUsage);
    }

    return webSearchUsage;
  }

  function registerWebSearchCalls(numberOfCalls) {
    refreshDailyWebSearchUsage();

    const safeNumberOfCalls = Math.max(
      0,
      Number(numberOfCalls) || 0
    );

    webSearchUsage.calls = Math.min(
      WEB_SEARCH_DAILY_LIMIT,
      webSearchUsage.calls + safeNumberOfCalls
    );
    saveWebSearchUsage(webSearchUsage);

    return webSearchUsage;
  }

  function emptyVoiceUsage() {
    return {
      month: new Date().toISOString().slice(0, 7),
      responseIds: [],
      responses: [],
      sessions: {},
      costUSD: 0,
    };
  }

  function loadVoiceUsage() {
    try {
      const usage = JSON.parse(fs.readFileSync(VOICE_USAGE_FILE, "utf8"));
      const currentMonth = new Date().toISOString().slice(0, 7);
      return usage.month === currentMonth ? usage : emptyVoiceUsage();
    } catch {
      return emptyVoiceUsage();
    }
  }

  function saveVoiceUsage(usage) {
    const temporaryFile = `${VOICE_USAGE_FILE}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(usage, null, 2));
    fs.renameSync(temporaryFile, VOICE_USAGE_FILE);
  }

  function getVoiceBudgetStatus() {
    const usage = loadVoiceUsage();
    const ratio = VOICE_BUDGET_USD > 0
      ? usage.costUSD / VOICE_BUDGET_USD
      : 1;
    const state = ratio >= 1
      ? "BLOCKED"
      : ratio >= 0.9
        ? "PROTECTION"
        : ratio >= 0.7
          ? "WARNING"
          : "NORMAL";

    return {
      month: usage.month,
      costUSD: Number((usage.costUSD || 0).toFixed(6)),
      budgetUSD: VOICE_BUDGET_USD,
      remainingUSD: Number(
        Math.max(0, VOICE_BUDGET_USD - usage.costUSD).toFixed(6)
      ),
      ratio,
      state,
    };
  }

  function registerRealtimeUsage({ sessionId, responseId, model, usage }) {
    const voiceUsage = loadVoiceUsage();
    const safeResponseId = String(responseId || "").slice(0, 120);
    const costUSD = calculateRealtimeCost(model, usage);

    if (!appendUniqueRealtimeResponse(voiceUsage, safeResponseId, costUSD)) {
      return { recorded: false, budget: getVoiceBudgetStatus() };
    }
    const input = usage.input_token_details || {};
    const output = usage.output_token_details || {};
    const cached = input.cached_tokens_details || {};
    voiceUsage.responses = Array.isArray(voiceUsage.responses)
      ? voiceUsage.responses
      : [];
    voiceUsage.responses.push({
      sessionId,
      responseId: safeResponseId,
      model,
      tokens: {
        inputText: input.text_tokens || 0,
        inputAudio: input.audio_tokens || 0,
        outputText: output.text_tokens || 0,
        outputAudio: output.audio_tokens || 0,
        cachedText: cached.text_tokens || 0,
        cachedAudio: cached.audio_tokens || 0,
      },
      costUSD: Number(costUSD.toFixed(8)),
      recordedAt: new Date().toISOString(),
      month: voiceUsage.month,
    });
    voiceUsage.responses = voiceUsage.responses.slice(-2000);
    voiceUsage.sessions[sessionId] = {
      model,
      lastResponseId: safeResponseId,
      updatedAt: new Date().toISOString(),
    };
    saveVoiceUsage(voiceUsage);

    const generalUsage = loadUsage();
    generalUsage.voiceCostUSD =
      (generalUsage.voiceCostUSD || 0) + costUSD;
    saveUsage(generalUsage);

    return { recorded: true, costUSD, budget: getVoiceBudgetStatus() };
  }

  // Charge les compteurs du mois ou initialise un suivi vide.
  function loadUsage() {
    const emptyUsage = {
      month: new Date().toISOString().slice(0, 7),
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      requests: 0,
      transcriptionSeconds: 0,
      transcriptionRequests: 0,
      webSearchCalls: 0,
      voiceCostUSD: 0,
      modelPremiumCostUSD: 0,
      modelUsage: {},
      imageGenerationRequests: 0,
      imageGenerationCostUSD: 0,
    };

    if (!fs.existsSync(USAGE_FILE)) return emptyUsage;

    try {
      return {
        ...emptyUsage,
        ...JSON.parse(fs.readFileSync(USAGE_FILE, "utf8")),
      };
    } catch (error) {
      console.warn("Compteurs Noon illisibles :", error.message);
      return emptyUsage;
    }
  }

  // Enregistre les compteurs de consommation dans un fichier local.
  function saveUsage(usage) {
    // V3-L6 (G.1) : la hausse du coût estimé est ventilée par jour (Europe/Paris), toutes catégories.
    let previous;
    try { previous = fs.existsSync(USAGE_FILE) ? JSON.parse(fs.readFileSync(USAGE_FILE, "utf8")) : null; } catch { previous = null; }
    const next = withDailyCost(previous, usage, { costOf: calculateCostUSD, today: parisDate(new Date()) });
    fs.writeFileSync(USAGE_FILE, JSON.stringify(next, null, 2));
  }

  function calculateTranscriptionCostUSD(usage) {
    const minutes = (usage.transcriptionSeconds || 0) / 60;

    return minutes * TRANSCRIPTION_PRICE_PER_MINUTE;
  }

  // Convertit les tokens et la transcription en coût estimé en dollars.
  function calculateCostUSD(usage) {
    const cachedInputTokens = Math.min(
      usage.inputTokens || 0,
      Math.max(0, usage.cachedInputTokens || 0)
    );
    const uncachedInputTokens = Math.max(
      0,
      (usage.inputTokens || 0) - cachedInputTokens
    );
    const inputCost =
      ((uncachedInputTokens + cachedInputTokens * CACHED_INPUT_DISCOUNT) /
        1_000_000) * LUNA_INPUT_PRICE;

    const outputCost =
      (usage.outputTokens / 1_000_000) * LUNA_OUTPUT_PRICE;

    const transcriptionCost =
      calculateTranscriptionCostUSD(usage);
    const webSearchCost =
      (usage.webSearchCalls || 0) * WEB_SEARCH_PRICE_PER_CALL;
    const voiceCost = usage.voiceCostUSD || 0;
    const modelPremiumCost = usage.modelPremiumCostUSD || 0;
    const imageGenerationCost = usage.imageGenerationCostUSD || 0;

    return inputCost + outputCost + transcriptionCost + webSearchCost + voiceCost + modelPremiumCost + imageGenerationCost;
  }

  function trackImageGenerationUsage(quality) {
    let usage = loadUsage();
    const currentMonth = new Date().toISOString().slice(0, 7);
    if (usage.month !== currentMonth) {
      usage = {
        month: currentMonth,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        requests: 0,
        transcriptionSeconds: 0,
        transcriptionRequests: 0,
        webSearchCalls: 0,
        voiceCostUSD: 0,
        modelPremiumCostUSD: 0,
        modelUsage: {},
        imageGenerationRequests: 0,
        imageGenerationCostUSD: 0,
      };
    }
    const selectedQuality = Object.hasOwn(IMAGE_GENERATION_ESTIMATED_COST_USD, quality)
      ? quality
      : "medium";
    usage.imageGenerationRequests = (usage.imageGenerationRequests || 0) + 1;
    usage.imageGenerationCostUSD = (usage.imageGenerationCostUSD || 0) +
      IMAGE_GENERATION_ESTIMATED_COST_USD[selectedQuality];
    saveUsage(usage);
    deps.metricsService.record("image_generation_requests", 1, { model: "gpt-image-2" });
  }

  // Détermine le budget restant et le mode de protection à appliquer.
  function getBudgetStatus() {
    const usage = loadUsage();
    const costUSD = calculateCostUSD(usage);
    const remainingUSD = Math.max(
      0,
      MONTHLY_BUDGET_USD - costUSD
    );

    let mode = "NORMAL";

    if (costUSD >= MONTHLY_BUDGET_USD) {
      mode = "BLOCKED";
    } else if (costUSD >= MONTHLY_BUDGET_USD * 0.86) {
      mode = "PROTECTION";
    } else if (costUSD >= MONTHLY_BUDGET_USD * 0.61) {
      mode = "ECO";
    }

    return {
      ...usage,
      costUSD,
      remainingUSD,
      monthlyBudgetUSD: MONTHLY_BUDGET_USD,
      mode,
    };
  }

  // Adapte le comportement de Noon au niveau de budget mensuel restant.
  function getRuntimeLimits(mode) {
    switch (mode) {
      case "ECO":
        return {
          maxTurns: 2,
          maxSearchResults: 10,
          maxFileChars: 4000,
          instruction:
            "Mode économie actif. Réponds brièvement et limite fortement les appels d'outils.",
        };

      case "PROTECTION":
        return {
          maxTurns: 1,
          maxSearchResults: 5,
          maxFileChars: 2500,
          instruction:
            "Mode protection budgétaire actif. Utilise l'API au strict minimum et réponds très brièvement.",
        };

      default:
        return {
          maxTurns: 3,
          maxSearchResults: 15,
          maxFileChars: 6000,
          instruction:
            "Mode normal. Reste néanmoins économe en tokens et en appels d'outils.",
        };
    }
  }

  // Ajoute à la consommation mensuelle les tokens du dernier appel OpenAI.
  function trackUsage(response) {
    if (!response.usage) return;

    let usage = loadUsage();
    const currentMonth = new Date().toISOString().slice(0, 7);

    // Réinitialise automatiquement les compteurs lors d'un changement de mois.
    if (usage.month !== currentMonth) {
      usage = {
        month: currentMonth,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        requests: 0,
        transcriptionSeconds: 0,
        transcriptionRequests: 0,
        webSearchCalls: 0,
        voiceCostUSD: 0,
        modelPremiumCostUSD: 0,
        modelUsage: {},
        imageGenerationRequests: 0,
        imageGenerationCostUSD: 0,
      };
    }

    const inputTokens = response.usage.inputTokens ?? response.usage.input_tokens ?? 0;
    const cachedInputTokens =
      response.usage.cachedInputTokens ?? response.usage.input_tokens_details?.cached_tokens ?? 0;
    const outputTokens = response.usage.outputTokens ?? response.usage.output_tokens ?? 0;
    const billableInputEquivalent = Math.max(0, inputTokens - cachedInputTokens) +
      cachedInputTokens * CACHED_INPUT_DISCOUNT;
    usage.inputTokens += inputTokens;
    usage.cachedInputTokens =
      (usage.cachedInputTokens || 0) + cachedInputTokens;
    usage.outputTokens += outputTokens;
    const usedModel = response.model || response.noonModel || "gpt-5.6-luna";
    const prices = MODEL_PRICES[usedModel] || MODEL_PRICES["gpt-5.6-luna"];
    usage.modelPremiumCostUSD = (usage.modelPremiumCostUSD || 0) +
      (billableInputEquivalent / 1_000_000) * (prices.input - LUNA_INPUT_PRICE) +
      (outputTokens / 1_000_000) * (prices.output - LUNA_OUTPUT_PRICE);
    usage.modelUsage = usage.modelUsage || {};
    const modelUsage = usage.modelUsage[usedModel] || { requests: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    modelUsage.requests += 1; modelUsage.inputTokens += inputTokens; modelUsage.cachedInputTokens = (modelUsage.cachedInputTokens || 0) + cachedInputTokens; modelUsage.outputTokens += outputTokens;
    usage.modelUsage[usedModel] = modelUsage;
    usage.webSearchCalls =
      (usage.webSearchCalls || 0) +
      countWebSearchCalls(response);
    usage.requests += 1;

    saveUsage(usage);
    const requestCostUSD = (billableInputEquivalent / 1_000_000) * prices.input +
      (outputTokens / 1_000_000) * prices.output;
    deps.metricsService.record("api_requests", 1, { model: usedModel });
    deps.metricsService.record("input_tokens", inputTokens, { model: usedModel });
    deps.metricsService.record("output_tokens", outputTokens, { model: usedModel });
    deps.metricsService.record("api_cost_usd", requestCostUSD, { model: usedModel });
  }

  // pricePerMinute (facultatif) : modèle plus cher que le tarif de base (ex. whisper-1 pour le
  // Recorder, 0,006 $/min) ; l'écart s'ajoute au coût du mois pour que le budget reste exact.
  function trackTranscriptionUsage(durationMs, { pricePerMinute = null } = {}) {
    let usage = loadUsage();
    const currentMonth = new Date().toISOString().slice(0, 7);

    if (usage.month !== currentMonth) {
      usage = {
        month: currentMonth,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        requests: 0,
        transcriptionSeconds: 0,
        transcriptionRequests: 0,
        webSearchCalls: 0,
        voiceCostUSD: 0,
        modelPremiumCostUSD: 0,
        modelUsage: {},
        imageGenerationRequests: 0,
        imageGenerationCostUSD: 0,
      };
    }

    const safeDurationMs = Math.max(
      0,
      Number(durationMs) || 0
    );

    usage.transcriptionSeconds =
      (usage.transcriptionSeconds || 0) +
      safeDurationMs / 1000;

    usage.transcriptionRequests =
      (usage.transcriptionRequests || 0) + 1;

    const extraPerMinute = Number(pricePerMinute) - TRANSCRIPTION_PRICE_PER_MINUTE;
    if (Number.isFinite(extraPerMinute) && extraPerMinute > 0) {
      usage.modelPremiumCostUSD = (usage.modelPremiumCostUSD || 0) + (safeDurationMs / 60000) * extraPerMinute;
    }

    usage.requests = (usage.requests || 0) + 1;

    saveUsage(usage);
  }

  return { refreshDailyWebSearchUsage, registerWebSearchCalls, getVoiceBudgetStatus, registerRealtimeUsage, calculateTranscriptionCostUSD, trackImageGenerationUsage, getBudgetStatus, getRuntimeLimits, trackUsage, trackTranscriptionUsage };
}

module.exports = { DEPENDENCIES, createUsageTracking };
