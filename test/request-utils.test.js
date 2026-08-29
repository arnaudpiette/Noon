"use strict";

const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const test = require("node:test");
const { getErrorHeader, readJsonBody, readTextBody, validateAttachment } = require("../services/http/request-utils");

test("les lecteurs HTTP conservent les limites et erreurs historiques", async () => {
  assert.deepEqual(await readJsonBody(Readable.from([Buffer.from('{"ok":true}')]), 100), { ok: true });
  assert.equal(await readTextBody(Readable.from([Buffer.from("hello")]), 10), "hello");
  await assert.rejects(readJsonBody(Readable.from([Buffer.from("123456")]), 4), (error) => error.statusCode === 413);
  await assert.rejects(readJsonBody(Readable.from([Buffer.from("{")]), 20), (error) => error.statusCode === 400);
});

test("la validation des pièces jointes reste stricte", () => {
  const png = validateAttachment({ kind: "image", name: "capture.png", mimeType: "image/png", dataUrl: "data:image/png;base64,AA==" });
  assert.equal(png.kind, "image");
  const xlsxMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  assert.equal(validateAttachment({ kind: "spreadsheet", name: "test.xlsx", mimeType: xlsxMime, dataUrl: `data:${xlsxMime};base64,AA==` }).kind, "spreadsheet");
  assert.throws(() => validateAttachment({ kind: "image", name: "x.svg", mimeType: "image/svg+xml", dataUrl: "data:image/svg+xml;base64,AA==" }), (error) => error.statusCode === 400);
});

test("les en-têtes d'erreur acceptent Headers et objets simples", () => {
  assert.equal(getErrorHeader({ headers: new Headers({ "retry-after": "3" }) }, "retry-after"), "3");
  assert.equal(getErrorHeader({ headers: { "retry-after": "5" } }, "Retry-After"), "5");
});
