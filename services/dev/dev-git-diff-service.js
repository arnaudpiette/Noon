"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFile } =
  require("node:child_process");

const {
  redactSecrets,
} = require("../security/redaction");

const {
  PRIVATE_NAMES,
} = require("../delegation/dev-task-contract");

const MAX_FILES = 250;
const MAX_PATH_LENGTH = 2048;
const MAX_PATCH_CHARS = 256 * 1024;
const MAX_STATUS_BUFFER = 4 * 1024 * 1024;
const MAX_PATCH_BUFFER = 512 * 1024;
const GIT_TIMEOUT_MS = 5_000;

const SCOPES =
  Object.freeze([
    "WORKTREE",
    "STAGED",
  ]);

class DevGitDiffError extends Error {
  constructor(code, message) {
    super(message);
    this.name =
      "DevGitDiffError";
    this.code = code;
  }
}

function gitEnvironment(
  source = process.env
) {
  const environment = {
    CI: "1",
    NO_COLOR: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    PAGER: "cat",
  };

  for (const key of [
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
  ]) {
    if (source[key] != null) {
      environment[key] =
        source[key];
    }
  }

  return environment;
}

function normalizeRepositoryPath(
  value
) {
  const raw =
    String(value ?? "");

  if (
    !raw ||
    raw.length > MAX_PATH_LENGTH ||
    /[\0\r\n]/.test(raw) ||
    raw.includes("\\") ||
    path.posix.isAbsolute(raw) ||
    /^[A-Za-z]:[\\/]/.test(raw) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(
      raw
    )
  ) {
    return null;
  }

  const candidate =
    raw.replace(/^\.\//, "");

  if (
    candidate
      .split("/")
      .includes("..")
  ) {
    return null;
  }

  const normalized =
    path.posix.normalize(
      candidate
    );

  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    return null;
  }

  return normalized;
}

function safeRepositoryPath(
  repositoryRoot,
  value
) {
  const relative =
    normalizeRepositoryPath(
      value
    );

  if (!relative) {
    throw new DevGitDiffError(
      "GIT_PATH_DENIED",
      "Chemin Git invalide."
    );
  }

  const absolute =
    path.resolve(
      repositoryRoot,
      relative
    );

  const relation =
    path.relative(
      repositoryRoot,
      absolute
    );

  if (
    !relation ||
    relation === ".." ||
    relation.startsWith(
      `..${path.sep}`
    ) ||
    path.isAbsolute(relation)
  ) {
    throw new DevGitDiffError(
      "GIT_PATH_DENIED",
      "Chemin Git hors dépôt."
    );
  }

  return relative;
}

function privateNameMatches(
  value
) {
  if (
    !(PRIVATE_NAMES instanceof RegExp)
  ) {
    return false;
  }

  PRIVATE_NAMES.lastIndex = 0;

  const matched =
    PRIVATE_NAMES.test(value);

  PRIVATE_NAMES.lastIndex = 0;

  return matched;
}

function isSensitiveGitPath(
  value
) {
  return (
    privateNameMatches(value) ||
    /(^|\/)\.env(?:\.[^/]+)?$/i.test(
      value
    ) ||
    /(^|\/)id_(?:rsa|dsa|ecdsa|ed25519)$/i.test(
      value
    ) ||
    /\.(?:pem|p12|pfx|key)$/i.test(
      value
    )
  );
}

function statusKind({
  indexStatus,
  worktreeStatus,
}) {
  if (
    indexStatus === "?" &&
    worktreeStatus === "?"
  ) {
    return "UNTRACKED";
  }

  const pair =
    `${indexStatus}${worktreeStatus}`;

  if (
    indexStatus === "U" ||
    worktreeStatus === "U" ||
    [
      "AA",
      "DD",
      "AU",
      "UA",
      "DU",
      "UD",
    ].includes(pair)
  ) {
    return "CONFLICT";
  }

  const staged =
    indexStatus !== " ";

  const unstaged =
    worktreeStatus !== " ";

  if (staged && unstaged) {
    return "BOTH";
  }

  if (staged) {
    return "STAGED";
  }

  return "UNSTAGED";
}

