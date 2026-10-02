"use strict";

const crypto = require("node:crypto");
const { TERMINAL_JOB_STATES } = require("./job-registry");

const TRANSIENT_CODES = new Set(["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "RATE_LIMIT", "SERVICE_UNAVAILABLE"]);
const BACKGROUND_PATTERN = /\b(en arrière[- ]plan|plus tard|préviens[- ]moi|quand (?:ce sera|c'est) prêt|recherche approfondie|deep research)\b/i;

function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function safeErrorCode(error) { return String(error?.code || error?.name || "JOB_FAILED").replace(/[^A-Z0-9_-]/gi, "_").slice(0, 80); }
function retryDelay(attempt) { return Math.min(60_000, 1000 * (2 ** Math.max(0, attempt - 1))); }

function createBackgroundJobEngine({
  store, registry, mode = "SHADOW", now = () => Date.now(), workerId = `worker_${process.pid}`,
  observability = null, notify = null, maxQueuedJobs = 500, maxRunningJobs = 2,
  resourceLimits = { LIGHT: 2, MODEL: 1, HEAVY_IO: 1 }, leaseMs = 30_000,
} = {}) {
  if (!store?.create || !registry?.get) throw new TypeError("JobStore et JobRegistry requis.");
  let currentMode = mode;
  let timer = null;
  const running = new Map();
  const notificationKeys = new Set();

  function record(event, metadata = {}) { observability?.(event, { ...metadata, workerId }); }
  function decideExecutionMode({ question = "", explicitBackground = false, requiresRestartResilience = false, estimatedMs = 0, attachmentCount = 0 } = {}) {
    const reason = explicitBackground || BACKGROUND_PATTERN.test(String(question)) ? "USER_DEFERRED" : requiresRestartResilience ? "RESTART_RESILIENCE" : estimatedMs >= 20_000 || attachmentCount > 2 ? "LONG_RUNNING" : "INLINE_FAST_PATH";
    return { mode: reason === "INLINE_FAST_PATH" ? "INLINE" : "BACKGROUND", reason, authoritative: ["LIMITED", "ON"].includes(currentMode), shadow: currentMode === "SHADOW" };
  }
  function validateInput(definition, inputRef) {
    if (!inputRef || typeof inputRef !== "object" || Array.isArray(inputRef)) throw Object.assign(new Error("Référence d'entrée invalide."), { code: "JOB_INPUT_INVALID" });
    const serialized = JSON.stringify(inputRef);
    if (serialized.length > 32_000) throw Object.assign(new Error("Référence d'entrée trop volumineuse."), { code: "JOB_INPUT_TOO_LARGE" });
    if (definition.inputMode === "REFERENCE_ONLY" && Object.keys(inputRef).some((key) => /content|body|secret|token|password|raw/i.test(key))) throw Object.assign(new Error("Le job doit référencer les données sans les dupliquer."), { code: "JOB_RAW_INPUT_FORBIDDEN" });
  }
  function enqueue(request = {}) {
    const definition = registry.get(request.type);
    validateInput(definition, request.inputRef || {});
    if (!["LIMITED", "ON"].includes(currentMode)) return { accepted: false, shadow: currentMode === "SHADOW", reason: `FEATURE_${currentMode}`, decision: decideExecutionMode(request) };
    const queued = Object.entries(store.stats()).filter(([state]) => !TERMINAL_JOB_STATES.includes(state)).reduce((total, [, count]) => total + count, 0);
    if (queued >= maxQueuedJobs) throw Object.assign(new Error("La file de jobs est pleine."), { code: "JOB_QUEUE_PRESSURE" });
    const dependencies = [...new Set(request.dependencies || [])];
    for (const dependencyId of dependencies) {
      if (!store.get(dependencyId)) throw Object.assign(new Error("Dépendance de job inconnue."), { code: "JOB_DEPENDENCY_UNKNOWN" });
      if (request.id && store.hasDependencyPath(dependencyId, request.id)) throw Object.assign(new Error("Cycle de dépendances détecté."), { code: "JOB_DEPENDENCY_CYCLE" });
    }
    const idempotencyKey = request.idempotencyKey || null;
    const dedupeKey = request.dedupeKey || (definition.coalesce ? hash({ type: request.type, inputRef: request.inputRef, workspaceId: request.workspaceId || null }) : null);
    const existing = store.findActiveByIdempotencyKey(idempotencyKey) || store.findActiveByDedupeKey(dedupeKey);
    if (existing) return { accepted: true, deduplicated: true, job: existing };
    const job = store.create({ ...request, handlerVersion: definition.handlerVersion, inputMode: definition.inputMode, priority: request.priority || definition.priority, resourceClass: definition.resourceClass, maxAttempts: request.maxAttempts || definition.maxAttempts, idempotencyKey, dedupeKey, dependencies });
    record("job_enqueued", { jobId: job.id, type: job.type, priority: job.priority, resourceClass: job.resourceClass });
    return { accepted: true, deduplicated: false, job };
  }
  function resourceAvailable(resourceClass) {
    if (running.size >= maxRunningJobs) return false;
    return [...running.values()].filter((entry) => entry.job.resourceClass === resourceClass).length < (resourceLimits[resourceClass] || 1);
  }
  async function notifyOnce(job, state) {
    const definition = registry.get(job.type); if (!definition.userVisible || !notify) return;
    const key = `${job.id}:${state}`; if (notificationKeys.has(key)) return; notificationKeys.add(key);
    try { await notify({ jobId: job.id, type: job.type, state, workspaceId: job.workspace_id || null, sessionId: job.session_id || null }); store.transition(job.id, state, { notificationState: "SENT" }); }
    catch { notificationKeys.delete(key); }
  }
  async function execute(job) {
    const definition = registry.get(job.type);
    const handler = registry.handler(job.type);
    if (!handler) { const blocked = store.transition(job.id, "BLOCKED", { reasonCode: "HANDLER_UNAVAILABLE", completedAt: new Date(now()).toISOString() }); await notifyOnce(blocked, "BLOCKED"); return blocked; }
    const controller = new AbortController(); running.set(job.id, { job, controller });
    const started = now(); let wallTimer = null; let leaseTimer = null;
    try {
      const maxWallMs = Math.max(1000, Math.min(3_600_000, Number(job.budget?.maxWallMs) || 300_000));
      wallTimer = setTimeout(() => controller.abort(Object.assign(new Error("Budget temps dépassé."), { code: "JOB_WALL_BUDGET_EXCEEDED" })), maxWallMs);
      leaseTimer = setInterval(() => store.renewLease(job.id, workerId, leaseMs), Math.max(1000, Math.floor(leaseMs / 3)));
      leaseTimer.unref?.();
      const result = await handler({
        job,
        signal: controller.signal,
        checkpoint: job.checkpoint,

        reportProgress(progress) {
          store.transition(
            job.id,
            "RUNNING",
            { progress }
          );

          const percent =
            Number(progress?.percent);

          if (Number.isFinite(percent)) {
            record("job_progress", {
              jobId: job.id,
              type: job.type,
              percent: Math.max(
                0,
                Math.min(
                  100,
                  Math.round(percent)
                )
              ),
            });
          }
        },

        saveCheckpoint(checkpoint) {
          store.transition(
            job.id,
            "RUNNING",
            { checkpoint }
          );
        },
      });
      const current = store.get(job.id);
      if (current.state === "CANCEL_REQUESTED" || controller.signal.aborted) {
        const cancelled =
          store.transition(
            job.id,
            "CANCELLED",
            {
              reasonCode:
                "USER_CANCELLED",
              completedAt:
                new Date(now()).toISOString(),
            }
          );

        record("job_cancelled", {
          jobId: cancelled.id,
          type: cancelled.type,
          reasonCode:
            "USER_CANCELLED",
        });

        await notifyOnce(
          cancelled,
          "CANCELLED"
        );

        return cancelled;
      }
      if (result?.waiting) {
        const reasonCode =
          String(
            result.reasonCode ||
            "APPROVAL_REQUIRED"
          ).slice(0, 80);

        const waiting =
          store.transition(
            job.id,
            "WAITING",
            {
              reasonCode,
              checkpoint:
                result.checkpoint ||
                job.checkpoint,
            }
          );

        record("job_waiting", {
          jobId: job.id,
          type: job.type,
          reasonCode,
        });

        return waiting;
      }
      const succeeded = store.transition(job.id, "SUCCEEDED", { reasonCode: "COMPLETED", outputRef: result?.outputRef || {}, progress: { percent: 100 }, completedAt: new Date(now()).toISOString() });
      record("job_succeeded", { jobId: job.id, type: job.type, durationMs: now() - started, attempt: job.attempt_count }); await notifyOnce(succeeded, "SUCCEEDED"); return succeeded;
    } catch (error) {
      const current = store.get(job.id); const code = safeErrorCode(error);
      if (current.state === "CANCEL_REQUESTED" || code === "ABORTERROR") {
        const cancelled =
          store.transition(
            job.id,
            "CANCELLED",
            {
              reasonCode:
                "USER_CANCELLED",
              completedAt:
                new Date(now()).toISOString(),
            }
          );

        record("job_cancelled", {
          jobId: cancelled.id,
          type: cancelled.type,
          reasonCode:
            "USER_CANCELLED",
        });

        await notifyOnce(
          cancelled,
          "CANCELLED"
        );

        return cancelled;
      }
      const unknownOutcome = error?.unknownOutcome === true || code === "UNKNOWN_OUTCOME";
      const retryable = definition.retryable && !unknownOutcome && (error?.transient === true || TRANSIENT_CODES.has(code)) && current.attempt_count < current.max_attempts;
      if (retryable) { const scheduledAt = new Date(now() + retryDelay(current.attempt_count)).toISOString(); record("job_retry_scheduled", { jobId: job.id, type: job.type, code, attempt: current.attempt_count }); return store.transition(job.id, "RETRY_SCHEDULED", { reasonCode: code, scheduledAt }); }
      const failedState = unknownOutcome ? "BLOCKED" : "FAILED"; const failed = store.transition(job.id, failedState, { reasonCode: unknownOutcome ? "UNKNOWN_OUTCOME" : code, completedAt: new Date(now()).toISOString() }); record("job_failed", { jobId: job.id, type: job.type, code: failed.reason_code, attempt: failed.attempt_count }); await notifyOnce(failed, failedState); return failed;
    } finally { if (wallTimer) clearTimeout(wallTimer); if (leaseTimer) clearInterval(leaseTimer); running.delete(job.id); }
  }
  async function runOnce() {
    if (!["LIMITED", "ON"].includes(currentMode)) return null;
    store.blockBrokenDependencies();
    for (const resourceClass of ["LIGHT", "MODEL", "HEAVY_IO"]) {
      if (!resourceAvailable(resourceClass)) continue;
      const job = store.claimNext({ workerId, leaseMs, resourceClasses: [resourceClass] });
      if (job) return execute(job);
    }
    return null;
  }
  function recover() {
    const interrupted = store.recoverExpiredLeases();
    for (const job of interrupted) {
      const definition = registry.get(job.type);
      store.transition(job.id, definition.resumable ? "QUEUED" : "BLOCKED", { reasonCode: definition.resumable ? "RECOVERY_RESUME" : "RECOVERY_NOT_RESUMABLE", scheduledAt: new Date(now()).toISOString() });
    }
    if (interrupted.length) record("job_recovery", { count: interrupted.length });
    return interrupted.length;
  }
  function cancel(id, { profileScope = null } = {}) {
    const job = store.get(id); if (!job || (profileScope && job.profile_scope !== profileScope)) return null;
    if (TERMINAL_JOB_STATES.includes(job.state)) return job;
    if (
      [
        "CREATED",
        "QUEUED",
        "RETRY_SCHEDULED",
        "WAITING",
        "INTERRUPTED",
      ].includes(job.state)
    ) {
      const cancelled =
        store.transition(
          id,
          "CANCELLED",
          {
            reasonCode:
              "USER_CANCELLED",
            completedAt:
              new Date(now()).toISOString(),
          }
        );

      record("job_cancelled", {
        jobId: cancelled.id,
        type: cancelled.type,
        reasonCode:
          "USER_CANCELLED",
      });

      return cancelled;
    }
    const updated = store.transition(id, "CANCEL_REQUESTED", { reasonCode: "USER_CANCELLED" }); running.get(id)?.controller.abort(); return updated;
  }
  function start({ intervalMs = 1000 } = {}) { if (timer || !["LIMITED", "ON"].includes(currentMode)) return; recover(); timer = setInterval(() => { void runOnce(); }, Math.max(100, intervalMs)); timer.unref?.(); }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  function setMode(next) { currentMode = next; if (!["LIMITED", "ON"].includes(next)) stop(); }
  return { cancel, decideExecutionMode, enqueue, get: store.get, list: store.list, mode: () => currentMode, recover, runOnce, setMode, start, stats: store.stats, stop };
}

module.exports = { BACKGROUND_PATTERN, TRANSIENT_CODES, createBackgroundJobEngine };
