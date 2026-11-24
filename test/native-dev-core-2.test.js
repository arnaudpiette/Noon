"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  fixture,
  repository,
} = require("./helpers/native-dev-core-fixtures");

test(
  "Context Closure V1 lit une dépendance locale directe avant EDIT sans traverser node_modules ou le scope",
  async () => {
    const root =
      repository({
        "src/service.js":
          "const store=require('./store');require('./node_modules/pkg');require('../outside');module.exports=()=>store.value;\n",

        "src/store.js":
          "module.exports={value:1};\n",

        "src/node_modules/pkg.js":
          "module.exports='never-context';\n",

        "outside.js":
          "module.exports='outside';\n",
      });

    let editFiles =
      [];

    const f =
      fixture({
        root,

        allowedPaths: [
          "src",
        ],

        reason: ({
          phase,
          files,
        }) => {
          if (
            phase === "PLAN"
          ) {
            return {
              files: [
                "src/service.js",
              ],

              searchTerms: [],
              operations: [],
            };
          }

          editFiles =
            files.map(
              (item) =>
                item.path
            );

          const service =
            files.find(
              (item) =>
                item.path ===
                "src/service.js"
            );

          return {
            operations: [
              {
                type:
                  "MODIFY",

                path:
                  "src/service.js",

                expectedHash:
                  service.hash,

                search:
                  "store.value;",

                replacement:
                  "store.value + 1;",
              },
            ],
          };
        },
      });

    const result =
      await f.run({
        forbiddenPaths: [
          ".git",
          "node_modules",
        ],
      });

    assert.equal(
      result.finalVerdict,
      "PASS",
      JSON.stringify(result)
    );

    assert.ok(
      editFiles.includes(
        "src/service.js"
      )
    );

    assert.ok(
      editFiles.includes(
        "src/store.js"
      )
    );

    assert.equal(
      editFiles.includes(
        "src/node_modules/pkg.js"
      ),
      false
    );

    assert.equal(
      editFiles.includes(
        "outside.js"
      ),
      false
    );

    assert.deepEqual(
      result.metrics
        .contextEvaluation
        .inspection
        .dependencyReadFiles,
      [
        "src/store.js",
      ]
    );
  }
);

test(
  "Context Closure V1 refuse un EDIT aveugle si aucun code source n'a été lu",
  async () => {
    const {
      CONTEXT_MANIFEST_EXPERIMENT,
    } =
      require(
        "../services/dev/benchmark/context-manifest-experiment"
      );

    const root =
      repository({
        "src/a.js":
          "module.exports=1;\n",
      });

    let reasonerCalls =
      0;

    const f =
      fixture({
        root,

        allowedPaths: [
          "src",
        ],

        reason:
          () => {
            reasonerCalls += 1;

            return {
              files: [],
              searchTerms: [],
              operations: [],
            };
          },
      });

    const result =
      await f.run({
        [CONTEXT_MANIFEST_EXPERIMENT]:
          "OFF",

        sessionId:
          "session-zero-context",

        benchmark: {
          id:
            "session-zero-context",

          limitUsd:
            0.5,
        },

        workspaceAuthorized:
          true,

        workspaceRoots: [
          root,
        ],
      });

    assert.equal(
      result.finalVerdict,
      "FAIL"
    );

    assert.equal(
      result.failureCategory,
      "SOURCE_CONTEXT_REQUIRED"
    );

    assert.equal(
      reasonerCalls,
      1
    );

    assert.equal(
      fs.readFileSync(
        path.join(
          root,
          "src/a.js"
        ),
        "utf8"
      ),
      "module.exports=1;\n"
    );
  }
);

