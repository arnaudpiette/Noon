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
  generateCreativeImage,
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
