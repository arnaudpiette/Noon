"use strict";

// SelfDev V1 (SD-2) — preuves « base contre patch », sans modèle.
// Les validations passent exclusivement par l'exécuteur sandboxé canonique
// (createSandboxDevValidationExecutor : politique opérationnelle, environnement minimal
// sans NOON_DATA_DIR, délais et sortie bornés), injecté par le composant appelant.
// Aucune sortie brute n'est conservée : statut, code, durée et noms de tests en échec.
// Voir docs/SELFDEV_V1_DESIGN.md §4.3.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { classifyDevCommand } = require("../delegation/dev-command-policy");
const { normalizeRelativePath, TEST_DIRECTORY } = require("./selfdev-path-policy");

const MAX_COMMANDS = 6;
const MAX_REPRO_FILES = 5;
const MAX_FAILED_NAMES = 20;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const ACCEPTED_COMMAND = /^(?:npm test|npm run lint|npm run build|npm test -- .+|node --test .+)$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{5,47}$/;

function evidenceError(code, message) { return Object.assign(new Error(message), { code }); }

function validateCommands(commands) {
  if (!Array.isArray(commands) || !commands.length || commands.length > MAX_COMMANDS) {
    throw evidenceError("SELFDEV_COMMANDS_INVALID", `Entre 1 et ${MAX_COMMANDS} commandes de validation.`);
  }
  const unique = [...new Set(commands.map((command) => String(command || "").trim()))];
  for (const command of unique) {
    const decision = classifyDevCommand(command);
    if (!ACCEPTED_COMMAND.test(command) || decision.allowed !== true || decision.classification !== "SAFE_READ") {
      throw evidenceError("SELFDEV_COMMAND_REFUSED", "Commande de validation non autorisée pour SelfDev.");
    }
  }
  return unique;
}

// Noms des tests en échec, au mieux, depuis la fin de sortie (TAP de node:test). Partiel par nature.
function failedTestNames(outputTail) {
  const names = [];
  for (const line of String(outputTail || "").split("\n")) {
    const match = line.match(/^\s*not ok \d+ - (.+)$/);
    if (match) names.push(match[1].trim().slice(0, 200));
    if (names.length >= MAX_FAILED_NAMES) break;
  }
  return names;
}

function summarize(result) {
  return Object.freeze({
    status: result?.status === "PASS" ? "PASS" : "FAIL",
    exitCode: Number.isInteger(result?.exitCode) ? result.exitCode : null,
    durationMs: Number.isFinite(result?.durationMs) ? Math.round(result.durationMs) : null,
    failureCategory: result?.failureCategory ? String(result.failureCategory).slice(0, 80) : null,
    reasonCode: result?.reasonCode ? String(result.reasonCode).slice(0, 80) : null,
    failedTests: Object.freeze(result?.status === "PASS" ? [] : failedTestNames(result?.outputTail)),
    outputTruncated: result?.outputTruncated === true,
  });
}

