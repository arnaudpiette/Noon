"use strict";

const crypto = require("node:crypto");

const SCOPE_FIELDS = Object.freeze([
  "profileScope",
  "workspaceId",
  "projectId",
  "sessionId",
  "conversationId",
]);

class ContextOffloadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ContextOffloadError";
    this.code = code;
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
  );
}

function stableSerialize(value) {
  try { return JSON.stringify(stableValue(value)); }
  catch { return JSON.stringify(String(value ?? "")); }
}

function contentFingerprint(value) {
  return crypto.createHash("sha256").update(stableSerialize(value)).digest("hex");
}

function bounded(value, max = 160) {
  if (value === null || value === undefined || value === "") return null;
  return String(value).replace(/[\0\r\n]+/g, " ").trim().slice(0, max) || null;
}

function normalizeScope(scope = {}) {
  return Object.fromEntries(SCOPE_FIELDS.map((field) => [field, bounded(scope[field])]));
}

function createContextOffloader({
  sourceResolver = null,
  canResolve = null,
  now = () => Date.now(),
  defaultTtlMs = 30 * 60_000,
  maxRefs = 500,
  observability = null,
} = {}) {
  const refs = new Map();
  const refLimit = Math.max(1, Math.min(
    5_000,
    Number.isFinite(Number(maxRefs)) ? Math.floor(Number(maxRefs)) : 500
  ));
  const emit = (event, metadata) => {
    try { observability?.(event, metadata); } catch {}
  };

  function requireScope(scope) {
    const normalized = normalizeScope(scope);
    if (!normalized.profileScope || !normalized.sessionId || !normalized.conversationId) {
      throw new ContextOffloadError(
        "OFFLOAD_SCOPE_REQUIRED",
        "Le profil, la session et la conversation canoniques sont requis."
      );
    }
    return normalized;
  }

  function scopeMismatch(ref, requested) {
    for (const field of SCOPE_FIELDS) {
      if (ref[field] !== null && ref[field] !== requested[field]) return field;
    }
    return null;
  }

  function pruneExpired() {
    const currentTime = Number(now());
    let removed = 0;
    for (const [id, ref] of refs) {
      if (Date.parse(ref.expiresAt) <= currentTime) {
        refs.delete(id);
        removed += 1;
      }
    }
    if (removed) emit("context_offload_pruned", { count: removed, reason: "expired" });
    return removed;
  }

  function enforceCapacity() {
    let removed = 0;
    while (refs.size > refLimit) {
      refs.delete(refs.keys().next().value);
      removed += 1;
    }
    if (removed) emit("context_offload_pruned", { count: removed, reason: "capacity" });
  }

  function offload(input = {}) {
    pruneExpired();
    const sourceType = bounded(input.sourceType, 80);
    const sourceId = bounded(input.sourceId, 240);
    if (!sourceType || !sourceId) {
      throw new ContextOffloadError(
        "OFFLOAD_SOURCE_REQUIRED",
        "Une source et son identifiant sont requis."
      );
    }
    const scope = requireScope(input);
    const fingerprint = contentFingerprint(input.content);
    const id = `offload_${contentFingerprint({ sourceType, sourceId, scope, fingerprint }).slice(0, 32)}`;
    const createdAtMs = Number(now());
    const ttlMs = Math.max(1, Math.min(24 * 60 * 60_000, Number(input.ttlMs) || defaultTtlMs));
    const resolverAvailable = typeof sourceResolver === "function";
    const resolvable = input.resolvable === false
      ? false
      : resolverAvailable && (typeof canResolve !== "function" || canResolve(sourceType) === true);
    const ref = Object.freeze({
      id,
      sourceType,
      sourceId,
      conversationId: scope.conversationId,
      sessionId: scope.sessionId,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      profileScope: scope.profileScope,
      subjectScope: bounded(input.subjectScope, 80),
      privacyClass: bounded(input.privacyClass, 40) || "UNKNOWN",
      localOnly: input.localOnly === true,
      resolvable,
      contentFingerprint: fingerprint,
      approximateTokens: Math.max(0, Number(input.approximateTokens) || 0),
      approximateCharacters: Math.max(0, Number(input.approximateCharacters) || stableSerialize(input.content).length),
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + ttlMs).toISOString(),
      reason: bounded(input.reason, 80) || "context_budget",
    });
    refs.delete(id);
    refs.set(id, ref);
    enforceCapacity();
    emit("context_offload_created", {
      count: 1,
      approximateTokens: ref.approximateTokens,
    });
    return ref;
  }

  function getRef(id) {
    return refs.get(String(id || "")) || null;
  }

  function resolve(id, { scope = {}, access = "local", authorizationContext = null } = {}) {
    const requested = requireScope(scope);
    const ref = getRef(id);
    if (!ref) throw new ContextOffloadError("OFFLOAD_REF_NOT_FOUND", "Référence offload introuvable.");
    const mismatch = scopeMismatch(ref, requested);
    if (mismatch) {
      const code = mismatch === "profileScope" ? "OFFLOAD_CROSS_PROFILE_FORBIDDEN" :
        mismatch === "workspaceId" ? "OFFLOAD_CROSS_WORKSPACE_FORBIDDEN" :
          "OFFLOAD_SCOPE_MISMATCH";
      throw new ContextOffloadError(code, "La référence ne correspond pas au contexte demandé.");
    }
    if (Date.parse(ref.expiresAt) <= Number(now())) {
      refs.delete(ref.id);
      throw new ContextOffloadError("OFFLOAD_REF_EXPIRED", "La référence offload a expiré.");
    }
    if (access === "remote" && ref.localOnly) {
      throw new ContextOffloadError("OFFLOAD_LOCAL_ONLY", "Cette référence reste strictement locale.");
    }
    if (!ref.resolvable || typeof sourceResolver !== "function") {
      throw new ContextOffloadError("OFFLOAD_SOURCE_UNRESOLVABLE", "La source ne propose pas de relecture par identifiant.");
    }
    let current;
    try {
      current = sourceResolver(ref, {
        access,
        scope: requested,
        authorizationContext,
      });
    }
    catch (error) {
      emit("context_offload_resolve_failed", { count: 1, status: "SOURCE_ERROR" });
      throw new ContextOffloadError(
        "OFFLOAD_SOURCE_ERROR",
        `La source n'a pas pu être relue (${String(error?.code || error?.name || "ERROR").slice(0, 80)}).`
      );
    }
    if (!current) {
      throw new ContextOffloadError("OFFLOAD_SOURCE_MISSING", "La source référencée n'existe plus.");
    }
    if (current.authorized !== true) {
      throw new ContextOffloadError(
        "OFFLOAD_ACCESS_DENIED",
        "L'autorité actuelle refuse la relecture de cette source."
      );
    }
    if (!Object.hasOwn(current, "content")) {
      throw new ContextOffloadError("OFFLOAD_SOURCE_MISSING", "La source référencée n'existe plus.");
    }
    if (access === "remote" && current.localOnly === true) {
      throw new ContextOffloadError("OFFLOAD_LOCAL_ONLY", "Cette référence reste strictement locale.");
    }
    if (access === "remote" && current.allowedForRemoteModel !== true) {
      throw new ContextOffloadError(
        "OFFLOAD_REMOTE_FORBIDDEN",
        "La politique actuelle interdit l'usage distant de cette source."
      );
    }
    if (contentFingerprint(current.content) !== ref.contentFingerprint) {
      throw new ContextOffloadError("OFFLOAD_REF_STALE", "La source a changé depuis la création de la référence.");
    }
    emit("context_offload_resolved", { count: 1 });
    return {
      ref,
      content: structuredClone(current.content),
      policy: Object.freeze({
        localOnly: current.localOnly === true,
        allowedForRemoteModel: current.allowedForRemoteModel === true,
        privacyClass: bounded(current.privacyClass, 40) || "UNKNOWN",
        providerRestrictions: Object.freeze(
          [...new Set((Array.isArray(current.providerRestrictions) ? current.providerRestrictions : [])
            .map((item) => bounded(item, 80)).filter(Boolean))]
        ),
      }),
    };
  }

  function resolveMany(ids, options = {}) {
    return [...new Set((ids || []).map(String))].map((id) => resolve(id, options));
  }

  function listRefs({ scope = {}, access = "local", includeExpired = false } = {}) {
    const requested = requireScope(scope);
    // Une référence est un objet de contrôle local. Même lorsqu'elle pointe
    // vers un contenu autorisable à distance, elle n'est jamais une projection
    // destinée au provider.
    if (access === "remote") return [];
    if (!includeExpired) pruneExpired();
    const currentTime = Number(now());
    return [...refs.values()].filter((ref) => {
      if (scopeMismatch(ref, requested)) return false;
      if (!includeExpired && Date.parse(ref.expiresAt) <= currentTime) return false;
      return true;
    });
  }

  function clear() {
    const count = refs.size;
    refs.clear();
    return count;
  }

  return { clear, getRef, listRefs, offload, pruneExpired, resolve, resolveMany };
}

module.exports = {
  ContextOffloadError,
  SCOPE_FIELDS,
  contentFingerprint,
  createContextOffloader,
  stableValue,
};
