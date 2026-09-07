"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createConfigRegistry } = require("../services/config/config-registry");
const { createRuntimeConfigService } = require("../services/config/runtime-config-service");
const { createFeatureFlagRegistry } = require("../services/config/feature-flag-registry");
const { cohort, createFeatureFlagService } = require("../services/config/feature-flag-service");
const { createShadowComparator } = require("../services/config/shadow-comparator");
const { createFeatureRolloutService } = require("../services/config/feature-rollout-service");

function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-config-test-"));
  const registry = createConfigRegistry();
  const runtimeConfig = createRuntimeConfigService({ registry, filePath: path.join(directory, "runtime.json"), ...options });
  const flagRegistry = createFeatureFlagRegistry();
  const featureFlags = createFeatureFlagService({ registry: flagRegistry, runtimeConfig, promotionGate: () => ({ allowed: true }) });
  return { directory, registry, runtimeConfig, flagRegistry, featureFlags };
}

test("applique defaults, user, workspace et session selon la précédence sans fuite", () => {
  const { runtimeConfig } = fixture();
  assert.equal(runtimeConfig.get("search.maxResults").value, 10);
  runtimeConfig.set("search.maxResults", 12, { scope: "USER" });
  runtimeConfig.set("search.maxResults", 20, { scope: "WORKSPACE", workspaceId: "workspace-a" });
  runtimeConfig.set("search.maxResults", 25, { scope: "SESSION", sessionId: "session-a" });
  assert.equal(runtimeConfig.get("search.maxResults", { workspaceId: "workspace-a", sessionId: "session-a" }).value, 25);
  assert.equal(runtimeConfig.get("search.maxResults", { workspaceId: "workspace-b" }).value, 12);
  assert.equal(runtimeConfig.get("search.maxResults", { workspaceId: "workspace-a" }).source, "WORKSPACE");
});

test("refuse clé inconnue, mauvais type, valeur hors limites et scope interdit", () => {
  const { runtimeConfig } = fixture();
  assert.throws(() => runtimeConfig.set("unknown", 1), /inconnue/);
  assert.throws(() => runtimeConfig.set("search.maxResults", "12"), /limites/);
  assert.throws(() => runtimeConfig.set("search.maxResults", 200), /limites/);
  assert.throws(() => runtimeConfig.set("openai.connectionRef", "ref", { scope: "USER" }), /interdit/);
});

test("la vue publique masque les secrets et le snapshot reste stable", () => {
  const { runtimeConfig } = fixture();
  const before = runtimeConfig.snapshot();
  runtimeConfig.set("search.maxResults", 18, { scope: "USER" });
  const after = runtimeConfig.snapshot();
  assert.equal(runtimeConfig.getPublicConfig().secrets["openai.connectionRef"], "configured");
  assert.equal(Object.hasOwn(runtimeConfig.getPublicConfig().values, "openai.connectionRef"), false);
  assert.equal(before.effectiveValues["search.maxResults"], 10);
  assert.equal(after.effectiveValues["search.maxResults"], 18);
  assert.notEqual(before.snapshotId, after.snapshotId);
});

test("restaure la dernière configuration valide après corruption", () => {
  const { directory, runtimeConfig } = fixture();
  runtimeConfig.set("search.maxResults", 14, { scope: "USER" });
  const filePath = path.join(directory, "runtime.json");
  fs.writeFileSync(filePath, "{broken");
  const recovered = createRuntimeConfigService({ registry: createConfigRegistry(), filePath });
  assert.equal(recovered.recovery(), "last_known_good");
  assert.equal(recovered.get("search.maxResults").value, 14);
});

test("restaure la configuration persistée après redémarrage", () => {
  const { directory, runtimeConfig } = fixture();
  runtimeConfig.set("routing.profileDefault", "maximum", { scope: "USER" });
  const restarted = createRuntimeConfigService({ registry: createConfigRegistry(), filePath: path.join(directory, "runtime.json") });
  assert.equal(restarted.get("routing.profileDefault").value, "maximum");
  assert.equal(restarted.get("routing.profileDefault").restartRequired, "SESSION");
});

