"use strict";

// Vérifie que le pont Codex reste disponible uniquement en lecture seule dans le Focus.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCodexArgs,
  findCodexExecutable,
  runCodexAnalysis,
} = require("../lib/codex-bridge");

test("détecte le chemin Codex explicitement configuré", () => {
  const executable = findCodexExecutable({
    env: { NOON_CODEX_PATH: "/opt/noon/codex" },
    homeDirectory: "/Users/test",
    existsSync: (candidate) => candidate === "/opt/noon/codex",
    readdirSync: () => [],
  });

  assert.equal(executable, "/opt/noon/codex");
});

test("lance Codex dans le Focus avec un bac à sable en lecture seule", async () => {
  const calls = [];
  const runner = (command, args, options, callback) => {
    calls.push({ command, args, options });
    callback(null, "Analyse Codex vérifiée", "");
  };

  const result = await runCodexAnalysis({
    question: "Explique le routeur",
    projectPath: "/tmp/kasa",
    executable: "/opt/noon/codex",
    runner,
  });

  assert.equal(result.analysis, "Analyse Codex vérifiée");
  assert.equal(calls[0].command, "/opt/noon/codex");
  assert.equal(calls[0].options.cwd, "/tmp/kasa");
  assert.deepEqual(
    calls[0].args.slice(0, 7),
    ["exec", "--sandbox", "read-only", "--ephemeral", "--skip-git-repo-check", "--color", "never"]
  );
  assert.equal(calls[0].args.includes("--cd"), true);
});

test("refuse Codex sans projet Focus absolu", async () => {
  await assert.rejects(
    runCodexAnalysis({
      question: "Analyse",
      projectPath: "projet-relatif",
      executable: "/opt/noon/codex",
    }),
    /Focus/
  );
});

test("les arguments Codex interdisent toute écriture", () => {
  const args = buildCodexArgs("/tmp/kasa", "Question");
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
  assert.equal(args.includes("--ephemeral"), true);
  assert.equal(args.includes("danger-full-access"), false);
});