test(
  "DEV Core Reliability : PLAN est discovery-only et ne peut jamais fournir le patch appliqué",
  async () => {
    const root =
      repository({
        "lib/a.js":
          "module.exports = 1;\n",
      });

    const phases = [];

    const f =
      fixture({
        root,

        reason: ({
          phase,
          files,
        }) => {
          phases.push(
            phase
          );

          if (
            phase === "PLAN"
          ) {
            return {
              files: [
                "lib/a.js",
              ],

              searchTerms: [],

              operations: [
                {
                  type:
                    "MODIFY",

                  path:
                    "lib/a.js",

                  expectedHash:
                    null,

                  search:
                    "module.exports = 1;",

                  replacement:
                    "module.exports = 999;",
                },
              ],

              validationCommands:
                [],
            };
          }

          assert.equal(
            phase,
            "EDIT"
          );

          const file =
            files.find(
              (item) =>
                item.path ===
                "lib/a.js"
            );

          assert.ok(
            file
          );

          return {
            operations: [
              {
                type:
                  "MODIFY",

                path:
                  "lib/a.js",

                expectedHash:
                  file.hash,

                search:
                  "module.exports = 1;",

                replacement:
                  "module.exports = 2;",
              },
            ],
          };
        },
      });

    const result =
      await f.run();

    assert.equal(
      result.finalVerdict,
      "PASS",
      JSON.stringify(result)
    );

    assert.deepEqual(
      phases,
      [
        "PLAN",
        "EDIT",
      ]
    );

    assert.equal(
      fs.readFileSync(
        path.join(
          root,
          "lib/a.js"
        ),
        "utf8"
      ),
      "module.exports = 2;\n"
    );

    assert.equal(
      result.metrics
        .contextEvaluation
        .plan
        .ignoredOperationsCount,
      1
    );
  }
);

test(
  "DEV Core Reliability : un scope vide autorise CREATE via EDIT mais jamais un MODIFY aveugle",
  async () => {
    const root =
      repository({});

    const phases = [];

    const f =
      fixture({
        root,

        allowedPaths: [
          "src",
        ],

        reason: ({
          phase,
        }) => {
          phases.push(
            phase
          );

          if (
            phase === "PLAN"
          ) {
            return {
              files: [],
              searchTerms: [],

              // Même si PLAN tente une mutation,
              // elle ne doit jamais être exécutée.
              operations: [
                {
                  type:
                    "MODIFY",

                  path:
                    "src/ghost.js",

                  expectedHash:
                    null,

                  search:
                    "ghost",

                  replacement:
                    "invalid",
                },
              ],

              validationCommands:
                [],
            };
          }

          assert.equal(
            phase,
            "EDIT"
          );

          return {
            operations: [
              {
                type:
                  "CREATE",

                path:
                  "src/App.js",

                expectedHash:
                  null,

                search:
                  null,

                replacement:
                  null,

                content:
                  "module.exports = 'created';\n",
              },
            ],
          };
        },
      });

    const result =
      await f.run({
        objective:
          "Créer src/App.js",
      });

    assert.equal(
      result.finalVerdict,
      "PASS",
      JSON.stringify(result)
    );

    assert.deepEqual(
      phases,
      [
        "PLAN",
        "EDIT",
      ]
    );

    assert.equal(
      fs.readFileSync(
        path.join(
          root,
          "src/App.js"
        ),
        "utf8"
      ),
      "module.exports = 'created';\n"
    );

    assert.equal(
      fs.existsSync(
        path.join(
          root,
          "src/ghost.js"
        )
      ),
      false
    );
  }
);

test(
  "DEV Core Reliability : un scope vide refuse encore MODIFY produit par EDIT",
  async () => {
    const root =
      repository({});

    const f =
      fixture({
        root,

        allowedPaths: [
          "src",
        ],

        reason: ({
          phase,
        }) => {
          if (
            phase === "PLAN"
          ) {
            return {
              files: [],
              searchTerms: [],
              operations: [],
              validationCommands:
                [],
            };
          }

          return {
            operations: [
              {
                type:
                  "MODIFY",

                path:
                  "src/missing.js",

                expectedHash:
                  null,

                search:
                  "x",

                replacement:
                  "y",
              },
            ],
          };
        },
      });

    const result =
      await f.run({
        objective:
          "Modifier src/missing.js",
      });

    assert.equal(
      result.finalVerdict,
      "FAIL"
    );

    assert.equal(
      result.failureCategory,
      "SOURCE_CONTEXT_REQUIRED"
    );

    assert.equal(
      fs.existsSync(
        path.join(
          root,
          "src/missing.js"
        )
      ),
      false
    );
  }
);

