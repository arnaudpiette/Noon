"use strict";

const assert =
  require("node:assert/strict");

const fs =
  require("node:fs");

const os =
  require("node:os");

const path =
  require("node:path");

const {
  execFileSync,
} = require("node:child_process");

const test =
  require("node:test");

const REPO_ROOT =
  path.resolve(
    __dirname,
    ".."
  );

const DATA_DIR =
  fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      "noon-retry-http-e2e-"
    )
  );

const AUTH_SECRET =
  "noon-retry-http-e2e-secret";

const PROJECT_ID =
  "project-retry-http-e2e";

const CHAIN_ID =
  "chain-retry-http-e2e";

const ROOT_TASK_ID =
  "task-retry-http-root";

process.env.NOON_SAFE_MODE =
  "1";

process.env.NOON_DATA_DIR =
  DATA_DIR;

delete process.env.NOON_UI_VALIDATION;

function projectRegistryPath() {
  const source =
    fs.readFileSync(
      path.join(
        REPO_ROOT,
        "server.js"
      ),
      "utf8"
    );

  const match =
    source.match(
      /PROJECTS_REGISTRY_FILE\s*=\s*path\.join\(\s*DATA_DIRECTORY\s*,\s*"([^"]+)"\s*\)/s
    );

  assert.ok(
    match,
    "PROJECTS_REGISTRY_FILE introuvable dans server.js"
  );

  return path.join(
    DATA_DIR,
    match[1]
  );
}

function seedLocalAuthorityFiles() {
  const projectFile =
    projectRegistryPath();

  fs.mkdirSync(
    path.dirname(projectFile),
    {
      recursive: true,
    }
  );

  fs.writeFileSync(
    projectFile,
    JSON.stringify(
      {
        version: 1,

        updatedAt:
          new Date()
            .toISOString(),

        projects: [
          {
            id:
              PROJECT_ID,

            name:
              "Noon Retry HTTP E2E",

            rootPath:
              REPO_ROOT,

            aliases: [
              "Noon Retry HTTP E2E",
            ],

            category:
              "test",

            status:
              "active",
          },
        ],
      },
      null,
      2
    )
  );

  const permissionFile =
    path.join(
      DATA_DIR,
      "local-permissions.json"
    );

  fs.writeFileSync(
    permissionFile,
    JSON.stringify(
      {
        version: 1,

        roots: [
          {
            path:
              REPO_ROOT,

            mode:
              "read-write",

            output:
              false,
          },
        ],
      },
      null,
      2
    )
  );

  const {
    createLocalPermissionStore,
  } = require(
    "../lib/local-permissions"
  );

  const verificationStore =
    createLocalPermissionStore(
      permissionFile
    );

  const writableRoots =
    verificationStore
      .roots(
        "read-write"
      )
      .map(
        (value) =>
          fs.realpathSync.native(
            value
          )
      );

  assert.ok(
    writableRoots.includes(
      fs.realpathSync.native(
        REPO_ROOT
      )
    ),
    "La racine Noon de test doit être réellement autorisée en read-write."
  );
}

seedLocalAuthorityFiles();

const {
  server,
  startNoonServer,
  stopNoonServer,
} = require("../server");

const {
  createPersonalDatabase,
} = require(
  "../services/persistence/database"
);

const {
  createGoalDevRetryChainRepository,
} = require(
  "../services/persistence/repositories/goal-dev-retry-chain-repository"
);

const {
  createGoalDevRetryChainStore,
} = require(
  "../services/goals/goal-dev-retry-chain-store"
);

const {
  createGoalDevRetryExecutionTemplate,
} = require(
  "../services/goals/goal-dev-retry-execution-template"
);

let origin =
  null;

let workspaceId =
  null;

let sqlitePath =
  null;

function currentBranch() {
  return execFileSync(
    "git",
    [
      "branch",
      "--show-current",
    ],
    {
      cwd:
        REPO_ROOT,

      encoding:
        "utf8",
    }
  ).trim();
}

