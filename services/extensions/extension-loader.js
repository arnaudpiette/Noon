"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { isPathInsideRoots } = require("../../lib/path-utils");

function loaderError(code, message) { return Object.assign(new Error(message), { code }); }
function createExtensionLoader({ roots = [], developerMode = false } = {}) {
  const allowedRoots = roots.map((root) => fs.realpathSync(root));
  function resolvePackage(packagePath, entrypoint = "./index.js") {
    if (fs.lstatSync(packagePath).isSymbolicLink()) throw loaderError("EXTENSION_SYMLINK_PACKAGE_DENIED", "Package extension symbolique refusé.");
    const packageReal = fs.realpathSync(packagePath);
    if (!isPathInsideRoots(packageReal, allowedRoots)) throw loaderError("EXTENSION_PATH_OUTSIDE_ROOT", "Package hors des racines autorisées.");
    const entryReal = fs.realpathSync(path.resolve(packageReal, entrypoint));
    if (!isPathInsideRoots(entryReal, [packageReal])) throw loaderError("EXTENSION_ENTRYPOINT_ESCAPE", "Entrypoint hors du package.");
    return entryReal;
  }
  function loadLocal(packagePath, manifest) {
    if (!developerMode) throw loaderError("EXTENSION_DEVELOPER_MODE_REQUIRED", "Mode développeur requis.");
    const entrypoint = resolvePackage(packagePath, manifest.entrypoint);
    return { module: require(entrypoint), entrypoint, provenance: "LOCAL_DEVELOPMENT", signed: false };
  }
  return { resolvePackage, loadLocal, isolation: "IN_PROCESS_TRUSTED", roots: () => [...allowedRoots] };
}
module.exports = { createExtensionLoader };
