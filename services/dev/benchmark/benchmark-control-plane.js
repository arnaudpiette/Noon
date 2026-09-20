"use strict";

const WRITE_METHODS = new Set(["arm", "prepare", "runNext", "cancel", "resume", "disarm", "armCodexProbe", "prepareCodexProbe", "runCodexProbe"]);
const { CODEX_PROBE_SUITE_VERSION, SUITE_VERSION, runPlan } = require("../dev-benchmark-service");
function rejectUnknown(input, allowed) {
  for (const key of Object.keys(input || {})) if (!allowed.includes(key)) throw Object.assign(new Error("Champ de contrôle benchmark interdit."), { code: "BENCHMARK_REQUEST_INVALID" });
}
function requireSessionId(sessionId) {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(String(sessionId || ""))) throw Object.assign(new Error("Session benchmark invalide."), { code: "BENCHMARK_SESSION_INVALID" });
  return String(sessionId);
}
function publicArm(arm) {
  if (!arm) return null;
  const { armId, suiteVersion, state, benchmarkSessionId, approvedCapUsd, createdAt, expiresAt, boundAt, completedAt, cancelledAt, failedAt, failureReason, authorizedParticipants } = arm;
  return { armId, suiteVersion, state, benchmarkSessionId, approvedCapUsd, createdAt, expiresAt, boundAt, completedAt, cancelledAt, failedAt, failureReason, authorizedParticipants };
}
function createBenchmarkControlPlane({ runtime, featureMode = () => "OFF" } = {}) {
  if (!runtime?.service || !runtime?.repository) throw new TypeError("Runtime benchmark requis.");
  const enabled = (sessionId) => {
    if (featureMode({ sessionId }) !== "LIMITED") throw Object.assign(new Error("Benchmark désactivé."), { code: "FEATURE_DISABLED" });
  };
  return {
    async execute(action, input = {}) {
      if (!WRITE_METHODS.has(action)) throw Object.assign(new Error("Action benchmark inconnue."), { code: "BENCHMARK_ACTION_INVALID" });
      if (action === "arm") { rejectUnknown(input, []); return publicArm(runtime.armPilot()); }
      if (action === "armCodexProbe") { rejectUnknown(input, []); return publicArm(runtime.armCodexAuthenticityProbe()); }
      if (action === "disarm") { rejectUnknown(input, ["armId"]); return publicArm(runtime.disarmArm(String(input.armId || ""))); }
      if (action === "prepare") {
        rejectUnknown(input, ["armId"]);
        const result = runtime.service.prepare({ armId: String(input.armId || "") });
        return { ...result, arm: publicArm(result.arm) };
      }
      if (action === "prepareCodexProbe") {
        rejectUnknown(input, ["armId"]);
        const arm = runtime.armingRepository.getArm(String(input.armId || ""));
        if (!arm || arm.suiteVersion !== CODEX_PROBE_SUITE_VERSION) throw Object.assign(new Error("Arm probe Codex invalide."), { code: "CODEX_PROBE_ARM_INVALID" });
        const result = runtime.service.prepare({ armId: arm.armId }); return { ...result, arm: publicArm(result.arm) };
      }
      rejectUnknown(input, ["sessionId"]);
      const sessionId = requireSessionId(input.sessionId);
      const session = runtime.repository.getSession?.(sessionId) || null;
      if (action === "runCodexProbe") {
        if (!session || session.suite_version !== CODEX_PROBE_SUITE_VERSION) throw Object.assign(new Error("Session probe Codex invalide."), { code: "CODEX_PROBE_SESSION_INVALID" });
        enabled(sessionId); return runtime.service.runNext(sessionId);
      }
      if (action === "resume" && session?.suite_version === CODEX_PROBE_SUITE_VERSION) throw Object.assign(new Error("Reprise probe Codex interdite."), { code: "CODEX_PROBE_RETRY_DENIED" });
      if (["runNext", "resume"].includes(action)) enabled(sessionId);
      if (action === "runNext") return runtime.service.runNext(sessionId);
      if (action === "cancel") return runtime.service.cancelBenchmark(sessionId);
      return runtime.service.resumeRemainingRuns(sessionId);
    },
    read(kind, sessionId) {
      if (kind === "suite") return { suiteVersion: SUITE_VERSION, plan: runPlan().map((item) => ({ runIndex: item.runIndex, taskId: item.task.taskId, participant: item.participant })) };
      const id = requireSessionId(sessionId);
      if (kind === "status") return runtime.service.status(id);
      if (kind === "results") return { session: runtime.repository.getSession(id), results: runtime.repository.getResults(id), aggregate: runtime.repository.aggregate(id) };
      throw Object.assign(new Error("Lecture benchmark inconnue."), { code: "BENCHMARK_READ_INVALID" });
    },
  };
}
module.exports = { createBenchmarkControlPlane, publicArm, rejectUnknown, requireSessionId };