function changeType({
  indexStatus,
  worktreeStatus,
}) {
  if (
    indexStatus === "?" &&
    worktreeStatus === "?"
  ) {
    return "?";
  }

  if (
    worktreeStatus !== " "
  ) {
    return worktreeStatus;
  }

  return indexStatus;
}

function parsePorcelainStatus(
  raw,
  {
    maxFiles = MAX_FILES,
  } = {}
) {
  const records =
    String(raw || "")
      .split("\0");

  const files = [];
  let unsafeOmitted = 0;

  for (
    let index = 0;
    index < records.length;
    index += 1
  ) {
    const record =
      records[index];

    if (!record) {
      continue;
    }

    if (record.length < 4) {
      unsafeOmitted += 1;
      continue;
    }

    const indexStatus =
      record[0];

    const worktreeStatus =
      record[1];

    if (
      indexStatus === "!" &&
      worktreeStatus === "!"
    ) {
      continue;
    }

    const file =
      normalizeRepositoryPath(
        record.slice(3)
      );

    let originalFile = null;

    const renameOrCopy =
      ["R", "C"].includes(
        indexStatus
      ) ||
      ["R", "C"].includes(
        worktreeStatus
      );

    if (renameOrCopy) {
      originalFile =
        normalizeRepositoryPath(
          records[index + 1]
        );

      index += 1;
    }

    if (
      !file ||
      (
        renameOrCopy &&
        !originalFile
      )
    ) {
      unsafeOmitted += 1;
      continue;
    }

    const untracked =
      indexStatus === "?" &&
      worktreeStatus === "?";

    const staged =
      !untracked &&
      indexStatus !== " ";

    const unstaged =
      !untracked &&
      worktreeStatus !== " ";

    const kind =
      statusKind({
        indexStatus,
        worktreeStatus,
      });

    files.push({
      file,
      originalFile,
      indexStatus,
      worktreeStatus,
      changeType:
        changeType({
          indexStatus,
          worktreeStatus,
        }),
      status: kind,
      staged,
      unstaged,
      untracked,
      conflicted:
        kind === "CONFLICT",
      sensitive:
        isSensitiveGitPath(file) ||
        Boolean(
          originalFile &&
          isSensitiveGitPath(
            originalFile
          )
        ),
    });
  }

  files.sort(
    (left, right) =>
      left.file.localeCompare(
        right.file
      )
  );

  const counts = {
    total: files.length,
    staged:
      files.filter(
        (item) => item.staged
      ).length,
    unstaged:
      files.filter(
        (item) => item.unstaged
      ).length,
    untracked:
      files.filter(
        (item) => item.untracked
      ).length,
    conflicted:
      files.filter(
        (item) =>
          item.conflicted
      ).length,
  };

  return {
    counts,
    unsafeOmitted,
    truncated:
      files.length > maxFiles,
    files:
      files.slice(
        0,
        maxFiles
      ),
  };
}

function parseNumstat(raw) {
  const value =
    String(raw || "")
      .trim();

  if (!value) {
    return {
      additions: 0,
      deletions: 0,
      binary: false,
    };
  }

  const first =
    value.split("\n")[0] || "";

  const [
    additionsRaw,
    deletionsRaw,
  ] = first.split("\t");

  const binary =
    additionsRaw === "-" ||
    deletionsRaw === "-";

  return {
    additions:
      binary
        ? null
        : Number(
            additionsRaw || 0
          ) || 0,
    deletions:
      binary
        ? null
        : Number(
            deletionsRaw || 0
          ) || 0,
    binary,
  };
}

