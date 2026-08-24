"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const CODEX_TIMEOUT_MS = 120_000;
const MAX_CODEX_OUTPUT_CHARS = 16_000;

function findCodexExecutable({
  env = process.env,
  homeDirectory = os.homedir(),
  existsSync = fs.existsSync,
  readdirSync = fs.readdirSync,
} = {}) {
  const configuredPath = String(env.NOON_CODEX_PATH || "").trim();
  const candidates = [
    configuredPath,
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    path.join(homeDirectory, ".local", "bin", "codex"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // L’extension Codex de VS Code embarque aussi le CLI. Le nom de version
  // change à chaque mise à jour : il est donc détecté, jamais codé en dur.
  const extensionsDirectory = path.join(homeDirectory, ".vscode", "extensions");
  let extensionNames = [];

  try {
    extensionNames = readdirSync(extensionsDirectory)
      .filter((name) => name.startsWith("openai.chatgpt-"))
      .sort()
      .reverse();
  } catch {
    return null;
  }

  const platformDirectory = process.arch === "arm64"
    ? "macos-aarch64"
    : "macos-x86_64";

  for (const extensionName of extensionNames) {
    const candidate = path.join(
      extensionsDirectory,
      extensionName,
      "bin",
      platformDirectory,
      "codex"
    );

    if (existsSync(candidate)) return candidate;
  }

  return null;
}

function buildCodexArgs(projectPath, prompt) {
  return [
    "exec",
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--skip-git-repo-check",
    "--color",
    "never",
    "--cd",
    projectPath,
    prompt,
  ];
}

function runCodexAnalysis({
  question,
  projectPath,
  signal = null,
  executable = findCodexExecutable(),
  runner = execFile,
} = {}) {
  if (!executable) {
    return Promise.reject(new Error(
      "Codex n’est pas disponible sur ce Mac. Installez le CLI Codex ou définissez NOON_CODEX_PATH."
    ));
  }

  if (!projectPath || !path.isAbsolute(projectPath)) {
    return Promise.reject(new Error(
      "Sélectionnez un projet Focus avant de consulter Codex."
    ));
  }

  const safeQuestion = String(question || "").trim().slice(0, 4_000);

  if (!safeQuestion) {
    return Promise.reject(new Error("La question destinée à Codex est vide."));
  }

  const prompt = [
    "Tu interviens comme spécialiste du code au sein de Noon.",
    "Analyse uniquement le projet courant en lecture seule.",
    "Ne modifie aucun fichier et ne lance aucune action externe.",
    "Réponds en français avec des faits vérifiés, les chemins de fichiers utiles et une synthèse concise.",
    `Question de l’utilisateur : ${safeQuestion}`,
  ].join("\n");

  return new Promise((resolve, reject) => {
    runner(
      executable,
      buildCodexArgs(projectPath, prompt),
      {
        cwd: projectPath,
        timeout: CODEX_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
        ...(signal ? { signal } : {}),
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || error.message).trim().slice(0, 500);
          return reject(new Error(`Codex indisponible : ${detail}`));
        }

        const output = String(stdout || "").trim();

        if (!output) {
          return reject(new Error("Codex n’a produit aucune analyse exploitable."));
        }

        return resolve({
          provider: "Codex",
          mode: "read-only",
          projectPath,
          truncated: output.length > MAX_CODEX_OUTPUT_CHARS,
          analysis: output.slice(0, MAX_CODEX_OUTPUT_CHARS),
        });
      }
    );
  });
}

module.exports = {
  buildCodexArgs,
  findCodexExecutable,
  runCodexAnalysis,
};
