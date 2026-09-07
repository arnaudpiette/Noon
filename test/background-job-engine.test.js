"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createPersonalDatabase } = require("../services/persistence/database");
const { createJobRegistry } = require("../services/jobs/job-registry");
const { createJobStore } = require("../services/jobs/job-store");
const { createBackgroundJobEngine } = require("../services/jobs/background-job-engine");
const { createJobScheduler, localParts, nextLocalOccurrence } = require("../services/jobs/job-scheduler");

function fixture({ mode = "ON", now = Date.now, notify = null, observability = null, maxQueuedJobs = 50 } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-jobs-test-"));
  const database = createPersonalDatabase(path.join(directory, "jobs.sqlite"));
  const registry = createJobRegistry();
  const store = createJobStore(database, { now });
  const engine = createBackgroundJobEngine({ store, registry, mode, now, notify, observability, maxQueuedJobs, leaseMs: 1000 });
  return { database, directory, engine, registry, store };
}

test("SHADOW décide sans créer de job et ON distingue inline/background", () => {
  const { database, engine } = fixture({ mode: "SHADOW" });
  assert.equal(engine.decideExecutionMode({ question: "bonjour" }).mode, "INLINE");
  assert.equal(engine.decideExecutionMode({ question: "Fais une recherche approfondie et préviens-moi" }).mode, "BACKGROUND");
  const result = engine.enqueue({ type: "PUBLIC_RESEARCH", inputRef: { query: "actualité publique" } });
  assert.deepEqual({ accepted: result.accepted, shadow: result.shadow }, { accepted: false, shadow: true });
  assert.deepEqual(engine.stats(), {});
  database.close();
});

test("persiste, réclame atomiquement et restaure un job après redémarrage", async () => {
  let clock = Date.parse("2026-08-30T08:00:00Z");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-jobs-restart-"));
  let database = createPersonalDatabase(path.join(directory, "jobs.sqlite"));
  let registry = createJobRegistry();
  let store = createJobStore(database, { now: () => clock });
  const created = createBackgroundJobEngine({ store, registry, mode: "ON", now: () => clock }).enqueue({ type: "MAINTENANCE", inputRef: { taskRef: "maintenance:one" } }).job;
  const claimed = store.claimNext({ workerId: "crashed-worker", leaseMs: 1000 });
  assert.equal(claimed.state, "RUNNING");
  assert.equal(store.claimNext({ workerId: "second-worker" }), null);
  database.close();

  clock += 2000;
  database = createPersonalDatabase(path.join(directory, "jobs.sqlite"));
  registry = createJobRegistry();
  store = createJobStore(database, { now: () => clock });
  registry.registerHandler("MAINTENANCE", async () => ({ outputRef: { reportId: "report:one" } }));
  const restarted = createBackgroundJobEngine({ store, registry, mode: "ON", now: () => clock });
  assert.equal(restarted.recover(), 1);
  await restarted.runOnce();
  assert.equal(store.get(created.id).state, "SUCCEEDED");
  assert.equal(store.get(created.id).outputRef.reportId, "report:one");
  database.close();
});

test("déduplique les requêtes actives et respecte les dépendances", async () => {
  const { database, engine, registry, store } = fixture();
  const first = engine.enqueue({ type: "MAINTENANCE", inputRef: { taskRef: "same" }, idempotencyKey: "idem:one" });
  const duplicate = engine.enqueue({ type: "MAINTENANCE", inputRef: { taskRef: "other" }, idempotencyKey: "idem:one" });
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.job.id, first.job.id);
  const dependent = engine.enqueue({ type: "CONVERSATION_COMPACTION", inputRef: { conversationRef: "conv:one" }, dependencies: [first.job.id] }).job;
  registry.registerHandler("MAINTENANCE", async () => ({ outputRef: { ok: true } }));
  registry.registerHandler("CONVERSATION_COMPACTION", async () => ({ outputRef: { summaryRef: "summary:one" } }));
  const claimedBefore = store.claimNext({ workerId: "manual", resourceClasses: ["LIGHT"] });
  assert.equal(claimedBefore.id, first.job.id);
  store.transition(first.job.id, "SUCCEEDED", { outputRef: { ok: true } });
  const claimedAfter = store.claimNext({ workerId: "manual-2", resourceClasses: ["LIGHT"] });
  assert.equal(claimedAfter.id, dependent.id);
  database.close();
});

test("propage l'échec d'une dépendance sans exécuter son enfant", async () => {
  const { database, engine, registry, store } = fixture();
  let childExecutions = 0;
  registry.registerHandler("MAINTENANCE", async () => { throw Object.assign(new Error("permanent"), { code: "PERMANENT" }); });
  registry.registerHandler("CONVERSATION_COMPACTION", async () => { childExecutions += 1; return {}; });
  const parent = engine.enqueue({ type: "MAINTENANCE", inputRef: { taskRef: "parent" } }).job;
  const child = engine.enqueue({ type: "CONVERSATION_COMPACTION", inputRef: { conversationRef: "child" }, dependencies: [parent.id] }).job;
  await engine.runOnce(); await engine.runOnce();
  assert.equal(store.get(parent.id).state, "FAILED");
  assert.equal(store.get(child.id).state, "BLOCKED");
  assert.equal(childExecutions, 0);
  database.close();
});

