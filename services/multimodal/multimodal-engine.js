"use strict";

const crypto = require("node:crypto");
const { PDFDocument } = require("pdf-lib");
const sharp = require("sharp");
const { createMediaIntakeService, MediaError } = require("./media-intake-service");
const { createMediaAnalysisCache } = require("./media-analysis-cache");
const { selectMediaStrategy } = require("./media-strategy-selector");
const { clean, normalizeMultimodalRequest, stableHash } = require("./media-schema");

const ANALYSIS_VERSION = "multimodal-v1";

function cleanEvidenceText(value, maximum = 4000) { return String(value || "").replace(/\0/g, "").trim().slice(0, maximum); }
function safeConfidence(value) { return ["HIGH", "MEDIUM", "LOW", "UNKNOWN"].includes(String(value).toUpperCase()) ? String(value).toUpperCase() : "UNKNOWN"; }
function normalizeRegion(region) {
  if (!region || typeof region !== "object") return null;
  const values = [region.x, region.y, region.width, region.height].map(Number);
  return values.every(Number.isFinite) && values.every((item) => item >= 0) ? { x: values[0], y: values[1], width: values[2], height: values[3] } : null;
}
function normalizeEvidence(asset, raw, index, now) {
  const page = Number.isInteger(Number(raw.page)) && Number(raw.page) > 0 ? Number(raw.page) : null;
  const startMs = Number.isFinite(Number(raw.startMs)) && Number(raw.startMs) >= 0 ? Number(raw.startMs) : null;
  const endMs = Number.isFinite(Number(raw.endMs)) && Number(raw.endMs) >= (startMs || 0) ? Number(raw.endMs) : null;
  const content = cleanEvidenceText(raw.content || raw.text || raw.description || raw.summary);
  if (!content && !raw.table && !raw.chart && !raw.metadata) return null;
  const kind = ["TEXT", "VISUAL_OBSERVATION", "TABLE", "CHART", "AUDIO_TRANSCRIPT", "METADATA"].includes(raw.type) ? raw.type : asset.mediaType === "AUDIO" ? "AUDIO_TRANSCRIPT" : "VISUAL_OBSERVATION";
  const extractionMethod = ["native_text", "vision", "ocr", "speech_transcription", "metadata"].includes(raw.extractionMethod) ? raw.extractionMethod : asset.mediaType === "AUDIO" ? "speech_transcription" : "vision";
  const observationType = raw.observationType === "INFERENCE" ? "INFERENCE" : "OBSERVATION";
  return {
    evidenceId: `media-evidence-${stableHash(`${asset.assetId}:${index}:${kind}:${content}`, 24)}`,
    assetId: asset.assetId, sourceType: "media", sourceId: asset.assetId, sourceScope: asset.sourceScope,
    type: kind, content, table: raw.table || null, chart: raw.chart || null, metadata: raw.metadata || null,
    confidence: safeConfidence(raw.confidence), observationType,
    derivedFrom: observationType === "INFERENCE" ? (raw.derivedFrom || []).slice(0, 20) : [],
    locator: { assetId: asset.assetId, page, region: normalizeRegion(raw.region), startMs, endMs },
    provenance: { assetId: asset.assetId, page, region: normalizeRegion(raw.region), startMs, endMs, extractionMethod, extractedAt: new Date(now()).toISOString(), label: asset.filename, status: "current" },
    localOnly: asset.localOnly, allowedForRemoteModel: !asset.localOnly, untrustedContent: true,
    profileScope: "arnaud", projectId: asset.workspaceId || null,
    snippet: content, title: asset.filename,
  };
}

