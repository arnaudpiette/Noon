"use strict";

const fs = require("fs");
const path = require("path");
const { estimateModelCost } = require("./model-pricing");
const { normalizeRoutingMetadata } = require("../models/routing-metadata");

const DEFAULT_RETENTION_DAYS = 30;
const SENSITIVE_KEY = /(prompt|response|content|message|question|query|email|address|path|file|attachment|audio|transcript|token|secret|password|argument|result|payload|statement|value)/i;
const SAFE_METRIC_KEY = /^(inputTokens|outputTokens|cachedTokens|contextEstimatedTokens|estimatedTokens|budgetTokens|contextBudget|attachments|sourceCount|expectedCount|textLength|contextCacheHits|contextCacheMisses|contextCacheHitRate|contextCacheEntries|contextCacheMemoryBytesEstimate|contextTokensBefore|contextTokensAfter|contextTokensSaved|contextFingerprint|contextSegments|timeToFirstAudioMs|timeToFirstTokenMs|ttsMs|ttsStartMs|ttsTotalMs|transcriptionMs|realtimeConnectMs|firstAudioMs)$/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PRIVATE_PATH = /(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)[^\s"']+/gi;
const SECRET = /(?:sk-|Bearer\s+|token[=:]\s*)[A-Za-z0-9._-]{8,}/gi;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function sanitizeString(value) {
  return String(value)
    .replace(EMAIL, "[redacted-email]")
    .replace(PRIVATE_PATH, "[redacted-path]")
    .replace(SECRET, "[redacted-secret]")
    .slice(0, 160);
}

function sanitizeMetrics(value, key = "", depth = 0) {
  if (depth > 6) return "[truncated]";
  if (SENSITIVE_KEY.test(key) && !SAFE_METRIC_KEY.test(key)) return "[redacted]";
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeMetrics(item, "item", depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      sanitizeMetrics(childValue, childKey, depth + 1),
    ]));
  }
  return sanitizeString(value);
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function normalizeError(error) {
  const status = Number(error?.status || error?.statusCode) || null;
  const code = String(error?.code || error?.type || error?.name || "ERROR").toUpperCase();
  let type = "MODEL_ERROR";
  if (error?.name === "AbortError") type = "MODEL_TIMEOUT";
  else if (status === 429) type = "MODEL_RATE_LIMIT";
  else if (/PERMISSION/.test(code)) type = "PERMISSION_DENIED";
  else if (/APPROVAL/.test(code)) type = "APPROVAL_REJECTED";
  else if (/TOOL/.test(code)) type = "TOOL_ERROR";
  else if (/CONTEXT/.test(code)) type = "CONTEXT_ERROR";
  else if (/TTS/.test(code)) type = "TTS_ERROR";
  else if (/REALTIME/.test(code)) type = "REALTIME_ERROR";
  else if (/CONNECTOR|NETWORK/.test(code)) type = "CONNECTOR_ERROR";
  return { type, code: code.slice(0, 80), status };
}

function bottleneck(trace) {
  const phases = [
    ["context", finite(trace.context?.contextBuildMs)],
    ["model", (trace.modelCalls || []).reduce((sum, call) => sum + finite(call.modelTotalMs), 0)],
    ["tools", (trace.tools || []).reduce((sum, tool) => sum + finite(tool.toolMs), 0)],
    ["voice", finite(trace.voice?.ttsMs) + finite(trace.voice?.transcriptionMs)],
  ];
  return phases.sort((left, right) => right[1] - left[1])[0]?.[0] || null;
}

