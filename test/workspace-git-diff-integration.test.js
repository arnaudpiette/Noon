"use strict";

const assert =
  require("node:assert/strict");
const test =
  require("node:test");
const fs =
  require("node:fs");
const os =
  require("node:os");
const path =
  require("node:path");
const {
  execFileSync,
} = require("node:child_process");

const {
  createDevWorkspaceTerminalService,
} = require(
  "../services/dev/workspace-terminal-service"
);

function git(root, args) {
  return execFileSync(
    "git",
    args,
    {
      cwd: root,
      encoding: "utf8",
      stdio: [
        "ignore",
        "pipe",
        "pipe",
      ],
    }
  );
}

function repository(context) {
  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "noon-workspace-git-"
      )
    );

  context.after(() => {
    fs.rmSync(
      root,
      {
        recursive: true,
        force: true,
      }
    );
  });

  git(root, [
    "init",
    "--quiet",
  ]);

  git(root, [
    "config",
    "user.name",
    "Noon Test",
  ]);

  git(root, [
    "config",
    "user.email",
    "noon@localhost",
  ]);

  git(root, [
    "config",
    "commit.gpgsign",
    "false",
  ]);

  fs.writeFileSync(
    path.join(
      root,
      "tracked.txt"
    ),
    "initial\n"
  );

  git(root, [
    "add",
    "--",
    "tracked.txt",
  ]);

  git(root, [
    "commit",
    "--quiet",
    "-m",
    "initial",
  ]);

  git(root, [
    "branch",
    "-M",
    "main",
  ]);

  return root;
}

function workspaceEngine(root) {
  return {
    context(workspaceId) {
      if (
        workspaceId !==
        "workspace-git-test"
      ) {
        const error =
          new Error(
            "Workspace inconnu."
          );

        error.code =
          "WORKSPACE_NOT_FOUND";

        throw error;
      }

      return {
        workspaceId,
        displayName:
          "Git Fixture",
        activeProject: {
          name:
            "Git Fixture",
        },
        roots: [
          {
            path: root,
            mode:
              "read-write",
          },
        ],
      };
    },
  };
}

function securityPolicy() {
  return {
    evaluate() {
      return {
        outcome: "ALLOW",
      };
    },
  };
}

test(
  "une session expose Git Diff UNCONFIGURED puis un inventaire live",
  async (context) => {
    const root =
      repository(context);

    fs.appendFileSync(
      path.join(
        root,
        "tracked.txt"
      ),
      "changed\n"
    );

    fs.writeFileSync(
      path.join(
        root,
        "untracked.txt"
      ),
      "new\n"
    );

    const service =
      createDevWorkspaceTerminalService({
        workspaceEngine:
          workspaceEngine(root),
        operationalSecurityPolicy:
          securityPolicy(),
      });

    const session =
      service.createSession({
        workspaceId:
          "workspace-git-test",
      });

    assert.equal(
      session.gitDiff.status,
      "UNCONFIGURED"
    );

    const gitDiff =
      await service.inspectGitDiff({
        sessionId:
          session.id,
      });

    assert.equal(
      gitDiff.status,
      "READY"
    );

    assert.equal(
      gitDiff.branch,
      "main"
    );

    assert.equal(
      gitDiff.counts.total,
      2
    );

    assert.equal(
      gitDiff.counts.unstaged,
      1
    );

    assert.equal(
      gitDiff.counts.untracked,
      1
    );

    assert.deepEqual(
      gitDiff.files.map(
        (item) => item.file
      ),
      [
        "tracked.txt",
        "untracked.txt",
      ]
    );

    const refreshed =
      service.getSession(
        session.id
      );

    assert.equal(
      refreshed.gitDiff.status,
      "READY"
    );

    assert.equal(
      refreshed.dirty,
      true
    );

    assert.equal(
      refreshed.branch,
      "main"
    );
  }
);

test(
  "lit un patch uniquement depuis la racine liée à la session",
  async (context) => {
    const root =
      repository(context);

    fs.appendFileSync(
      path.join(
        root,
        "tracked.txt"
      ),
      "workspace-change\n"
    );

    const service =
      createDevWorkspaceTerminalService({
        workspaceEngine:
          workspaceEngine(root),
        operationalSecurityPolicy:
          securityPolicy(),
      });

    const session =
      service.createSession({
        workspaceId:
          "workspace-git-test",
      });

    const result =
      await service.readGitDiff({
        sessionId:
          session.id,

        // Doit être ignoré :
        // la racine canonique appartient
        // exclusivement à la session.
        repositoryRoot:
          "/tmp",

        file:
          "tracked.txt",
        scope:
          "WORKTREE",
      });

    assert.equal(
      result.status,
      "READY"
    );

    assert.equal(
      result.file,
      "tracked.txt"
    );

    assert.match(
      result.patch,
      /\+workspace-change/
    );

    await assert.rejects(
      () =>
        service.readGitDiff({
          sessionId:
            session.id,
          file:
            "../outside.txt",
          scope:
            "WORKTREE",
        }),
      (error) =>
        error?.code ===
        "GIT_PATH_DENIED"
    );
  }
);

