"use strict";

// SelfDev V1 — briques SD-1 (cible, worktree isolé, politique de chemins).
// Non branché au serveur : le câblage (flag selfdev.v1, OFF) arrive en SD-3.

module.exports = {
  ...require("./selfdev-path-policy"),
  ...require("./selfdev-worktree-service"),
  ...require("./selfdev-target-store"),
};
