"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createPersonalDatabase } = require("../services/persistence/database");
const { createSyncRepository } = require("../services/sync/sync-repository");
const { createSyncEngine } = require("../services/sync/sync-engine");

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "noon-sync-atomic-"));
  const database = createPersonalDatabase(path.join(directory, "sync.sqlite"));
  return {
    directory,
    database,
    close() {
      database.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

function faultingDatabase(database, failure) {
  return new Proxy(database, {
    get(target, property) {
      const value = Reflect.get(target, property, target);

      if (property === "exec") return target.exec.bind(target);

      if (property === "prepare") {
        return (sql) => {
          const changeInsert = /^INSERT INTO sync_changes/.test(sql);
          const appliedInsert = /^INSERT OR IGNORE INTO sync_applied_envelopes/.test(sql);

          if (
            (failure === "change" && changeInsert) ||
            (failure === "applied" && appliedInsert)
          ) {
            return {
              run() {
                throw Object.assign(
                  new Error(`échec sync ${failure} simulé`),
                  { code: `TEST_SYNC_${failure.toUpperCase()}_FAILURE` },
                );
              },
            };
          }

          return target.prepare(sql);
        };
      }

      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function repository(ctx, db = ctx.database.database) {
  return createSyncRepository({ kind: "sqlite", database: db });
}

function sourceDevice() {
  return {
    deviceId: "remote",
    status: "ACTIVE",
    syncScopes: ["WORKSPACES", "REMOTE_CONTROL"],
  };
}

function policy() {
  return {
    evaluate: () => ({
      allowed: true,
      classification: "SYNC_ALLOWED",
      reasonCodes: [],
    }),
    sanitize: (_type, payload) => payload,
    entityRules: () => ({
      workspace: {
        scope: "WORKSPACES",
        classification: "SYNC_ALLOWED",
      },
      remote_request: {
        scope: "REMOTE_CONTROL",
        classification: "SYNC_ON_REQUEST",
      },
    }),
  };
}

function engine(repo, options = {}) {
  const devices = {
    remote: sourceDevice(),
  };

  return createSyncEngine({
    repository: repo,
    policy: policy(),
    deviceRegistry: {
      get: (id) => devices[id] || null,
      list: () => Object.values(devices),
      assertAuthorized: (id) => devices[id],
    },
    cryptoLayer: {
      seal: ({ payload }) => payload,
      open: options.open || ((envelope) => envelope.content),
    },
    transport: options.transport || {
      send: () => ({ bytesSent: 0 }),
      pull: () => ({
        status: "OK",
        envelopes: [],
        cursor: 0,
        bytesReceived: 0,
      }),
      status: () => ({ connected: true }),
    },
    localDeviceId: "local",
    mode: "ON",
    conflictResolver: {
      resolve: ({ incoming }) => ({
        state: "APPLIED",
        conflicts: [],
        entity: incoming,
      }),
    },
  });
}

function workspaceEnvelope(id = "env-workspace", entityId = "workspace-1") {
  return {
    envelopeId: id,
    sourceDeviceId: "remote",
    entityType: "workspace",
    entityId,
    content: {
      entity: {
        entityType: "workspace",
        entityId,
        profileScope: "arnaud",
        revision: 1,
        payload: { name: "Fixture Sync" },
        fieldVersions: {},
        originDeviceId: "remote",
        deletedAt: null,
        updatedAt: "2026-10-01T18:00:00.000Z",
      },
      change: {
        changedFields: ["name"],
      },
      baseFieldVersions: {},
    },
  };
}

function remoteEnvelope(id = "env-remote") {
  return {
    envelopeId: id,
    sourceDeviceId: "remote",
    entityType: "remote_request",
    entityId: "rr-1",
    content: {
      entity: {
        entityType: "remote_request",
        entityId: "rr-1",
        profileScope: "arnaud",
        payload: {
          requestId: `request-${id}`,
          nonce: crypto.randomUUID(),
          createdAt: "2026-10-01T18:00:00.000Z",
          expiresAt: "2099-01-01T00:00:00.000Z",
          executionNode: "MAC_PRIMARY",
          intentEnvelope: { intentId: "intent-fixture" },
        },
      },
      change: {
        changedFields: ["payload"],
      },
      baseFieldVersions: {},
    },
  };
}

test("appendChange rollbacke la révision si l'insertion du change échoue", () => {
  const ctx = fixture();
  try {
    const good = repository(ctx);
    const failing = repository(
      ctx,
      faultingDatabase(ctx.database.database, "change"),
    );

    assert.equal(good.revision(), 0);

    assert.throws(
      () => failing.appendChange({
        entityType: "workspace",
        entityId: "w1",
        operation: "UPSERT",
        version: 1,
        originDeviceId: "local",
        profileScope: "arnaud",
        syncClassification: "SYNC_ALLOWED",
        changedFields: ["name"],
        baseFieldVersions: {},
      }),
      { code: "TEST_SYNC_CHANGE_FAILURE" },
    );

    assert.equal(good.revision(), 0);
    assert.equal(good.changesAfter(0).length, 0);
  } finally {
    ctx.close();
  }
});

test("échec markApplied rollbacke l'entité reçue", () => {
  const ctx = fixture();
  try {
    const good = repository(ctx);
    const failing = repository(
      ctx,
      faultingDatabase(ctx.database.database, "applied"),
    );
    const sync = engine(failing);
    const envelope = workspaceEnvelope();

    assert.throws(
      () => sync.applyEnvelope(envelope),
      { code: "TEST_SYNC_APPLIED_FAILURE" },
    );

    assert.equal(
      good.getEntity("workspace", "workspace-1", "arnaud"),
      null,
    );
    assert.equal(good.isApplied(envelope.envelopeId), false);

    const reusable = engine(good);
    assert.equal(reusable.applyEnvelope(envelope).applied, true);
    assert.equal(
      good.getEntity("workspace", "workspace-1", "arnaud").payload.name,
      "Fixture Sync",
    );
  } finally {
    ctx.close();
  }
});

test("échec markApplied rollbacke aussi une remote_request", () => {
  const ctx = fixture();
  try {
    const good = repository(ctx);
    const failing = repository(
      ctx,
      faultingDatabase(ctx.database.database, "applied"),
    );
    const sync = engine(failing);
    const envelope = remoteEnvelope();

    assert.throws(
      () => sync.applyEnvelope(envelope),
      { code: "TEST_SYNC_APPLIED_FAILURE" },
    );

    assert.equal(
      good.remoteRequestSeen(
        envelope.content.entity.payload.requestId,
        "remote",
        "nonce-impossible",
      ),
      false,
    );

    assert.equal(
      Number(
        ctx.database.database
          .prepare("SELECT COUNT(*) n FROM sync_remote_requests")
          .get().n,
      ),
      0,
    );
    assert.equal(good.isApplied(envelope.envelopeId), false);
  } finally {
    ctx.close();
  }
});

test("applyEnvelope respecte rollback d'une transaction appelante", () => {
  const ctx = fixture();
  try {
    const repo = repository(ctx);
    const sync = engine(repo);
    const db = ctx.database.database;
    const envelope = workspaceEnvelope("env-external", "workspace-external");

    db.exec("BEGIN IMMEDIATE");
    try {
      const result = sync.applyEnvelope(envelope);
      assert.equal(result.applied, true);
      assert.equal(db.isTransaction, true);
      db.exec("ROLLBACK");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }

    assert.equal(
      repo.getEntity("workspace", "workspace-external", "arnaud"),
      null,
    );
    assert.equal(repo.isApplied(envelope.envelopeId), false);
  } finally {
    ctx.close();
  }
});

test("échec interne sous transaction externe conserve la transaction appelante", () => {
  const ctx = fixture();
  try {
    const good = repository(ctx);
    const failing = repository(
      ctx,
      faultingDatabase(ctx.database.database, "applied"),
    );
    const sync = engine(failing);
    const db = ctx.database.database;
    const envelope = workspaceEnvelope(
      "env-external-failure",
      "workspace-external-failure",
    );

    db.exec("BEGIN IMMEDIATE");

    try {
      assert.throws(
        () => sync.applyEnvelope(envelope),
        { code: "TEST_SYNC_APPLIED_FAILURE" },
      );

      assert.equal(db.isTransaction, true);

      good.saveCursor({
        deviceId: "local",
        inboundSequence: 7,
        outboundSequence: 0,
      });

      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }

    assert.equal(
      good.getEntity(
        "workspace",
        "workspace-external-failure",
        "arnaud",
      ),
      null,
    );
    assert.equal(good.isApplied(envelope.envelopeId), false);
    assert.equal(good.cursor("local").inboundSequence, 7);
  } finally {
    ctx.close();
  }
});

test("pull n'avance pas le curseur si une enveloppe du batch échoue", () => {
  const ctx = fixture();
  try {
    const repo = repository(ctx);

    const ok = workspaceEnvelope("env-ok", "workspace-ok");
    const bad = workspaceEnvelope("env-bad", "workspace-bad");

    const sync = engine(repo, {
      open: (envelope) => {
        if (envelope.envelopeId === "env-bad") {
          throw Object.assign(
            new Error("enveloppe invalide simulée"),
            { code: "TEST_SYNC_OPEN_FAILURE" },
          );
        }
        return envelope.content;
      },
      transport: {
        send: () => ({ bytesSent: 0 }),
        pull: () => ({
          status: "OK",
          envelopes: [ok, bad],
          cursor: 2,
          bytesReceived: 123,
        }),
        status: () => ({ connected: true }),
      },
    });

    const result = sync.pull();

    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].applied, true);
    assert.equal(result.results[1].errorCode, "TEST_SYNC_OPEN_FAILURE");
    assert.equal(result.cursor, 0);
    assert.equal(repo.cursor("local").inboundSequence, 0);
    assert.equal(repo.isApplied("env-ok"), true);
    assert.equal(repo.isApplied("env-bad"), false);
  } finally {
    ctx.close();
  }
});