function discoverSqlitePath() {
  const preferred =
    path.join(
      DATA_DIR,
      "personal-intelligence.sqlite"
    );

  if (
    fs.existsSync(
      preferred
    )
  ) {
    return preferred;
  }

  const candidates =
    fs.readdirSync(
      DATA_DIR
    )
      .filter(
        (name) =>
          name.endsWith(
            ".sqlite"
          )
      )
      .map(
        (name) =>
          path.join(
            DATA_DIR,
            name
          )
      );

  assert.equal(
    candidates.length,
    1,
    `Base SQLite Noon ambiguë: ${candidates.join(", ")}`
  );

  return candidates[0];
}

async function request(
  route,
  {
    method = "GET",
    auth = true,
    trusted = true,
    body,
  } = {}
) {
  const headers = {};

  if (auth) {
    headers[
      "X-Noon-Local-Auth"
    ] = AUTH_SECRET;
  }

  if (trusted) {
    headers[
      "X-Noon-Request"
    ] = "1";
  }

  if (
    body !==
      undefined
  ) {
    headers[
      "Content-Type"
    ] =
      "application/json";
  }

  const response =
    await fetch(
      `${origin}${route}`,
      {
        method,
        headers,

        body:
          body ===
            undefined
            ? undefined
            : JSON.stringify(
                body
              ),
      }
    );

  let payload =
    null;

  try {
    payload =
      await response.json();
  } catch {}

  return {
    status:
      response.status,

    payload,
  };
}

function seedRetryChain() {
  sqlitePath =
    discoverSqlitePath();

  const database =
    createPersonalDatabase(
      sqlitePath
    );

  const repository =
    createGoalDevRetryChainRepository(
      database
    );

  const store =
    createGoalDevRetryChainStore({
      repository,
    });

  const now =
    new Date();

  const createdAt =
    new Date(
      now.getTime() -
        1_000
    ).toISOString();

  const failedAt =
    new Date(
      now.getTime() -
        500
    ).toISOString();

  const template =
    createGoalDevRetryExecutionTemplate({
      objective:
        "Valider le transport HTTP du Retry sans exécuter Native DEV.",

      requiredQuality:
        "HIGH",

      branch:
        currentBranch(),

      allowedPaths: [
        REPO_ROOT,
      ],

      forbiddenPaths: [
        path.join(
          REPO_ROOT,
          ".env"
        ),
      ],

      constraints: [
        "Ne modifier aucun fichier pendant le test HTTP.",
      ],

      validationCommands: [
        "node --version",
      ],

      maxIterations: 1,

      maxDuration:
        5 * 60_000,

      maxEstimatedCost: 1,

      localOnly: true,
    });

  let revision =
    store.create({
      chainId:
        CHAIN_ID,

      goalRef: {
        goalId:
          "goal-retry-http-e2e",

        goalVersion: 1,

        workspaceId,

        projectId:
          PROJECT_ID,
      },

      rootTaskId:
        ROOT_TASK_ID,

      executionTemplate:
        template,

      limits: {
        maxRetries: 1,

        maxDuration:
          5 * 60_000,

        maxEstimatedCost: 1,
      },

      createdAt,
    });

  revision =
    store.recordAttempt(
      CHAIN_ID,
      {
        expectedRevision:
          revision.revision,

        taskId:
          ROOT_TASK_ID,

        finalVerdict:
          "FAIL",

        failureCategory:
          "VALIDATION_FAILED",

        continuationState:
          "RETRY_CANDIDATE",

        estimatedCost: 0,

        actualCost: 0,

        recordedAt:
          failedAt,
      }
    );

  assert.equal(
    revision.revision,
    2
  );

  assert.equal(
    revision.chain
      .attempts.length,
    1
  );

  database.close();
}

