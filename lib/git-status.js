"use strict";

const { execFile } = require("child_process");

function runGit(cwd, args, runner = execFile) {
  return new Promise((resolve) => runner("git", args, { cwd, timeout: 3000, maxBuffer: 256 * 1024 },
    (error, stdout) => resolve(error ? "" : String(stdout).trim())));
}

async function inspectGitStatus(projectPath, runner = execFile) {
  const status = await runGit(projectPath, ["status", "--porcelain=v1", "--branch"], runner);
  if (!status) return { available: false };
  const lines = status.split("\n");
  const header = lines.shift() || "";
  const branch = header.match(/^## ([^.\s]+|HEAD)/)?.[1] || "inconnue";
  const ahead = Number(header.match(/ahead (\d+)/)?.[1] || 0);
  const behind = Number(header.match(/behind (\d+)/)?.[1] || 0);
  const last = await runGit(projectPath, ["log", "-1", "--pretty=format:%H%x09%cI%x09%s"], runner);
  const [hash = "", date = "", subject = ""] = last.split("\t");
  return {
    available: true, branch, modified: lines.filter((line) => !line.startsWith("??")).length,
    untracked: lines.filter((line) => line.startsWith("??")).length, ahead, behind,
    lastCommit: hash ? { hash: hash.slice(0, 12), date, subject: subject.slice(0, 200) } : null,
  };
}

module.exports = { inspectGitStatus };
