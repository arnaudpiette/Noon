"use strict";

// V3-L6 (G.4) — « plus petit modèle capable » en ombre : décision expliquée, route jamais modifiée.
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { selectModelRoute } = require("../lib/noon-intelligence");
const { smallFirstDecision } = require("../services/models/small-first-policy");
const { createNoonHealthReport } = require("../services/observability/noon-health-report");
const { readServerSource } = require("./helpers/server-source");

const route = (query) => selectModelRoute({ query, question: query, channel: "chat" });

test("demandes simples routées sur terra : luna aurait suffi", () => {
  for (const query of ["Qu'est-ce que j'ai demain ?", "Rappelle-moi d'appeler Paul demain à 10h", "Écris un email poli pour décaler la réunion de jeudi"]) {
    const active = route(query);
    assert.equal(active.model, "gpt-5.6-terra", query);
    assert.deepEqual(smallFirstDecision(active), { eligible: true, model: "gpt-5.6-luna", reasons: [], channel: "chat" }, query);
  }
});

test("escalade expliquée : complexité, recherche web, route déjà escaladée ou déjà sur luna", () => {
  const planning = smallFirstDecision(route("Analyse l'architecture de mon projet Noon et propose un plan de refactorisation de server.js"));
  assert.equal(planning.eligible, false);
  assert.ok(planning.reasons.includes("COMPLEXITY_PLANNING"));
  assert.ok(smallFirstDecision(route("Qu'est-ce que j'ai demain ?"), { webSearchEnabled: true }).reasons.includes("WEB_RESEARCH"));
  assert.deepEqual(smallFirstDecision(route("Salut Noon")).reasons, ["NOT_DEFAULT_ROUTE"], "déjà sur luna : rien à mesurer");
  const big = route("Qu'est-ce que j'ai demain ?");
  assert.ok(smallFirstDecision({ ...big, signals: { ...big.signals, context: { ...big.signals.context, attachments: 2, estimatedTokens: 9000 } } }).reasons.includes("ATTACHMENTS"));
  assert.equal(smallFirstDecision(null), null);
});

test("câblage : la route active reste celle du routeur ; décision tracée ; flag OFF/SHADOW uniquement", () => {
  const server = readServerSource();
  assert.match(server, /const route = smallFirstFlag\.shadow\s+\? \{ \.\.\.baseRoute, smallFirst:/);
  assert.doesNotMatch(server, /smallFirst[^\n]*model:\s*"gpt-5\.6-luna"/, "aucune réécriture du modèle actif");
  assert.match(fs.readFileSync(path.join(__dirname, "..", "services", "orchestration", "noon-orchestrator.js"), "utf8"), /smallFirst: state\.route\.smallFirst \|\| null/);
  const { FEATURE_FLAGS } = require("../services/config/feature-flag-registry");
  const flag = FEATURE_FLAGS.find((item) => item.flagId === "router.small-first");
  assert.equal(flag.defaultMode, "SHADOW");
  assert.deepEqual(flag.allowedModes, ["OFF", "SHADOW"]);
});

test("bilan : part des échanges éligibles, économie estimée, raisons d'escalade", () => {
  const now = Date.parse("2026-11-22T15:00:00Z");
  const trace = (smallFirst, text = 0.01) => ({ executionId: String(Math.random()), startedAt: "2026-11-22T09:00:00Z", completedAt: "2026-11-22T09:00:01Z", channel: "chat", status: "completed", errors: [], technicalExecutionMs: 1000, costs: { text, total: text }, routing: { smallFirst }, modelCalls: [] });
  const report = createNoonHealthReport({
    listTraces: () => [trace({ eligible: true, reasons: [] }, 0.02), trace({ eligible: false, reasons: ["COMPLEXITY_PLANNING"] }), trace({ eligible: false, reasons: ["NOT_DEFAULT_ROUTE"] }), trace(undefined)],
    usageStatus: () => ({ month: "2026-11" }), now: () => now,
  }).report({ days: 7 });
  assert.deepEqual(report.smallFirst, { measured: 2, eligible: 1, ratio: 0.5, estimatedSavingsUSD: 0.018, escalationReasons: { COMPLEXITY_PLANNING: 1 } });
});
