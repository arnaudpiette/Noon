"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

const MAX_PROBLEMS = 200;
const MAX_MESSAGE_LENGTH = 600;
const MAX_COMMAND_LENGTH = 256;
const MAX_PATH_LENGTH = 2048;

const SEVERITIES = Object.freeze([
  "error",
  "warning",
  "info",
]);

const SOURCES = Object.freeze([
  "test",
  "lint",
  "typecheck",
  "build",
  "validation",
]);

const ANSI_PATTERN =
  /\x1B(?:[@-_][0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;

function stripAnsi(value) {
  return String(value || "")
    .replace(ANSI_PATTERN, "")
    .replace(/\r\n?/g, "\n");
}

function clean(value, limit) {
  return stripAnsi(value)
    .replace(/\0/g, "")
    .trim()
    .slice(0, limit);
}

function positiveInteger(value) {
  const number = Number(value);

  return (
    Number.isSafeInteger(number) &&
    number > 0
  )
    ? number
    : null;
}

function inferDevProblemSource(command) {
  const value =
    clean(
      command,
      MAX_COMMAND_LENGTH
    ).toLowerCase();

  if (
    /\btypecheck\b|\btsc\b/.test(
      value
    )
  ) {
    return "typecheck";
  }

  if (
    /\blint\b|\beslint\b|node\s+--check\b/.test(
      value
    )
  ) {
    return "lint";
  }

  if (
    /\btest\b|node\s+--test\b/.test(
      value
    )
  ) {
    return "test";
  }

  if (
    /\bbuild\b|vite\s+build\b|astro\s+build\b/.test(
      value
    )
  ) {
    return "build";
  }

  return "validation";
}

function normalizeProblemPath(
  rawPath,
  repositoryRoot
) {
  let candidate =
    clean(
      rawPath,
      MAX_PATH_LENGTH
    );

  if (!candidate) {
    return null;
  }

  if (
    candidate.startsWith("file://")
  ) {
    try {
      candidate =
        decodeURIComponent(
          new URL(candidate).pathname
        );
    } catch {
      return null;
    }
  }

  if (
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(
      candidate
    ) ||
    candidate.includes("://")
  ) {
    return null;
  }

  const root =
    repositoryRoot
      ? path.resolve(
          String(repositoryRoot)
        )
      : null;

  if (!root) {
    if (path.isAbsolute(candidate)) {
      return null;
    }

    const segments =
      candidate.split(/[\\/]+/);

    if (
      segments.includes("..")
    ) {
      return null;
    }

    return candidate
      .replace(/\\/g, "/")
      .replace(/^\.\//, "");
  }

  let absolute;

  if (path.isAbsolute(candidate)) {
    absolute =
      path.resolve(candidate);
  } else {
    const segments =
      candidate.split(/[\\/]+/);

    if (
      segments.includes("..")
    ) {
      return null;
    }

    absolute =
      path.resolve(
        root,
        candidate
      );
  }

  const relative =
    path.relative(
      root,
      absolute
    );

  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(
      `..${path.sep}`
    ) ||
    path.isAbsolute(relative)
  ) {
    return null;
  }

  return relative
    .split(path.sep)
    .join("/");
}

function collectOutput(input = {}) {
  if (
    Array.isArray(input.output)
  ) {
    return stripAnsi(
      input.output
        .filter(
          (event) =>
            event &&
            event.type !== "input"
        )
        .map(
          (event) =>
            String(
              event.text || ""
            )
        )
        .join("")
    );
  }

  return stripAnsi(
    [
      input.stdout,
      input.stderr,
    ]
      .filter(Boolean)
      .join("\n")
  );
}

function contextualDetails(
  lines,
  index
) {
  let message = null;
  let code = null;

  const positions = [];

  for (
    let distance = 0;
    distance <= 8;
    distance += 1
  ) {
    const before =
      index - distance;

    const after =
      index + distance;

    if (
      before >= 0 &&
      !positions.includes(before)
    ) {
      positions.push(before);
    }

    if (
      after < lines.length &&
      !positions.includes(after)
    ) {
      positions.push(after);
    }
  }

  for (const position of positions) {
    const line =
      clean(
        lines[position],
        MAX_MESSAGE_LENGTH
      );

    if (!line) continue;

    if (!code) {
      const codeMatch =
        line.match(
          /^\s*code:\s*['"]?([^'"\s]+)['"]?\s*$/i
        ) ||
        line.match(
          /\b(TS\d{3,5})\b/i
        );

      if (codeMatch) {
        code =
          clean(
            codeMatch[1],
            100
          );
      }
    }

    if (!message) {
      const exception =
        line.match(
          /\b((?:Syntax|Type|Reference|Range|Assertion)?Error(?:\s*\[[^\]]+\])?):\s*(.+)$/i
        );

      if (exception) {
        message =
          clean(
            `${exception[1]}: ${exception[2]}`,
            MAX_MESSAGE_LENGTH
          );

        if (!code) {
          const bracket =
            exception[1].match(
              /\[([^\]]+)\]/
            );

          if (bracket) {
            code =
              clean(
                bracket[1],
                100
              );
          }
        }

        continue;
      }

      const tapError =
        line.match(
          /^\s*error:\s*['"]?(.+?)['"]?\s*$/i
        );

      if (tapError) {
        message =
          clean(
            tapError[1],
            MAX_MESSAGE_LENGTH
          );
        continue;
      }

      const failedTest =
        line.match(
          /^\s*[✖×]\s*(.+)$/u
        );

      if (failedTest) {
        message =
          clean(
            failedTest[1],
            MAX_MESSAGE_LENGTH
          );
      }
    }
  }

  return {
    message,
    code,
  };
}

function tapYamlDetails(
  lines,
  index
) {
  let message = null;
  let code = null;
  let scalarField = null;
  let scalarIndent = -1;
  const ignoredLines = new Set();

  for (
    let position = index + 1;
    position < lines.length;
    position += 1
  ) {
    const rawLine =
      String(lines[position] || "");

    if (
      /^\s*(?:not )?ok\b/i.test(
        rawLine
      ) ||
      /^\s*\.\.\.\s*$/.test(
        rawLine
      )
    ) {
      break;
    }

    const trimmed =
      rawLine.trim();

    if (!trimmed) continue;

    const indentation =
      rawLine.match(/^\s*/)[0]
        .length;

    if (
      scalarField &&
      indentation > scalarIndent
    ) {
      if (
        scalarField === "error" &&
        !message
      ) {
        message =
          clean(
            trimmed,
            MAX_MESSAGE_LENGTH
          );
      }

      if (scalarField === "stack") {
        ignoredLines.add(position);
      }

      continue;
    }

    scalarField = null;
    scalarIndent = -1;

    const field =
      rawLine.match(
        /^(\s*)([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/
      );

    if (!field) continue;

    const name =
      field[2].toLowerCase();

    const value =
      field[3].trim();

    if (
      (name === "error" ||
        name === "stack") &&
      /^[|>][+-]?$/.test(value)
    ) {
      scalarField = name;
      scalarIndent =
        field[1].length;
      continue;
    }

    if (
      name === "error" &&
      value
    ) {
      message =
        clean(
          value.replace(
            /^(['"])(.*)\1$/,
            "$2"
          ),
          MAX_MESSAGE_LENGTH
        );
    }

    if (
      name === "code" &&
      value
    ) {
      code =
        clean(
          value.replace(
            /^(['"])(.*)\1$/,
            "$2"
          ),
          100
        );
    }
  }

  return {
    message,
    code,
    ignoredLines,
  };
}

function stableProblemId(problem) {
  return crypto
    .createHash("sha256")
    .update(
      [
        problem.source,
        problem.severity,
        problem.file,
        problem.line,
        problem.column,
        problem.code,
        problem.message,
      ].join("|")
    )
    .digest("hex")
    .slice(0, 16);
}

function parseDevProblems(
  input = {}
) {
  const command =
    clean(
      input.command,
      MAX_COMMAND_LENGTH
    );

  const source =
    inferDevProblemSource(
      command
    );

  const repositoryRoot =
    input.repositoryRoot
      ? path.resolve(
          String(
            input.repositoryRoot
          )
        )
      : null;

  const output =
    collectOutput(input);

  const lines =
    output.split("\n");

  const problems = [];
  const seen = new Set();
  const ignoredLines = new Set();
  let truncated = false;

  function addProblem({
    severity = "error",
    rawPath,
    line,
    column = 1,
    message,
    code = null,
  }) {
    const file =
      normalizeProblemPath(
        rawPath,
        repositoryRoot
      );

    const safeLine =
      positiveInteger(line);

    const safeColumn =
      positiveInteger(column) || 1;

    const safeMessage =
      clean(
        message ||
          "Erreur de validation.",
        MAX_MESSAGE_LENGTH
      );

    const safeSeverity =
      SEVERITIES.includes(
        String(severity)
          .toLowerCase()
      )
        ? String(severity)
            .toLowerCase()
        : "error";

    const safeCode =
      code
        ? clean(code, 100)
        : null;

    if (
      !file ||
      !safeLine ||
      !safeMessage
    ) {
      return;
    }

    const key = [
      source,
      safeSeverity,
      file,
      safeLine,
      safeColumn,
      safeCode || "",
      safeMessage,
    ].join("|");

    if (seen.has(key)) {
      return;
    }

    if (
      problems.length >=
      MAX_PROBLEMS
    ) {
      truncated = true;
      return;
    }

    seen.add(key);

    const problem = {
      id: null,
      source,
      severity:
        safeSeverity,
      file,
      line:
        safeLine,
      column:
        safeColumn,
      message:
        safeMessage,
      code:
        safeCode,
    };

    problem.id =
      stableProblemId(problem);

    problems.push(problem);
  }

  for (
    let index = 0;
    index < lines.length;
    index += 1
  ) {
    if (ignoredLines.has(index)) {
      continue;
    }

    const rawLine =
      lines[index];

    const line =
      clean(
        rawLine,
        4096
      );

    if (!line) continue;

    // TypeScript:
    // src/file.ts(12,5): error TS2322: message
    const typescript =
      line.match(
        /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s*(TS\d+)?\s*:?\s*(.+)$/i
      );

    if (typescript) {
      addProblem({
        rawPath:
          typescript[1],
        line:
          typescript[2],
        column:
          typescript[3],
        severity:
          typescript[4],
        code:
          typescript[5] ||
          null,
        message:
          typescript[6],
      });

      continue;
    }

    // ESLint compact / diagnostic générique:
    // src/file.js:12:5: error message
    const compact =
      line.match(
        /^(.+?):(\d+):(\d+)\s*[:\-]?\s*(error|warning)\s+(.+)$/i
      );

    if (compact) {
      let message =
        compact[5];

      let code = null;

      const rule =
        message.match(
          /^(.*?)(?:\s{2,})([@A-Za-z0-9_/-]+)\s*$/
        );

      if (rule) {
        message =
          rule[1];

        code =
          rule[2];
      }

      addProblem({
        rawPath:
          compact[1],
        line:
          compact[2],
        column:
          compact[3],
        severity:
          compact[4],
        message,
        code,
      });

      continue;
    }

    // node:test TAP:
    // location: '/repo/test/a.test.js:42:1'
    const tapLocation =
      line.match(
        /^\s*location:\s*['"](.+):(\d+):(\d+)['"]\s*$/i
      );

    if (tapLocation) {
      const tapDetails =
        tapYamlDetails(
          lines,
          index
        );

      for (
        const ignoredLine of
          tapDetails.ignoredLines
      ) {
        ignoredLines.add(
          ignoredLine
        );
      }

      const context =
        contextualDetails(
          lines,
          index
        );

      addProblem({
        rawPath:
          tapLocation[1],
        line:
          tapLocation[2],
        column:
          tapLocation[3],
        severity:
          "error",
        message:
          tapDetails.message ||
          context.message ||
          "Test en échec.",
        code:
          tapDetails.code ||
          context.code,
      });

      continue;
    }

    // ESLint stylish:
    //
    // /repo/src/file.js
    //   12:5  error  message  rule
    const possibleFile =
      normalizeProblemPath(
        line,
        repositoryRoot
      );

    if (
      possibleFile &&
      /\.[A-Za-z0-9]+$/.test(
        possibleFile
      ) &&
      index + 1 <
        lines.length
    ) {
      const stylish =
        stripAnsi(
          lines[index + 1]
        ).match(
          /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+)$/
        );

      if (stylish) {
        let message =
          stylish[4];

        let code = null;

        const rule =
          message.match(
            /^(.*?)(?:\s{2,})([@A-Za-z0-9_/-]+)\s*$/
          );

        if (rule) {
          message =
            rule[1];
          code =
            rule[2];
        }

        addProblem({
          rawPath: line,
          line:
            stylish[1],
          column:
            stylish[2],
          severity:
            stylish[3],
          message,
          code,
        });

        index += 1;
        continue;
      }
    }

    // Node --check / syntax errors:
    // /repo/public/app.js:63
    const syntaxLocation =
      line.match(
        /^(.+?\.[A-Za-z0-9]+):(\d+)(?::(\d+))?\s*$/
      );

    if (syntaxLocation) {
      const context =
        contextualDetails(
          lines,
          index
        );

      if (context.message) {
        addProblem({
          rawPath:
            syntaxLocation[1],
          line:
            syntaxLocation[2],
          column:
            syntaxLocation[3] ||
            1,
          severity:
            "error",
          message:
            context.message,
          code:
            context.code ||
            (
              /SyntaxError/i.test(
                context.message
              )
                ? "SYNTAX_ERROR"
                : null
            ),
        });

        continue;
      }
    }

    // Stack Node:
    // at fn (/repo/file.js:12:5)
    // test at test/file.test.js:12:1
    const stackLocation =
      line.match(
        /\(([^()]+):(\d+):(\d+)\)\s*$/
      ) ||
      line.match(
        /\btest at\s+(.+?):(\d+):(\d+)\s*$/i
      ) ||
      line.match(
        /(?:^|\s)(\/[^:\s]+):(\d+):(\d+)\s*$/
      );

    if (stackLocation) {
      const context =
        contextualDetails(
          lines,
          index
        );

      addProblem({
        rawPath:
          stackLocation[1],
        line:
          stackLocation[2],
        column:
          stackLocation[3],
        severity:
          "error",
        message:
          context.message ||
          "Erreur de validation.",
        code:
          context.code,
      });
    }
  }

  const counts = {
    total:
      problems.length,
    error: 0,
    warning: 0,
    info: 0,
  };

  for (const problem of problems) {
    counts[
      problem.severity
    ] += 1;
  }

  const exitCode =
    Number.isInteger(
      input.exitCode
    )
      ? input.exitCode
      : null;

  const failed =
    exitCode !== null &&
    exitCode !== 0;

  return {
    status:
      problems.length > 0
        ? "READY"
        : failed
          ? "UNRESOLVED"
          : "EMPTY",

    source,
    command,
    exitCode,
    counts,
    truncated,
    problems,
  };
}

module.exports = {
  MAX_PROBLEMS,
  SEVERITIES,
  SOURCES,
  inferDevProblemSource,
  normalizeProblemPath,
  parseDevProblems,
  stripAnsi,
};
