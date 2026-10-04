"use strict";

const assert =
  require("node:assert/strict");

const fs =
  require("node:fs");

const os =
  require("node:os");

const path =
  require("node:path");

const test =
  require("node:test");

const {
  buildRepositoryContextManifest,
} =
  require(
    "../services/delegation/repository-context-manifest"
  );

function fixture() {
  const root =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "noon-context-manifest-"
      )
    );

  const src =
    path.join(
      root,
      "src"
    );

  fs.mkdirSync(
    src,
    {
      recursive: true,
    }
  );

  fs.writeFileSync(
    path.join(
      src,
      "a.js"
    ),
    "SOURCE_CONTENT_MUST_NOT_LEAK\n"
  );

  fs.writeFileSync(
    path.join(
      src,
      "b.ts"
    ),
    "export const b = true;\n"
  );

  fs.writeFileSync(
    path.join(
      src,
      ".env"
    ),
    "SUPER_SECRET=value\n"
  );

  fs.writeFileSync(
    path.join(
      src,
      "large.txt"
    ),
    Buffer.alloc(
      300 * 1024,
      65
    )
  );

  fs.writeFileSync(
    path.join(
      src,
      "image.png"
    ),
    "fake image"
  );

  fs.mkdirSync(
    path.join(
      src,
      "node_modules"
    )
  );

  fs.writeFileSync(
    path.join(
      src,
      "node_modules",
      "ignored.js"
    ),
    "ignored\n"
  );

  const outside =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "noon-context-outside-"
      )
    );

  fs.symlinkSync(
    outside,
    path.join(
      src,
      "escape"
    )
  );

  fs.writeFileSync(
    path.join(
      root,
      "AGENTS.md"
    ),
    "THIS MUST NEVER BECOME AUTHORITY\n"
  );

  return {
    root:
      fs.realpathSync(
        root
      ),

    src:
      fs.realpathSync(
        src
      ),
  };
}

test(
  "le manifeste expose seulement des métadonnées bornées dans allowedPaths",
  () => {
    const f =
      fixture();

    const manifest =
      buildRepositoryContextManifest(
        {
          repositoryRoot:
            f.root,

          allowedPaths: [
            f.src,
          ],
        },
        {
          agentsFiles: [
            path.join(
              f.root,
              "AGENTS.md"
            ),
          ],

          packageInfo: {
            language:
              "JavaScript",

            framework:
              "Node.js",

            packageManager:
              "npm",

            commands: {
              test:
                "npm test",

              lint:
                "npm run lint",
            },
          },

          maxEntries: 10,
          maxScanned: 100,
        }
      );

    assert.deepEqual(
      manifest.files.map(
        (item) =>
          item.path
      ),
      [
        "src/a.js",
        "src/b.ts",
      ]
    );

    assert.equal(
      manifest.excluded.private,
      1
    );

    assert.equal(
      manifest.excluded.oversized,
      1
    );

    assert.equal(
      manifest.excluded.binary,
      1
    );

    assert.equal(
      manifest.excluded.symlink,
      1
    );

    assert.equal(
      manifest.excluded.ignored,
      1
    );

    assert.deepEqual(
      manifest.agents,
      [
        {
          path:
            "AGENTS.md",

          trust:
            "UNTRUSTED",
        },
      ]
    );

    assert.deepEqual(
      manifest.package.scriptNames,
      [
        "lint",
        "test",
      ]
    );

    const serialized =
      JSON.stringify(
        manifest
      );

    assert.doesNotMatch(
      serialized,
      /SOURCE_CONTENT_MUST_NOT_LEAK/
    );

    assert.doesNotMatch(
      serialized,
      /SUPER_SECRET/
    );

    assert.doesNotMatch(
      serialized,
      /THIS MUST NEVER BECOME AUTHORITY/
    );
  }
);

test(
  "la troncature du manifeste est déterministe",
  () => {
    const f =
      fixture();

    const manifest =
      buildRepositoryContextManifest(
        {
          repositoryRoot:
            f.root,

          allowedPaths: [
            f.src,
          ],
        },
        {
          maxEntries: 1,
          maxScanned: 100,
        }
      );

    assert.equal(
      manifest.files.length,
      1
    );

    assert.equal(
      manifest.files[0].path,
      "src/a.js"
    );

    assert.equal(
      manifest.truncated,
      true
    );

    assert.ok(
      manifest.excluded
        .entryLimit >= 1
    );
  }
);
