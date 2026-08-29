"use strict";

// Vérifie la configuration, la confidentialité et le cycle de vie du mot-clé vocal.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { WakeWordService } = require("../services/wake-word-service");

test("refuse une configuration incomplète sans ouvrir le microphone", () => {
  const service = new WakeWordService({ getAccessKey: async () => "secret" });
  assert.throws(() => service.validateConfig({ sensitivity: 0.5 }), /Importez/);
  assert.equal(service.running, false);
});

test("valide uniquement des fichiers locaux et une sensibilité bornée", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-wake-"));
  const keywordPath = path.join(directory, "salut-noon.ppn");
  const modelPath = path.join(directory, "francais.pv");
  fs.writeFileSync(keywordPath, "test");
  fs.writeFileSync(modelPath, "test");
  const service = new WakeWordService();
  assert.doesNotThrow(() => service.validateConfig({ keywordPath, modelPath, sensitivity: 0.5 }));
  assert.throws(() => service.validateConfig({ keywordPath, modelPath, sensitivity: 1.2 }), /sensibilité/);
});

test("l’état public ne contient jamais l’AccessKey", () => {
  const service = new WakeWordService({ getAccessKey: async () => "pv-secret" });
  assert.equal(JSON.stringify(service.getStatus()).includes("pv-secret"), false);
});
