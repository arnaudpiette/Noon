"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { isPathInsideRoots } = require("../../lib/path-utils");
const { PRIVATE_NAMES, resolveScopedPath } = require("../delegation/dev-task-contract");
const { classifyDevCommand } = require("../delegation/dev-command-policy");

const execFileAsync = promisify(execFile);
const CONTENT_SECRET = /(?:AIza[0-9A-Za-z_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|GOCSPX-[A-Za-z0-9_-]{10,}|ya29\.[A-Za-z0-9_-]{10,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:access_token|refresh_token|client_secret|password)\s*[:=]\s*[^\s,;]{6,})/i;
function digest(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function relative(contract, absolute) { return path.relative(contract.repositoryRoot, absolute).replaceAll(path.sep, "/"); }
function resolveFile(contract, value) {
  const absolute = resolveScopedPath(contract.repositoryRoot, value);
  const rel = relative(contract, absolute);
  if (PRIVATE_NAMES.test(rel) || !contract.allowedPaths.some((root) => isPathInsideRoots(absolute, [root])) || contract.forbiddenPaths.some((root) => isPathInsideRoots(absolute, [root]))) {
    throw Object.assign(new Error("Fichier hors périmètre DEV."), { code: "OUT_OF_SCOPE_CHANGE" });
  }
  return { absolute, relative: rel };
}
function readText(contract, value, { maxBytes = 256 * 1024 } = {}) {
  const target = resolveFile(contract, value); const stat = fs.statSync(target.absolute);
  if (!stat.isFile() || stat.size > maxBytes) throw Object.assign(new Error("Fichier DEV illisible ou trop volumineux."), { code: "FILE_UNAVAILABLE" });
  const content = fs.readFileSync(target.absolute, "utf8");
  if (content.includes("\0")) throw Object.assign(new Error("Fichier binaire refusé."), { code: "BINARY_FILE_DENIED" });
  return { ...target, content, hash: digest(content), mtimeMs: stat.mtimeMs };
}
function atomicWrite(file, content) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temporary, content, { mode: 0o600 }); fs.renameSync(temporary, file);
}
function prepareOperation(
  contract,
  operation,
  snapshots,
  {
    allowDelete = false,
  } = {}
) {
  if (
    !operation ||
    ![
      "CREATE",
      "MODIFY",
      "DELETE",
    ].includes(
      operation.type
    )
  ) {
    throw Object.assign(
      new Error(
        "Opération DEV invalide."
      ),
      {
        code:
          "MALFORMED_OPERATION",
      }
    );
  }

  const target =
    resolveFile(
      contract,
      operation.path
    );

  if (
    operation.type ===
      "DELETE" &&
    !allowDelete
  ) {
    throw Object.assign(
      new Error(
        "Suppression non autorisée."
      ),
      {
        code:
          "PERMISSION_FAILURE",
      }
    );
  }

  const currentExists =
    fs.existsSync(
      target.absolute
    );

  const current =
    currentExists
      ? fs.readFileSync(
          target.absolute,
          "utf8"
        )
      : null;

  const currentHash =
    current === null
      ? null
      : digest(
          current
        );

  if (
    operation.type !==
      "CREATE"
  ) {
    const inspected =
      snapshots.get(
        target.relative
      );

    if (!inspected) {
      throw Object.assign(
        new Error(
          "Lecture préalable requise."
        ),
        {
          code:
            "READ_BEFORE_WRITE_REQUIRED",
        }
      );
    }

    if (
      operation.expectedHash !==
        inspected.hash ||
      currentHash !==
        inspected.hash
    ) {
      throw Object.assign(
        new Error(
          "Le fichier a changé depuis sa lecture."
        ),
        {
          code:
            "STALE_FILE_STATE",
        }
      );
    }
  } else if (
    currentExists
  ) {
    throw Object.assign(
      new Error(
        "Le fichier à créer existe déjà."
      ),
      {
        code:
          "STALE_FILE_STATE",
      }
    );
  }

  let next =
    null;

  if (
    operation.type ===
      "MODIFY"
  ) {
    if (
      typeof operation.search !==
        "string" ||
      !operation.search ||
      typeof operation.replacement !==
        "string"
    ) {
      throw Object.assign(
        new Error(
          "Patch MODIFY incomplet."
        ),
        {
          code:
            "MALFORMED_OPERATION",
        }
      );
    }

    const first =
      current.indexOf(
        operation.search
      );

    const last =
      current.lastIndexOf(
        operation.search
      );

    if (
      first < 0 ||
      first !== last
    ) {
      throw Object.assign(
        new Error(
          "Précondition de patch non unique."
        ),
        {
          code:
            "PATCH_PRECONDITION_FAILED",
        }
      );
    }

    next =
      current.slice(
        0,
        first
      ) +
      operation.replacement +
      current.slice(
        first +
          operation.search.length
      );
  } else if (
    operation.type ===
      "CREATE"
  ) {
    if (
      typeof operation.content !==
        "string"
    ) {
      throw Object.assign(
        new Error(
          "Contenu CREATE absent."
        ),
        {
          code:
            "MALFORMED_OPERATION",
        }
      );
    }

    next =
      operation.content;
  }

  if (
    next !== null &&
    CONTENT_SECRET.test(
      next
    )
  ) {
    throw Object.assign(
      new Error(
        "Secret potentiel détecté dans le patch."
      ),
      {
        code:
          "SECRET_ADDED",
      }
    );
  }

  return {
    target,
    currentHash,
    next,
  };
}

