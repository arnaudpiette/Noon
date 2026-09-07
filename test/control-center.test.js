"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createControlCenterService, scrub } = require("../services/control-center");

function reliability(status = "HEALTHY") {
  return {
    report: () => ({ overallState: status }),
  };
}

function fixture(overrides = {}) {
  const calls = { diagnostics: 0, mutations: 0, authorizations: 0 };
  const readers = {
    reliability: () => ({ status: "HEALTHY", summary: "Cœur opérationnel", counts: { readiness: "FULLY_READY" }, items: [{ id: "core", label: "Core", state: "HEALTHY" }] }),
    connections: () => ({ status: "DEGRADED", summary: "Une connexion à revoir", items: [{ id: "gmail", label: "Gmail", state: "UNAUTHORIZED", meta: { auth: "expired", health: "HEALTHY" } }] }),
    jobs: () => ({ status: "HEALTHY", summary: "Aucun job", items: [], counts: { running: 0 } }),
    approvals: () => ({ status: "HEALTHY", summary: "Aucune validation", items: [], counts: { pending: 0 } }),
    privacy: () => ({ status: "HEALTHY", summary: "Vie privée", counts: { localOnly: 3 }, items: [] }),
    extensions: () => ({ status: "HEALTHY", summary: "Extensions", items: [{ id: "xss", label: "<script>alert(1)</script>", state: "HEALTHY", meta: { token: "secret-value", path: "/Users/arnaud/private" } }] }),
    diagnostics: () => ({ status: "HEALTHY", summary: "Rapport", items: [{ id: "diag", label: "Diagnostic", state: "HEALTHY", meta: { apiKey: "sk-secretvalue123456", privatePath: "/Users/arnaud/Documents/a.txt" } }] }),
    ...overrides.readers,
  };
  const service = createControlCenterService({
    reliability: reliability(), readers,
    featureAccess: overrides.featureAccess || (() => ({ enabled: true, advanced: true, developer: false })),
    cacheTtlMs: 10_000, sectionTimeoutMs: overrides.sectionTimeoutMs || 50,
    actions: {
      RUN_QUICK_DIAGNOSTIC: async () => { calls.diagnostics += 1; return { status: "SUCCEEDED" }; },
      MUTATE_TEST: async () => { calls.mutations += 1; return { status: "SUCCEEDED" }; },
      authorize: async (command, context) => { calls.authorizations += 1; return overrides.authorize ? overrides.authorize(command, context) : { status: "PENDING_APPROVAL" }; },
    },
  });
  return { calls, service };
}

test("overview charge malgré un service optionnel dégradé et garde Reliability comme statut global", async () => {
  const { service } = fixture();
  const overview = await service.getOverview();
  assert.equal(overview.overallStatus, "HEALTHY");
  assert.equal(overview.sections.connections.status, "DEGRADED");
  assert.equal(overview.partial, false);
  assert.equal(overview.needsAttention[0].id, "gmail");
});

test("auth et health restent deux champs distincts", async () => {
  const { service } = fixture();
  const model = await service.getSection("connections");
  assert.deepEqual(model.items[0].meta, { auth: "expired", health: "HEALTHY" });
  assert.equal(model.items[0].state, "UNAUTHORIZED");
});

test("une section en panne reste partielle sans bloquer l'overview", async () => {
  const { service } = fixture({ readers: { jobs: () => { throw Object.assign(new Error("boom"), { code: "JOB_STORE_DOWN" }); } } });
  const overview = await service.getOverview();
  assert.equal(overview.sections.jobs.partial, true);
  assert.match(overview.sections.jobs.summary, /temporairement indisponible/);
  assert.equal(overview.sections.reliability.status, "HEALTHY");
});

test("les sections sont lazy et le cache court évite une seconde lecture", async () => {
  let reads = 0;
  const { service } = fixture({ readers: { privacy: () => { reads += 1; return { status: "HEALTHY", summary: "Privé", items: [] }; } } });
  await service.getSection("privacy");
  const cached = await service.getSection("privacy");
  assert.equal(reads, 1);
  assert.equal(cached.cached, true);
  await service.getSection("privacy", { force: true });
  assert.equal(reads, 2);
});

