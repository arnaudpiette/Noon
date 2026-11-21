"use strict";

// SelfDev V1 — SD-1 (cible, worktree isolé, politique de chemins), SD-2 (preuves) et
// SD-3 (politique Goal Mode DEV). Routes HTTP : selfdev-http-routes.js (flag selfdev.v1, OFF).

module.exports = {
  ...require("./selfdev-path-policy"),
  ...require("./selfdev-worktree-service"),
  ...require("./selfdev-target-store"),
  ...require("./selfdev-evidence-service"),
  ...require("./selfdev-goal-mode-policy"),
};