function createSelfDevEvidenceService({ worktreeService, executeValidation, stateDirectory, timeoutMs = DEFAULT_TIMEOUT_MS, now = () => new Date() } = {}) {
  if (!worktreeService?.describe || typeof executeValidation !== "function" || !stateDirectory) {
    throw evidenceError("SELFDEV_CONFIG_INVALID", "Worktree, exécuteur sandboxé et dossier d'état requis.");
  }
  fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });

  function evidencePath(id) {
    if (!ID_PATTERN.test(String(id))) throw evidenceError("SELFDEV_ID_INVALID", "Identifiant SelfDev invalide.");
    return path.join(stateDirectory, `${id}.evidence.json`);
  }

  function load(id) {
    try { return JSON.parse(fs.readFileSync(evidencePath(id), "utf8")); }
    catch (error) { if (error.code === "SELFDEV_ID_INVALID") throw error; return null; }
  }

  function save(id, evidence) {
    const target = evidencePath(id);
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(evidence, null, 2), { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, target);
    return evidence;
  }

  async function run(command, cwd, context, signal) {
    let result;
    try { result = await executeValidation(command, cwd, timeoutMs, signal, context); }
    catch { result = { status: "FAIL", reasonCode: "SELFDEV_VALIDATION_ERROR" }; }
    return summarize(result);
  }

  // Un échec est relancé une fois : s'il passe, il est marqué instable (jamais « réussi »).
  async function runWithRetry(command, cwd, context, signal) {
    const first = await run(command, cwd, context, signal);
    if (first.status === "PASS") return Object.freeze({ command, outcome: "PASS", attempts: [first] });
    if (signal?.aborted) return Object.freeze({ command, outcome: "FAIL", attempts: [first] });
    const second = await run(command, cwd, context, signal);
    return Object.freeze({ command, outcome: second.status === "PASS" ? "FLAKY" : "FAIL", attempts: [first, second] });
  }

  function requireContext(context) {
    if (!context?.workspaceId || !(context.taskId || context.sessionId)) throw evidenceError("SELFDEV_CONTEXT_INVALID", "Contexte d'exécution autoritaire requis.");
    return context;
  }

  // 1) Base : le worktree doit être identique au commit de base.
  async function runBaseline(id, { commands, context, signal = null } = {}) {
    const manifest = worktreeService.describe(id);
    const accepted = validateCommands(commands);
    requireContext(context);
    if (worktreeService.diffEntries(id).length) throw evidenceError("SELFDEV_BASELINE_NOT_CLEAN", "La base doit être mesurée avant tout patch.");
    const results = [];
    for (const command of accepted) results.push(await runWithRetry(command, manifest.worktreePath, context, signal));
    return save(id, { version: 1, id, baseCommit: manifest.baseCommit, commands: accepted, baseline: { at: now().toISOString(), results }, patched: null, reproduction: null });
  }

  // 2) Après patch : mêmes commandes, refusées si le diff touche un chemin protégé.
  async function runPatched(id, { context, signal = null, allowedPrefixes = null } = {}) {
    const manifest = worktreeService.describe(id);
    requireContext(context);
    const evidence = load(id);
    if (!evidence?.baseline) throw evidenceError("SELFDEV_BASELINE_MISSING", "Mesure de la base absente.");
    const policy = worktreeService.check(id, { allowedPrefixes });
    if (!policy.ok) {
      evidence.patched = { at: now().toISOString(), refused: true, violations: policy.violations, results: [] };
      save(id, evidence);
      throw evidenceError("SELFDEV_PROTECTED_PATH_CHANGED", "Le patch touche un chemin protégé : aucune validation lancée.");
    }
    if (!policy.changed.length) throw evidenceError("SELFDEV_PATCH_EMPTY", "Aucune modification à évaluer.");
    const results = [];
    for (const command of evidence.commands) results.push(await runWithRetry(command, manifest.worktreePath, context, signal));
    evidence.patched = { at: now().toISOString(), refused: false, changed: policy.changed, results };
    return save(id, evidence);
  }

  // 3) Reproduction : les nouveaux tests échouent sur la base (sonde) et passent après patch.
  async function runReproduction(id, { testFiles, context, signal = null } = {}) {
    const manifest = worktreeService.describe(id);
    requireContext(context);
    const evidence = load(id);
    if (!evidence?.baseline) throw evidenceError("SELFDEV_BASELINE_MISSING", "Mesure de la base absente.");
    if (!Array.isArray(testFiles) || !testFiles.length || testFiles.length > MAX_REPRO_FILES) throw evidenceError("SELFDEV_REPRO_INVALID", "Tests de reproduction requis.");
    const files = [...new Set(testFiles.map(normalizeRelativePath))];
    const added = new Set(worktreeService.diffEntries(id).filter((entry) => entry.status === "A" || entry.status === "?").map((entry) => normalizeRelativePath(entry.path)));
    const baseTests = new Set(manifest.baseTestFiles);
    for (const file of files) {
      if (!file.startsWith(TEST_DIRECTORY) || !file.endsWith(".test.js") || baseTests.has(file) || !added.has(file)) {
        throw evidenceError("SELFDEV_REPRO_NOT_NEW_TEST", "La reproduction doit reposer sur de nouveaux fichiers de test.");
      }
    }
    const command = `node --test ${files.join(" ")}`;
    validateCommands([command]);
    const probe = worktreeService.createProbe(id);
    let onBase;
    try {
      for (const file of files) {
        const source = path.join(manifest.worktreePath, file);
        const stat = fs.lstatSync(source);
        if (!stat.isFile()) throw evidenceError("SELFDEV_REPRO_NOT_NEW_TEST", "Fichier de test invalide.");
        const destination = path.join(probe.probePath, file);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(source, destination);
      }
      onBase = await run(command, probe.probePath, context, signal);
    } finally {
      worktreeService.removeProbe(id, probe.probePath);
    }
    const afterPatch = await run(command, manifest.worktreePath, context, signal);
    evidence.reproduction = { at: now().toISOString(), files, onBase, afterPatch, reproduced: onBase.status === "FAIL" && afterPatch.status === "PASS" };
    return save(id, evidence);
  }

  // Verdict : BLOCKED (régression ou chemin protégé), DEMONSTRATED, ou UNPROVEN (rien n'est masqué).
  function verdict(id) {
    const evidence = load(id);
    if (!evidence?.baseline) return Object.freeze({ verdict: "UNPROVEN", reasons: ["BASELINE_MISSING"] });
    if (evidence.patched?.refused) return Object.freeze({ verdict: "BLOCKED", reasons: ["PROTECTED_PATH_CHANGED"], violations: evidence.patched.violations });
    if (!evidence.patched) return Object.freeze({ verdict: "UNPROVEN", reasons: ["PATCH_NOT_MEASURED"] });
    const reasons = [];
    const comparison = evidence.commands.map((command) => {
      const before = evidence.baseline.results.find((item) => item.command === command)?.outcome || "MISSING";
      const after = evidence.patched.results.find((item) => item.command === command)?.outcome || "MISSING";
      let change = "UNCHANGED";
      if (before === "PASS" && after === "FAIL") change = "REGRESSION";
      else if (before === "PASS" && after === "FLAKY") change = "FLAKY_AFTER_PATCH";
      else if (before !== "PASS" && after === "PASS") change = "IMPROVED";
      else if (before === "FLAKY" || after === "FLAKY") change = "FLAKY";
      else if (before === "FAIL" && after === "FAIL") change = "PRE_EXISTING_FAILURE";
      else if (after === "MISSING") change = "MISSING";
      return Object.freeze({ command, before, after, change });
    });
    if (comparison.some((item) => item.change === "REGRESSION")) reasons.push("REGRESSION");
    if (comparison.some((item) => item.change === "MISSING")) reasons.push("RESULT_MISSING");
    if (reasons.length) return Object.freeze({ verdict: "BLOCKED", reasons, comparison });
    if (comparison.some((item) => ["FLAKY", "FLAKY_AFTER_PATCH"].includes(item.change))) reasons.push("FLAKY_VALIDATION");
    if (!evidence.reproduction) reasons.push("REPRODUCTION_MISSING");
    else if (!evidence.reproduction.reproduced) reasons.push(evidence.reproduction.onBase.status === "PASS" ? "REPRO_NOT_FAILING_ON_BASE" : "REPRO_NOT_PASSING_AFTER_PATCH");
    return Object.freeze({ verdict: reasons.length ? "UNPROVEN" : "DEMONSTRATED", reasons, comparison, reproduction: evidence.reproduction || null });
  }

  return Object.freeze({ runBaseline, runPatched, runReproduction, verdict, load: (id) => load(id) });
}

module.exports = { createSelfDevEvidenceService, failedTestNames, MAX_COMMANDS };