test("le scrubber retire secrets, tokens et chemins privés sans interpréter le HTML", async () => {
  const { service } = fixture();
  const model = await service.getSection("extensions");
  assert.equal(model.items[0].label, "<script>alert(1)</script>");
  assert.equal(Object.hasOwn(model.items[0].meta, "token"), false);
  assert.equal(model.items[0].meta.path, "/[DOSSIER_LOCAL]");
  const serialized = JSON.stringify(await service.getSection("diagnostics"));
  assert.doesNotMatch(serialized, /sk-secret|\/Users\/arnaud/);
});

test("les valeurs local_only restent des compteurs sans contenu mémoire", async () => {
  const { service } = fixture();
  const model = await service.getSection("privacy");
  assert.equal(model.counts.localOnly, 3);
  assert.doesNotMatch(JSON.stringify(model), /statement|payload|content/i);
});

test("une action de diagnostic sûre s'exécute sans mutation", async () => {
  const { calls, service } = fixture();
  const result = await service.requestAction({ action: "RUN_QUICK_DIAGNOSTIC", params: {} });
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(calls.diagnostics, 1);
  assert.equal(calls.mutations, 0);
  assert.equal(calls.authorizations, 0);
});

test("une mutation de trusted_ui passe par la policy et reste bloquée en attente d'approbation", async () => {
  const { calls, service } = fixture();
  const result = await service.requestAction({ action: "MUTATE_TEST", targetId: "device-1", params: {} });
  assert.equal(result.status, "PENDING_APPROVAL");
  assert.equal(calls.authorizations, 1);
  assert.equal(calls.mutations, 0);
});

test("une policy DENY empêche tout effet de bord", async () => {
  const { calls, service } = fixture({ authorize: async () => ({ status: "DENIED", outcome: "DENY" }) });
  const result = await service.requestAction({ action: "MUTATE_TEST", targetId: "device-1", params: {} });
  assert.equal(result.status, "DENIED");
  assert.equal(calls.authorizations, 1);
  assert.equal(calls.mutations, 0);
});

test("une action arbitraire et une cible mal formée sont refusées", async () => {
  const { service } = fixture();
  await assert.rejects(() => service.requestAction({ action: "db.query", params: { sql: "SELECT *" } }), { code: "CONTROL_ACTION_UNAVAILABLE" });
  await assert.rejects(() => service.requestAction({ action: "RUN_QUICK_DIAGNOSTIC", targetId: "../../private" }), { code: "CONTROL_TARGET_INVALID" });
});

test("Developer est refusé sans flag et n'accorde aucune autorité supplémentaire", async () => {
  const { service } = fixture();
  await assert.rejects(() => service.getSection("diagnostics", { view: "DEVELOPER" }), { code: "CONTROL_DEVELOPER_DISABLED" });
  assert.equal(service.diagnostics().directDatabaseAccess, false);
  assert.equal(service.diagnostics().directFilesystemAccess, false);
  assert.equal(service.diagnostics().secretAccess, false);
});

test("le renderer Control Center n'utilise ni innerHTML, ni require, ni API Node", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "control-center.js"), "utf8");
  assert.doesNotMatch(source, /innerHTML|require\s*\(|ipcRenderer|node:fs|window\.noon\.(?:db|fs|exec|tokens)/);
  assert.match(source, /textContent/);
});

test("le preload ne publie aucune primitive DB, shell arbitraire, token ou filesystem", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "electron", "preload.js"), "utf8");
  assert.doesNotMatch(source, /\b(?:queryDatabase|executeShell|readToken|readFile|writeFile)\s*:/);
  assert.match(source, /contextBridge\.exposeInMainWorld/);
});

test("scrub borne les objets et masque les clés sensibles récursives", () => {
  assert.deepEqual(scrub({ ok: true, nested: { password: "x", label: "safe" } }), { ok: true, nested: { label: "safe" } });
});