test(
  "le renderer ne peut jamais substituer la racine Git de la session",
  async (context) => {
    const root =
      repository(context);

    const calls = [];

    const fakeGitDiff = {
      async inspect(input) {
        calls.push({
          operation:
            "inspect",
          ...input,
        });

        return {
          status: "READY",
          branch: "main",
          detached: false,
          counts: {
            total: 0,
            staged: 0,
            unstaged: 0,
            untracked: 0,
            conflicted: 0,
          },
          truncated: false,
          unsafeOmitted: 0,
          files: [],
        };
      },

      async readDiff(input) {
        calls.push({
          operation:
            "readDiff",
          ...input,
        });

        return {
          status: "EMPTY",
          file: input.file,
          scope:
            input.scope,
          patch: "",
          additions: 0,
          deletions: 0,
          binary: false,
          truncated: false,
          sensitive: false,
        };
      },
    };

    const service =
      createDevWorkspaceTerminalService({
        workspaceEngine:
          workspaceEngine(root),
        operationalSecurityPolicy:
          securityPolicy(),
        gitDiffService:
          fakeGitDiff,
      });

    const session =
      service.createSession({
        workspaceId:
          "workspace-git-test",
      });

    await service.inspectGitDiff({
      sessionId:
        session.id,
      repositoryRoot:
        "/tmp/evil",
    });

    await service.readGitDiff({
      sessionId:
        session.id,
      repositoryRoot:
        "/tmp/evil",
      file:
        "tracked.txt",
      scope:
        "STAGED",
    });

    assert.equal(
      calls.length,
      2
    );

    const canonicalRoot =
      fs.realpathSync(root);

    for (const call of calls) {
      assert.equal(
        call.repositoryRoot,
        canonicalRoot
      );
    }

    assert.equal(
      calls[1].file,
      "tracked.txt"
    );

    assert.equal(
      calls[1].scope,
      "STAGED"
    );
  }
);


test(
  "une ancienne inspection Git ne remplace jamais une plus récente",
  async (context) => {
    const root =
      repository(context);

    const resolvers = [];

    const gitDiffService = {
      inspect() {
        return new Promise(
          (resolve) => {
            resolvers.push(resolve);
          }
        );
      },

      async readDiff() {
        return {};
      },
    };

    const service =
      createDevWorkspaceTerminalService({
        workspaceEngine:
          workspaceEngine(root),
        operationalSecurityPolicy:
          securityPolicy(),
        gitDiffService,
      });

    const session =
      service.createSession({
        workspaceId:
          "workspace-git-test",
      });

    const older =
      service.inspectGitDiff({
        sessionId:
          session.id,
      });

    const newer =
      service.inspectGitDiff({
        sessionId:
          session.id,
      });

    assert.equal(
      resolvers.length,
      2
    );

    resolvers[1]({
      status: "READY",
      branch: "newer",
      detached: false,
      counts: {
        total: 1,
        staged: 0,
        unstaged: 1,
        untracked: 0,
        conflicted: 0,
      },
      truncated: false,
      unsafeOmitted: 0,
      files: [
        {
          file: "newer.txt",
          originalFile: null,
          indexStatus: " ",
          worktreeStatus: "M",
          changeType: "M",
          status: "UNSTAGED",
          staged: false,
          unstaged: true,
          untracked: false,
          conflicted: false,
          sensitive: false,
        },
      ],
    });

    const newerResult =
      await newer;

    assert.equal(
      newerResult.branch,
      "newer"
    );

    resolvers[0]({
      status: "READY",
      branch: "older",
      detached: false,
      counts: {
        total: 1,
        staged: 1,
        unstaged: 0,
        untracked: 0,
        conflicted: 0,
      },
      truncated: false,
      unsafeOmitted: 0,
      files: [
        {
          file: "older.txt",
          originalFile: null,
          indexStatus: "M",
          worktreeStatus: " ",
          changeType: "M",
          status: "STAGED",
          staged: true,
          unstaged: false,
          untracked: false,
          conflicted: false,
          sensitive: false,
        },
      ],
    });

    const olderResult =
      await older;

    // La requête ancienne est neutralisée
    // jusque dans sa réponse publique.
    assert.equal(
      olderResult.branch,
      "newer"
    );

    assert.equal(
      olderResult.files[0].file,
      "newer.txt"
    );

    const current =
      service.getSession(
        session.id
      );

    assert.equal(
      current.gitDiff.branch,
      "newer"
    );

    assert.equal(
      current.gitDiff.files[0].file,
      "newer.txt"
    );

    assert.equal(
      current.branch,
      "newer"
    );
  }
);

test(
  "Git Diff refuse une session DEV inconnue avant toute lecture Git",
  async (context) => {
    const root =
      repository(context);

    let reads = 0;

    const service =
      createDevWorkspaceTerminalService({
        workspaceEngine:
          workspaceEngine(root),
        operationalSecurityPolicy:
          securityPolicy(),
        gitDiffService: {
          async inspect() {
            reads += 1;
            return {};
          },

          async readDiff() {
            reads += 1;
            return {};
          },
        },
      });

    await assert.rejects(
      () =>
        service.inspectGitDiff({
          sessionId:
            "missing-session",
        }),
      (error) =>
        error?.code ===
        "DEV_WORKSPACE_NOT_FOUND"
    );

    await assert.rejects(
      () =>
        service.readGitDiff({
          sessionId:
            "missing-session",
          file:
            "tracked.txt",
        }),
      (error) =>
        error?.code ===
        "DEV_WORKSPACE_NOT_FOUND"
    );

    assert.equal(
      reads,
      0
    );
  }
);
