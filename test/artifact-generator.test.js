"use strict";

// Vérifie la création, la validation, le confinement et le versionnement des livrables.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { generateArtifact, verifyArtifact } = require("../services/production/artifact-generator");

for (const format of ["docx", "pdf", "png", "xlsx", "pptx", "md", "html", "rtf"]) {
  test(`génère et vérifie un livrable ${format}`, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `noon-${format}-`));
    const artifact = await generateArtifact({ format, title: `Test ${format}`, project: "Noon", outputDirectory: directory, content: format === "xlsx" ? "Nom,Valeur\nNoon,42" : "Première ligne\nDeuxième ligne\n---\nSeconde partie" }, [fs.realpathSync(directory)]);
    assert.equal(artifact.format, format);
    assert.ok(fs.existsSync(artifact.path));
    assert.ok((await verifyArtifact(artifact.path, format)).size > 0);
  });
}

test("refuse un dossier non autorisé et ne crée aucun fichier", async () => {
  const allowed = fs.mkdtempSync(path.join(os.tmpdir(), "noon-allowed-"));
  const denied = fs.mkdtempSync(path.join(os.tmpdir(), "noon-denied-"));
  await assert.rejects(() => generateArtifact({ format: "pdf", title: "Refus", content: "secret", outputDirectory: denied }, [allowed]), /autorisé/);
  assert.deepEqual(fs.readdirSync(denied), []);
});

test("versionne les livrables et n’écrase jamais l’existant", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-versions-"));
  const first = await generateArtifact({ format: "md", title: "Rapport", project: "Kasa", content: "v1", outputDirectory: directory }, [directory]);
  const second = await generateArtifact({ format: "md", title: "Rapport", project: "Kasa", content: "v2", outputDirectory: directory }, [directory]);
  assert.notEqual(first.path, second.path);
  assert.equal(fs.readFileSync(first.path, "utf8"), "v1");
  assert.equal(fs.readFileSync(second.path, "utf8"), "v2");
});
