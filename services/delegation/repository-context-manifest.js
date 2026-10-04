"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  isPathInsideRoots,
} = require("../../lib/path-utils");

const DEFAULT_MAX_ENTRIES = 400;
const DEFAULT_MAX_SCANNED = 2_000;
const DEFAULT_MAX_FILE_BYTES =
  256 * 1024;

const IGNORED_DIRECTORIES =
  new Set([
    ".git",
    "node_modules",
    "out",
    "dist",
    "build",
    "coverage",
    ".next",
    ".cache",
  ]);

const BINARY_EXTENSIONS =
  new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".pdf",
    ".zip",
    ".gz",
    ".tgz",
    ".tar",
    ".7z",
    ".rar",
    ".mp3",
    ".wav",
    ".m4a",
    ".mp4",
    ".mov",
    ".avi",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".wasm",
    ".sqlite",
    ".sqlite3",
    ".db",
    ".dmg",
    ".pkg",
  ]);

function positiveInteger(
  value,
  fallback
) {
  const parsed =
    Number(value);

  return Number.isInteger(parsed) &&
    parsed > 0
    ? parsed
    : fallback;
}

function relativePath(
  repositoryRoot,
  absolute
) {
  const relative =
    path.relative(
      repositoryRoot,
      absolute
    );

  return (
    relative || "."
  )
    .split(path.sep)
    .join("/");
}

function isPrivateSegment(
  value
) {
  const name =
    String(value || "");

  return (
    /^\.env(?:\.|$)/i.test(name) ||
    /^(?:id_rsa|id_ed25519)$/i.test(
      name
    ) ||
    /\.(?:pem|key|p12|pfx)$/i.test(
      name
    ) ||
    /(?:^|[._-])(?:secret|secrets|credential|credentials|token|tokens)(?:[._-]|$)/i.test(
      name
    )
  );
}

function isPrivatePath(
  relative
) {
  return String(relative || "")
    .split("/")
    .filter(Boolean)
    .some(isPrivateSegment);
}

function isLikelyBinary(
  relative
) {
  return BINARY_EXTENSIONS.has(
    path
      .extname(relative)
      .toLowerCase()
  );
}

function frozenFileEntry(
  relative,
  stat
) {
  return Object.freeze({
    path: relative,
    extension:
      path
        .extname(relative)
        .toLowerCase()
        .slice(0, 24) ||
      null,
    sizeBytes:
      Number(stat.size) || 0,
  });
}

function agentsMetadata(
  repositoryRoot,
  agentsFiles
) {
  const result = [];

  for (
    const candidate of
    Array.isArray(agentsFiles)
      ? agentsFiles
      : []
  ) {
    try {
      const absolute =
        fs.realpathSync(candidate);

      if (
        !isPathInsideRoots(
          absolute,
          [repositoryRoot]
        )
      ) {
        continue;
      }

      result.push(
        Object.freeze({
          path: relativePath(
            repositoryRoot,
            absolute
          ),
          trust: "UNTRUSTED",
        })
      );
    } catch {
      // La découverte AGENTS reste
      // purement métadonnée.
    }
  }

  return Object.freeze(
    result
      .sort(
        (a, b) =>
          a.path.localeCompare(
            b.path
          )
      )
  );
}

function packageSummary(
  value = {}
) {
  const commands =
    value.commands &&
    typeof value.commands ===
      "object"
      ? value.commands
      : {};

  return Object.freeze({
    language:
      String(
        value.language ||
          "UNKNOWN"
      ).slice(0, 40),

    framework:
      value.framework
        ? String(
            value.framework
          ).slice(0, 80)
        : null,

    packageManager:
      value.packageManager
        ? String(
            value.packageManager
          ).slice(0, 40)
        : null,

    scriptNames:
      Object.entries(commands)
        .filter(
          ([, command]) =>
            Boolean(command)
        )
        .map(
          ([name]) =>
            String(name).slice(
              0,
              40
            )
        )
        .sort(),
  });
}

