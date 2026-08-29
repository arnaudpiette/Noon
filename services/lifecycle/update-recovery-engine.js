"use strict";

const crypto = require("node:crypto");

const MAINTENANCE_STATES = Object.freeze(["NORMAL", "MAINTENANCE_PREPARING", "MAINTENANCE_READ_ONLY", "MIGRATING", "RECOVERING"]);

function createUpdateRecoveryEngine({ appVersion, migrationManager, backupService, journal, runtimeConfig, featureFlags, reliability = null, activeExecutions = () => [], diskSpace = () => Infinity, secureStorageAvailable = () => true, validation = async () => ({ valid: true }), criticalEvaluation = async () => ({ releaseGate: "PASS" }), observability = null, now = () => Date.now() } = {}) {
  let maintenanceState = "NORMAL";
  const maintenance = { get: () => maintenanceState, set: (state) => { if (!MAINTENANCE_STATES.includes(state)) throw new TypeError("Mode maintenance invalide."); maintenanceState = state; return state; }, mutationsAllowed: () => maintenanceState === "NORMAL" };
  function preflight(plan) {
    observability?.("update_preflight_started", { fromSchema: plan.currentSchemaVersion, toSchema: plan.targetSchemaVersion });
    const checks = {
      schemaCompatible: plan.compatible === true,
      diskSpaceSufficient: diskSpace() > 1_048_576,
      backupWritable: true,
      secureStorageAccessible: secureStorageAvailable() === true,
      noCriticalExecution: activeExecutions().length === 0,
      noMigrationActive: !journal.incomplete(),
      configValid: runtimeConfig?.recovery?.() !== "safe_defaults",
      coreReliable: reliability?.report ? reliability.report().readiness !== "NOT_READY" : true,
    };
    const ok = Object.values(checks).every(Boolean);
    if (!ok) observability?.("update_preflight_failed", { failedChecks: Object.entries(checks).filter(([, value]) => !value).map(([key]) => key) });
    return { ok, checks, versions: { appVersion, schemaVersion: plan.currentSchemaVersion, configVersion: runtimeConfig?.state?.().configVersion || null, featureFlagVersion: featureFlags?.snapshot?.().featureFlagVersion || null } };
  }
  function plan(options = {}) { const migrationPlan = migrationManager.plan(options); return { ...migrationPlan, fromVersion: appVersion, toVersion: options.toAppVersion || appVersion, rollbackStrategy: migrationPlan.rollbackSafe ? "FEATURE_OR_CODE_ROLLBACK" : "VALIDATED_BACKUP_RESTORE" }; }
  async function run(options = {}) {
    const updatePlan = plan(options); const precheck = preflight(updatePlan);
    if (!precheck.ok) throw Object.assign(new Error("Préflight update refusé."), { code: "UPDATE_PREFLIGHT_FAILED", checks: precheck.checks });
    const updateId = `update-${crypto.randomUUID()}`;
    journal.begin({ updateId, fromAppVersion: updatePlan.fromVersion, toAppVersion: updatePlan.toVersion, fromSchemaVersion: updatePlan.currentSchemaVersion, targetSchemaVersion: updatePlan.targetSchemaVersion, configVersion: precheck.versions.configVersion, featureFlagVersion: precheck.versions.featureFlagVersion });
    maintenance.set("MAINTENANCE_PREPARING"); let backup = null;
    try {
      if (updatePlan.backupRequired) { journal.transition(updateId, "BACKING_UP"); backup = await backupService.create({ reason: "PRE_MIGRATION", availableBytes: diskSpace() }); }
      journal.transition(updateId, "MIGRATING", { backupId: backup?.backupId || null }); maintenance.set("MIGRATING");
      const migration = await migrationManager.execute(updatePlan, options.context || {});
      journal.transition(updateId, "VALIDATING", { migrationIds: migration.applied }); maintenance.set("MAINTENANCE_READ_ONLY");
      const validated = await validation({ updatePlan, migration, backup }); if (!validated?.valid) throw Object.assign(new Error("Validation post-migration échouée."), { code: "UPDATE_VALIDATION_FAILED" });
      const evaluation = await criticalEvaluation(); if (evaluation.releaseGate !== "PASS") throw Object.assign(new Error("Évaluations critiques échouées."), { code: "CRITICAL_EVAL_FAILED" });
      journal.transition(updateId, "ACTIVATING"); journal.transition(updateId, "SUCCEEDED");
      const lastKnownGood = journal.markLastKnownGood({ appVersion: updatePlan.toVersion, schemaVersion: migration.schemaVersion, configVersion: precheck.versions.configVersion, backupId: backup?.backupId || null, criticalEvalResult: "PASS" });
      maintenance.set("NORMAL"); observability?.("last_known_good_marked", { updateId, schemaVersion: migration.schemaVersion });
      return { updateId, state: "SUCCEEDED", backupId: backup?.backupId || null, migration, lastKnownGood };
    } catch (error) { journal.transition(updateId, "FAILED", { failure: { code: error.code || error.name } }); maintenance.set("MAINTENANCE_READ_ONLY"); throw error; }
  }
  function startupDiagnostic() { const incomplete = journal.incomplete(); return { appVersion, schemaVersion: migrationManager.plan().currentSchemaVersion, configVersion: runtimeConfig?.state?.().configVersion || null, migrationState: incomplete?.state || "CLEAN", backupState: backupService.list().length ? "AVAILABLE" : "NONE", lastKnownGood: journal.load().lastKnownGood, recoveryRequired: Boolean(incomplete), maintenanceState: maintenance.get(), warnings: incomplete ? ["UPDATE_INCOMPLETE"] : [] }; }
  return { maintenance, plan, preflight, run, startupDiagnostic };
}

module.exports = { MAINTENANCE_STATES, createUpdateRecoveryEngine };
