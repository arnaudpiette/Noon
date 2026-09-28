"use strict";

const assert =
  require("node:assert/strict");
const test =
  require("node:test");
const fs =
  require("node:fs");
const path =
  require("node:path");

function serverSource() {
  return fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "server.js"
    ),
    "utf8"
  );
}

function gitDiffRoutes() {
  const source =
    serverSource();

  const start =
    source.indexOf(
      "const devGitDiffRead ="
    );

  const end =
    source.indexOf(
      "const devTerminalCompletionsRead =",
      start
    );

  assert.ok(
    start >= 0,
    "début des routes Git Diff absent"
  );

  assert.ok(
    end > start,
    "fin des routes Git Diff absente"
  );

  return source.slice(
    start,
    end
  );
}

test(
  "Git Diff expose uniquement deux lectures HTTP GET",
  () => {
    const routes =
      gitDiffRoutes();

    assert.match(
      routes,
      /\/git-diff\$/
    );

    assert.match(
      routes,
      /\/git-diff\\\/file\$/
    );

    const getCount =
      (
        routes.match(
          /req\.method === "GET"/g
        ) || []
      ).length;

    assert.equal(
      getCount,
      2
    );

    assert.doesNotMatch(
      routes,
      /req\.method === "(?:POST|PUT|PATCH|DELETE)"/
    );

    assert.doesNotMatch(
      routes,
      /readJsonBody/
    );
  }
);

test(
  "les deux lectures Git Diff exigent l'UI locale de confiance",
  () => {
    const routes =
      gitDiffRoutes();

    const guardCount =
      (
        routes.match(
          /requireTrustedDevUi\(req\)/g
        ) || []
      ).length;

    assert.equal(
      guardCount,
      2
    );

    assert.match(
      routes,
      /devWorkspaceTerminalService\s*\.inspectGitDiff/
    );

    assert.match(
      routes,
      /devWorkspaceTerminalService\s*\.readGitDiff/
    );
  }
);

test(
  "la route fichier transmet seulement session file et scope",
  () => {
    const routes =
      gitDiffRoutes();

    assert.match(
      routes,
      /searchParams\s*\.get\("file"\)/
    );

    assert.match(
      routes,
      /searchParams\s*\.get\("scope"\)/
    );

    assert.doesNotMatch(
      routes,
      /repositoryRoot/
    );

    assert.doesNotMatch(
      routes,
      /body\./
    );
  }
);

test(
  "les erreurs Git de racine et lecture ont un statut HTTP explicite",
  () => {
    const source =
      serverSource();

    assert.match(
      source,
      /GIT_ROOT_UNAVAILABLE/
    );

    assert.match(
      source,
      /GIT_REPOSITORY_UNAVAILABLE/
    );

    assert.match(
      source,
      /GIT_ROOT_MISMATCH/
    );

    assert.match(
      source,
      /GIT_READ_FAILED/
    );
  }
);