function readRetryChain() {
  const database =
    createPersonalDatabase(
      sqlitePath
    );

  const repository =
    createGoalDevRetryChainRepository(
      database
    );

  const store =
    createGoalDevRetryChainStore({
      repository,
    });

  const current =
    store.get(
      CHAIN_ID
    );

  database.close();

  return current;
}

test.before(
  async () => {
    await startNoonServer({
      port: 0,

      authSecret:
        AUTH_SECRET,
    });

    const address =
      server.address();

    assert.ok(
      address
    );

    origin =
      `http://127.0.0.1:${address.port}`;

    const workspace =
      await request(
        "/workspaces",
        {
          method:
            "POST",

          body: {
            id:
              "workspace-retry-http-e2e",

            name:
              "Retry HTTP E2E",

            type:
              "project",

            profileScope:
              "arnaud",

            memoryScope:
              "test:retry-http-e2e",

            metadata: {
              test:
                "goal-dev-retry-http-e2e",
            },

            projectIds: [
              PROJECT_ID,
            ],

            roots: [
              {
                path:
                  REPO_ROOT,

                mode:
                  "read-write",
              },
            ],
          },
        }
      );

    assert.equal(
      workspace.status,
      201,
      JSON.stringify(
        workspace.payload
      )
    );

    workspaceId =
      workspace.payload
        ?.workspace
        ?.workspace
        ?.id ||
      workspace.payload
        ?.workspace
        ?.id;

    assert.ok(
      workspaceId,
      "workspaceId HTTP absent"
    );

    const context =
      workspace.payload
        ?.workspace;

    assert.ok(
      Array.isArray(
        context?.projects
      ) &&
      context.projects
        .some(
          (project) =>
            project.id ===
              PROJECT_ID
        ),
      "Projet Retry non lié au workspace HTTP."
    );

    assert.ok(
      Array.isArray(
        context?.roots
      ) &&
      context.roots
        .some(
          (root) =>
            root.mode ===
              "read-write"
        ),
      "Racine read-write Retry absente du workspace HTTP."
    );

    seedRetryChain();
  }
);

test.after(
  async () => {
    await stopNoonServer();

    fs.rmSync(
      DATA_DIR,
      {
        recursive: true,
        force: true,
      }
    );
  }
);

test(
  "4.6L les routes Retry réelles exigent l'auth locale",
  async () => {
    const result =
      await request(
        "/api/goals/dev-retry/prepare",
        {
          method:
            "POST",

          auth:
            false,

          trusted:
            true,

          body: {
            chainId:
              CHAIN_ID,
          },
        }
      );

    assert.equal(
      result.status,
      401
    );

    assert.equal(
      result.payload
        ?.status,
      "error"
    );
  }
);

test(
  "4.6L les routes Retry réelles exigent la trusted UI",
  async () => {
    const result =
      await request(
        "/api/goals/dev-retry/prepare",
        {
          method:
            "POST",

          auth:
            true,

          trusted:
            false,

          body: {
            chainId:
              CHAIN_ID,
          },
        }
      );

    assert.equal(
      result.status,
      403
    );

    assert.equal(
      result.payload
        ?.code,
      "TRUSTED_UI_REQUIRED"
    );
  }
);

test(
  "4.6L le vrai transport HTTP refuse toute autorité injectée par le client",
  async () => {
    const result =
      await request(
        "/api/goals/dev-retry/prepare",
        {
          method:
            "POST",

          body: {
            chainId:
              CHAIN_ID,

            taskId:
              "caller-task",

            repositoryRoot:
              "/tmp/injected",

            permissions: [
              "ALL",
            ],
          },
        }
      );

    assert.equal(
      result.status,
      400
    );

    assert.equal(
      result.payload
        ?.code,
      "GOAL_DEV_RETRY_HTTP_BODY_INVALID"
    );
  }
);

