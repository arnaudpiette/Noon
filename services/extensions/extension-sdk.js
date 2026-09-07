"use strict";

const { validateManifest } = require("./extension-manifest-schema");

function defineSkill(definition, handler) {
  if (!definition || typeof handler !== "function") throw new TypeError("Skill d’extension invalide.");
  return Object.freeze({ definition: Object.freeze({ ...definition }), handler });
}
function defineExtension({ manifest, activate, healthCheck = null, deactivate = null, migrate = null } = {}) {
  validateManifest(manifest);
  if (typeof activate !== "function") throw new TypeError("activate est obligatoire.");
  return Object.freeze({ manifest: Object.freeze({ ...manifest }), activate, healthCheck, deactivate, migrate });
}
const defineConnector = defineSkill;
const defineContextAdapter = defineSkill;
const defineArtifactRenderer = defineSkill;
module.exports = { defineArtifactRenderer, defineConnector, defineContextAdapter, defineExtension, defineSkill };
