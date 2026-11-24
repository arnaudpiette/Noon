"use strict";

// V3-L7 — complétions du terminal du workspace DEV (entrées autorisées, chemins réels dans le
// dépôt, scripts package.json, liste des complétions), sorties telles quelles de
// workspace-terminal-service.js. Fonctions pures : aucune dépendance à l'état du service.

const fs = require("node:fs");
const path = require("node:path");

function completionEntryAllowed(
  name
) {
  const value =
    String(name || "");

  if (!value) {
    return false;
  }

  if (
    value === ".git" ||
    value === "node_modules" ||
    value === ".DS_Store"
  ) {
    return false;
  }

  if (
    /^\.env(?:\.|$)/i.test(value) ||
    /^(?:id_rsa|id_ed25519)$/i.test(value) ||
    /\.(?:pem|key|p12|pfx)$/i.test(value)
  ) {
    return false;
  }

  if (
    /(?:^|[._-])(?:secret|secrets|credential|credentials|token|tokens)(?:[._-]|$)/i.test(
      value
    )
  ) {
    return false;
  }

  return true;
}

function realPathInsideRepository(
  repositoryRoot,
  requestedPath
) {
  const rootReal =
    fs.realpathSync(
      repositoryRoot
    );

  const resolved =
    path.resolve(
      rootReal,
      requestedPath || "."
    );

  if (
    resolved !== rootReal &&
    !resolved.startsWith(
      rootReal + path.sep
    )
  ) {
    return null;
  }

  let real;

  try {
    real =
      fs.realpathSync(
        resolved
      );
  } catch {
    return null;
  }

  if (
    real !== rootReal &&
    !real.startsWith(
      rootReal + path.sep
    )
  ) {
    return null;
  }

  return real;
}

function readPackageScripts(
  repositoryRoot
) {
  const packagePath =
    realPathInsideRepository(
      repositoryRoot,
      "package.json"
    );

  if (!packagePath) {
    return [];
  }

  try {
    const stat =
      fs.statSync(
        packagePath
      );

    if (
      !stat.isFile() ||
      stat.size > 512 * 1024
    ) {
      return [];
    }

    const parsed =
      JSON.parse(
        fs.readFileSync(
          packagePath,
          "utf8"
        )
      );

    if (
      !parsed?.scripts ||
      typeof parsed.scripts !==
        "object"
    ) {
      return [];
    }

    return Object.keys(
      parsed.scripts
    )
      .filter(
        (name) =>
          typeof name === "string" &&
          name.trim()
      )
      .slice(0, 80);
  } catch {
    return [];
  }
}

function listRepositoryCompletions({
  repositoryRoot,
  query,
}) {
  const value =
    String(query || "")
      .slice(0, 1000);

  const trimmed =
    value.trim();

  if (!trimmed) {
    return [];
  }

  const suggestions = [];
  const seen = new Set();

  const add = (candidate) => {
    const item =
      String(candidate || "");

    if (
      !item ||
      seen.has(item)
    ) {
      return;
    }

    seen.add(item);
    suggestions.push(item);
  };

  // ------------------------------------------
  // npm run <script>
  // ------------------------------------------

  const lower =
    trimmed.toLowerCase();

  for (
    const script of
    readPackageScripts(
      repositoryRoot
    )
  ) {
    const candidate =
      `npm run ${script}`;

    if (
      candidate
        .toLowerCase()
        .startsWith(lower)
    ) {
      add(candidate);
    }
  }

  // npm test est une forme spéciale courante.
  if (
    "npm test".startsWith(lower)
  ) {
    add("npm test");
  }

  // ------------------------------------------
  // Fichiers / dossiers repo-only
  // ------------------------------------------

  const pathCommand =
    /^(?:cd|ls|cat|less|head|tail|node|python|python3|open|code|vim|nano)\s+/i.test(
      trimmed
    );

  const tokenMatch =
    value.match(
      /([^\s]+)$/
    );

  const token =
    tokenMatch
      ? tokenMatch[1]
      : "";

  const standalonePath =
    token === trimmed &&
    (
      token.startsWith(".") ||
      token.includes("/")
    );

  if (
    token &&
    (
      pathCommand ||
      standalonePath
    )
  ) {
    const slashIndex =
      token.lastIndexOf("/");

    const directoryToken =
      slashIndex >= 0
        ? token.slice(
            0,
            slashIndex + 1
          )
        : "";

    const basename =
      slashIndex >= 0
        ? token.slice(
            slashIndex + 1
          )
        : token;

    const directory =
      realPathInsideRepository(
        repositoryRoot,
        directoryToken || "."
      );

    if (directory) {
      try {
        const entries =
          fs.readdirSync(
            directory,
            {
              withFileTypes: true,
            }
          )
            .filter((entry) =>
              completionEntryAllowed(
                entry.name
              )
            )
            .sort(
              (a, b) => {
                const ad =
                  a.isDirectory()
                    ? 0
                    : 1;

                const bd =
                  b.isDirectory()
                    ? 0
                    : 1;

                if (ad !== bd) {
                  return ad - bd;
                }

                return a.name.localeCompare(
                  b.name
                );
              }
            )
            .slice(0, 120);

        const commandPrefix =
          value.slice(
            0,
            value.length -
              token.length
          );

        for (
          const entry of entries
        ) {
          if (
            basename &&
            !entry.name
              .toLowerCase()
              .startsWith(
                basename.toLowerCase()
              )
          ) {
            continue;
          }

          const lexicalChild =
            path.join(
              directory,
              entry.name
            );

          const realChild =
            realPathInsideRepository(
              repositoryRoot,
              path.relative(
                repositoryRoot,
                lexicalChild
              )
            );

          // Symlink hors repo = ignoré.
          if (!realChild) {
            continue;
          }

          let directoryEntry =
            entry.isDirectory();

          if (
            entry.isSymbolicLink()
          ) {
            try {
              directoryEntry =
                fs.statSync(
                  realChild
                ).isDirectory();
            } catch {
              continue;
            }
          }

          const completedToken =
            `${directoryToken}${entry.name}${
              directoryEntry
                ? "/"
                : ""
            }`;

          add(
            commandPrefix +
              completedToken
          );

          if (
            suggestions.length >= 40
          ) {
            break;
          }
        }
      } catch {
        // Completion ergonomique seulement :
        // une lecture impossible ne bloque pas le terminal.
      }
    }
  }

  return suggestions.slice(
    0,
    40
  );
}

module.exports = {
  completionEntryAllowed,
  realPathInsideRepository,
  readPackageScripts,
  listRepositoryCompletions,
};