function buildRepositoryContextManifest(
  contract,
  {
    agentsFiles = [],
    packageInfo = {},
    maxEntries =
      DEFAULT_MAX_ENTRIES,
    maxScanned =
      DEFAULT_MAX_SCANNED,
    maxFileBytes =
      DEFAULT_MAX_FILE_BYTES,
  } = {}
) {
  if (
    !contract?.repositoryRoot ||
    !Array.isArray(
      contract.allowedPaths
    )
  ) {
    throw new TypeError(
      "Contrat DEV invalide pour le manifeste."
    );
  }

  const repositoryRoot =
    fs.realpathSync(
      contract.repositoryRoot
    );

  const entryLimit =
    positiveInteger(
      maxEntries,
      DEFAULT_MAX_ENTRIES
    );

  const scanLimit =
    positiveInteger(
      maxScanned,
      DEFAULT_MAX_SCANNED
    );

  const fileLimit =
    positiveInteger(
      maxFileBytes,
      DEFAULT_MAX_FILE_BYTES
    );

  const files = [];

  const excluded = {
    ignored: 0,
    private: 0,
    binary: 0,
    oversized: 0,
    symlink: 0,
    nonRegular: 0,
    inaccessible: 0,
    outOfScope: 0,
    missing: 0,
    entryLimit: 0,
    scanLimit: 0,
  };

  const queue = [];

  for (
    const allowed of
    [...contract.allowedPaths]
      .map(String)
      .sort()
  ) {
    if (
      !fs.existsSync(allowed)
    ) {
      excluded.missing += 1;
      continue;
    }

    let stat;

    try {
      stat =
        fs.lstatSync(allowed);
    } catch {
      excluded.inaccessible += 1;
      continue;
    }

    if (
      stat.isSymbolicLink()
    ) {
      excluded.symlink += 1;
      continue;
    }

    let absolute;

    try {
      absolute =
        fs.realpathSync(allowed);
    } catch {
      excluded.inaccessible += 1;
      continue;
    }

    if (
      !isPathInsideRoots(
        absolute,
        [repositoryRoot]
      )
    ) {
      excluded.outOfScope += 1;
      continue;
    }

    queue.push(absolute);
  }

  const visited =
    new Set();

  let scanned = 0;
  let truncated = false;

  while (queue.length) {
    if (
      scanned >= scanLimit
    ) {
      truncated = true;

      excluded.scanLimit +=
        queue.length;

      break;
    }

    const absolute =
      queue.shift();

    if (
      visited.has(absolute)
    ) {
      continue;
    }

    visited.add(absolute);

    let stat;

    try {
      stat =
        fs.lstatSync(absolute);
    } catch {
      excluded.inaccessible += 1;
      continue;
    }

    scanned += 1;

    if (
      stat.isSymbolicLink()
    ) {
      excluded.symlink += 1;
      continue;
    }

    if (
      !isPathInsideRoots(
        absolute,
        [repositoryRoot]
      )
    ) {
      excluded.outOfScope += 1;
      continue;
    }

    const relative =
      relativePath(
        repositoryRoot,
        absolute
      );

    const basename =
      path.basename(absolute);

    if (
      stat.isDirectory()
    ) {
      if (
        relative !== "." &&
        IGNORED_DIRECTORIES.has(
          basename
        )
      ) {
        excluded.ignored += 1;
        continue;
      }

      if (
        relative !== "." &&
        isPrivatePath(relative)
      ) {
        excluded.private += 1;
        continue;
      }

      let children;

      try {
        children =
          fs
            .readdirSync(
              absolute,
              {
                withFileTypes:
                  true,
              }
            )
            .sort(
              (a, b) =>
                a.name.localeCompare(
                  b.name
                )
            );
      } catch {
        excluded.inaccessible += 1;
        continue;
      }

      for (
        const child of children
      ) {
        queue.push(
          path.join(
            absolute,
            child.name
          )
        );
      }

      continue;
    }

    if (
      !stat.isFile()
    ) {
      excluded.nonRegular += 1;
      continue;
    }

    if (
      isPrivatePath(relative)
    ) {
      excluded.private += 1;
      continue;
    }

    if (
      isLikelyBinary(relative)
    ) {
      excluded.binary += 1;
      continue;
    }

    if (
      stat.size > fileLimit
    ) {
      excluded.oversized += 1;
      continue;
    }

    if (
      files.length >=
      entryLimit
    ) {
      truncated = true;
      excluded.entryLimit += 1;
      continue;
    }

    files.push(
      frozenFileEntry(
        relative,
        stat
      )
    );
  }

  return Object.freeze({
    version: 1,

    limits: Object.freeze({
      maxEntries:
        entryLimit,
      maxScanned:
        scanLimit,
      maxFileBytes:
        fileLimit,
    }),

    scanned,

    truncated,

    files: Object.freeze(
      files
    ),

    excluded:
      Object.freeze({
        ...excluded,
      }),

    package:
      packageSummary(
        packageInfo
      ),

    agents:
      agentsMetadata(
        repositoryRoot,
        agentsFiles
      ),
  });
}

module.exports = {
  BINARY_EXTENSIONS,
  DEFAULT_MAX_ENTRIES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_SCANNED,
  IGNORED_DIRECTORIES,
  buildRepositoryContextManifest,
  isLikelyBinary,
  isPrivatePath,
};
