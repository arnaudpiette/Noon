"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ContextOffloadError,
  contentFingerprint,
  createContextOffloader,
} = require("../services/context/context-offloader");

function scope(overrides = {}) {
  return {
    profileScope: "arnaud",
    workspaceId: "workspace-a",
    projectId: "project-a",
    sessionId: "session-a",
    conversationId: "conversation-a",
    ...overrides,
  };
}

function expectCode(code) {
  return (error) => error instanceof ContextOffloadError && error.code === code;
}

function current(content, overrides = {}) {
  return {
    content,
    authorized: true,
    localOnly: false,
    allowedForRemoteModel: true,
    privacyClass: "PRIVATE",
    ...overrides,
  };
}

test("l'empreinte de contenu est stable pour des objets équivalents", () => {
  assert.equal(
    contentFingerprint({ b: 2, a: { d: 4, c: 3 } }),
    contentFingerprint({ a: { c: 3, d: 4 }, b: 2 })
  );
  const input = {
    ...scope(), sourceType: "structured_memory", sourceId: "stable-1",
    content: { b: 2, a: 1 },
  };
  const first = createContextOffloader({ now: () => 1 }).offload(input);
  const second = createContextOffloader({ now: () => 2 }).offload({ ...input, content: { a: 1, b: 2 } });
  assert.equal(first.id, second.id);
  assert.equal(first.contentFingerprint, second.contentFingerprint);
});

test("offload conserve une référence sans recopier le contenu", () => {
  const secret = "CONTENU_PRIVE_NON_STOCKE";
  const offloader = createContextOffloader({ sourceResolver: () => current(secret) });
  const ref = offloader.offload({
    ...scope(), sourceType: "private_memory", sourceId: "memory-1",
    content: secret, privacyClass: "PRIVATE", approximateTokens: 8,
  });
  assert.equal(ref.sourceId, "memory-1");
  assert.equal(ref.approximateTokens, 8);
  assert.doesNotMatch(JSON.stringify(ref), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(offloader.listRefs({ scope: scope() })), new RegExp(secret));
  assert.deepEqual(offloader.listRefs({ scope: scope(), access: "remote" }), []);
});

test("une récupération ciblée relit l'autorité et vérifie l'empreinte", () => {
  const values = new Map([["memory-1", "Valeur actuelle"]]);
  const offloader = createContextOffloader({
    sourceResolver: (ref) => current(values.get(ref.sourceId)),
  });
  const ref = offloader.offload({
    ...scope(), sourceType: "structured_memory", sourceId: "memory-1",
    content: "Valeur actuelle", privacyClass: "PRIVATE",
  });
  assert.deepEqual(
    offloader.resolve(ref.id, { scope: scope(), access: "remote" }).content,
    "Valeur actuelle"
  );
  values.set("memory-1", "Valeur modifiée");
  assert.throws(
    () => offloader.resolve(ref.id, { scope: scope(), access: "remote" }),
    expectCode("OFFLOAD_REF_STALE")
  );
});

test("local_only ne peut jamais être listé ou résolu pour un accès distant", () => {
  const offloader = createContextOffloader({
    sourceResolver: () => current("Local", { localOnly: true, allowedForRemoteModel: false }),
  });
  const ref = offloader.offload({
    ...scope(), sourceType: "private_memory", sourceId: "local-1",
    content: "Local", localOnly: true,
  });
  assert.deepEqual(offloader.listRefs({ scope: scope(), access: "remote" }), []);
  assert.throws(
    () => offloader.resolve(ref.id, { scope: scope(), access: "remote" }),
    expectCode("OFFLOAD_LOCAL_ONLY")
  );
  assert.equal(offloader.resolve(ref.id, { scope: scope(), access: "local" }).content, "Local");
});

test("les profils, workspaces et sessions restent isolés", () => {
  const offloader = createContextOffloader({ sourceResolver: () => current("Valeur") });
  const ref = offloader.offload({
    ...scope(), sourceType: "conversation_memory", sourceId: "message-1", content: "Valeur",
  });
  assert.throws(
    () => offloader.resolve(ref.id, { scope: scope({ profileScope: "alexandra" }) }),
    expectCode("OFFLOAD_CROSS_PROFILE_FORBIDDEN")
  );
  assert.throws(
    () => offloader.resolve(ref.id, { scope: scope({ workspaceId: "workspace-b" }) }),
    expectCode("OFFLOAD_CROSS_WORKSPACE_FORBIDDEN")
  );
  assert.throws(
    () => offloader.resolve(ref.id, { scope: scope({ sessionId: "session-b" }) }),
    expectCode("OFFLOAD_SCOPE_MISMATCH")
  );
});

