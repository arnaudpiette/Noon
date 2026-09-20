"use strict";

// Génère un aperçu PNG avec GPT Image 2, le valide et le conserve temporairement avant téléchargement.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { nextVersionedPath } = require("./versioning");

const IMAGE_MODEL = "gpt-image-2";
const IMAGE_PROVIDER = Object.freeze({
  id: "openai",
  model: IMAGE_MODEL,
  capabilities: Object.freeze({ imageGeneration: true, imageEditing: false, text: false }),
});
const ALLOWED_QUALITIES = new Set(["low", "medium", "high"]);
const ALLOWED_SIZES = new Set(["1024x1024", "1536x1024", "1024x1536"]);
const MAX_PROMPT_LENGTH = 12_000;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_TEMPORARY_PREVIEWS = 20;
const MAX_PREVIEW_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set(["ETIMEDOUT", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH"]);

class ImageGenerationError extends Error {
  constructor(code, message, { retryable = false, provider = "openai", model = IMAGE_MODEL, status = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ImageGenerationError";
    this.code = code;
    this.retryable = retryable;
    this.provider = provider;
    this.model = model;
    this.status = Number(status) || null;
  }
}

function normalizeImageGenerationError(error) {
  if (error instanceof ImageGenerationError) return error;
  const status = Number(error?.status || error?.statusCode || error?.response?.status) || null;
  const sourceCode = String(error?.code || error?.name || "").toUpperCase();
  if ([401, 403].includes(status)) return new ImageGenerationError("AUTH_ERROR", "Le fournisseur d’image doit être reconnecté.", { status, cause: error });
  if (status === 429 && /quota|billing|credit/i.test(String(error?.message || ""))) return new ImageGenerationError("QUOTA_EXCEEDED", "La limite du fournisseur d’image est atteinte.", { status, cause: error });
  if (status === 429) return new ImageGenerationError("RATE_LIMITED", "Le fournisseur d’image limite temporairement les requêtes.", { retryable: true, status, cause: error });
  if (sourceCode === "ABORTERROR" || sourceCode.includes("TIMEOUT") || status === 408) return new ImageGenerationError("TIMEOUT", "Le fournisseur d’image n’a pas répondu à temps.", { retryable: true, status, cause: error });
  if (RETRYABLE_CODES.has(sourceCode)) return new ImageGenerationError("NETWORK_ERROR", "Le fournisseur d’image n’est pas joignable.", { retryable: true, status, cause: error });
  if ([500, 502, 503, 504].includes(status)) return new ImageGenerationError("PROVIDER_UNAVAILABLE", "Le fournisseur d’image est momentanément indisponible.", { retryable: true, status, cause: error });
  if ([400, 404, 422].includes(status)) return new ImageGenerationError("PROVIDER_REJECTED", "Le fournisseur d’image a refusé la requête.", { status, cause: error });
  return new ImageGenerationError("IMAGE_GENERATION_FAILED", "La génération d’image a échoué.", { retryable: RETRYABLE_STATUS.has(status), status, cause: error });
}

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
  { client, previewDirectory, signal = null, maxRetries = 1, retryDelayMs = 150, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), observability = null } = {}
) {
  const normalizedPrompt = String(prompt || "").trim().slice(0, MAX_PROMPT_LENGTH);
  if (!normalizedPrompt) throw new Error("La description de l’image est obligatoire.");
  if (!client?.images?.generate) throw new ImageGenerationError("NO_IMAGE_PROVIDER", "Aucun fournisseur d’image compatible n’est configuré.");

  if (!previewDirectory) throw new Error("Le stockage temporaire des aperçus est indisponible.");
  const directory = path.resolve(previewDirectory);
  try { fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); }
  catch (error) { throw new ImageGenerationError("ASSET_WRITE_FAILED", "Le stockage temporaire de l’image est indisponible.", { cause: error }); }
  pruneCreativePreviews(directory);

  const selectedQuality = ALLOWED_QUALITIES.has(quality) ? quality : "medium";
  const selectedSize = ALLOWED_SIZES.has(size) ? size : "1024x1024";
  const destination = nextVersionedPath(directory, project, title || "Image-creative", "png");
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;

  try {
    let response;
    const attempts = Math.max(1, Math.min(2, Number(maxRetries) + 1 || 1));
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const startedAt = Date.now();
      observability?.("image_generation_attempt", { provider: "openai", model: IMAGE_MODEL, attempt });
      try {
        response = await client.images.generate({
          model: IMAGE_MODEL,
          prompt: normalizedPrompt,
          n: 1,
          quality: selectedQuality,
          size: selectedSize,
          background: "opaque",
          output_format: "png",
        }, signal ? { signal } : undefined);
        observability?.("image_generation_provider_success", { provider: "openai", model: IMAGE_MODEL, attempt, durationMs: Date.now() - startedAt });
        break;
      } catch (error) {
        const normalized = normalizeImageGenerationError(error);
        observability?.("image_generation_provider_failure", { provider: normalized.provider, model: normalized.model, attempt, code: normalized.code, status: normalized.status, retryable: normalized.retryable, durationMs: Date.now() - startedAt });
        if (!normalized.retryable || attempt === attempts || signal?.aborted) throw normalized;
        await sleep(retryDelayMs);
      }
    }
    const encodedImage = response?.data?.[0]?.b64_json;
    if (typeof encodedImage !== "string" || !encodedImage) {
      throw new ImageGenerationError("INVALID_RESPONSE", "Le fournisseur d’image n’a retourné aucun visuel exploitable.");
    }
    const imageBuffer = Buffer.from(encodedImage, "base64");
    if (!imageBuffer.length || imageBuffer.length > MAX_IMAGE_BYTES) {
      throw new Error("L’image générée dépasse la taille locale autorisée.");
    }
    try { fs.writeFileSync(temporary, imageBuffer, { flag: "wx" }); }
    catch (error) { throw new ImageGenerationError("ASSET_WRITE_FAILED", "L’aperçu temporaire n’a pas pu être écrit.", { cause: error }); }
    const metadata = await sharp(temporary).metadata();
    if (metadata.format !== "png" || !metadata.width || !metadata.height) {
      throw new Error("L’image générée n’est pas un PNG valide.");
    }
    try { fs.renameSync(temporary, destination); }
    catch (error) { throw new ImageGenerationError("ASSET_WRITE_FAILED", "L’aperçu temporaire n’a pas pu être finalisé.", { cause: error }); }
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
    throw normalizeImageGenerationError(error);
  }
}

module.exports = {
  ALLOWED_QUALITIES,
  ALLOWED_SIZES,
  IMAGE_MODEL,
  IMAGE_PROVIDER,
  ImageGenerationError,
  generateCreativeImage,
  normalizeImageGenerationError,
  pruneCreativePreviews,
};