function createDevGitDiffService({
  runner = execFile,
  environment = process.env,
} = {}) {
  function runGit(
    cwd,
    args,
    {
      maxBuffer =
        MAX_STATUS_BUFFER,
      allowBufferTruncation =
        false,
      failureCode =
        "GIT_READ_FAILED",
    } = {}
  ) {
    return new Promise(
      (resolve, reject) => {
        const safeArgs = [
          "-c",
          "core.fsmonitor=false",
          ...args,
        ];

        runner(
          "git",
          safeArgs,
          {
            cwd,
            encoding: "utf8",
            timeout:
              GIT_TIMEOUT_MS,
            maxBuffer,
            shell: false,
            env:
              gitEnvironment(
                environment
              ),
          },
          (
            error,
            stdout,
            stderr
          ) => {
            if (error) {
              const bufferExceeded =
                error.code ===
                  "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
                /maxBuffer/i.test(
                  error.message || ""
                );

              if (
                allowBufferTruncation &&
                bufferExceeded
              ) {
                resolve({
                  stdout:
                    String(
                      stdout || ""
                    ),
                  stderr: "",
                  truncated: true,
                });

                return;
              }

              reject(
                new DevGitDiffError(
                  failureCode,
                  "Lecture Git impossible."
                )
              );

              return;
            }

            resolve({
              stdout:
                String(
                  stdout || ""
                ),
              stderr:
                String(
                  stderr || ""
                ),
              truncated: false,
            });
          }
        );
      }
    );
  }

  async function repositoryRoot(
    value
  ) {
    let root;

    try {
      root =
        fs.realpathSync(
          String(value || "")
        );

      if (
        !fs.statSync(root)
          .isDirectory()
      ) {
        throw new Error(
          "not-directory"
        );
      }
    } catch {
      throw new DevGitDiffError(
        "GIT_ROOT_UNAVAILABLE",
        "Dépôt Git indisponible."
      );
    }

    const topLevel =
      await runGit(
        root,
        [
          "rev-parse",
          "--show-toplevel",
        ],
        {
          failureCode:
            "GIT_REPOSITORY_UNAVAILABLE",
        }
      );

    let canonicalTopLevel;

    try {
      canonicalTopLevel =
        fs.realpathSync(
          topLevel.stdout.replace(
            /\r?\n$/,
            ""
          )
        );
    } catch {
      throw new DevGitDiffError(
        "GIT_REPOSITORY_UNAVAILABLE",
        "Dépôt Git indisponible."
      );
    }

    if (
      canonicalTopLevel !== root
    ) {
      throw new DevGitDiffError(
        "GIT_ROOT_MISMATCH",
        "La racine DEV ne correspond pas à la racine Git."
      );
    }

    return root;
  }

  async function statusForRoot(
    root
  ) {
    const result =
      await runGit(
        root,
        [
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
        ]
      );

    return parsePorcelainStatus(
      result.stdout
    );
  }

  async function inspect({
    repositoryRoot: inputRoot,
  } = {}) {
    const root =
      await repositoryRoot(
        inputRoot
      );

    const branchResult =
      await runGit(
        root,
        [
          "branch",
          "--show-current",
        ]
      );

    const status =
      await statusForRoot(root);

    const branch =
      branchResult.stdout
        .replace(
          /[\0\r\n]+/g,
          ""
        )
        .trim()
        .slice(0, 200);

    return {
      status: "READY",
      branch:
        branch || null,
      detached:
        !branch,
      counts:
        status.counts,
      truncated:
        status.truncated,
      unsafeOmitted:
        status.unsafeOmitted,
      files:
        status.files,
    };
  }

  async function readDiff({
    repositoryRoot: inputRoot,
    file: inputFile,
    scope = "WORKTREE",
  } = {}) {
    const root =
      await repositoryRoot(
        inputRoot
      );

    const requestedFile =
      safeRepositoryPath(
        root,
        inputFile
      );

    const normalizedScope =
      String(scope || "")
        .trim()
        .toUpperCase();

    if (
      !SCOPES.includes(
        normalizedScope
      )
    ) {
      throw new DevGitDiffError(
        "GIT_DIFF_SCOPE_INVALID",
        "Périmètre Git Diff invalide."
      );
    }

    const status =
      await statusForRoot(root);

    const entry =
      status.files.find(
        (item) =>
          item.file ===
            requestedFile ||
          item.originalFile ===
            requestedFile
      );

    if (!entry) {
      return {
        status: "EMPTY",
        file:
          requestedFile,
        scope:
          normalizedScope,
        patch: "",
        additions: 0,
        deletions: 0,
        binary: false,
        truncated: false,
        sensitive: false,
      };
    }

    if (
      normalizedScope ===
        "STAGED" &&
      !entry.staged
    ) {
      return {
        status: "EMPTY",
        file: entry.file,
        scope:
          normalizedScope,
        patch: "",
        additions: 0,
        deletions: 0,
        binary: false,
        truncated: false,
        sensitive:
          entry.sensitive,
      };
    }

    if (
      normalizedScope ===
        "WORKTREE" &&
      !entry.unstaged &&
      !entry.untracked
    ) {
      return {
        status: "EMPTY",
        file: entry.file,
        scope:
          normalizedScope,
        patch: "",
        additions: 0,
        deletions: 0,
        binary: false,
        truncated: false,
        sensitive:
          entry.sensitive,
      };
    }

    if (entry.sensitive) {
      return {
        status:
          "REDACTED",
        file: entry.file,
        originalFile:
          entry.originalFile,
        scope:
          normalizedScope,
        changeType:
          entry.changeType,
        patch: null,
        additions: null,
        deletions: null,
        binary: false,
        truncated: false,
        sensitive: true,
      };
    }

    if (
      normalizedScope ===
        "WORKTREE" &&
      entry.untracked
    ) {
      return {
        status:
          "UNTRACKED",
        file: entry.file,
        originalFile:
          entry.originalFile,
        scope:
          normalizedScope,
        changeType: "?",
        patch: null,
        additions: null,
        deletions: null,
        binary: false,
        truncated: false,
        sensitive: false,
      };
    }

    const literalPaths = [
      `:(literal)${entry.file}`,
    ];

    if (
      entry.originalFile &&
      entry.originalFile !== entry.file
    ) {
      literalPaths.push(
        `:(literal)${entry.originalFile}`
      );
    }

    const baseArgs = [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
    ];

    if (
      normalizedScope ===
      "STAGED"
    ) {
      baseArgs.push(
        "--cached"
      );
    }

    const patchResult =
      await runGit(
        root,
        [
          ...baseArgs,
          "--unified=3",
          "--",
          ...literalPaths,
        ],
        {
          maxBuffer:
            MAX_PATCH_BUFFER,
          allowBufferTruncation:
            true,
        }
      );

    const statsResult =
      await runGit(
        root,
        [
          ...baseArgs,
          "--numstat",
          "--",
          ...literalPaths,
        ],
        {
          maxBuffer:
            128 * 1024,
        }
      );

    const stats =
      parseNumstat(
        statsResult.stdout
      );

    const redactedPatch =
      redactSecrets(
        patchResult.stdout
      );

    const truncated =
      patchResult.truncated ||
      redactedPatch.length >
        MAX_PATCH_CHARS;

    const patch =
      redactedPatch.slice(
        0,
        MAX_PATCH_CHARS
      );

    const binary =
      stats.binary ||
      /(?:^|\n)Binary files .* differ(?:\n|$)/.test(
        patch
      ) ||
      /(?:^|\n)GIT binary patch(?:\n|$)/.test(
        patch
      );

    return {
      status:
        patch
          ? "READY"
          : "EMPTY",
      file:
        entry.file,
      originalFile:
        entry.originalFile,
      scope:
        normalizedScope,
      changeType:
        entry.changeType,
      patch,
      additions:
        stats.additions,
      deletions:
        stats.deletions,
      binary,
      truncated,
      sensitive: false,
    };
  }

  return {
    inspect,
    readDiff,
  };
}

module.exports = {
  DevGitDiffError,
  MAX_FILES,
  MAX_PATCH_CHARS,
  SCOPES,
  createDevGitDiffService,
  gitEnvironment,
  isSensitiveGitPath,
  normalizeRepositoryPath,
  parseNumstat,
  parsePorcelainStatus,
  safeRepositoryPath,
};
