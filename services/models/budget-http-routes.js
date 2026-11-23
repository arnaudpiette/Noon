"use strict";

// V3-L7 — route HTTP de la consommation mensuelle et du mode budgétaire (/budget).
// Bloc déplacé tel quel depuis server.js ; ses dépendances sont lues à chaque requête
// (accesseurs), ce qui préserve les variables initialisées plus tard au démarrage.

const { NOT_HANDLED } = require("../http/route-result");

const DEPENDENCIES = Object.freeze(["WEB_SEARCH_PRICE_PER_CALL","calculateTranscriptionCostUSD","getBudgetStatus","getVoiceBudgetStatus"]);

function createBudgetHttpRoutes(deps) {
  for (const name of DEPENDENCIES) if (!(name in deps)) throw new TypeError(`Dépendance manquante : ${name}`);
  return async function handle(req, res, requestPath) {
    const {
      WEB_SEARCH_PRICE_PER_CALL,
      calculateTranscriptionCostUSD,
      getBudgetStatus,
      getVoiceBudgetStatus,
    } = deps;

    // Expose la consommation mensuelle et le mode budgétaire actuel.
    if (req.url === "/budget") {
      const budget = getBudgetStatus();

      res.writeHead(200);

      return res.end(
        JSON.stringify(
          {
            status: "ok",
            assistant: "Noon",
            budget: {
              month: budget.month,
              requests: budget.requests,
              inputTokens: budget.inputTokens,
              cachedInputTokens: budget.cachedInputTokens || 0,
              outputTokens: budget.outputTokens,
              modelUsage: budget.modelUsage || {},
              transcriptionSeconds: Number(
                (budget.transcriptionSeconds || 0).toFixed(1)
              ),
              transcriptionRequests:
                budget.transcriptionRequests || 0,
              transcriptionCostUSD: Number(
                calculateTranscriptionCostUSD(budget).toFixed(6)
              ),
              webSearchCalls: budget.webSearchCalls || 0,
              webSearchCostUSD: Number(
                (
                  (budget.webSearchCalls || 0) *
                  WEB_SEARCH_PRICE_PER_CALL
                ).toFixed(4)
              ),
              voiceCostUSD: Number(
                (budget.voiceCostUSD || 0).toFixed(6)
              ),
              imageGenerationRequests:
                budget.imageGenerationRequests || 0,
              imageGenerationCostUSD: Number(
                (budget.imageGenerationCostUSD || 0).toFixed(4)
              ),
              voiceBudget: getVoiceBudgetStatus(),
              costUSD: Number(budget.costUSD.toFixed(4)),
              remainingUSD: Number(
                budget.remainingUSD.toFixed(4)
              ),
              monthlyBudgetUSD: budget.monthlyBudgetUSD,
              mode: budget.mode,
            },
          },
          null,
          2
        )
      );
    }

    return NOT_HANDLED;
  };
}

module.exports = { DEPENDENCIES, createBudgetHttpRoutes };
