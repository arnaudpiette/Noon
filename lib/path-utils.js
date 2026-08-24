"use strict";

const path = require("path");

function isPathInsideRoots(targetPath, roots) {
  const resolvedTarget = path.resolve(targetPath);
  return roots.some((root) => {
    const resolvedRoot = path.resolve(root);
    return resolvedTarget === resolvedRoot ||
      resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
  });
}

module.exports = { isPathInsideRoots };