function createNoonObservability({
  filePath = null,
  retentionDays = DEFAULT_RETENTION_DAYS,
  slowThresholdMs = Number(process.env.NOON_SLOW_TRACE_MS) || 5000,
  now = () => Date.now(),
  maxInMemory = 5000,
} = {}) {
  const traces = new Map();
  let writeQueue = Promise.resolve();
  let persistenceErrors = 0;
  let modelPerformanceEngine = null;

  // Le chargement et la purge ont lieu au démarrage, hors du chemin critique.
  if (filePath && fs.existsSync(filePath)) {
    try {
      const cutoff = now() - retentionDays * 24 * 60 * 60 * 1000;
      const retained = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((trace) => Date.parse(trace.startedAt) >= cutoff)
        .slice(-maxInMemory);
      for (const trace of retained) traces.set(trace.executionId, trace);
      writeQueue = fs.promises.writeFile(
        filePath,
        retained.map((trace) => JSON.stringify(trace)).join("\n") + (retained.length ? "\n" : ""),
        "utf8"
      ).catch(() => { persistenceErrors += 1; });
    } catch {
      persistenceErrors += 1;
    }
  }

  function startExecution({ executionId, channel = "chat", intent = "general", mode = null } = {}) {
    const overheadStarted = now();
    const trace = {
      executionId: sanitizeString(executionId),
      startedAt: new Date(now()).toISOString(),
      completedAt: null,
      channel: sanitizeString(channel),
      intent: sanitizeString(intent),
      mode: mode ? sanitizeString(mode) : null,
      context: {}, routing: {}, modelCalls: [], tools: [], approvals: [], voice: {},
      priority: {},
      costs: { text: 0, web: 0, transcription: 0, realtime: 0, image: 0, tts: 0, total: 0 },
      fallbacks: [], errors: [], toolRounds: 0, streamChunks: 0,
      approvalWaitMs: 0, technicalExecutionMs: 0, wallClockTotalMs: 0,
      observabilityOverheadMs: 0, slow: false, principalBottleneck: null,
      _startedMs: now(),
    };
    trace.observabilityOverheadMs += now() - overheadStarted;
    traces.set(trace.executionId, trace);
    return trace.executionId;
  }

  function mutate(executionId, operation) {
    const started = now();
    const trace = traces.get(String(executionId));
    if (!trace) return null;
    try { operation(trace); } catch { persistenceErrors += 1; }
    trace.observabilityOverheadMs += now() - started;
    return trace;
  }

  function recordContext(id, metrics) {
    mutate(id, (trace) => { trace.context = sanitizeMetrics(metrics); });
  }
  function recordRouting(id, metrics) {
    mutate(id, (trace) => { trace.routing = sanitizeMetrics(metrics); });
  }
  function recordPriority(id, metrics) {
    mutate(id, (trace) => { trace.priority = sanitizeMetrics(metrics); });
  }
  function recordModelCall(id, metrics) {
    mutate(id, (trace) => {
      const clean = sanitizeMetrics(metrics);
      const cost = estimateModelCost(metrics.provider || "openai", clean.model, metrics.usage || {});
      const routingMetadata = normalizeRoutingMetadata(metrics.routingMetadata || metrics, {
        provider: metrics.provider || "openai", model: clean.model, usage: metrics.usage || {},
        latencyMs: metrics.modelTotalMs ?? metrics.latency, success: metrics.status !== "failed",
        error: metrics.status === "failed" ? metrics.failureCategory || metrics.errorType || metrics.errorCode : null,
      });
      clean.inputTokens = finite(metrics.usage?.inputTokens ?? metrics.usage?.input_tokens);
      clean.outputTokens = finite(metrics.usage?.outputTokens ?? metrics.usage?.output_tokens);
      clean.cachedTokens = finite(metrics.usage?.cachedInputTokens ?? metrics.usage?.input_tokens_details?.cached_tokens);
      delete clean.usage;
      clean.costEstimate = cost;
      clean.routingMetadata = routingMetadata;
      trace.modelCalls.push(clean);
      if (cost.status === "available") trace.costs.text += cost.total;

      try {
        modelPerformanceEngine?.recordOutcome({
          taskDomain: routingMetadata.taskDomain,
          requiredQuality: routingMetadata.requiredQuality,
          provider: String(metrics.provider || "openai"),
          model: String(clean.model || metrics.model || ""),
          success: routingMetadata.success,
          failureCategory: routingMetadata.failureCategory,
          latencyMs: routingMetadata.latency,
          inputTokens: clean.inputTokens,
          outputTokens: clean.outputTokens,
          actualCost: routingMetadata.actualCost?.total ?? null,
          firstPassSuccess:
            typeof metrics.firstPassSuccess === "boolean"
              ? metrics.firstPassSuccess
              : null,
          fallbackUsed: metrics.fallbackUsed === true,
          escalationUsed: metrics.escalationUsed === true,
        });
      } catch {
        persistenceErrors += 1;
      }
    });
  }
  function attachModelPerformanceEngine(engine) {
    if (!engine?.recordOutcome || !engine?.snapshot) {
      throw new TypeError("ModelPerformanceEngine invalide.");
    }
    modelPerformanceEngine = engine;
    return true;
  }

  function recordTool(id, metrics) {
    mutate(id, (trace) => { trace.tools.push(sanitizeMetrics(metrics)); });
  }
  function recordApproval(id, metrics) {
    mutate(id, (trace) => {
      const clean = sanitizeMetrics(metrics);
      trace.approvals.push(clean);
      trace.approvalWaitMs += finite(clean.waitMs);
    });
  }
  function recordFallback(id, metrics) {
    mutate(id, (trace) => { trace.fallbacks.push(sanitizeMetrics(metrics)); });
  }
  function recordVoice(id, metrics) {
    const trace = mutate(id, (current) => { current.voice = { ...current.voice, ...sanitizeMetrics(metrics) }; });
    if (trace?.completedAt) persist(trace);
  }
  function recordCost(id, category, amount) {
    mutate(id, (trace) => {
      if (Object.prototype.hasOwnProperty.call(trace.costs, category) && category !== "total") {
        trace.costs[category] += finite(amount);
      }
    });
  }
  function recordError(id, error) {
    mutate(id, (trace) => { trace.errors.push(normalizeError(error)); });
  }

  function persist(trace) {
    if (!filePath) return;
    const publicTrace = sanitizeMetrics(Object.fromEntries(
      Object.entries(trace).filter(([key]) => !key.startsWith("_"))
    ));
    writeQueue = writeQueue
      .then(async () => {
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.appendFile(filePath, `${JSON.stringify(publicTrace)}\n`, "utf8");
      })
      .catch(() => { persistenceErrors += 1; });
  }

  function completeExecution(id, metrics = {}) {
    const trace = mutate(id, (current) => {
      Object.assign(current, sanitizeMetrics(metrics));
      current.completedAt = new Date(now()).toISOString();
      current.wallClockTotalMs = finite(metrics.wallClockTotalMs, now() - current._startedMs);
      current.technicalExecutionMs = finite(
        metrics.technicalExecutionMs,
        Math.max(0, current.wallClockTotalMs - current.approvalWaitMs)
      );
      current.slow = current.technicalExecutionMs > slowThresholdMs;
      current.principalBottleneck = bottleneck(current);
      current.costs.total = Object.entries(current.costs)
        .filter(([key]) => key !== "total")
        .reduce((sum, [, value]) => sum + finite(value), 0);
    });
    if (trace) persist(trace);
    if (traces.size > maxInMemory) traces.delete(traces.keys().next().value);
    return trace ? sanitizeMetrics(trace) : null;
  }

  function failExecution(id, error, metrics = {}) {
    recordError(id, error);
    return completeExecution(id, { ...metrics, status: "failed" });
  }

  function getTrace(id) {
    const trace = traces.get(String(id));
    return trace ? sanitizeMetrics(Object.fromEntries(Object.entries(trace).filter(([key]) => !key.startsWith("_")))) : null;
  }

  function summary({ sinceMs = 24 * 60 * 60 * 1000 } = {}) {
    const cutoff = now() - finite(sinceMs);
    const recent = [...traces.values()].filter((trace) => Date.parse(trace.startedAt) >= cutoff && trace.completedAt);
    const latency = recent.map((trace) => trace.technicalExecutionMs);
    const modelCounts = {};
    const costByCategory = { text: 0, web: 0, transcription: 0, realtime: 0, image: 0, tts: 0 };
    let contextCacheHits = 0;
    let contextCacheMisses = 0;
    let contextTokensSaved = 0;
    const approvalMetrics = { created: 0, approved: 0, rejected: 0, expired: 0, stale: 0, consumed: 0, failures: 0, waitMs: 0, resumeMs: 0 };
    for (const trace of recent) {
      for (const call of trace.modelCalls) modelCounts[call.model] = (modelCounts[call.model] || 0) + 1;
      for (const category of Object.keys(costByCategory)) costByCategory[category] += finite(trace.costs[category]);
      contextCacheHits += finite(trace.context?.contextCacheHits);
      contextCacheMisses += finite(trace.context?.contextCacheMisses);
      contextTokensSaved += finite(trace.context?.contextTokensSaved);
      for (const approval of trace.approvals || []) {
        const status = String(approval.status || "");
        if (status === "required") approvalMetrics.created += 1;
        if (["accepted", "approved"].includes(status)) approvalMetrics.approved += 1;
        if (status === "rejected") approvalMetrics.rejected += 1;
        if (status === "expired") approvalMetrics.expired += 1;
        if (status === "stale") approvalMetrics.stale += 1;
        if (status === "consumed") approvalMetrics.consumed += 1;
        if (status === "failed") approvalMetrics.failures += 1;
        approvalMetrics.waitMs += finite(approval.waitMs);
        approvalMetrics.resumeMs += finite(approval.approvalResumeMs);
      }
    }
    return {
      status: "ok",
      retentionDays,
      executions: recent.length,
      errors: recent.reduce((sum, trace) => sum + trace.errors.length, 0),
      fallbacks: recent.reduce((sum, trace) => sum + trace.fallbacks.length, 0),
      latency: { p50Ms: percentile(latency, 0.5), p95Ms: percentile(latency, 0.95) },
      modelCounts,
      costByCategory,
      contextCache: {
        hits: contextCacheHits,
        misses: contextCacheMisses,
        hitRate: contextCacheHits + contextCacheMisses
          ? contextCacheHits / (contextCacheHits + contextCacheMisses)
          : 0,
        tokensSaved: contextTokensSaved,
      },
      approvals: approvalMetrics,
      persistenceErrors,
    };
  }

  return {
    attachModelPerformanceEngine,
    completeExecution, failExecution, flush: () => writeQueue, getTrace,
    healthSummary: () => summary(), recordApproval, recordContext, recordCost, recordError,
    recordFallback, recordModelCall, recordRouting, recordTool, recordVoice,
    recordPriority, sanitize: sanitizeMetrics, startExecution, summary,
  };
}

module.exports = {
  DEFAULT_RETENTION_DAYS,
  createNoonObservability,
  normalizeError,
  percentile,
  sanitizeMetrics,
};
