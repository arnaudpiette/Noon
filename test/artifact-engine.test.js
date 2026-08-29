"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApprovalEngine } = require("../services/approvals/approval-engine");
const { ArtifactError, createArtifactEngine, fingerprint } = require("../services/artifacts/artifact-engine");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createArtifactRepository } = require("../services/persistence/repositories/artifact-repository");

function memoryRepository() {
  const records = []; const writes = [];
  return {
    save(record) { const index = records.findIndex((item) => item.artifact_id === record.artifact_id && item.version === record.version); if (index >= 0) records[index] = record; else records.push(record); return record; },
    get(id, version) { return records.find((item) => item.artifact_id === id && item.version === version) || null; },
    latest(id) { return records.filter((item) => item.artifact_id === id).sort((a, b) => b.version - a.version)[0] || null; },
    list(id) { return records.filter((item) => item.artifact_id === id).sort((a, b) => a.version - b.version); },
    findDuplicate(contentFingerprint, format) { return records.find((item) => item.content_fingerprint === contentFingerprint && item.output_format === format) || null; },
    saveWrite(record) { const index = writes.findIndex((item) => item.write_operation_id === record.write_operation_id); if (index >= 0) writes[index] = record; else writes.push(record); return record; },
    getWrite(id) { return writes.find((item) => item.write_operation_id === id) || null; }, records, writes,
  };
}

function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noon-artifact-engine-"));
  const previews = fs.mkdtempSync(path.join(os.tmpdir(), "noon-artifact-preview-"));
  const repository = memoryRepository(); const events = [];
  const approvalEngine = options.approvalEngine || createApprovalEngine();
  const engine = createArtifactEngine({ repository, writableRoots: () => [root], previewDirectory: previews, approvalEngine, observability: (event, metadata) => events.push({ event, metadata }), ...options });
  return { root, previews, repository, events, approvalEngine, engine };
}

function request(root, format = "md", overrides = {}) {
  const type = { docx: "document", pdf: "pdf", pptx: "presentation", xlsx: "spreadsheet", md: "markdown", html: "html", rtf: "rtf", png: "image" }[format];
  return { artifactType: type, outputFormat: format, title: "Rapport Noon", purpose: "test", content: [{ id: "intro", type: "heading", text: "Synthèse", level: 1 }, { id: "body", type: "paragraph", text: "Contenu vérifié" }], destination: root, provenanceMode: "none", ...overrides };
}

for (const format of ["docx", "pdf", "pptx", "xlsx", "md"]) {
  test(`prépare, prévisualise et écrit un ${format} valide`, async () => {
    const { engine, root } = fixture(); const result = await engine.create(request(root, format));
    assert.equal(result.plan.outputFormat, format); assert.equal(result.preview.temporary, true);
    assert.ok(fs.existsSync(result.preview.previewPath)); assert.ok(fs.existsSync(result.artifact.path));
    assert.equal(result.artifact.state, "written");
  });
}

test("preview only ne crée aucun fichier dans le dossier utilisateur", async () => {
  const { engine, root } = fixture(); const result = await engine.create(request(root), { previewOnly: true });
  assert.equal(result.artifact, null); assert.deepEqual(fs.readdirSync(root), []); assert.ok(fs.existsSync(result.preview.previewPath));
});

test("un même contenu s'exporte dans plusieurs formats avec une structure cohérente", async () => {
  const { engine, root } = fixture();
  const docx = await engine.create(request(root, "docx")); const pdf = await engine.create(request(root, "pdf"));
  assert.deepEqual(docx.plan.blocks, pdf.plan.blocks); assert.equal(docx.plan.title, pdf.plan.title);
});

test("CREATE_NEW versionne et préserve l'ancien fichier", async () => {
  const { engine, root } = fixture(); const first = await engine.create(request(root)); const second = await engine.create(request(root, "md", { content: "version deux" }));
  assert.notEqual(first.artifact.path, second.artifact.path); assert.match(fs.readFileSync(first.artifact.path, "utf8"), /Contenu vérifié/);
});

