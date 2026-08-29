"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PRECEDENCE = Object.freeze(["BUILD", "MACHINE", "USER", "WORKSPACE", "SESSION", "TEST"]);

function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16); }
function emptyLayers() { return Object.fromEntries(PRECEDENCE.map((scope) => [scope, {}])); }

function createRuntimeConfigService({ registry, filePath = null, environment = {}, observability = null, now = () => Date.now() } = {}) {
  if (!registry?.validate) throw new TypeError("ConfigRegistry requis.");
  let state = { schemaVersion: registry.schemaVersion, configVersion: 1, layers: emptyLayers(), flags: {}, killSwitches: {}, updatedAt: new Date(now()).toISOString() };
  let recovery = null;
  const lkgPath = filePath ? `${filePath}.lkg` : null;

  function validateState(candidate) {
    if (!candidate || candidate.schemaVersion !== registry.schemaVersion || !candidate.layers) throw Object.assign(new Error("Configuration incompatible."), { code: "CONFIG_SCHEMA_INVALID" });
    for (const scope of PRECEDENCE) {
      const layer = candidate.layers[scope] || {};
      if (["WORKSPACE", "SESSION"].includes(scope)) {
        for (const scopedValues of Object.values(layer)) for (const [key, value] of Object.entries(scopedValues || {})) registry.validate(key, value, scope);
      } else {
        for (const [key, value] of Object.entries(layer)) registry.validate(key, value, scope);
      }
    }
    return candidate;
  }
  function loadFile(candidatePath) { return validateState(JSON.parse(fs.readFileSync(candidatePath, "utf8"))); }
  if (filePath && fs.existsSync(filePath)) {
    try { state = loadFile(filePath); observability?.("config_loaded", { configVersion: state.configVersion }); }
    catch (error) {
      observability?.("config_validation_failed", { code: error.code || "CONFIG_CORRUPT" });
      if (lkgPath && fs.existsSync(lkgPath)) {
        try { state = loadFile(lkgPath); recovery = "last_known_good"; observability?.("config_recovered", { configVersion: state.configVersion }); }
        catch { recovery = "safe_defaults"; }
      } else recovery = "safe_defaults";
    }
  }
  for (const entry of registry.list()) state.layers.BUILD[entry.key] = entry.defaultValue;
  for (const [key, raw] of Object.entries(environment || {})) {
    if (!registry.has(key) || raw === undefined) continue;
    const definition = registry.get(key);
    const value = definition.type === "integer" ? Number(raw) : definition.type === "boolean" ? raw === "true" : raw;
    if (definition.allowedScopes.includes("MACHINE")) state.layers.MACHINE[key] = registry.validate(key, value, "MACHINE");
  }

  function persist(next) {
    if (!filePath) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, filePath);
    fs.writeFileSync(lkgPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  }
  function set(key, value, { scope = "USER", workspaceId = null, sessionId = null, origin = "developer" } = {}) {
    registry.validate(key, value, scope);
    const bucketKey = scope === "WORKSPACE" ? workspaceId : scope === "SESSION" ? sessionId : null;
    if (["WORKSPACE", "SESSION"].includes(scope) && !bucketKey) throw Object.assign(new Error(`Identifiant requis pour ${scope}`), { code: "CONFIG_SCOPE_ID_REQUIRED" });
    const next = structuredClone(state);
    const layer = bucketKey ? (next.layers[scope][bucketKey] ||= {}) : next.layers[scope];
    if (JSON.stringify(layer[key]) === JSON.stringify(value)) return { changed: false, configVersion: state.configVersion };
    layer[key] = value; next.configVersion += 1; next.updatedAt = new Date(now()).toISOString();
    validateState(next); persist(next); state = next;
    observability?.("config_changed", { key, scope, origin, configVersion: state.configVersion, valueHash: hash(value) });
    return { changed: true, configVersion: state.configVersion };
  }
  function replaceState(candidate, { event = "config_changed", flagId = null, origin = "developer" } = {}) {
    const next = validateState(structuredClone(candidate));
    persist(next);
    state = next;
    observability?.(event, { flagId, origin, configVersion: state.configVersion });
    return { configVersion: state.configVersion };
  }
  function get(key, { workspaceId = null, sessionId = null, test = false } = {}) {
    const definition = registry.get(key);
    let value = definition.defaultValue, source = "BUILD";
    for (const scope of PRECEDENCE) {
      if (scope === "TEST" && !test) continue;
      const layer = scope === "WORKSPACE" ? state.layers.WORKSPACE[workspaceId] : scope === "SESSION" ? state.layers.SESSION[sessionId] : state.layers[scope];
      if (layer && Object.hasOwn(layer, key)) { value = layer[key]; source = scope; }
    }
    return { key, value, defaultValue: definition.defaultValue, source, scope: source, configVersion: state.configVersion, restartRequired: definition.restartRequired };
  }
  function snapshot(context = {}) {
    const effectiveValues = Object.fromEntries(registry.list().filter((entry) => !entry.sensitive).map((entry) => [entry.key, get(entry.key, context).value]));
    return Object.freeze({ snapshotId: `cfg_${hash({ version: state.configVersion, effectiveValues })}`, configVersion: state.configVersion, configSchemaVersion: registry.schemaVersion, effectiveValues: Object.freeze(effectiveValues), createdAt: new Date(now()).toISOString() });
  }
  function getPublicConfig(context = {}) {
    return { configVersion: state.configVersion, configSchemaVersion: registry.schemaVersion, recovery, values: Object.fromEntries(registry.list().filter((entry) => entry.public).map((entry) => [entry.key, get(entry.key, context)])), secrets: Object.fromEntries(registry.list().filter((entry) => entry.sensitive).map((entry) => [entry.key, get(entry.key, context).value ? "configured" : "missing"])) };
  }
  function featureState(flagId) {
    return { configured: structuredClone(state.flags?.[flagId] || {}), killSwitch: state.killSwitches?.[flagId] === true, configVersion: state.configVersion };
  }
  return { featureState, get, getPublicConfig, registry, replaceState, set, snapshot, state: () => structuredClone(state), recovery: () => recovery };
}

module.exports = { PRECEDENCE, createRuntimeConfigService };
