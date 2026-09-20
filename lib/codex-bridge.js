"use strict";

const path = require("path");
const { execFile } = require("child_process");
const { resolveCodexExecutable } = require("./codex-executable-resolver");

const CODEX_TIMEOUT_MS = 120_000;
const MAX_CODEX_OUTPUT_CHARS = 16_000;

function findCodexExecutable(options = {}) { return resolveCodexExecutable(options).executable; }

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
      "Codex n’est pas disponible sur ce Mac. Installez le CLI ou l’extension Codex prise en charge."
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
