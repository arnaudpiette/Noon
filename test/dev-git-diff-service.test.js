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
  MAX_FILES,
  createDevGitDiffService,
  normalizeRepositoryPath,
  parsePorcelainStatus,
} = require(
  "../services/dev/dev-git-diff-service"
);

function git(
  root,
  args
) {
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

function write(
  root,
  file,
  content
) {
  const target =
    path.join(root, file);

  fs.mkdirSync(
    path.dirname(target),
    {
      recursive: true,
    }
  );

  fs.writeFileSync(
    target,
    content
  );
}

function repository(
  context
) {
  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "noon-git-diff-"
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

  write(
    root,
    "tracked.txt",
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

test(
  "normalise uniquement des chemins Git relatifs sûrs",
  () => {
    assert.equal(
      normalizeRepositoryPath(
        "src/app.js"
      ),
      "src/app.js"
    );

    assert.equal(
      normalizeRepositoryPath(
        "./src/app.js"
      ),
      "src/app.js"
    );

    assert.equal(
      normalizeRepositoryPath(
        " leading.txt"
      ),
      " leading.txt"
    );

    assert.equal(
      normalizeRepositoryPath(
        "trailing.txt "
      ),
      "trailing.txt "
    );

    for (const invalid of [
      "",
      "/tmp/app.js",
      "../app.js",
      "src/../../app.js",
      "src/../app.js",
      "C:/tmp/app.js",
      "file://tmp/app.js",
      "node:internal/test",
      "src\\app.js",
      "src/a\nb.js",
    ]) {
      assert.equal(
        normalizeRepositoryPath(
          invalid
        ),
        null,
        invalid
      );
    }
  }
);

test(
  "parse staged unstaged et untracked sans ambiguïté",
  () => {
    const result =
      parsePorcelainStatus(
        [
          " M tracked.txt",
          "A  staged.txt",
          "?? untracked.txt",
          "",
        ].join("\0")
      );

    const byFile =
      new Map(
        result.files.map(
          (item) => [
            item.file,
            item,
          ]
        )
      );

    assert.equal(
      byFile.get(
        "tracked.txt"
      ).status,
      "UNSTAGED"
    );

    assert.equal(
      byFile.get(
        "staged.txt"
      ).status,
      "STAGED"
    );

    assert.equal(
      byFile.get(
        "untracked.txt"
      ).status,
      "UNTRACKED"
    );

    assert.deepEqual(
      result.counts,
      {
        total: 3,
        staged: 1,
        unstaged: 1,
        untracked: 1,
        conflicted: 0,
      }
    );
  }
);

test(
  "parse un renommage porcelain -z",
  () => {
    const result =
      parsePorcelainStatus(
        [
          "R  renamed.txt",
          "tracked.txt",
          "",
        ].join("\0")
      );

    assert.equal(
      result.files.length,
      1
    );

    assert.equal(
      result.files[0].file,
      "renamed.txt"
    );

    assert.equal(
      result.files[0]
        .originalFile,
      "tracked.txt"
    );

    assert.equal(
      result.files[0]
        .changeType,
      "R"
    );
  }
);

test(
  "inspecte un dépôt réel avec staged unstaged et untracked",
  async (context) => {
    const root =
      repository(context);

    fs.appendFileSync(
      path.join(
        root,
        "tracked.txt"
      ),
      "worktree\n"
    );

    write(
      root,
      "staged.txt",
      "staged\n"
    );

    git(root, [
      "add",
      "--",
      "staged.txt",
    ]);

    write(
      root,
      "untracked.txt",
      "untracked\n"
    );

    const service =
      createDevGitDiffService();

    const result =
      await service.inspect({
        repositoryRoot: root,
      });

    assert.equal(
      result.status,
      "READY"
    );

    assert.equal(
      result.branch,
      "main"
    );

    const byFile =
      new Map(
        result.files.map(
          (item) => [
            item.file,
            item,
          ]
        )
      );

    assert.equal(
      byFile.get(
        "tracked.txt"
      ).unstaged,
      true
    );

    assert.equal(
      byFile.get(
        "staged.txt"
      ).staged,
      true
    );

    assert.equal(
      byFile.get(
        "untracked.txt"
      ).untracked,
      true
    );
  }
);

test(
  "détecte un renommage réel sans perdre le chemin d'origine",
  async (context) => {
    const root =
      repository(context);

    fs.renameSync(
      path.join(
        root,
        "tracked.txt"
      ),
      path.join(
        root,
        "renamed.txt"
      )
    );

    git(root, [
      "add",
      "-A",
    ]);

    const service =
      createDevGitDiffService();

    const result =
      await service.inspect({
        repositoryRoot: root,
      });

    const renamed =
      result.files.find(
        (item) =>
          item.file ===
          "renamed.txt"
      );

    assert.ok(renamed);

    assert.equal(
      renamed.originalFile,
      "tracked.txt"
    );

    assert.equal(
      renamed.changeType,
      "R"
    );

    assert.equal(
      renamed.staged,
      true
    );

    const diff =
      await service.readDiff({
        repositoryRoot: root,
        file: "renamed.txt",
        scope: "STAGED",
      });

    assert.equal(
      diff.status,
      "READY"
    );

    assert.match(
      diff.patch,
      /rename from tracked\.txt/
    );

    assert.match(
      diff.patch,
      /rename to renamed\.txt/
    );

    assert.equal(
      diff.additions,
      0
    );

    assert.equal(
      diff.deletions,
      0
    );
  }
);

test(
  "lit un diff worktree avec statistiques et patch borné",
  async (context) => {
    const root =
      repository(context);

    write(
      root,
      "tracked.txt",
      [
        "initial",
        "after",
        "",
      ].join("\n")
    );

    const service =
      createDevGitDiffService();

    const result =
      await service.readDiff({
        repositoryRoot: root,
        file: "tracked.txt",
        scope: "WORKTREE",
      });

    assert.equal(
      result.status,
      "READY"
    );

    assert.equal(
      result.scope,
      "WORKTREE"
    );

    assert.equal(
      result.file,
      "tracked.txt"
    );

    assert.ok(
      result.additions >= 1
    );

    assert.match(
      result.patch,
      /\+after/
    );

    assert.equal(
      result.truncated,
      false
    );
  }
);

test(
  "lit séparément le diff staged",
  async (context) => {
    const root =
      repository(context);

    write(
      root,
      "staged.txt",
      "hello\n"
    );

    git(root, [
      "add",
      "--",
      "staged.txt",
    ]);

    const service =
      createDevGitDiffService();

    const result =
      await service.readDiff({
        repositoryRoot: root,
        file: "staged.txt",
        scope: "STAGED",
      });

    assert.equal(
      result.status,
      "READY"
    );

    assert.equal(
      result.scope,
      "STAGED"
    );

    assert.equal(
      result.changeType,
      "A"
    );

    assert.match(
      result.patch,
      /\+hello/
    );
  }
);

test(
  "refuse les chemins absolus et les traversées",
  async (context) => {
    const root =
      repository(context);

    const service =
      createDevGitDiffService();

    for (const file of [
      "../outside.js",
      "/tmp/outside.js",
      "file://outside.js",
    ]) {
      await assert.rejects(
        () =>
          service.readDiff({
            repositoryRoot:
              root,
            file,
            scope:
              "WORKTREE",
          }),
        (error) =>
          error?.code ===
          "GIT_PATH_DENIED"
      );
    }
  }
);

test(
  "ne renvoie jamais le patch d'un fichier sensible",
  async (context) => {
    const root =
      repository(context);

    write(
      root,
      ".env",
      "TOKEN=initial\n"
    );

    git(root, [
      "add",
      "--",
      ".env",
    ]);

    git(root, [
      "commit",
      "--quiet",
      "-m",
      "env baseline",
    ]);

    write(
      root,
      ".env",
      "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz1234567890\n"
    );

    const service =
      createDevGitDiffService();

    const result =
      await service.readDiff({
        repositoryRoot: root,
        file: ".env",
        scope: "WORKTREE",
      });

    assert.equal(
      result.status,
      "REDACTED"
    );

    assert.equal(
      result.sensitive,
      true
    );

    assert.equal(
      result.patch,
      null
    );
  }
);

test(
  "redacte les secrets d'un patch ordinaire",
  async (context) => {
    const root =
      repository(context);

    write(
      root,
      "config.js",
      "module.exports = {};\n"
    );

    git(root, [
      "add",
      "--",
      "config.js",
    ]);

    git(root, [
      "commit",
      "--quiet",
      "-m",
      "config baseline",
    ]);

    const secret =
      "sk-proj-abcdefghijklmnopqrstuvwxyz1234567890";

    write(
      root,
      "config.js",
      `const token = "${secret}";\n`
    );

    const service =
      createDevGitDiffService();

    const result =
      await service.readDiff({
        repositoryRoot: root,
        file: "config.js",
        scope: "WORKTREE",
      });

    assert.equal(
      result.status,
      "READY"
    );

    assert.doesNotMatch(
      result.patch,
      new RegExp(secret)
    );
  }
);

test(
  "identifie les diffs binaires sans exposer leur contenu",
  async (context) => {
    const root =
      repository(context);

    fs.writeFileSync(
      path.join(
        root,
        "asset.bin"
      ),
      Buffer.from([
        0,
        1,
        2,
        3,
      ])
    );

    git(root, [
      "add",
      "--",
      "asset.bin",
    ]);

    git(root, [
      "commit",
      "--quiet",
      "-m",
      "binary baseline",
    ]);

    fs.writeFileSync(
      path.join(
        root,
        "asset.bin"
      ),
      Buffer.from([
        0,
        4,
        5,
        6,
      ])
    );

    const service =
      createDevGitDiffService();

    const result =
      await service.readDiff({
        repositoryRoot: root,
        file: "asset.bin",
        scope: "WORKTREE",
      });

    assert.equal(
      result.status,
      "READY"
    );

    assert.equal(
      result.binary,
      true
    );

    assert.equal(
      result.additions,
      null
    );

    assert.equal(
      result.deletions,
      null
    );
  }
);

test(
  "borne l'inventaire sans perdre le compte total",
  async (context) => {
    const root =
      repository(context);

    for (
      let index = 0;
      index < MAX_FILES + 5;
      index += 1
    ) {
      write(
        root,
        `untracked/u${String(
          index
        ).padStart(
          3,
          "0"
        )}.txt`,
        "x\n"
      );
    }

    const service =
      createDevGitDiffService();

    const result =
      await service.inspect({
        repositoryRoot: root,
      });

    assert.equal(
      result.files.length,
      MAX_FILES
    );

    assert.equal(
      result.counts.total,
      MAX_FILES + 5
    );

    assert.equal(
      result.truncated,
      true
    );
  }
);

test(
  "un fichier untracked est inventorié sans lecture implicite de son contenu",
  async (context) => {
    const root =
      repository(context);

    write(
      root,
      "new-file.txt",
      "secret-ish content\n"
    );

    const service =
      createDevGitDiffService();

    const result =
      await service.readDiff({
        repositoryRoot: root,
        file: "new-file.txt",
        scope: "WORKTREE",
      });

    assert.equal(
      result.status,
      "UNTRACKED"
    );

    assert.equal(
      result.patch,
      null
    );

    assert.equal(
      result.additions,
      null
    );
  }
);

test(
  "désactive core.fsmonitor avant git status",
  async (context) => {
    const root =
      repository(context);

    const marker =
      path.join(
        root,
        "fsmonitor-ran"
      );

    const hook =
      path.join(
        root,
        "fsmonitor-probe.js"
      );

    fs.writeFileSync(
      hook,
      [
        "#!/usr/bin/env node",
        `require("node:fs").appendFileSync(${JSON.stringify(marker)}, "ran\\n");`,
        'process.stdout.write("1\\n");',
        "",
      ].join("\n")
    );

    fs.chmodSync(
      hook,
      0o755
    );

    git(root, [
      "config",
      "core.fsmonitor",
      hook,
    ]);

    fs.appendFileSync(
      path.join(
        root,
        "tracked.txt"
      ),
      "changed\n"
    );

    const service =
      createDevGitDiffService();

    await service.inspect({
      repositoryRoot: root,
    });

    assert.equal(
      fs.existsSync(marker),
      false
    );
  }
);

test(
  "le moteur n'exécute que des lectures Git hardcodées sans shell",
  async (context) => {
    const root =
      fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "noon-git-runner-"
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

    const calls = [];

    const runner = (
      command,
      args,
      options,
      callback
    ) => {
      calls.push({
        command,
        args: [...args],
        options,
      });

      const gitArgs =
        args[0] === "-c" &&
        args[1] === "core.fsmonitor=false"
          ? args.slice(2)
          : args;

      if (
        gitArgs[0] ===
        "rev-parse"
      ) {
        callback(
          null,
          `${root}\n`,
          ""
        );

        return;
      }

      if (
        gitArgs[0] ===
        "branch"
      ) {
        callback(
          null,
          "main\n",
          ""
        );

        return;
      }

      if (
        gitArgs[0] ===
        "status"
      ) {
        callback(
          null,
          " M app.js\0",
          ""
        );

        return;
      }

      if (
        gitArgs.includes(
          "--numstat"
        )
      ) {
        callback(
          null,
          "1\t0\tapp.js\n",
          ""
        );

        return;
      }

      callback(
        null,
        [
          "diff --git a/app.js b/app.js",
          "--- a/app.js",
          "+++ b/app.js",
          "@@ -1 +1,2 @@",
          " old",
          "+new",
          "",
        ].join("\n"),
        ""
      );
    };

    const service =
      createDevGitDiffService({
        runner,
      });

    await service.inspect({
      repositoryRoot: root,
    });

    await service.readDiff({
      repositoryRoot: root,
      file: "app.js",
      scope: "WORKTREE",
    });

    assert.ok(
      calls.length > 0
    );

    for (const call of calls) {
      assert.equal(
        call.command,
        "git"
      );

      assert.equal(
        call.options.shell,
        false
      );

      assert.equal(
        call.args[0],
        "-c"
      );

      assert.equal(
        call.args[1],
        "core.fsmonitor=false"
      );

      assert.ok(
        [
          "rev-parse",
          "branch",
          "status",
          "diff",
        ].includes(
          call.args[2]
        ),
        call.args.join(" ")
      );
    }

    const forbidden =
      new Set([
        "add",
        "commit",
        "push",
        "pull",
        "reset",
        "checkout",
        "restore",
        "clean",
        "switch",
        "rebase",
      ]);

    assert.equal(
      calls.some(
        (call) =>
          call.args.some(
            (arg) =>
              forbidden.has(
                arg
              )
          )
      ),
      false
    );
  }
);