test("checkpoint, attente, annulation avant démarrage et annulation en cours sont sûrs", async () => {
  const { database, engine, registry, store } = fixture();
  const queued = engine.enqueue({ type: "MAINTENANCE", inputRef: { taskRef: "cancel-before" } }).job;
  assert.equal(engine.cancel(queued.id).state, "CANCELLED");
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  registry.registerHandler("WORKSPACE_ANALYSIS", async ({ signal, saveCheckpoint }) => {
    saveCheckpoint({ cursorRef: "cursor:one" }); entered();
    await new Promise((resolve, reject) => { signal.addEventListener("abort", () => reject(Object.assign(new Error("stopped"), { name: "AbortError" })), { once: true }); });
  });
  const running = engine.enqueue({ type: "WORKSPACE_ANALYSIS", inputRef: { workspaceRef: "workspace:one" }, workspaceId: "workspace-one" }).job;
  const execution = engine.runOnce(); await enteredPromise;
  assert.equal(store.get(running.id).checkpoint.cursorRef, "cursor:one");
  assert.equal(engine.cancel(running.id).state, "CANCEL_REQUESTED");
  await execution;
  assert.equal(store.get(running.id).state, "CANCELLED");
  database.close();
});

test("retry borné pour erreur transitoire et blocage sans retry en résultat incertain", async () => {
  let clock = Date.parse("2026-08-30T08:00:00Z");
  const { database, engine, registry, store } = fixture({ now: () => clock });
  let attempts = 0;
  registry.registerHandler("PUBLIC_RESEARCH", async () => { attempts += 1; if (attempts === 1) throw Object.assign(new Error("temporary"), { code: "ETIMEDOUT" }); return { outputRef: { evidencePackId: "ep:one" } }; });
  const retry = engine.enqueue({ type: "PUBLIC_RESEARCH", inputRef: { query: "information publique" } }).job;
  await engine.runOnce();
  assert.equal(store.get(retry.id).state, "RETRY_SCHEDULED");
  clock += 2000; await engine.runOnce();
  assert.equal(store.get(retry.id).state, "SUCCEEDED");
  registry.registerHandler("MULTIMODAL_ANALYSIS", async () => { throw Object.assign(new Error("unknown"), { code: "UNKNOWN_OUTCOME", unknownOutcome: true }); });
  const uncertain = engine.enqueue({ type: "MULTIMODAL_ANALYSIS", inputRef: { attachmentRef: "attachment:one" } }).job;
  await engine.runOnce();
  assert.equal(store.get(uncertain.id).state, "BLOCKED");
  assert.equal(store.get(uncertain.id).attempt_count, 1);
  database.close();
});

test("refuse les payloads bruts, protège les scopes et ne journalise pas les entrées", async () => {
  const events = [];
  const { database, engine, registry, store } = fixture({ observability: (event, metadata) => events.push({ event, metadata }) });
  assert.throws(() => engine.enqueue({ type: "MAINTENANCE", inputRef: { rawContent: "secret-personal-value" } }), /référencer/);
  registry.registerHandler("MAINTENANCE", async () => ({ outputRef: { reportRef: "safe:one" } }));
  const job = engine.enqueue({ type: "MAINTENANCE", profileScope: "alexandra", inputRef: { taskRef: "private:one" } }).job;
  assert.equal(engine.cancel(job.id, { profileScope: "arnaud" }), null);
  await engine.runOnce();
  assert.equal(JSON.stringify(events).includes("private:one"), false);
  assert.equal(store.list({ profileScope: "arnaud" }).length, 0);
  assert.equal(store.list({ profileScope: "alexandra" }).length, 1);
  database.close();
});

test("notifie exactement une fois les jobs visibles et garde la maintenance silencieuse", async () => {
  const notifications = [];
  const { database, engine, registry } = fixture({ notify: async (event) => notifications.push(event) });
  registry.registerHandler("PUBLIC_RESEARCH", async () => ({ outputRef: { evidencePackId: "ep:one" } }));
  registry.registerHandler("MAINTENANCE", async () => ({ outputRef: { reportRef: "report:one" } }));
  engine.enqueue({ type: "PUBLIC_RESEARCH", inputRef: { query: "public" } });
  engine.enqueue({ type: "MAINTENANCE", inputRef: { taskRef: "clean" } });
  await engine.runOnce(); await engine.runOnce();
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].state, "SUCCEEDED");
  database.close();
});

test("applique backpressure avant saturation de la file", () => {
  const { database, engine } = fixture({ maxQueuedJobs: 1 });
  engine.enqueue({ type: "WORKSPACE_ANALYSIS", inputRef: { workspaceRef: "one" }, workspaceId: "one" });
  assert.throws(() => engine.enqueue({ type: "WORKSPACE_ANALYSIS", inputRef: { workspaceRef: "two" }, workspaceId: "two" }), /pleine/);
  database.close();
});

test("planifie en Europe/Paris sans double exécution pendant les changements DST", () => {
  const spring = nextLocalOccurrence({ after: new Date("2026-03-28T23:00:00Z"), hour: 7, timeZone: "Europe/Paris" });
  const autumn = nextLocalOccurrence({ after: new Date("2026-10-24T23:00:00Z"), hour: 7, timeZone: "Europe/Paris" });
  assert.deepEqual([localParts(spring, "Europe/Paris").hour, localParts(autumn, "Europe/Paris").hour], [7, 7]);
  assert.equal(spring.toISOString(), "2026-03-29T05:00:00.000Z");
  assert.equal(autumn.toISOString(), "2026-10-25T06:00:00.000Z");

  let clock = Date.parse("2026-10-25T05:50:00Z");
  const { database, engine, store } = fixture({ now: () => clock });
  const scheduler = createJobScheduler({ engine, now: () => clock });
  scheduler.register({ scheduleId: "maintenance.daily", hour: 7, missedPolicy: "RUN_ONCE", job: { type: "MAINTENANCE", inputRef: { taskRef: "daily" } } });
  clock = Date.parse("2026-10-25T06:01:00Z");
  assert.equal(scheduler.tick(new Date(clock)).length, 1);
  assert.equal(scheduler.tick(new Date(clock)).length, 0);
  assert.equal(store.list().length, 1);
  database.close();
});
