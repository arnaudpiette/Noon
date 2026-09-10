"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { estimateModelCost } = require("../services/observability/model-pricing");
const {
  createNoonObservability,
  sanitizeMetrics,
} = require("../services/observability/noon-observability");

test("conserve un execution ID commun au contexte, modèle, outil et voix", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-observability-"));
  const filePath = path.join(directory, "metrics.jsonl");
  let clock = 1_000;
  const metrics = createNoonObservability({ filePath, now: () => clock, slowThresholdMs: 50 });
  const executionId = "exec_12345678";
  metrics.startExecution({ executionId, channel: "chat", intent: "development" });
  clock += 4;
  metrics.recordContext(executionId, {
    contextBuildMs: 4, memoryRetrievalMs: 2, memoriesLoaded: 3,
    memoryPrivateFiltered: 1, contextEstimatedTokens: 900,
  });
  metrics.recordRouting(executionId, { selectedModel: "gpt-5.6-terra", routingReason: { complexity: "high" } });
  metrics.recordModelCall(executionId, {
    model: "gpt-5.6-terra", modelTotalMs: 30, timeToFirstTokenMs: 8,
    streamChunks: 4, usage: { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 200 } },
  });
  metrics.recordTool(executionId, { toolName: "read_file", toolMs: 20, toolStatus: "succeeded" });
  metrics.recordVoice(executionId, { voiceIdentity: "noon-default", timeToFirstAudioMs: 40, ttsMs: 70 });
  clock += 80;
  metrics.completeExecution(executionId, { wallClockTotalMs: 84, technicalExecutionMs: 84 });
  await metrics.flush();

  const trace = metrics.getTrace(executionId);
  assert.equal(trace.executionId, executionId);
  assert.equal(trace.context.memoryRetrievalMs, 2);
  assert.equal(trace.modelCalls[0].inputTokens, 1000);
  assert.equal(trace.tools[0].toolMs, 20);
  assert.equal(trace.voice.timeToFirstAudioMs, 40);
  assert.equal(trace.principalBottleneck, "voice");
  assert.equal(trace.slow, true);
  assert.match(fs.readFileSync(filePath, "utf8"), /exec_12345678/);
});

test("sépare l'attente d'approbation du temps technique et trace le fallback", () => {
  let clock = 0;
  const metrics = createNoonObservability({ now: () => clock });
  metrics.startExecution({ executionId: "exec_approval" });
  metrics.recordApproval("exec_approval", { status: "accepted", waitMs: 25000 });
  metrics.recordFallback("exec_approval", { component: "model", from: "sol", to: "terra", reason: "timeout" });
  clock = 27_000;
  metrics.completeExecution("exec_approval", { wallClockTotalMs: 27000 });
  const trace = metrics.getTrace("exec_approval");
  assert.equal(trace.approvalWaitMs, 25000);
  assert.equal(trace.technicalExecutionMs, 2000);
  assert.equal(trace.fallbacks.length, 1);
});

test("supprime contenus privés, local_only, e-mails, chemins et secrets", () => {
  const clean = sanitizeMetrics({
    content: "médical local_only",
    prompt: "secret",
    filePath: "/Users/personne/Documents/privé.txt",
    contact: "personne@example.com",
    apiKey: "sk-testsecrettestsecret",
    memoryItemsReturned: 2,
  });
  const serialized = JSON.stringify(clean);
  assert.doesNotMatch(serialized, /médical|local_only|personne@example|Documents|sk-test/);
  assert.equal(clean.memoryItemsReturned, 2);
});

test("calcule un coût connu et refuse d'inventer un prix inconnu", () => {
  const known = estimateModelCost("gpt-5.6-luna", {
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    input_tokens_details: { cached_tokens: 500_000 },
  });
  assert.equal(known.status, "available");
  assert.equal(known.total, 1.31);
  const astra = estimateModelCost("gpt-6-astra", {
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    input_tokens_details: { cached_tokens: 500_000 },
  });
  assert.equal(astra.status, "available");
  assert.equal(astra.total, 55.5);
  assert.deepEqual(
    estimateModelCost("modele-inconnu", { input_tokens: 999 }),
    { status: "unavailable", currency: "USD", total: null }
  );
});

test("produit les agrégats p50/p95, routage, coûts et reste failure-safe", async () => {
  const metrics = createNoonObservability({ filePath: "/dev/null/interdit.jsonl" });
  for (let index = 1; index <= 5; index += 1) {
    const id = `exec_${index}`;
    metrics.startExecution({ executionId: id });
    metrics.recordContext(id, { contextCacheHits: 4, contextCacheMisses: 2, contextTokensSaved: 3 });
    metrics.recordModelCall(id, { model: "gpt-5.6-luna", modelTotalMs: index, usage: { input_tokens: 10, output_tokens: 5 } });
    metrics.completeExecution(id, { technicalExecutionMs: index * 10, wallClockTotalMs: index * 10 });
  }
  await metrics.flush();
  const summary = metrics.summary();
  assert.equal(summary.executions, 5);
  assert.equal(summary.latency.p50Ms, 30);
  assert.equal(summary.latency.p95Ms, 50);
  assert.equal(summary.modelCounts["gpt-5.6-luna"], 5);
  assert.equal(summary.contextCache.hits, 20);
  assert.equal(summary.contextCache.misses, 10);
  assert.equal(summary.contextCache.hitRate, 2 / 3);
  assert.equal(summary.contextCache.tokensSaved, 15);
  assert.ok(summary.persistenceErrors >= 1);
});
