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
  "DEV Core Reliability : une annulation après écriture déclenche la compensation avant CANCELLED",
  async () => {
    const root =
      repository({
        "lib/a.js":
          "module.exports = 1;\n",
      });

    const controller =
      new AbortController();

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

    const originalRecord =
      f.journal
        .recordFileOperation;

    f.journal
      .recordFileOperation =
      (
        taskId,
        operation
      ) => {
        const result =
          originalRecord(
            taskId,
            operation
          );

        if (
          operation.path ===
            "lib/a.js" &&
          operation.status ===
            "APPLIED"
        ) {
          controller.abort();
        }

        return result;
      };

    const result =
      await f.run({
        signal:
          controller.signal,
      });

    assert.equal(
      result.finalVerdict,
      "CANCELLED"
    );

    assert.equal(
      result.failureCategory,
      "CANCELLED"
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
  "DEV Core Reliability : un timeout après écriture déclenche la compensation avant TIMEOUT",
  async () => {
    const root =
      repository({
        "lib/a.js":
          "module.exports = 1;\n",
      });

    let clock =
      0;

    const f =
      fixture({
        root,

        now:
          () =>
            clock,

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

    const originalRecord =
      f.journal
        .recordFileOperation;

    f.journal
      .recordFileOperation =
      (
        taskId,
        operation
      ) => {
        const result =
          originalRecord(
            taskId,
            operation
          );

        if (
          operation.path ===
            "lib/a.js" &&
          operation.status ===
            "APPLIED"
        ) {
          clock =
            2_000;
        }

        return result;
      };

    const result =
      await f.run({
        maxDuration:
          1_000,
      });

    assert.equal(
      result.finalVerdict,
      "TIMEOUT"
    );

    assert.equal(
      result.failureCategory,
      "TIMEOUT"
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