function validateOperation(
  contract,
  operation,
  snapshots,
  options = {}
) {
  const prepared =
    prepareOperation(
      contract,
      operation,
      snapshots,
      options
    );

  return {
    ok: true,
    path:
      prepared
        .target
        .relative,
    preHash:
      prepared
        .currentHash,
    postHash:
      operation.type ===
        "DELETE"
        ? null
        : digest(
            prepared.next
          ),
  };
}

function applyOperation(
  contract,
  operation,
  snapshots,
  options = {}
) {
  const prepared =
    prepareOperation(
      contract,
      operation,
      snapshots,
      options
    );

  const {
    target,
    currentHash,
    next,
  } = prepared;

  if (
    operation.type ===
      "CREATE"
  ) {
    fs.mkdirSync(
      path.dirname(
        target.absolute
      ),
      {
        recursive: true,
      }
    );
  }

  if (
    operation.type ===
      "DELETE"
  ) {
    fs.unlinkSync(
      target.absolute
    );
  } else {
    atomicWrite(
      target.absolute,
      next
    );
  }

  const postHash =
    operation.type ===
      "DELETE"
      ? null
      : digest(
          next
        );

  return {
    ok: true,

    result: {
      path:
        target.relative,

      hash:
        postHash,

      preHash:
        currentHash,

      postHash,
    },

    changedTargets: [
      target.relative,
    ],
  };
}

async function runSafeCommand(command, cwd, timeout = 120_000, signal = null) {
  const decision = classifyDevCommand(command);
  if (!decision.allowed) return { command, status: "DENIED", exitCode: null, durationMs: 0, failureCategory: decision.reasonCode };
  const started = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(decision.execution[0], decision.execution[1], { cwd, timeout, signal, maxBuffer: 2 * 1024 * 1024, env: { PATH: process.env.PATH, LANG: process.env.LANG || "C.UTF-8", CI: "1", NO_COLOR: "1" } });
    return { command, status: "PASS", exitCode: 0, durationMs: Date.now() - started, outputTail: `${stdout || ""}\n${stderr || ""}`.trim().slice(-4000), failureCategory: null };
  } catch (error) {
    const category = error.name === "AbortError" ? "CANCELLED" : error.killed ? "TIMEOUT" : "TEST_FAILURE";
    return { command, status: "FAIL", exitCode: Number.isInteger(error.code) ? error.code : null, signal: error.signal || null, durationMs: Date.now() - started, outputTail: `${error.stdout || ""}\n${error.stderr || ""}`.trim().slice(-4000), failureCategory: category };
  }
}
function searchRepository(contract, terms = [], { maxFiles = 40, maxMatches = 80 } = {}) {
  const matches = []; const ignored = new Set([".git", "node_modules", "out", "dist", "build", "coverage"]);
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (matches.length >= maxMatches || ignored.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (!isPathInsideRoots(absolute, contract.allowedPaths)) continue;
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && !PRIVATE_NAMES.test(relative(contract, absolute))) {
        let text; try { if (fs.statSync(absolute).size > 256 * 1024) continue; text = fs.readFileSync(absolute, "utf8"); } catch { continue; }
        if (text.includes("\0")) continue;
        for (const term of terms.slice(0, 12)) if (String(term).length >= 2 && text.toLowerCase().includes(String(term).toLowerCase())) { matches.push(relative(contract, absolute)); break; }
      }
      if (matches.length >= maxFiles) break;
    }
  }
  for (const root of contract.allowedPaths) if (fs.existsSync(root)) { const stat = fs.statSync(root); if (stat.isDirectory()) visit(root); }
  return [...new Set(matches)].slice(0, maxFiles);
}

module.exports = { CONTENT_SECRET, applyOperation, digest, readText, resolveFile, runSafeCommand, searchRepository, validateOperation };