test("un overwrite exige puis consomme une approbation exacte", async () => {
  const { engine, root, approvalEngine } = fixture(); const destination = path.join(root, "rapport.md"); fs.writeFileSync(destination, "ancien");
  const plan = engine.prepare(request(destination, "md", { destination, overwritePolicy: "OVERWRITE" })); await engine.preview(plan);
  await assert.rejects(() => engine.write(plan), { code: "ARTIFACT_OVERWRITE_REQUIRES_APPROVAL" });
  const approval = engine.requestWriteApproval(plan); approvalEngine.confirm(approval.id);
  const written = await engine.write(plan, { approvalId: approval.id }); assert.equal(fs.realpathSync(written.path), fs.realpathSync(destination)); assert.match(fs.readFileSync(destination, "utf8"), /Contenu vérifié/);
});

test("un double write avec le même operationId reste idempotent", async () => {
  const { engine, root } = fixture(); const plan = engine.prepare(request(root)); await engine.preview(plan);
  const first = await engine.write(plan, { writeOperationId: "operation-stable" }); const second = await engine.write(plan, { writeOperationId: "operation-stable" });
  assert.equal(first.path, second.path); assert.equal(second.idempotent, true); assert.equal(fs.readdirSync(root).length, 1);
});

test("une preview modifiée devient stale", async () => {
  const { engine, root } = fixture(); const plan = engine.prepare(request(root)); await engine.preview(plan);
  await assert.rejects(() => engine.write({ ...plan, contentFingerprint: "changed" }), { code: "ARTIFACT_STALE" });
});

test("un changement de destination après preview est bloqué", async () => {
  const { engine, root } = fixture(); const second = fs.mkdtempSync(path.join(os.tmpdir(), "noon-artifact-other-"));
  const plan = engine.prepare(request(root)); await engine.preview(plan);
  await assert.rejects(() => engine.write(plan, { destination: second }), { code: "ARTIFACT_STALE" });
});

test("un chemin non autorisé et un symlink sortant sont bloqués", async () => {
  const { engine, root } = fixture(); const outside = fs.mkdtempSync(path.join(os.tmpdir(), "noon-artifact-outside-"));
  const plan = engine.prepare(request(outside)); await engine.preview(plan);
  await assert.rejects(() => engine.write(plan), { code: "ARTIFACT_DESTINATION_NOT_ALLOWED" });
  const link = path.join(root, "escape"); fs.symlinkSync(outside, link);
  const symlinkPlan = engine.prepare(request(link)); await engine.preview(symlinkPlan);
  await assert.rejects(() => engine.write(symlinkPlan), { code: "ARTIFACT_DESTINATION_NOT_ALLOWED" });
});

test("un échec renderer ne laisse aucun fichier final et produit une erreur structurée", async () => {
  const { engine, root } = fixture({ renderArtifact: async () => { throw new Error("renderer down"); } });
  const plan = engine.prepare(request(root)); await assert.rejects(() => engine.preview(plan), { code: "ARTIFACT_RENDER_FAILED" }); assert.deepEqual(fs.readdirSync(root), []);
});

test("un échec de validation ne promeut jamais le fichier final", async () => {
  const { engine, root } = fixture({ verify: async () => { throw new Error("invalid"); } });
  const plan = engine.prepare(request(root)); await assert.rejects(() => engine.preview(plan), { code: "ARTIFACT_VALIDATION_FAILED" }); assert.deepEqual(fs.readdirSync(root), []);
});

test("les versions sont liées, immuables, révisables et comparables", async () => {
  const { engine, root } = fixture(); const v1 = engine.prepare(request(root)); await engine.preview(v1); await engine.write(v1);
  const v2 = engine.revise(v1.artifactId, { blockEdits: [{ blockId: "body", patch: { text: "Texte aéré" } }], reason: "aérer" });
  assert.equal(v2.version, 2); assert.equal(v2.parentArtifactId, v1.artifactId); assert.equal(v1.blocks[1].text, "Contenu vérifié");
  assert.deepEqual(engine.diff(v1.artifactId, 1, 2).modified, ["body"]); assert.equal(engine.history(v1.artifactId).length, 2);
});

test("la provenance est conservée sans inventer de citation", () => {
  const { engine, root } = fixture();
  const sourced = engine.prepare(request(root, "md", { provenanceMode: "detailed", sourceEvidence: [{ id: "e1", label: "Décision projet", locator: "section 2" }], sourceSynthesisId: "synthesis-1" }));
  const original = engine.prepare(request(root, "md", { provenanceMode: "standard", sourceEvidence: [] }));
  assert.equal(sourced.citations.length, 1); assert.equal(sourced.sourceSynthesisId, "synthesis-1"); assert.deepEqual(original.citations, []);
});

