"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createBenchmarkArmingRepository } = require("../../persistence/repositories/benchmark-arming-repository");
const { createBenchmarkRepository } = require("../../persistence/repositories/benchmark-repository");
const { createDevBenchmarkService } = require("../dev-benchmark-service");
const { createBenchmarkArmingService } = require("./benchmark-arming-service");
const { createBenchmarkRuntimeAuthorizationService } = require("./benchmark-runtime-authorization-service");
const { createGlobalBenchmarkValidator } = require("./global-benchmark-validator");
const { createNativeNoonBenchmarkParticipant } = require("./native-noon-benchmark-participant");
const { createCodexBenchmarkParticipant } = require("./codex-benchmark-participant");
const { createBenchmarkFixtureRegistry } = require("./fixture-registry");
const { getHiddenValidator } = require("./hidden-validator-registry");

function materializeBenchmarkWorkspace(template, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(target)) fs.rmSync(path.join(target, entry), { recursive: true, force: true });
  fs.cpSync(template, target, { recursive: true });
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: target, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Noon Benchmark"], { cwd: target, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "benchmark@localhost"], { cwd: target, stdio: "ignore" });
    execFileSync("git", ["add", "--all"], { cwd: target, stdio: "ignore" });
    execFileSync("git", ["commit", "--quiet", "-m", "benchmark fixture baseline"], { cwd: target, stdio: "ignore" });
  } catch (cause) {
    throw Object.assign(new Error("Workspace benchmark Git invalide."), { code: "BENCHMARK_WORKSPACE_INVALID", cause });
  }
  return fs.realpathSync(target);
}

function createBenchmarkRuntime({ database, runtimeConfig, benchmarkWorkspaceRoot, nativeDevCoordinator, devDelegationRunner, featureMode, resolveHiddenValidator = getHiddenValidator, templates = createBenchmarkFixtureRegistry(), observability = null } = {}) {
  const repository = createBenchmarkRepository(database);
  const armingRepository = createBenchmarkArmingRepository(database);
  if (!runtimeConfig?.state || !runtimeConfig?.replaceState) throw new TypeError("RuntimeConfigService requis.");
  const workspaceRoot = path.resolve(String(benchmarkWorkspaceRoot || ""));
  if (!benchmarkWorkspaceRoot) throw new TypeError("Racine workspace benchmark requise.");
  const runtimeStateReader = { read(flagId) { return structuredClone(runtimeConfig.state().flags?.[flagId] || {}); } };
  const armingService = createBenchmarkArmingService({ repository: armingRepository, runtimeStateReader });
  const runtimeAuthorization = createBenchmarkRuntimeAuthorizationService({ runtimeConfig, benchmarkRepository: repository, armingRepository, fixtureRegistry: templates });
  const validator = createGlobalBenchmarkValidator({
    resolveHiddenValidator: resolveHiddenValidator || (() => {
      throw Object.assign(new Error("Validateur benchmark non configuré."), { code: "BENCHMARK_VALIDATOR_UNAVAILABLE" });
    }),
  });
  const participants = {
    NATIVE_NOON: createNativeNoonBenchmarkParticipant({ coordinator: nativeDevCoordinator }),
    CODEX: createCodexBenchmarkParticipant({ runner: devDelegationRunner }),
  };
  function sessionWorkspace(sessionId) {
    const target = path.resolve(workspaceRoot, String(sessionId));
    if (target !== workspaceRoot && !target.startsWith(`${workspaceRoot}${path.sep}`)) throw Object.assign(new Error("Workspace benchmark invalide."), { code: "BENCHMARK_WORKSPACE_INVALID" });
    fs.mkdirSync(target, { recursive: true });
    return target;
  }
  function workspaceFactory(template, { session }) {
    const workspace = sessionWorkspace(session.id);
    materializeBenchmarkWorkspace(template, workspace);
    const peer = fs.mkdtempSync(path.join(workspaceRoot, "peer-"));
    fs.cpSync(template, peer, { recursive: true });
    return { workspace, peer };
  }
  const devService = createDevBenchmarkService({ repository, armingRepository, runtimeAuthorization, participants, validator, templates, featureMode: () => "LIMITED", workspaceFactory, observability });
  const service = {
    ...devService,
    prepare(input) {
      const result = devService.prepare(input);
      runtimeAuthorization.activate({ sessionId: result.session.id, workspacePath: sessionWorkspace(result.session.id), nativeAllowed: result.arm.authorizedParticipants.includes("NATIVE_NOON"), codexAllowed: result.arm.authorizedParticipants.includes("CODEX") });
      return result;
    },
  };
  function disarmArm(armId) {
    const arm = armingRepository.getArm(armId);
    if (arm?.state === "BOUND_TO_SESSION") throw Object.assign(new Error("Utiliser l'annulation de session benchmark."), { code: "BENCHMARK_ARM_BOUND_USE_CANCEL" });
    return armingService.disarm(armId);
  }
  armingService.recoverPersistedArms();
  runtimeAuthorization.recover();
  observability?.("benchmark_service_ready", { databaseKind: database.kind, featureMode: featureMode({}).toString() });
  return {
    repository,
    armingRepository,
    armingService,
    runtimeAuthorization,
    service,
    armPilot: () => armingService.armPilot(),
    armCodexAuthenticityProbe: () => armingService.armCodexAuthenticityProbe(),
    disarmArm,
    status: () => ({ available: true, databaseKind: database.kind, featureMode: featureMode({}), pilotStarted: false }),
  };
}

module.exports = { createBenchmarkRuntime, materializeBenchmarkWorkspace };
