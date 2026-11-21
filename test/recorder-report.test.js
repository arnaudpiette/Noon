"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument } = require("pdf-lib");
const JSZip = require("jszip");
const { reportContent } = require("../lib/recorder-report");
const { buildBuffer } = require("../services/production/artifact-generator");

const record = {
  title: "Réunion",
  transcript: { text: "Envoyer le devis mardi prochain.", revision: 2 },
  analysis: {
    transcriptRevision: 2, stale: false, summary: "Le devis a été évoqué.",
    claims: [{ type: "action", text: "Envoyer le devis.", quote: "Envoyer le devis mardi prochain." }],
  },
};

test("une correction invalide la génération des quatre rapports", () => {
  assert.throws(() => reportContent({ ...record, analysis: { ...record.analysis, stale: true } }, "docx"), /périmée/);
  assert.match(reportContent(record, "docx"), /Citation exacte : « Envoyer le devis mardi prochain. »/);
});

test("génère un document, un tableau, une présentation et un PDF lisibles", async () => {
  for (const format of ["docx", "xlsx", "pptx"]) {
    const bytes = await buildBuffer(format, record.title, reportContent(record, format));
    const zip = await JSZip.loadAsync(bytes);
    assert.ok(zip.file(format === "docx" ? "word/document.xml" : format === "xlsx" ? "xl/worksheets/sheet1.xml" : "ppt/slides/slide1.xml"));
  }
  const pdf = await buildBuffer("pdf", record.title, reportContent(record, "pdf"));
  assert.ok((await PDFDocument.load(pdf)).getPageCount() >= 1);
});