test(
  "DEV Core Reliability : Patch Preflight refuse tout le batch avant écriture si une opération ultérieure est invalide",
  async () => {
    const root =
      repository({
        "lib/a.js":
          "module.exports = 1;\n",

        "lib/b.js":
          "module.exports = 10;\n",
      });

    const f =
      fixture({
        root,

        reason: ({
          phase,
          files,
        }) => {
          if (
            phase === "PLAN"
          ) {
            return {
              files: [
                "lib/a.js",
                "lib/b.js",
              ],

              searchTerms: [],
              operations: [],
              validationCommands:
                [],
            };
          }

          const a =
            files.find(
              (item) =>
                item.path ===
                "lib/a.js"
            );

          const b =
            files.find(
              (item) =>
                item.path ===
                "lib/b.js"
            );

          assert.ok(a);
          assert.ok(b);

          return {
            operations: [
              {
                type:
                  "MODIFY",

                path:
                  "lib/a.js",

                expectedHash:
                  a.hash,

                search:
                  "module.exports = 1;",

                replacement:
                  "module.exports = 2;",
              },

              {
                type:
                  "MODIFY",

                path:
                  "lib/b.js",

                expectedHash:
                  b.hash,

                search:
                  "texte inexistant",

                replacement:
                  "module.exports = 20;",
              },
            ],
          };
        },
      });

    const result =
      await f.run();

    assert.equal(
      result.finalVerdict,
      "FAIL"
    );

    assert.equal(
      result.failureCategory,
      "PATCH_PRECONDITION_FAILED"
    );

    assert.equal(
      fs.readFileSync(
        path.join(
          root,
          "lib/a.js"
        ),
        "utf8"
      ),
      "module.exports = 1;\n"
    );

    assert.equal(
      fs.readFileSync(
        path.join(
          root,
          "lib/b.js"
        ),
        "utf8"
      ),
      "module.exports = 10;\n"
    );
  }
);

test(
  "DEV Core Reliability : Patch Preflight refuse deux opérations sur la même cible avant toute écriture",
  async () => {
    const root =
      repository({
        "lib/a.js":
          "module.exports = 1;\n",
      });

    const f =
      fixture({
        root,

        reason: ({
          phase,
          files,
        }) => {
          if (
            phase === "PLAN"
          ) {
            return {
              files: [
                "lib/a.js",
              ],

              searchTerms: [],
              operations: [],
              validationCommands:
                [],
            };
          }

          const file =
            files.find(
              (item) =>
                item.path ===
                "lib/a.js"
            );

          assert.ok(file);

          return {
            operations: [
              {
                type:
                  "MODIFY",

                path:
                  "lib/a.js",

                expectedHash:
                  file.hash,

                search:
                  "module.exports = 1;",

                replacement:
                  "module.exports = 2;",
              },

              {
                type:
                  "MODIFY",

                path:
                  "./lib/a.js",

                expectedHash:
                  file.hash,

                search:
                  "module.exports = 1;",

                replacement:
                  "module.exports = 3;",
              },
            ],
          };
        },
      });

    const result =
      await f.run();

    assert.equal(
      result.finalVerdict,
      "FAIL"
    );

    assert.equal(
      result.failureCategory,
      "DUPLICATE_EDIT_TARGET"
    );

    assert.equal(
      fs.readFileSync(
        path.join(
          root,
          "lib/a.js"
        ),
        "utf8"
      ),
      "module.exports = 1;\n"
    );
  }
);