test("shareable retire chemins locaux et identifiants internes", () => {
  const { engine, root } = fixture(); const plan = engine.prepare(request(root, "md", { privacyMode: "shareable", provenanceMode: "standard", sourceEvidence: [{ id: "internal-42", label: "Conversation Noon", locator: "/Users/exemple/secret.md" }] }));
  assert.equal(plan.citations[0].locator, undefined); assert.equal(plan.citations[0].sourceId, undefined); assert.doesNotMatch(JSON.stringify(plan.citations), /\/Users\/|internal-42/);
});

test("table large, slide dense et image manquante produisent des warnings", async () => {
  const { engine, root } = fixture(); const plan = engine.prepare(request(root, "pptx", { content: [{ id: "table", type: "table", headers: Array.from({ length: 13 }, (_, i) => `C${i}`), rows: [] }, { id: "missing", type: "image" }, { id: "dense", type: "paragraph", text: "x".repeat(1300) }] }));
  const preview = await engine.preview(plan); assert.deepEqual(new Set(preview.warnings.map((item) => item.code)), new Set(["TABLE_TOO_WIDE", "MISSING_IMAGE", "SLIDE_TOO_DENSE"]));
});

test("les blocs conservent hiérarchie de titres et texte alternatif", () => {
  const { engine, root } = fixture(); const plan = engine.prepare(request(root, "docx", { content: [{ type: "heading", level: 2, text: "Titre" }, { type: "image", text: "asset.png", altText: "Schéma accessible" }] }));
  assert.equal(plan.blocks[0].level, 2); assert.equal(plan.blocks[1].altText, "Schéma accessible");
});

test("annuler avant le rendu ne crée aucun final", async () => {
  const { engine, root } = fixture(); const controller = new AbortController(); controller.abort(); const plan = engine.prepare(request(root));
  await assert.rejects(() => engine.preview(plan, { signal: controller.signal }), /annulée/); assert.deepEqual(fs.readdirSync(root), []);
});

test("un document long reste borné et stable", async () => {
  const { engine, root } = fixture(); const content = Array.from({ length: 300 }, (_, index) => `Paragraphe ${index}`).join("\n"); const result = await engine.create(request(root, "pdf", { content }));
  assert.ok(result.artifact.pageCount >= 1); assert.ok(result.artifact.size > 0);
});

test("l'observabilité ne reçoit jamais le contenu de l'artefact", async () => {
  const { engine, root, events } = fixture(); await engine.create(request(root, "md", { content: "SECRET-DOCUMENT-BODY" }));
  assert.doesNotMatch(JSON.stringify(events), /SECRET-DOCUMENT-BODY/); assert.ok(events.some((entry) => entry.event === "artifact_write_completed"));
});

test("les fingerprints sont déterministes", () => { assert.equal(fingerprint({ b: 2, a: 1 }), fingerprint({ a: 1, b: 2 })); });
test("les erreurs exposent un code stable", () => { const error = new ArtifactError("ARTIFACT_TEST", "test"); assert.equal(error.code, "ARTIFACT_TEST"); });
test("le type et le format restent distincts mais compatibles", () => {
  const { engine, root } = fixture();
  assert.throws(() => engine.prepare({ ...request(root, "docx"), artifactType: "spreadsheet" }), { code: "ARTIFACT_UNSUPPORTED_FORMAT" });
});

test("SQLite conserve l'historique et les opérations d'écriture", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-artifact-db-")); const database = createPersonalDatabase(path.join(directory, "artifacts.sqlite"));
  const repository = createArtifactRepository(database); const timestamp = new Date().toISOString();
  repository.save({ artifact_id: "artifact-db", version: 1, parent_artifact_id: null, artifact_type: "document", output_format: "docx", state: "draft", title: "Test", content_fingerprint: "content", request_fingerprint: "request", plan_json: "{}", source_ids_json: "[]", source_synthesis_id: null, privacy_mode: "internal", preview_path: null, output_path: null, size_bytes: null, created_at: timestamp, updated_at: timestamp });
  repository.saveWrite({ write_operation_id: "write-db", artifact_id: "artifact-db", version: 1, destination: "/redacted", content_fingerprint: "content", status: "completed", created_at: timestamp, completed_at: timestamp });
  assert.equal(repository.latest("artifact-db").title, "Test"); assert.equal(repository.getWrite("write-db").status, "completed"); database.close();
});