test(
  "4.6L prepare réel puis approve avec mauvais token puis reject exact reste sans exécution",
  async () => {
    const before =
      readRetryChain();

    assert.equal(
      before.revision,
      2
    );

    assert.equal(
      before.chain
        .attempts.length,
      1
    );

    const prepared =
      await request(
        "/api/goals/dev-retry/prepare",
        {
          method:
            "POST",

          body: {
            chainId:
              CHAIN_ID,
          },
        }
      );

    assert.equal(
      prepared.status,
      202,
      JSON.stringify(
        prepared.payload
      )
    );

    assert.equal(
      prepared.payload
        ?.status,
      "ok"
    );

    assert.equal(
      prepared.payload
        ?.retry
        ?.permitState,
      "PENDING_APPROVAL"
    );

    assert.equal(
      prepared.payload
        ?.retry
        ?.chainId,
      CHAIN_ID
    );

    assert.equal(
      prepared.payload
        ?.retry
        ?.authority
        ?.approvalGranted,
      false
    );

    const approvalId =
      prepared.payload
        ?.retry
        ?.approval
        ?.approvalId;

    const resumeToken =
      prepared.payload
        ?.retry
        ?.approval
        ?.resumeToken;

    assert.equal(
      typeof approvalId,
      "string"
    );

    assert.equal(
      typeof resumeToken,
      "string"
    );

    assert.equal(
      resumeToken.length,
      43
    );

    const serialized =
      JSON.stringify(
        prepared.payload
      );

    for (
      const forbidden of [
        "executionTemplate",
        "repositoryRoot",
        "\"binding\"",
        "\"security\"",
        "payloadHash",
        "policyVersion",
      ]
    ) {
      assert.equal(
        serialized.includes(
          forbidden
        ),
        false,
        forbidden
      );
    }

    const last =
      resumeToken.at(-1);

    const tamperedToken =
      `${resumeToken.slice(0, -1)}${
        last === "A"
          ? "B"
          : "A"
      }`;

    const deniedApprove =
      await request(
        "/api/goals/dev-retry/resume",
        {
          method:
            "POST",

          body: {
            approvalId,

            resumeToken:
              tamperedToken,

            decision:
              "approve",
          },
        }
      );

    assert.equal(
      deniedApprove.status,
      403,
      JSON.stringify(
        deniedApprove.payload
      )
    );

    assert.equal(
      deniedApprove.payload
        ?.code,
      "APPROVAL_TOKEN_INVALID"
    );

    const afterDeniedApprove =
      readRetryChain();

    assert.equal(
      afterDeniedApprove
        .revision,
      2
    );

    assert.equal(
      afterDeniedApprove
        .chain
        .attempts.length,
      1
    );

    const rejected =
      await request(
        "/api/goals/dev-retry/resume",
        {
          method:
            "POST",

          body: {
            approvalId,

            resumeToken,

            decision:
              "reject",
          },
        }
      );

    assert.equal(
      rejected.status,
      200,
      JSON.stringify(
        rejected.payload
      )
    );

    assert.equal(
      rejected.payload
        ?.retry
        ?.status,
      "rejected"
    );

    assert.equal(
      rejected.payload
        ?.retry
        ?.execution,
      null
    );

    const afterReject =
      readRetryChain();

    assert.equal(
      afterReject.revision,
      2
    );

    assert.equal(
      afterReject.chain
        .attempts.length,
      1
    );

    const secondResume =
      await request(
        "/api/goals/dev-retry/resume",
        {
          method:
            "POST",

          body: {
            approvalId,

            resumeToken,

            decision:
              "approve",
          },
        }
      );

    assert.equal(
      secondResume.status,
      409,
      JSON.stringify(
        secondResume.payload
      )
    );

    assert.equal(
      secondResume.payload
        ?.code,
      "APPROVAL_INVALID"
    );

    const final =
      readRetryChain();

    assert.equal(
      final.revision,
      2
    );

    assert.equal(
      final.chain
        .attempts.length,
      1
    );
  }
);