test("expiration, référence inconnue et source non résoluble échouent explicitement", () => {
  let clock = Date.parse("2026-10-08T08:00:00.000Z");
  const offloader = createContextOffloader({
    now: () => clock,
    sourceResolver: () => current("Valeur"),
  });
  const expired = offloader.offload({
    ...scope(), sourceType: "conversation_memory", sourceId: "message-1",
    content: "Valeur", ttlMs: 100,
  });
  clock += 101;
  assert.throws(
    () => offloader.resolve(expired.id, { scope: scope() }),
    expectCode("OFFLOAD_REF_EXPIRED")
  );
  assert.throws(
    () => offloader.resolve("offload_unknown", { scope: scope() }),
    expectCode("OFFLOAD_REF_NOT_FOUND")
  );

  const referencesOnly = createContextOffloader();
  const unresolved = referencesOnly.offload({
    ...scope(), sourceType: "session_summary", sourceId: "summary-1", content: "Résumé",
  });
  assert.equal(unresolved.resolvable, false);
  assert.throws(
    () => referencesOnly.resolve(unresolved.id, { scope: scope() }),
    expectCode("OFFLOAD_SOURCE_UNRESOLVABLE")
  );
});

test("les références V1 sont éphémères et ne survivent pas à une nouvelle instance", () => {
  const first = createContextOffloader({ sourceResolver: () => current("Valeur") });
  const ref = first.offload({
    ...scope(), sourceType: "structured_memory", sourceId: "memory-1", content: "Valeur",
  });
  const restarted = createContextOffloader({ sourceResolver: () => current("Valeur") });
  assert.throws(
    () => restarted.resolve(ref.id, { scope: scope() }),
    expectCode("OFFLOAD_REF_NOT_FOUND")
  );
});

test("l'observabilité ne contient ni contenu brut ni identifiant de source", () => {
  const events = [];
  const secret = "SECRET_OFFLOAD_FICTIF";
  const offloader = createContextOffloader({
    sourceResolver: () => current(secret),
    observability: (event, metadata) => events.push({ event, metadata }),
  });
  const ref = offloader.offload({
    ...scope(), sourceType: "private_memory", sourceId: "identifiant-prive",
    content: secret, approximateTokens: 4,
  });
  offloader.resolve(ref.id, { scope: scope() });
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /SECRET_OFFLOAD_FICTIF|identifiant-prive/);
  assert.doesNotMatch(serialized, /localOnly|private_memory|conversation_memory/);
  assert.match(serialized, /context_offload_created|context_offload_resolved/);
});

test("une portée canonique complète est requise pour créer, lister et résoudre", () => {
  const offloader = createContextOffloader({ sourceResolver: () => current("Valeur") });
  assert.throws(() => offloader.offload({
    profileScope: "arnaud", sourceType: "memory", sourceId: "m1", content: "Valeur",
  }), expectCode("OFFLOAD_SCOPE_REQUIRED"));
  const ref = offloader.offload({ ...scope(), sourceType: "memory", sourceId: "m1", content: "Valeur" });
  assert.throws(() => offloader.listRefs({ scope: { profileScope: "arnaud" } }), expectCode("OFFLOAD_SCOPE_REQUIRED"));
  assert.throws(() => offloader.resolve(ref.id, { scope: { profileScope: "arnaud" } }), expectCode("OFFLOAD_SCOPE_REQUIRED"));
});

test("une référence ne remplace jamais l'autorisation et la privacy actuelles", () => {
  let policy = current("Valeur autorisée");
  const offloader = createContextOffloader({ sourceResolver: () => policy });
  const ref = offloader.offload({
    ...scope(), sourceType: "private_memory", sourceId: "permission-1",
    content: "Valeur autorisée", localOnly: false, privacyClass: "PUBLIC",
  });
  assert.equal(offloader.resolve(ref.id, {
    scope: scope(), access: "remote", authorizationContext: { permissions: ["READ"] },
  }).content, "Valeur autorisée");

  policy = { authorized: false };
  assert.throws(
    () => offloader.resolve(ref.id, { scope: scope(), access: "remote" }),
    expectCode("OFFLOAD_ACCESS_DENIED")
  );

  policy = current("Valeur autorisée", { localOnly: true, allowedForRemoteModel: false });
  assert.throws(
    () => offloader.resolve(ref.id, { scope: scope(), access: "remote" }),
    expectCode("OFFLOAD_LOCAL_ONLY")
  );
});

test("le registre purge les expirations et applique une capacité maximale", () => {
  let clock = Date.parse("2026-10-08T08:00:00.000Z");
  const offloader = createContextOffloader({
    now: () => clock,
    maxRefs: 2,
    sourceResolver: (ref) => current(ref.sourceId),
  });
  const first = offloader.offload({
    ...scope(), sourceType: "structured_memory", sourceId: "one", content: "one", ttlMs: 10,
  });
  clock += 11;
  offloader.offload({
    ...scope(), sourceType: "structured_memory", sourceId: "two", content: "two",
  });
  assert.equal(offloader.getRef(first.id), null);
  offloader.offload({
    ...scope(), sourceType: "structured_memory", sourceId: "three", content: "three",
  });
  offloader.offload({
    ...scope(), sourceType: "structured_memory", sourceId: "four", content: "four",
  });
  assert.deepEqual(
    offloader.listRefs({ scope: scope() }).map((ref) => ref.sourceId),
    ["three", "four"]
  );
});
