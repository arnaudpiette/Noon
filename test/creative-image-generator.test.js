"use strict";

// Vérifie les aperçus GPT Image temporaires sans effectuer de véritable appel réseau.

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const sharp = require("sharp");
const {
  IMAGE_MODEL,
  IMAGE_PROVIDER,
  generateCreativeImage,
  normalizeImageGenerationError,
} = require("../services/production/creative-image-generator");

async function pngBase64() {
  return (await sharp({
    create: {
      width: 24,
      height: 16,
      channels: 4,
      background: { r: 186, g: 255, b: 0, alpha: 1 },
    },
  }).png().toBuffer()).toString("base64");
}

test("génère et vérifie un aperçu PNG créatif temporaire", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-image-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let request;
  const client = {
    images: {
      generate: async (options) => {
        request = options;
        return {
          data: [{ b64_json: await pngBase64() }],
          quality: "medium",
          size: "1536x1024",
        };
      },
    },
  };

  const result = await generateCreativeImage({
    prompt: "Une affiche graphique minimaliste pour Noon",
    title: "Affiche Noon",
    project: "Noon",
    quality: "medium",
    size: "1536x1024",
  }, {
    client,
    previewDirectory: directory,
  });

  assert.equal(request.model, IMAGE_MODEL);
  assert.equal(request.output_format, "png");
  assert.equal(request.background, "opaque");
  assert.equal(result.artifact.creative, true);
  assert.equal(result.artifact.temporary, true);
  assert.equal(result.artifact.width, 24);
  assert.equal(result.artifact.height, 16);
  assert.equal((await sharp(result.artifact.path).metadata()).format, "png");
});

test("refuse de générer sans stockage temporaire privé", async () => {
  let called = false;
  const client = { images: { generate: async () => { called = true; } } };

  await assert.rejects(
    generateCreativeImage({
      prompt: "Image",
      title: "Test",
    }, { client }),
    /stockage temporaire/
  );
  assert.equal(called, false);
});

test("n’écrase jamais une image créative existante", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-version-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const encoded = await pngBase64();
  const client = { images: { generate: async () => ({ data: [{ b64_json: encoded }] }) } };
  const args = { prompt: "Image", title: "Test", project: "Noon" };

  const first = await generateCreativeImage(args, { client, previewDirectory: directory });
  const second = await generateCreativeImage(args, { client, previewDirectory: directory });
  assert.notEqual(first.artifact.path, second.artifact.path);
  assert.match(first.artifact.name, /_v001_/);
  assert.match(second.artifact.name, /_v002_/);
});

test("le registre image n’expose qu’un modèle réellement compatible", () => {
  assert.equal(IMAGE_PROVIDER.model, IMAGE_MODEL);
  assert.equal(IMAGE_PROVIDER.capabilities.imageGeneration, true);
  assert.equal(IMAGE_PROVIDER.capabilities.text, false);
});

test("retente une seule fois un échec transitoire puis produit l’asset", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-image-retry-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let calls = 0;
  const client = { images: { generate: async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("temporary"), { status: 503 });
    return { data: [{ b64_json: await pngBase64() }] };
  } } };
  const result = await generateCreativeImage({ prompt: "Fixture synthétique", title: "Retry" }, { client, previewDirectory: directory, maxRetries: 1, sleep: async () => {} });
  assert.equal(calls, 2);
  assert.equal(result.artifact.creative, true);
});

test("une demande image ne retente pas automatiquement un appel provider coûteux", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-image-single-call-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let calls = 0;
  const client = { images: { generate: async () => {
    calls += 1;
    throw Object.assign(new Error("temporary"), { status: 503 });
  } } };
  await assert.rejects(
    generateCreativeImage({ prompt: "Fixture synthétique", title: "Single call" }, { client, previewDirectory: directory }),
    { code: "PROVIDER_UNAVAILABLE" }
  );
  assert.equal(calls, 1);
});

test("un provider image qui ne répond pas expire proprement sans créer de fichier", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-image-timeout-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let calls = 0;
  const client = { images: { generate: (_options, { signal }) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    });
  } } };
  await assert.rejects(
    generateCreativeImage({ prompt: "Fixture synthétique", title: "Timeout" }, { client, previewDirectory: directory, timeoutMs: 1_000 }),
    { code: "TIMEOUT" }
  );
  assert.equal(calls, 1);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test("normalise les échecs sans recopier de secret dans le message", () => {
  const error = normalizeImageGenerationError(Object.assign(new Error("Bearer secret-value"), { status: 429 }));
  assert.equal(error.code, "RATE_LIMITED");
  assert.equal(error.retryable, true);
  assert.equal(error.message.includes("secret-value"), false);
});

test("un résultat provider vide devient INVALID_RESPONSE et ne laisse aucun PNG", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-image-empty-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await assert.rejects(
    generateCreativeImage({ prompt: "Fixture synthétique", title: "Empty" }, { client: { images: { generate: async () => ({ data: [] }) } }, previewDirectory: directory }),
    { code: "INVALID_RESPONSE" }
  );
  assert.deepEqual(fs.readdirSync(directory), []);
});

test("un payload image invalide est rejeté sans créer de fichier", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-image-invalid-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await assert.rejects(
    generateCreativeImage({ prompt: "Fixture synthétique", title: "Invalid" }, { client: { images: { generate: async () => ({ data: [{ b64_json: "not-image" }] }) } }, previewDirectory: directory }),
    { code: "INVALID_RESPONSE" }
  );
  assert.deepEqual(fs.readdirSync(directory), []);
});