async function defaultInspect(asset, payload) {
  const metadata = { ...asset.metadata }; let pdfKind = null;
  if (["IMAGE", "SCREENSHOT"].includes(asset.mediaType)) {
    const value = await sharp(payload.buffer).metadata();
    metadata.dimensions = value.width && value.height ? { width: value.width, height: value.height } : null;
    metadata.orientation = value.orientation || null;
  } else if (asset.mediaType === "PDF") {
    const document = await PDFDocument.load(payload.buffer, { ignoreEncryption: false, updateMetadata: false });
    metadata.pageCount = document.getPageCount();
    const sample = payload.buffer.subarray(0, Math.min(payload.buffer.length, 512_000)).toString("latin1");
    const textSignals = (sample.match(/\b(?:BT|Tj|TJ)\b/g) || []).length;
    const imageSignals = (sample.match(/\/Subtype\s*\/Image/g) || []).length;
    pdfKind = textSignals > 3 && imageSignals > 0 ? "HYBRID" : textSignals > 3 ? "TEXT_NATIVE" : imageSignals > 0 ? "SCANNED" : "UNKNOWN";
  }
  return { metadata, pdfKind, inspectedAt: new Date().toISOString() };
}

function createMultimodalEngine({
  intake = null, inspect = defaultInspect, vision = null, transcribe = null, nativeDocument = null,
  synthesis = null, workspaceLink = null, indexEvidence = null, securityPolicy = null,
  modelRouter = null, observability = null, reliability = null, cache = createMediaAnalysisCache(),
  allowedRoots = () => [], now = () => Date.now(), limits = {},
} = {}) {
  const intakeService = intake || createMediaIntakeService({ allowedRoots, maxBytes: limits.maxAssetBytes || 12 * 1024 * 1024, now });
  const assets = new Map(); const payloads = new Map(); const analyses = new Map();
  const emit = (event, metadata = {}) => { try { observability?.(event, metadata); } catch {} };
  const fail = (asset, error) => { asset.processingState = error.code === "MEDIA_UNSUPPORTED" ? "UNSUPPORTED" : error.code === "ABORT_ERR" ? "INTERRUPTED" : "FAILED"; emit("media_analysis_failed", { assetId: asset.assetId, assetType: asset.mediaType, errorCode: error.code || error.name || "ERROR" }); try { reliability?.recordFailure?.(`multimodal-${asset.mediaType.toLowerCase()}`, error); } catch {} };

  async function ingest(input = {}) {
    const result = await intakeService.ingest(input); const existing = assets.get(result.asset.assetId);
    if (existing) return { asset: structuredClone(existing), duplicate: true };
    result.asset.processingState = "INSPECTING"; assets.set(result.asset.assetId, result.asset); payloads.set(result.asset.assetId, result.payload);
    emit("media_registered", { assetId: result.asset.assetId, assetType: result.asset.mediaType, sizeBytes: result.asset.sizeBytes });
    try {
      const inspection = await inspect(result.asset, result.payload);
      result.asset.metadata = { ...result.asset.metadata, ...(inspection.metadata || {}) };
      result.asset.inspection = { pdfKind: inspection.pdfKind || null };
      result.asset.processingState = result.asset.mediaType === "VIDEO" ? "UNSUPPORTED" : "REGISTERED";
      emit("media_inspected", { assetId: result.asset.assetId, assetType: result.asset.mediaType, pageCount: result.asset.metadata.pageCount || 0, audioDurationMs: result.asset.metadata.durationMs || 0, pdfKind: inspection.pdfKind || null });
    } catch (error) { fail(result.asset, Object.assign(error, { code: error.code || "MEDIA_INSPECTION_FAILED" })); }
    return { asset: structuredClone(result.asset), duplicate: false };
  }

  function requireAsset(assetId) { const asset = assets.get(String(assetId)); if (!asset) throw new MediaError("MEDIA_NOT_FOUND", "Média introuvable.", 404); return asset; }
  async function analyze(input = {}) {
    const request = normalizeMultimodalRequest(input); const started = now(); const evidence = []; const uncertainties = []; const analyzedAssets = [];
    for (const assetId of request.assetIds) {
      if (input.signal?.aborted) throw Object.assign(new Error("Analyse interrompue."), { name: "AbortError", code: "ABORT_ERR" });
      const asset = requireAsset(assetId); const payload = payloads.get(assetId);
      const strategy = selectMediaStrategy(asset, asset.inspection, request);
      if (strategy.strategy === "UNSUPPORTED") { asset.processingState = "UNSUPPORTED"; uncertainties.push({ assetId, code: "MEDIA_UNSUPPORTED", message: "Ce format n’est pas pris en charge." }); analyzedAssets.push(structuredClone(asset)); continue; }
      if (asset.localOnly && strategy.requiredCapabilities.some((item) => ["VISION", "AUDIO_TRANSCRIPTION"].includes(item))) {
        const hasLocal = strategy.strategy === "SPEECH_TRANSCRIPTION" ? transcribe?.local === true : vision?.local === true;
        if (!hasLocal) { asset.processingState = "PARTIAL"; uncertainties.push({ assetId, code: "MEDIA_LOCAL_ONLY_REMOTE_BLOCKED", message: "Analyse distante interdite pour ce média local-only." }); analyzedAssets.push(structuredClone(asset)); continue; }
      }
      const cacheInput = { fingerprint: asset.fingerprint, strategy: strategy.strategy, analysisVersion: ANALYSIS_VERSION, userIntent: request.userIntent };
      const cached = cache.get(cacheInput);
      if (cached) { evidence.push(...cached.evidence); analyzedAssets.push(cached.asset); emit("media_cache_hit", { assetId, assetType: asset.mediaType }); continue; }
      emit("media_cache_miss", { assetId, assetType: asset.mediaType });
      asset.processingState = "ANALYZING"; emit("media_analysis_started", { assetId, assetType: asset.mediaType, analysisStrategy: strategy.strategy });
      try {
        securityPolicy?.evaluateDataFlow?.({ action: "LOCAL_MEDIA_TO_REMOTE_MODEL", localOnly: asset.localOnly, sourceScope: asset.sourceScope, requiredCapabilities: strategy.requiredCapabilities });
        const route = modelRouter?.({ question: request.userIntent, profile: input.modelProfile || "balanced", budgetMode: input.budgetMode || "NORMAL", attachments: 1, requiredCapabilities: strategy.requiredCapabilities }) || null;
        let raw;
        if (strategy.strategy === "SPEECH_TRANSCRIPTION") {
          if (!transcribe) throw new MediaError("MEDIA_TRANSCRIPTION_UNAVAILABLE", "Transcription indisponible.", 503);
          raw = await transcribe({ asset, buffer: payload.buffer, signal: input.signal, route });
          emit("media_audio_transcribed", { assetId, audioSeconds: Math.round((asset.metadata.durationMs || 0) / 1000), segments: raw.segments?.length || 0 });
        } else if (strategy.strategy === "NATIVE_TEXT_FIRST" && nativeDocument) {
          raw = await nativeDocument({ asset, buffer: payload.buffer, request, signal: input.signal, route });
          emit("media_text_extracted", { assetId, pageCount: asset.metadata.pageCount || 0 });
        } else {
          if (!vision) throw new MediaError("MEDIA_VISION_UNAVAILABLE", "Analyse visuelle indisponible.", 503);
          raw = await vision({ asset, dataUrl: payload.dataUrl, request, strategy, signal: input.signal, route });
          emit("media_vision_analyzed", { assetId, pagesAnalyzed: raw.pagesAnalyzed || 0, regionsAnalyzed: raw.regionsAnalyzed || 0, visionCalls: 1 });
        }
        const rows = (raw.evidence || []).map((item, index) => normalizeEvidence(asset, item, index, now)).filter(Boolean);
        asset.processingState = raw.partial ? "PARTIAL" : "READY";
        const result = { asset: structuredClone(asset), evidence: rows, summary: cleanEvidenceText(raw.summary, 2000), strategy, metrics: { ...(raw.metrics || {}), totalMs: now() - started } };
        cache.set(cacheInput, result); analyses.set(assetId, result); evidence.push(...rows); analyzedAssets.push(result.asset);
        if (indexEvidence && rows.length) { await indexEvidence(result.asset, rows); emit("media_indexed", { assetId, evidenceCount: rows.length }); }
        if (request.workspaceId && workspaceLink) { await workspaceLink(request.workspaceId, result.asset); emit("media_linked_workspace", { assetId, workspaceId: request.workspaceId }); }
        emit(raw.partial ? "media_analysis_partial" : "media_analysis_completed", { assetId, assetType: asset.mediaType, analysisStrategy: strategy.strategy, evidenceCount: rows.length, durationMs: now() - started });
        try { reliability?.recordSuccess?.(`multimodal-${asset.mediaType.toLowerCase()}`, { latencyMs: now() - started, noData: rows.length === 0 }); } catch {}
      } catch (error) { fail(asset, error); uncertainties.push({ assetId, code: error.code || error.name || "MEDIA_ANALYSIS_FAILED", message: clean(error.message, 240) }); analyzedAssets.push(structuredClone(asset)); }
    }
    let synthesisResult = null;
    const pack = buildPack(request, analyzedAssets, evidence, uncertainties, started, now);
    if (synthesis && request.assetIds.length > 1 && evidence.length) synthesisResult = await synthesis(pack, { mode: /compare/i.test(request.userIntent) ? "COMPARE" : "SUMMARY", purpose: "remote_model", maxSources: 30, maxEvidenceTokens: 6000 });
    return { ...pack, synthesis: synthesisResult };
  }

  function buildPack(request, packAssets, evidence, uncertainties, started, clock) {
    return {
      evidencePackId: `multimodal-pack-${stableHash(`${request.requestId}:${packAssets.map((item) => item.fingerprint).join(":")}`, 24)}`,
      sourceType: "MULTIMODAL", sourceScope: request.privacyContext.sourceScope,
      assets: packAssets, evidence, results: evidence, remoteResults: evidence.filter((item) => item.allowedForRemoteModel),
      uncertainties, coverage: { requestedAssets: request.assetIds.length, analyzedAssets: packAssets.filter((item) => ["READY", "PARTIAL"].includes(item.processingState)).length, evidenceCount: evidence.length, partial: uncertainties.length > 0 },
      generatedAt: new Date(clock()).toISOString(), latency: { totalMs: Math.max(0, clock() - started) },
    };
  }

  function search({ query = "", workspaceId = null, sourceScope = null, limit = 20 } = {}) {
    const terms = String(query).toLowerCase().split(/\W+/).filter((item) => item.length > 2);
    const rows = [];
    for (const [assetId, result] of analyses) {
      if (workspaceId && result.asset.workspaceId !== workspaceId) continue;
      if (sourceScope && result.asset.sourceScope !== sourceScope) continue;
      for (const item of result.evidence) {
        const haystack = `${result.asset.filename} ${item.content}`.toLowerCase();
        const score = terms.length ? terms.filter((term) => haystack.includes(term)).length / terms.length : 0;
        if (score > 0) rows.push({ ...item, resultId: item.evidenceId, score, sourceType: "media", sourceId: assetId, title: result.asset.filename, snippet: item.content, timestamp: item.provenance.extractedAt, projectId: result.asset.workspaceId, profileScope: "arnaud" });
      }
    }
    return rows.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  return {
    analyze,
    cache,
    getAsset: (id) => structuredClone(requireAsset(id)),
    ingest,
    listAssets: () => [...assets.values()].map((asset) => structuredClone(asset)),
    search,
  };
}

module.exports = { ANALYSIS_VERSION, createMultimodalEngine, defaultInspect, normalizeEvidence };
