"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const JSZip = require("jszip");
const { PDFDocument } = require("pdf-lib");
const { generateArtifact, verifyArtifact, FORMATS } = require("../production/artifact-generator");
const { nextVersionedPath, safeBaseName } = require("../production/versioning");
const { isPathInsideRoots } = require("../../lib/path-utils");

const ARTIFACT_TYPES = new Set(["document", "pdf", "spreadsheet", "presentation", "markdown", "html", "image", "rtf"]);
const OUTPUT_FORMATS = new Set([...FORMATS]);
const STATES = new Set(["draft", "previewed", "approved", "written", "failed", "cancelled"]);
const PROVENANCE_MODES = new Set(["none", "minimal", "standard", "detailed"]);
const PRIVACY_MODES = new Set(["internal", "shareable"]);
const OVERWRITE_POLICIES = new Set(["CREATE_NEW", "OVERWRITE"]);
const FORMATS_BY_TYPE = Object.freeze({
  document: new Set(["docx", "pdf", "md", "html", "rtf", "txt"]),
  pdf: new Set(["pdf"]), spreadsheet: new Set(["xlsx", "csv"]),
  presentation: new Set(["pptx"]), markdown: new Set(["md"]),
  html: new Set(["html"]), image: new Set(["png"]), rtf: new Set(["rtf"]),
});
const CONTENT_BLOCKS = new Set(["heading", "paragraph", "list", "table", "image", "chart", "quote", "callout", "pageBreak", "sectionBreak"]);
const DEFAULT_PREVIEW_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MIME_TYPES = { docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pdf: "application/pdf", png: "image/png", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", md: "text/markdown", html: "text/html", rtf: "application/rtf", txt: "text/plain", json: "application/json", csv: "text/csv" };

class ArtifactError extends Error {
  constructor(code, message, details = null) {
    super(message); this.name = "ArtifactError"; this.code = code; this.details = details;
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function fingerprint(value) { return crypto.createHash("sha256").update(stableStringify(value)).digest("hex"); }
function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function iso(now) { return new Date(now()).toISOString(); }
function ensureEnum(value, allowed, fallback, code) { const normalized = String(value || fallback); if (!allowed.has(normalized)) throw new ArtifactError(code, `Valeur non prise en charge : ${normalized}.`); return normalized; }
function publicSourceLabel(source = {}) {
  const label = String(source.label || source.title || source.sourceType || "Source").trim().slice(0, 180);
  const date = String(source.observedAt || source.date || "").slice(0, 10);
  return date ? `${label} — ${date}` : label;
}
function safeCitation(source, privacyMode, index = 0) {
  const citationId = privacyMode === "shareable" ? `source-${index + 1}` : source.citationId || source.id || id("citation");
  const clean = { citationId: String(citationId).slice(0, 100), label: publicSourceLabel(source) };
  if (privacyMode === "internal") {
    clean.sourceId = source.sourceId || source.evidenceId || source.id || null;
    clean.locator = source.locator || null;
  }
  return clean;
}
function normalizeBlocks(content, structure = null) {
  if (Array.isArray(content)) {
    return content.map((block, index) => {
      const type = CONTENT_BLOCKS.has(block?.type) ? block.type : "paragraph";
      return { id: String(block?.id || `block-${index + 1}`), type, text: String(block?.text ?? block?.content ?? ""), level: Math.min(6, Math.max(1, Number(block?.level) || 1)), items: Array.isArray(block?.items) ? block.items.map(String) : [], headers: Array.isArray(block?.headers) ? block.headers.map(String) : [], rows: Array.isArray(block?.rows) ? block.rows.map((row) => Array.isArray(row) ? row.map(String) : [String(row)]) : [], altText: block?.altText ? String(block.altText) : null, sourceIds: Array.isArray(block?.sourceIds) ? block.sourceIds.map(String) : [] };
    });
  }
  if (content && typeof content === "object") {
    const blocks = [];
    for (const section of content.sections || []) {
      blocks.push({ id: id("section"), type: "heading", level: 1, text: String(section.title || "Section"), items: [], headers: [], rows: [], altText: null, sourceIds: section.sourceIds || [] });
      blocks.push({ id: id("paragraph"), type: "paragraph", level: 1, text: String(section.text || section.content || ""), items: [], headers: [], rows: [], altText: null, sourceIds: section.sourceIds || [] });
    }
    if (!blocks.length && content.answer) blocks.push({ id: id("paragraph"), type: "paragraph", level: 1, text: String(content.answer), items: [], headers: [], rows: [], altText: null, sourceIds: [] });
    return blocks;
  }
  const text = String(content || "");
  const chunks = text.replace(/\r/g, "").split("\n");
  return chunks.map((line, index) => ({ id: `block-${index + 1}`, type: line.trim() === "---" ? "sectionBreak" : "paragraph", level: 1, text: line, items: [], headers: [], rows: [], altText: null, sourceIds: [] }));
}
function renderPlanText(plan) {
  const lines = [];
  for (const block of plan.blocks) {
    if (["pageBreak", "sectionBreak"].includes(block.type)) { lines.push("---"); continue; }
    if (block.type === "heading") lines.push(`${"#".repeat(block.level)} ${block.text}`);
    else if (block.type === "list") lines.push(...block.items.map((item) => `- ${item}`));
    else if (block.type === "table") {
      if (block.headers.length) lines.push(block.headers.map(csvCell).join(","));
      lines.push(...block.rows.map((row) => row.map(csvCell).join(",")));
    } else if (block.type === "image") lines.push(block.altText ? `[Image : ${block.altText}]` : "[Image]");
    else if (block.type === "chart") lines.push(block.text ? `[Graphique : ${block.text}]` : "[Graphique]");
    else if (block.type === "quote") lines.push(`> ${block.text}`);
    else if (block.type === "callout") lines.push(`À retenir — ${block.text}`);
    else lines.push(block.text);
  }
  if (plan.citations.length && plan.provenanceMode !== "none") {
    lines.push("", "Sources");
    plan.citations.forEach((citation, index) => lines.push(`[${index + 1}] ${citation.label}`));
  }
  return lines.join("\n");
}
function csvCell(value) { const text = String(value ?? ""); return /[,"\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function detectWarnings(plan) {
  const warnings = [];
  for (const block of plan.blocks) {
    if (block.type === "table" && Math.max(block.headers.length, ...block.rows.map((row) => row.length), 0) > 12) warnings.push({ code: "TABLE_TOO_WIDE", blockId: block.id });
    if (block.type === "image" && !block.text && !block.altText) warnings.push({ code: "MISSING_IMAGE", blockId: block.id });
  }
  if (plan.outputFormat === "pptx") {
    const slideChunks = renderPlanText({ ...plan, citations: [] }).split(/\n---\n/);
    slideChunks.forEach((slide, index) => { if (slide.length > 1200 || slide.split("\n").length > 14) warnings.push({ code: "SLIDE_TOO_DENSE", slide: index + 1 }); });
  }
  return warnings;
}
function parseRecord(record) { if (!record) return null; return { ...record, plan: JSON.parse(record.plan_json), sourceIds: JSON.parse(record.source_ids_json || "[]") }; }

function createArtifactEngine({ repository, writableRoots = () => [], previewDirectory = path.join(os.tmpdir(), "noon-artifact-previews"), observability = null, approvalEngine = null, renderArtifact = generateArtifact, verify = verifyArtifact, now = () => Date.now(), previewMaxAgeMs = DEFAULT_PREVIEW_MAX_AGE_MS } = {}) {
  if (!repository) throw new ArtifactError("ARTIFACT_REPOSITORY_REQUIRED", "Registre d’artefacts indisponible.");
  fs.mkdirSync(previewDirectory, { recursive: true, mode: 0o700 });
  const locks = new Map();
  const emit = (event, metadata = {}) => { try { observability?.(event, metadata); } catch {} };

  function record(plan, extras = {}) {
    const previous = repository.get(plan.artifactId, plan.version);
    const timestamp = iso(now);
    return repository.save({
      artifact_id: plan.artifactId, version: plan.version, parent_artifact_id: plan.parentArtifactId,
      artifact_type: plan.artifactType, output_format: plan.outputFormat, state: extras.state || previous?.state || "draft",
      title: plan.title, content_fingerprint: plan.contentFingerprint, request_fingerprint: plan.requestFingerprint,
      plan_json: JSON.stringify(plan), source_ids_json: JSON.stringify(plan.sourceIds), source_synthesis_id: plan.sourceSynthesisId,
      privacy_mode: plan.privacyMode, preview_path: extras.previewPath ?? previous?.preview_path ?? null,
      output_path: extras.outputPath ?? previous?.output_path ?? null, size_bytes: extras.sizeBytes ?? previous?.size_bytes ?? null,
      created_at: previous?.created_at || timestamp, updated_at: timestamp,
    });
  }

  function prepare(request = {}) {
    const started = now(); emit("artifact_prepare_started", { artifactType: request.artifactType, outputFormat: request.outputFormat });
    const artifactType = ensureEnum(request.artifactType, ARTIFACT_TYPES, request.outputFormat === "pdf" ? "pdf" : "document", "ARTIFACT_UNSUPPORTED_TYPE");
    const outputFormat = ensureEnum(String(request.outputFormat || "docx").toLowerCase(), OUTPUT_FORMATS, "docx", "ARTIFACT_UNSUPPORTED_FORMAT");
    if (!FORMATS_BY_TYPE[artifactType]?.has(outputFormat)) {
      throw new ArtifactError("ARTIFACT_UNSUPPORTED_FORMAT", `Le format ${outputFormat} ne correspond pas au type ${artifactType}.`);
    }
    const provenanceMode = ensureEnum(request.provenanceMode, PROVENANCE_MODES, "standard", "ARTIFACT_PROVENANCE_INVALID");
    const privacyMode = ensureEnum(request.privacyMode, PRIVACY_MODES, "internal", "ARTIFACT_PRIVACY_INVALID");
    const overwritePolicy = ensureEnum(request.overwritePolicy, OVERWRITE_POLICIES, "CREATE_NEW", "ARTIFACT_OVERWRITE_POLICY_INVALID");
    const blocks = normalizeBlocks(request.content, request.structure);
    const evidence = Array.isArray(request.sourceEvidence) ? request.sourceEvidence : [];
    const citations = provenanceMode === "none" ? [] : evidence.map((source, index) => safeCitation(source, privacyMode, index));
    const sourceIds = evidence.map((source) => String(source.sourceId || source.evidenceId || source.id || "")).filter(Boolean);
    const previous = request.artifactId ? repository.latest(String(request.artifactId)) : null;
    const version = previous ? Number(previous.version) + 1 : 1;
    const artifactId = previous ? previous.artifact_id : String(request.artifactId || id("artifact"));
    const core = { artifactType, outputFormat, title: String(request.title || "Livrable").trim().slice(0, 160), purpose: String(request.purpose || "").slice(0, 500), blocks, tables: blocks.filter((block) => block.type === "table"), images: blocks.filter((block) => block.type === "image"), charts: blocks.filter((block) => block.type === "chart"), notes: Array.isArray(request.notes) ? request.notes.map(String) : [], citations, styling: request.styling && typeof request.styling === "object" ? request.styling : {}, template: request.template && typeof request.template === "object" ? { templateId: String(request.template.templateId || "minimal"), templateVersion: String(request.template.templateVersion || "1") } : { templateId: "minimal", templateVersion: "1" }, metadata: request.metadata && typeof request.metadata === "object" ? request.metadata : {} };
    const plan = Object.freeze({ artifactId, version, parentArtifactId: previous ? artifactId : null, ...core, sourceIds, sourceSynthesisId: request.sourceSynthesisId ? String(request.sourceSynthesisId) : null, provenanceMode, privacyMode, overwritePolicy, destination: request.destination ? path.resolve(String(request.destination)) : null, previewRequired: request.previewRequired !== false, contentFingerprint: fingerprint(core), requestFingerprint: fingerprint({ ...core, destination: request.destination || null, overwritePolicy }), createdAt: iso(now) });
    record(plan, { state: "draft" });
    emit("artifact_prepare_completed", { artifactId, artifactType, outputFormat, prepareMs: now() - started, blockCount: blocks.length, sourceCount: sourceIds.length });
    return plan;
  }

  async function inspect(filePath, format) {
    const stats = await verify(filePath, format);
    const metrics = { sizeBytes: stats.size, pageCount: null, slideCount: null, sheetCount: null };
    if (format === "pdf") metrics.pageCount = (await PDFDocument.load(fs.readFileSync(filePath))).getPageCount();
    if (["pptx", "xlsx", "docx"].includes(format)) {
      const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
      if (format === "pptx") metrics.slideCount = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
      if (format === "xlsx") metrics.sheetCount = Object.keys(zip.files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).length;
    }
    return metrics;
  }

  async function preview(planInput, options = {}) {
    const plan = typeof planInput === "string" ? parseRecord(repository.latest(planInput))?.plan : planInput;
    if (!plan) throw new ArtifactError("ARTIFACT_NOT_FOUND", "Artefact introuvable.");
    const started = now(); emit("artifact_preview_started", { artifactId: plan.artifactId, outputFormat: plan.outputFormat });
    const directory = path.join(previewDirectory, plan.artifactId, `v${plan.version}`);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      if (options.signal?.aborted) throw Object.assign(new Error("Génération annulée."), { name: "AbortError" });
      const renderStarted = now(); emit("artifact_render_started", { artifactId: plan.artifactId, outputFormat: plan.outputFormat });
      const artifact = await renderArtifact({ format: plan.outputFormat, title: plan.title, project: "Noon-preview", outputDirectory: directory, content: renderPlanText(plan) }, [previewDirectory]);
      emit("artifact_render_completed", { artifactId: plan.artifactId, outputFormat: plan.outputFormat, renderMs: now() - renderStarted });
      const validationStarted = now();
      let validation;
      try { validation = await inspect(artifact.path, plan.outputFormat); }
      catch (error) { throw new ArtifactError("ARTIFACT_VALIDATION_FAILED", error.message); }
      emit("artifact_validation_completed", { artifactId: plan.artifactId, outputFormat: plan.outputFormat, validationMs: now() - validationStarted, ...validation });
      const warnings = detectWarnings(plan);
      record(plan, { state: "previewed", previewPath: artifact.path, sizeBytes: validation.sizeBytes });
      const result = { artifactId: plan.artifactId, version: plan.version, state: "previewed", previewType: plan.outputFormat, previewPath: artifact.path, temporary: true, warnings, ...validation, contentFingerprint: plan.contentFingerprint };
      emit("artifact_preview_completed", { artifactId: plan.artifactId, outputFormat: plan.outputFormat, previewGenerationMs: now() - started, warningCount: warnings.length, ...validation });
      return result;
    } catch (error) {
      record(plan, { state: "failed" }); emit("artifact_write_failed", { artifactId: plan.artifactId, errorCode: error.code || error.name });
      if (error instanceof ArtifactError) throw error;
      throw new ArtifactError("ARTIFACT_RENDER_FAILED", error.message);
    }
  }

  function resolveDestination(plan, requestedDestination) {
    const rawTarget = String(requestedDestination || plan.destination || "").trim();
    if (!rawTarget) throw new ArtifactError("ARTIFACT_DESTINATION_REQUIRED", "Choisissez un dossier de destination.");
    const target = path.resolve(rawTarget);
    const roots = writableRoots().map((root) => { try { return fs.realpathSync(root); } catch { return path.resolve(root); } });
    let directory = target;
    if (path.extname(target)) directory = path.dirname(target);
    let realDirectory;
    try { realDirectory = fs.realpathSync(directory); } catch { throw new ArtifactError("ARTIFACT_DESTINATION_NOT_ALLOWED", "Le dossier de destination doit exister et être autorisé."); }
    if (!isPathInsideRoots(realDirectory, roots)) throw new ArtifactError("ARTIFACT_DESTINATION_NOT_ALLOWED", "Le dossier de destination n’est pas autorisé.");
    const filename = path.extname(target) ? `${safeBaseName(path.basename(target, path.extname(target)))}.${plan.outputFormat}` : null;
    return { directory: realDirectory, explicitPath: filename ? path.join(realDirectory, filename) : null };
  }

  async function write(planInput, options = {}) {
    const plan = typeof planInput === "string" ? parseRecord(repository.latest(planInput))?.plan : planInput;
    if (!plan) throw new ArtifactError("ARTIFACT_NOT_FOUND", "Artefact introuvable.");
    const stored = repository.get(plan.artifactId, plan.version);
    if (!stored?.preview_path || stored.content_fingerprint !== plan.contentFingerprint) throw new ArtifactError("ARTIFACT_STALE", "La prévisualisation ne correspond plus à cette version.");
    if (options.destination && plan.destination && path.resolve(String(options.destination)) !== path.resolve(String(plan.destination))) {
      throw new ArtifactError("ARTIFACT_STALE", "La destination a changé depuis la prévisualisation.");
    }
    const destinationInfo = resolveDestination(plan, options.destination);
    let destination = destinationInfo.explicitPath || nextVersionedPath(destinationInfo.directory, options.project || "Noon", plan.title, plan.outputFormat);
    const overwrite = plan.overwritePolicy === "OVERWRITE" || options.overwritePolicy === "OVERWRITE";
    if (fs.existsSync(destination)) {
      if (!overwrite) destination = nextVersionedPath(destinationInfo.directory, options.project || "Noon", plan.title, plan.outputFormat);
      else {
        const exact = { artifactId: plan.artifactId, version: plan.version, destination, outputFormat: plan.outputFormat, overwritePolicy: "OVERWRITE", contentFingerprint: plan.contentFingerprint };
        if (!approvalEngine || !options.approvalId) throw new ArtifactError("ARTIFACT_OVERWRITE_REQUIRES_APPROVAL", "L’écrasement exige une approbation exacte.", exact);
        approvalEngine.consumeApproval(options.approvalId, { provider: "artifact_engine", action: "overwrite_artifact", target: destination, payload: exact });
      }
    }
    const operationId = String(options.writeOperationId || fingerprint({ artifactId: plan.artifactId, version: plan.version, destination, contentFingerprint: plan.contentFingerprint })).slice(0, 128);
    const existingWrite = repository.getWrite(operationId);
    if (existingWrite?.status === "completed" && fs.existsSync(existingWrite.destination)) return { artifactId: plan.artifactId, version: plan.version, state: "written", path: existingWrite.destination, idempotent: true };
    if (locks.has(operationId)) return locks.get(operationId);
    const operation = (async () => {
      const started = now(); const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
      repository.saveWrite({ write_operation_id: operationId, artifact_id: plan.artifactId, version: plan.version, destination, content_fingerprint: plan.contentFingerprint, status: "started", created_at: iso(now), completed_at: null });
      try {
        if (options.signal?.aborted) throw Object.assign(new Error("Génération annulée."), { name: "AbortError" });
        fs.copyFileSync(stored.preview_path, temporary, fs.constants.COPYFILE_EXCL);
        let validation;
        try { validation = await inspect(temporary, plan.outputFormat); }
        catch (error) { throw new ArtifactError("ARTIFACT_VALIDATION_FAILED", error.message); }
        if (fs.existsSync(destination) && !overwrite) throw new ArtifactError("ARTIFACT_CONFLICT", "Le fichier de destination existe désormais.");
        fs.renameSync(temporary, destination);
        record(plan, { state: "written", outputPath: destination, sizeBytes: validation.sizeBytes });
        repository.saveWrite({ write_operation_id: operationId, artifact_id: plan.artifactId, version: plan.version, destination, content_fingerprint: plan.contentFingerprint, status: "completed", created_at: existingWrite?.created_at || iso(now), completed_at: iso(now) });
        emit("artifact_write_completed", { artifactId: plan.artifactId, outputFormat: plan.outputFormat, writeMs: now() - started, artifactSizeBytes: validation.sizeBytes });
        return { artifactId: plan.artifactId, version: plan.version, state: "written", format: plan.outputFormat, type: MIME_TYPES[plan.outputFormat], path: destination, directory: path.dirname(destination), name: path.basename(destination), size: validation.sizeBytes, createdAt: iso(now), writeOperationId: operationId, ...validation };
      } catch (error) {
        try { fs.unlinkSync(temporary); } catch {}
        repository.saveWrite({ write_operation_id: operationId, artifact_id: plan.artifactId, version: plan.version, destination, content_fingerprint: plan.contentFingerprint, status: "failed", created_at: existingWrite?.created_at || iso(now), completed_at: iso(now) });
        record(plan, { state: "failed" }); emit("artifact_write_failed", { artifactId: plan.artifactId, errorCode: error.code || error.name, writeMs: now() - started }); throw error;
      }
    })();
    locks.set(operationId, operation); try { return await operation; } finally { locks.delete(operationId); }
  }

  function revise(artifactId, changes = {}) {
    const previous = parseRecord(repository.latest(artifactId));
    if (!previous) throw new ArtifactError("ARTIFACT_NOT_FOUND", "Artefact introuvable.");
    const old = previous.plan;
    const blocks = old.blocks.map((block) => ({ ...block }));
    for (const edit of changes.blockEdits || []) {
      const index = blocks.findIndex((block) => block.id === edit.blockId);
      if (index >= 0) blocks[index] = { ...blocks[index], ...(edit.patch || {}) };
    }
    return prepare({ ...old, artifactId, content: changes.content || blocks, title: changes.title || old.title, destination: changes.destination || old.destination, sourceEvidence: old.citations, metadata: { ...old.metadata, revisionReason: String(changes.reason || "targeted_edit").slice(0, 200) } });
  }
  function requestWriteApproval(planInput, options = {}) {
    const plan = typeof planInput === "string" ? parseRecord(repository.latest(planInput))?.plan : planInput;
    if (!plan) throw new ArtifactError("ARTIFACT_NOT_FOUND", "Artefact introuvable.");
    if (!approvalEngine?.prepareAction) throw new ArtifactError("ARTIFACT_OVERWRITE_REQUIRES_APPROVAL", "Le moteur d’approbation est indisponible.");
    const destinationInfo = resolveDestination(plan, options.destination);
    const destination = destinationInfo.explicitPath || nextVersionedPath(destinationInfo.directory, options.project || "Noon", plan.title, plan.outputFormat);
    const exact = { artifactId: plan.artifactId, version: plan.version, destination, outputFormat: plan.outputFormat, overwritePolicy: "OVERWRITE", contentFingerprint: plan.contentFingerprint };
    return approvalEngine.prepareAction({ executionId: options.executionId, skillName: "artifact_engine", operation: "overwrite_artifact", target: destination, normalizedArgs: exact, permissionLevel: "write", title: "Écrasement d’un fichier", sanitizedSummary: `Remplacer ${path.basename(destination)} par la version prévisualisée.` });
  }
  function history(artifactId) { return repository.list(artifactId).map((entry) => ({ artifactId: entry.artifact_id, version: entry.version, parentArtifactId: entry.parent_artifact_id, format: entry.output_format, state: entry.state, path: entry.output_path, createdAt: entry.created_at, sourceSynthesisId: entry.source_synthesis_id, contentFingerprint: entry.content_fingerprint })); }
  function diff(artifactId, fromVersion, toVersion) {
    const left = parseRecord(repository.get(artifactId, fromVersion))?.plan; const right = parseRecord(repository.get(artifactId, toVersion))?.plan;
    if (!left || !right) throw new ArtifactError("ARTIFACT_NOT_FOUND", "Version d’artefact introuvable.");
    const leftBlocks = new Map(left.blocks.map((block) => [block.id, fingerprint(block)])); const rightBlocks = new Map(right.blocks.map((block) => [block.id, fingerprint(block)]));
    return { artifactId, fromVersion, toVersion, added: [...rightBlocks.keys()].filter((key) => !leftBlocks.has(key)), removed: [...leftBlocks.keys()].filter((key) => !rightBlocks.has(key)), modified: [...rightBlocks.keys()].filter((key) => leftBlocks.has(key) && leftBlocks.get(key) !== rightBlocks.get(key)) };
  }
  function cleanupPreviews() {
    let removed = 0;
    for (const entry of fs.readdirSync(previewDirectory, { withFileTypes: true })) {
      const target = path.join(previewDirectory, entry.name); let stat; try { stat = fs.statSync(target); } catch { continue; }
      if (now() - stat.mtimeMs > previewMaxAgeMs) { fs.rmSync(target, { recursive: true, force: true }); removed += 1; }
    }
    return removed;
  }
  async function create(request, options = {}) { const plan = prepare(request); const previewResult = await preview(plan, options); if (options.previewOnly || request.destination == null) return { plan, preview: previewResult, artifact: null }; return { plan, preview: previewResult, artifact: await write(plan, options) }; }
  return { prepare, preview, write, create, revise, history, diff, cleanupPreviews, requestWriteApproval, renderPlanText };
}

module.exports = { ARTIFACT_TYPES, CONTENT_BLOCKS, OUTPUT_FORMATS, STATES, ArtifactError, createArtifactEngine, fingerprint, normalizeBlocks, renderPlanText };