test("OFF, SHADOW, LIMITED, ON et kill switch sont déterministes", () => {
  const { featureFlags } = fixture();
  assert.equal(featureFlags.evaluate("router.policy.v2").mode, "ON");
  featureFlags.update("router.policy.v2", { mode: "SHADOW" });
  assert.equal(featureFlags.evaluate("router.policy.v2").shadow, true);
  featureFlags.update("router.policy.v2", { mode: "LIMITED", allowWorkspaces: ["workspace-a"] });
  assert.equal(featureFlags.evaluate("router.policy.v2", { workspaceId: "workspace-a" }).enabled, true);
  assert.equal(featureFlags.evaluate("router.policy.v2", { workspaceId: "workspace-b" }).mode, "OFF");
  assert.equal(cohort("router.policy.v2", "workspace-a"), cohort("router.policy.v2", "workspace-a"));
  featureFlags.update("router.policy.v2", { mode: "ON" });
  assert.equal(featureFlags.kill("router.policy.v2").mode, "OFF");
});

test("une promotion échoue lorsque le gate critique est rouge", () => {
  const { runtimeConfig, flagRegistry } = fixture();
  const flags = createFeatureFlagService({ registry: flagRegistry, runtimeConfig, promotionGate: () => ({ allowed: false }) });
  flags.update("search.unified", { mode: "OFF" });
  assert.throws(() => flags.update("search.unified", { mode: "SHADOW" }), /Promotion refusée/);
});

test("applique dépendances et incompatibilités sans permettre de security toggle", () => {
  const definitions = [
    { flagId: "base", description: "base", owner: "test", defaultMode: "OFF", allowedModes: ["OFF", "SHADOW", "LIMITED", "ON"], scopes: ["GLOBAL"], lifecycle: "EXPERIMENTAL", requires: [], incompatibleWith: [], rollbackSafe: true, killSwitchAllowed: true },
    { flagId: "dependent", description: "dependent", owner: "test", defaultMode: "ON", allowedModes: ["OFF", "SHADOW", "LIMITED", "ON"], scopes: ["GLOBAL"], lifecycle: "ROLLOUT", requires: ["base"], incompatibleWith: [], rollbackSafe: true, killSwitchAllowed: true },
    { flagId: "exclusive", description: "exclusive", owner: "test", defaultMode: "OFF", allowedModes: ["OFF", "SHADOW", "LIMITED", "ON"], scopes: ["GLOBAL"], lifecycle: "EXPERIMENTAL", requires: [], incompatibleWith: ["base"], rollbackSafe: true, killSwitchAllowed: true },
  ];
  const { runtimeConfig } = fixture();
  const registry = createFeatureFlagRegistry(definitions);
  const flags = createFeatureFlagService({ registry, runtimeConfig, promotionGate: () => ({ allowed: true }) });
  assert.match(flags.evaluate("dependent").reason, /dependency/);
  flags.update("base", { mode: "ON" });
  assert.equal(flags.evaluate("dependent").enabled, true);
  assert.throws(() => flags.update("exclusive", { mode: "ON" }), /incompatible/);
  assert.throws(() => flags.update("security.disable-hard-rules", { mode: "ON" }), /inconnu/);
});

test("le shadow d'une mutation conserve exactement un side effect", async () => {
  const { featureFlags } = fixture();
  featureFlags.update("search.unified", { mode: "SHADOW" });
  let effects = 0;
  const rollout = createFeatureRolloutService({ featureFlags, comparator: createShadowComparator() });
  const outcome = await rollout.run({ flagId: "search.unified", shadowSafe: true, legacy: async () => { effects += 1; return { id: "legacy" }; }, modern: async ({ authority }) => { if (authority) effects += 1; return { id: "modern" }; } });
  assert.equal(effects, 1);
  assert.equal(outcome.activePath, "legacy");
  assert.equal(outcome.result.id, "legacy");
});

