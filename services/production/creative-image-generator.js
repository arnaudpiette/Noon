"use strict";

// Génère un aperçu PNG avec GPT Image 2, le valide et le conserve temporairement avant téléchargement.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { nextVersionedPath } = require("./versioning");

const IMAGE_MODEL = "gpt-image-2";
const ALLOWED_QUALITIES = new Set(["low", "medium", "high"]);
const ALLOWED_SIZES = new Set(["1024x1024", "1536x1024", "1024x1536"]);
const MAX_PROMPT_LENGTH = 12_000;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_TEMPORARY_PREVIEWS = 20;
const MAX_PREVIEW_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function pruneCreativePreviews(directory, now = Date.now()) {
  let files;
  try {
    files = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
      .map((entry) => {
        const filePath = path.join(directory, entry.name);
        return { filePath, modifiedAt: fs.statSync(filePath).mtimeMs };
      })
      .sort((left, right) => right.modifiedAt - left.modifiedAt);
  } catch {
    return;
  }
  files.forEach((file, index) => {
    if (index >= MAX_TEMPORARY_PREVIEWS || now - file.modifiedAt > MAX_PREVIEW_AGE_MS) {
      try { fs.unlinkSync(file.filePath); } catch {}
    }
  });
}

async function generateCreativeImage(
  { prompt, title, project = "Noon", quality = "medium", size = "1024x1024" },
  { client, previewDirectory, signal = null } = {}
) {
  const normalizedPrompt = String(prompt || "").trim().slice(0, MAX_PROMPT_LENGTH);
  if (!normalizedPrompt) throw new Error("La description de l’image est obligatoire.");
  if (!client?.images?.generate) throw new Error("Le modèle d’image OpenAI est indisponible.");

  if (!previewDirectory) throw new Error("Le stockage temporaire des aperçus est indisponible.");
  const directory = path.resolve(previewDirectory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  pruneCreativePreviews(directory);

  const selectedQuality = ALLOWED_QUALITIES.has(quality) ? quality : "medium";
  const selectedSize = ALLOWED_SIZES.has(size) ? size : "1024x1024";
  const destination = nextVersionedPath(directory, project, title || "Image-creative", "png");
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;

  try {
    const response = await client.images.generate({
      model: IMAGE_MODEL,
      prompt: normalizedPrompt,
      n: 1,
      quality: selectedQuality,
      size: selectedSize,
      background: "opaque",
      output_format: "png",
    }, signal ? { signal } : undefined);
    const encodedImage = response?.data?.[0]?.b64_json;
    if (typeof encodedImage !== "string" || !encodedImage) {
      throw new Error("Le modèle d’image n’a retourné aucun visuel exploitable.");
    }
    const imageBuffer = Buffer.from(encodedImage, "base64");
    if (!imageBuffer.length || imageBuffer.length > MAX_IMAGE_BYTES) {
      throw new Error("L’image générée dépasse la taille locale autorisée.");
    }
    fs.writeFileSync(temporary, imageBuffer, { flag: "wx" });
    const metadata = await sharp(temporary).metadata();
    if (metadata.format !== "png" || !metadata.width || !metadata.height) {
      throw new Error("L’image générée n’est pas un PNG valide.");
    }
    fs.renameSync(temporary, destination);
    const stats = fs.statSync(destination);
    return {
      artifact: {
        name: path.basename(destination),
        type: "image/png",
        format: "png",
        size: stats.size,
        path: destination,
        directory,
        createdAt: new Date().toISOString(),
        model: IMAGE_MODEL,
        creative: true,
        temporary: true,
        width: metadata.width,
        height: metadata.height,
        quality: response.quality || selectedQuality,
      },
      usage: response.usage || null,
      quality: response.quality || selectedQuality,
      size: response.size || selectedSize,
    };
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

module.exports = {
  ALLOWED_QUALITIES,
  ALLOWED_SIZES,
  IMAGE_MODEL,
  generateCreativeImage,
  pruneCreativePreviews,
};
