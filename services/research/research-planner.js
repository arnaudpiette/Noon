"use strict";

const { bounded } = require("./research-schema");

const MODE_BUDGETS = Object.freeze({
  QUICK: { maxQueries: 1, maxSources: 3, maxRetrievedPages: 3, maxEvidenceTokens: 1800, maxModelCalls: 2, maxIterations: 1 },
  STANDARD: { maxQueries: 2, maxSources: 8, maxRetrievedPages: 6, maxEvidenceTokens: 4500, maxModelCalls: 3, maxIterations: 2 },
  CURRENT_STATE: { maxQueries: 2, maxSources: 6, maxRetrievedPages: 5, maxEvidenceTokens: 3500, maxModelCalls: 3, maxIterations: 2 },
  VERIFY: { maxQueries: 3, maxSources: 8, maxRetrievedPages: 7, maxEvidenceTokens: 5000, maxModelCalls: 4, maxIterations: 2 },
  COMPARE: { maxQueries: 3, maxSources: 10, maxRetrievedPages: 8, maxEvidenceTokens: 6000, maxModelCalls: 4, maxIterations: 2 },
  DEEP: { maxQueries: 6, maxSources: 14, maxRetrievedPages: 12, maxEvidenceTokens: 9000, maxModelCalls: 6, maxIterations: 3 },
});

function splitComparison(query) {
  const match = String(query).match(/compare\s+(.+?)\s+(?:et|avec|versus|vs\.?)[ ]+(.+?)(?:[?.!]|$)/i);
  return match ? [`${match[1]} état actuel`, `${match[2]} état actuel`, `${match[1]} ${match[2]} comparaison`] : [];
}

function createResearchPlanner({ observability = null } = {}) {
  function plan(request, { budgetMode = "NORMAL" } = {}) {
    const base = MODE_BUDGETS[request.mode] || MODE_BUDGETS.STANDARD;
    const restricted = ["ECO", "PROTECTION"].includes(budgetMode);
    const budget = {
      maxQueries: restricted ? 1 : bounded(request.maxQueries, base.maxQueries, 1, base.maxQueries),
      maxSources: Math.min(request.maxSources, restricted ? 3 : base.maxSources),
      maxRetrievedPages: restricted ? 2 : base.maxRetrievedPages,
      maxEvidenceTokens: restricted ? Math.min(1800, base.maxEvidenceTokens) : base.maxEvidenceTokens,
      maxModelCalls: restricted ? 2 : base.maxModelCalls,
      maxIterations: restricted ? 1 : base.maxIterations,
    };
    let subQuestions = [request.query];
    if (request.mode === "COMPARE") subQuestions = splitComparison(request.query);
    if (request.mode === "VERIFY") subQuestions = [request.query, `${request.query} source officielle`, `${request.query} contre-preuve`];
    if (request.mode === "DEEP") {
      subQuestions = String(request.query).split(/[;\n]+/).map((item) => item.trim()).filter(Boolean);
      if (subQuestions.length < 2) subQuestions = [request.query, `${request.query} recommandations officielles`, `${request.query} limites risques`, `${request.query} retours indépendants`];
    }
    if (!subQuestions.length) subQuestions = [request.query];
    subQuestions = [...new Set(subQuestions.map((item) => item.replace(/\s+/g, " ").trim()))].slice(0, budget.maxQueries);
    const result = Object.freeze({ researchId: request.researchId, objective: request.query, subQuestions, expectedSourceTypes: request.officialSourcesOnly ? ["OFFICIAL", "PRIMARY"] : request.intent === "OPINION" ? ["COMMUNITY", "TECHNICAL", "NEWS"] : ["OFFICIAL", "PRIMARY", "REFERENCE"], freshnessRequirement: request.freshnessRequirement, sourceBudget: budget, synthesisMode: request.mode === "VERIFY" ? "VERIFY" : request.mode === "COMPARE" ? "COMPARE" : "SUMMARY" });
    observability?.("research_plan_created", { researchId: request.researchId, mode: request.mode, queryCount: subQuestions.length, maxSources: budget.maxSources });
    return result;
  }
  return { plan };
}

module.exports = { MODE_BUDGETS, createResearchPlanner };