test("un shadow non déclaré sûr est ignoré et un mismatch sécurité permissif est critique", async () => {
  const { featureFlags } = fixture();
  featureFlags.update("intent.engine.v2", { mode: "SHADOW" });
  let shadowCalls = 0;
  const comparator = createShadowComparator();
  const rollout = createFeatureRolloutService({ featureFlags, comparator });
  await rollout.run({ flagId: "intent.engine.v2", legacy: async () => ({ intent: "ASK" }), modern: async () => { shadowCalls += 1; return {}; } });
  assert.equal(shadowCalls, 0);
  assert.equal(comparator.compare({ flagId: "security", legacyResult: { outcome: "REQUIRE_APPROVAL" }, shadowResult: { outcome: "ALLOW" }, security: true }).status, "CRITICAL_MISMATCH");
});

test("les diagnostics n'exposent ni workspace brut ni valeur sensible", () => {
  const events = [];
  const { registry, runtimeConfig } = fixture({ observability: (event, metadata) => events.push({ event, metadata }) });
  const flags = createFeatureFlagService({ registry: createFeatureFlagRegistry(), runtimeConfig, observability: (event, metadata) => events.push({ event, metadata }) });
  flags.evaluate("search.unified", { workspaceId: "workspace-secret-name" });
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes("workspace-secret-name"), false);
  assert.equal(serialized.includes(registry.get("openai.connectionRef").defaultValue), false);
});

test("signale la dette des flags arrivés à échéance", () => {
  const { featureFlags } = fixture({ now: () => Date.parse("2026-12-01T00:00:00Z") });
  const debt = featureFlags.debt(new Date("2026-12-01T00:00:00Z"));
  assert.ok(debt.some((item) => item.flagId === "router.policy.v2" && item.readyForCleanup));
});

test("la délégation démarre en shadow avec des limites prudentes", () => {
  const { registry, featureFlags, runtimeConfig } = fixture();
  assert.equal(featureFlags.evaluate("delegation.engine").mode, "SHADOW");
  assert.equal(runtimeConfig.get("delegation.maxSubtasks").value, 3);
  assert.equal(runtimeConfig.get("delegation.maxParallel").value, 2);
  assert.equal(registry.get("delegation.maxWallTimeMs").max, 120000);
});

test("le moteur de jobs démarre en shadow avec une backpressure configurée", () => {
  const { registry, featureFlags, runtimeConfig } = fixture();
  assert.equal(featureFlags.evaluate("jobs.engine").mode, "SHADOW");
  assert.equal(runtimeConfig.get("jobs.maxQueued").value, 500);
  assert.equal(runtimeConfig.get("jobs.maxRunning").value, 2);
  assert.equal(registry.get("jobs.leaseMs").restartRequired, "APP_RESTART");
});

test("le portfolio démarre read-only par rollout progressif", () => {
  const { flagRegistry, featureFlags, runtimeConfig } = fixture();
  assert.equal(flagRegistry.get("portfolio.engine").defaultMode, "LIMITED");
  assert.equal(flagRegistry.get("portfolio.capacity").defaultMode, "LIMITED");
  assert.equal(flagRegistry.get("portfolio.overload").defaultMode, "SHADOW");
  assert.equal(flagRegistry.get("portfolio.scenarios").defaultMode, "OFF");
  // Sans identité de cohorte ni dépendances activées, le runtime échoue fermé.
  assert.equal(featureFlags.evaluate("portfolio.engine").mode, "OFF");
  assert.equal(featureFlags.evaluate("portfolio.scenarios").mode, "OFF");
  assert.equal(runtimeConfig.get("portfolio.capacityCacheTtlMs").value, 60000);
  assert.equal(runtimeConfig.get("portfolio.tightUtilizationRatio").value, 85);
});

test("le SDK extensions internes est actif mais les extensions externes restent coupées", () => {
  const { flagRegistry, featureFlags, runtimeConfig } = fixture();
  assert.equal(featureFlags.evaluate("extensions.sdk").mode, "ON");
  assert.equal(featureFlags.evaluate("extensions.external").mode, "OFF");
  assert.equal(runtimeConfig.get("extensions.developerMode").value, false);
  assert.equal(runtimeConfig.get("extensions.storageQuotaBytes").value, 1048576);
  assert.equal(flagRegistry.get("extensions.external").requires.includes("extensions.sdk"), true);
});