test(
  "DEV Core Reliability : Patch Compensation restaure les écritures Noon si un futur fichier change pendant le batch",
  async () => {
    const root =
      repository({
        "lib/a.js":
          "module.exports = 1;\n",

        "lib/b.js":
          "module.exports = 10;\n",
      });

    let writeChecks =
      0;

    let injected =
      false;

    const securityPolicy = {
      evaluate({
        actionRequest,
      }) {
        if (
          actionRequest
            ?.actionClass ===
          "WRITE"
        ) {
          writeChecks +=
            1;

          // Deux checks preflight,
          // deux checks pour l'écriture de A,
          // puis l'autorisation initiale de B.
          if (
            writeChecks ===
              5 &&
            !injected
          ) {
            injected =
              true;

            fs.writeFileSync(
              path.join(
                root,
                "lib/b.js"
              ),
              "module.exports = 999;\n"
            );
          }
        }

        return {
          outcome:
            "ALLOW",

          policyVersion:
            "test",
        };
      },
    };

    const f =
      fixture({
        root,
        securityPolicy,

        reason: ({
          phase,
          files,
        }) => {
          if (
            phase === "PLAN"
          ) {
            return {
              files: [
                "lib/a.js",
                "lib/b.js",
              ],

              searchTerms: [],
              operations: [],
              validationCommands:
                [],
            };
          }

          const a =
            files.find(
              (item) =>
                item.path ===
                "lib/a.js"
            );

          const b =
            files.find(
              (item) =>
                item.path ===
                "lib/b.js"
            );

          return {
            operations: [
              {
                type:
                  "MODIFY",

                path:
                  "lib/a.js",

                expectedHash:
                  a.hash,

                search:
                  "module.exports = 1;",

                replacement:
                  "module.exports = 2;",
              },

              {
                type:
                  "MODIFY",

                path:
                  "lib/b.js",

                expectedHash:
                  b.hash,

                search:
                  "module.exports = 10;",

                replacement:
                  "module.exports = 20;",
              },
            ],
          };
        },
      });

    const result =
      await f.run();

    assert.equal(
      result.finalVerdict,
      "FAIL"
    );

    assert.equal(
      result.failureCategory,
      "TRANSACTION_FAILED"
    );

    // A avait été modifié par Noon :
    // il doit revenir à son état initial.
    assert.equal(
      fs.readFileSync(
        path.join(
          root,
          "lib/a.js"
        ),
        "utf8"
      ),
      "module.exports = 1;\n"
    );

    // B a été modifié extérieurement :
    // Noon ne doit jamais l'écraser.
    assert.equal(
      fs.readFileSync(
        path.join(
          root,
          "lib/b.js"
        ),
        "utf8"
      ),
      "module.exports = 999;\n"
    );

    const journal =
      f.journal.load(
        result.taskId
      );

    assert.ok(
      journal.fileOperations.some(
        (item) =>
          item.path ===
            "lib/a.js" &&
          item.status ===
            "ROLLED_BACK"
      )
    );
  }
);

test(
  "DEV Core Reliability : Patch Compensation refuse de rollback un fichier Noon modifié ensuite par une source externe",
  async () => {
    const root =
      repository({
        "lib/a.js":
          "module.exports = 1;\n",

        "lib/b.js":
          "module.exports = 10;\n",
      });

    let writeChecks =
      0;

    let injected =
      false;

    const securityPolicy = {
      evaluate({
        actionRequest,
      }) {
        if (
          actionRequest
            ?.actionClass ===
          "WRITE"
        ) {
          writeChecks +=
            1;

          if (
            writeChecks ===
              5 &&
            !injected
          ) {
            injected =
              true;

            // A a déjà été écrit par Noon.
            // Une source externe le change ensuite.
            fs.writeFileSync(
              path.join(
                root,
                "lib/a.js"
              ),
              "module.exports = 777;\n"
            );

            // B change aussi afin de faire
            // échouer le reste du batch.
            fs.writeFileSync(
              path.join(
                root,
                "lib/b.js"
              ),
              "module.exports = 999;\n"
            );
          }
        }

        return {
          outcome:
            "ALLOW",

          policyVersion:
            "test",
        };
      },
    };

    const f =
      fixture({
        root,
        securityPolicy,

        reason: ({
          phase,
          files,
        }) => {
          if (
            phase === "PLAN"
          ) {
            return {
              files: [
                "lib/a.js",
                "lib/b.js",
              ],

              searchTerms: [],
              operations: [],
              validationCommands:
                [],
            };
          }

          const a =
            files.find(
              (item) =>
                item.path ===
                "lib/a.js"
            );

          const b =
            files.find(
              (item) =>
                item.path ===
                "lib/b.js"
            );

          return {
            operations: [
              {
                type:
                  "MODIFY",

                path:
                  "lib/a.js",

                expectedHash:
                  a.hash,

                search:
                  "module.exports = 1;",

                replacement:
                  "module.exports = 2;",
              },

              {
                type:
                  "MODIFY",

                path:
                  "lib/b.js",

                expectedHash:
                  b.hash,

                search:
                  "module.exports = 10;",

                replacement:
                  "module.exports = 20;",
              },
            ],
          };
        },
      });

    const result =
      await f.run();

    assert.equal(
      result.finalVerdict,
      "FAIL"
    );

    assert.equal(
      result.failureCategory,
      "PATCH_ROLLBACK_INCOMPLETE"
    );

    // Noon refuse de remplacer le travail
    // externe par son ancienne préimage.
    assert.equal(
      fs.readFileSync(
        path.join(
          root,
          "lib/a.js"
        ),
        "utf8"
      ),
      "module.exports = 777;\n"
    );

    assert.equal(
      fs.readFileSync(
        path.join(
          root,
          "lib/b.js"
        ),
        "utf8"
      ),
      "module.exports = 999;\n"
    );
  }
);
