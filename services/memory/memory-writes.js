// @ts-check
"use strict";

// V3-L7 (A.6) — côté écriture de MemoryEngine : un seul point d'entrée pour créer, corriger,
// confirmer, oublier, bloquer ou purger un souvenir, quelle que soit la mémoire qui le stocke.
// Aucun stockage nouveau, aucune donnée déplacée : chaque action délègue au service existant
// (mémoire privée chiffrée ou mémoire structurée) et garde exactement son comportement.
// Après chaque écriture réussie, `onChange` est appelé une fois : c'est là que le serveur
// invalide les caches de contexte et de recherche, pour qu'un souvenir oublié ne ressorte pas.

const PRIVATE_ACTIONS = Object.freeze(["create", "update", "confirm", "forget", "purge", "profile-settings", "settings"]);
const STRUCTURED_ACTIONS = Object.freeze(["create", "confirm", "correct", "temporary", "forget", "block", "extend"]);

/** @typedef {Record<string, any>} MemoryRecord */
/**
 * Mémoire privée chiffrée (services/personal-memory/private-memory-service.js), méthodes utilisées.
 * @typedef {{
 *   available?: boolean,
 *   reason?: string,
 *   listMemories: (filters?: object) => MemoryRecord[],
 *   listProfiles: () => unknown,
 *   settings: () => Record<string, any>,
 *   exportSubject: (subjectId: string) => unknown,
 *   createMemory: (memory: object) => unknown,
 *   updateMemory: (id: string, changes: object, reason: string) => unknown,
 *   forgetMemory: (id: string) => unknown,
 *   purgeSubject: (subjectId: string) => unknown,
 *   setProfileEnabled: (subjectId: string, enabled: boolean) => unknown,
 *   setSettings: (settings: object) => unknown,
 *   isProfileEnabled: (subjectId: string) => boolean,
 *   getMemory?: (id: string) => MemoryRecord | null | undefined,
 *   migrationStatus?: (migrationId: string) => { status?: string } | null | undefined,
 *   hardRules: () => MemoryRecord[],
 * }} PrivateMemoryServiceLike
 */
/**
 * Mémoire structurée (dépôt SQLite), méthodes utilisées.
 * @typedef {{
 *   searchMemories: (text: string, filters?: object) => MemoryRecord[],
 *   listMemories: (filters?: object) => MemoryRecord[],
 *   upsertMemory: (memory: object) => MemoryRecord,
 *   getMemory: (id: string) => MemoryRecord | null | undefined,
 *   confirmMemory: (id: string) => unknown,
 *   forgetMemory: (id: string) => unknown,
 *   blockMemory: (id: string) => unknown,
 *   updateMemory: (id: string, changes: object) => unknown,
 * }} StructuredRepositoryLike
 */
/**
 * @typedef {{
 *   respondToInference?: (id: string, kind: string, value: unknown, expiresAt?: unknown) => unknown,
 * } | null} OperationalProfileLike
 */
/** @typedef {((change: { store: string, action: string, subjectId: string | null }) => void) | null} MemoryChangeListener */

/**
 * @param {number} statusCode
 * @param {string} message
 */
const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
/** @param {unknown} value */
const id = (value) => String(value || "");

/**
 * @param {{
 *   privateMemoryService?: PrivateMemoryServiceLike | null,
 *   structuredRepository?: StructuredRepositoryLike | null,
 *   operationalProfile?: OperationalProfileLike,
 *   onChange?: MemoryChangeListener,
 * }} [options]
 */
function createMemoryWrites({ privateMemoryService = null, structuredRepository = null, operationalProfile = null, onChange = null } = {}) {
  /**
   * @param {string} store
   * @param {string} action
   * @param {unknown} [subjectId]
   */
  function changed(store, action, subjectId = null) {
    if (typeof onChange === "function") onChange({ store, action, subjectId: subjectId ? String(subjectId) : null });
  }

  /** @returns {{ available: true, reason: null } | { available: false, reason: string }} */
  function privateStatus() {
    return privateMemoryService?.available
      ? { available: true, reason: null }
      : { available: false, reason: privateMemoryService?.reason || "Mémoire privée indisponible." };
  }

  function requirePrivate() {
    const status = privateStatus();
    if (!status.available) throw httpError(503, status.reason);
    // privateStatus() a confirmé la disponibilité du service.
    return /** @type {PrivateMemoryServiceLike} */ (privateMemoryService);
  }

  function requireStructured() {
    if (!structuredRepository) throw httpError(503, "Mémoire structurée indisponible.");
    return structuredRepository;
  }

  // Lectures brutes destinées aux écrans de gestion (pas au contexte modèle, qui passe
  // par getRelevantContext et ses filtres de confidentialité).
  /** @param {object} [filters] */
  function listPrivate(filters = {}) { return requirePrivate().listMemories(filters); }
  function privateProfiles() { const service = requirePrivate(); return { profiles: service.listProfiles(), settings: service.settings() }; }
  function privateSettings() { return requirePrivate().settings(); }
  /** @param {unknown} subjectId */
  function exportPrivate(subjectId) { return requirePrivate().exportSubject(String(subjectId || "arnaud")); }
  /** @param {{ query?: string } & Record<string, unknown>} [input] */
  function listStructured({ query = "", ...filters } = {}) {
    const repository = requireStructured();
    const text = String(query || "").slice(0, 200);
    return text ? repository.searchMemories(text, filters) : repository.listMemories(filters);
  }

  /**
   * Corps de requête HTTP : chaque champ est converti ou validé par le service appelé.
   * @param {string} action
   * @param {Record<string, any>} [body]
   */
  function applyPrivate(action, body = {}) {
    const service = requirePrivate();
    let result;
    if (action === "create") result = service.createMemory(body.memory || {});
    else if (action === "update") result = service.updateMemory(id(body.id), body.changes || {}, body.reason || "correction utilisateur");
    else if (action === "confirm") result = service.updateMemory(id(body.id), { status: "confirmed", consentStatus: "granted", confidence: 1 }, "validation explicite");
    else if (action === "forget") result = service.forgetMemory(id(body.id));
    else if (action === "purge") result = { purged: service.purgeSubject(id(body.subjectId)) };
    else if (action === "profile-settings") result = service.setProfileEnabled(id(body.subjectId), body.enabled === true);
    else if (action === "settings") result = service.setSettings(body.settings || {});
    else throw httpError(400, "Action de mémoire privée inconnue.");
    changed("private_memory", action, body.subjectId);
    return result;
  }

  /**
   * @param {string} action
   * @param {Record<string, any>} [body]
   */
  function applyStructured(action, body = {}) {
    const repository = requireStructured();
    let result;
    if (action === "create") {
      const inferred = body.memory?.status === "inferred";
      result = repository.upsertMemory({ ...body.memory, sourceType: body.memory?.sourceType || "explicit-user-instruction", status: inferred ? "inferred" : "confirmed", confidence: inferred ? body.memory?.confidence : 1, explicitConfirmation: !inferred });
    } else if (action === "confirm") result = repository.confirmMemory(id(body.id));
    else if (action === "correct" || action === "temporary") {
      if (!operationalProfile?.respondToInference) throw httpError(503, "Profil opérationnel indisponible.");
      result = action === "correct"
        ? operationalProfile.respondToInference(id(body.id), "correct", body.value)
        : operationalProfile.respondToInference(id(body.id), "temporary", body.value, body.expiresAt);
    } else if (action === "forget") result = repository.forgetMemory(id(body.id));
    else if (action === "block") result = repository.blockMemory(id(body.id));
    else if (action === "extend") result = repository.updateMemory(id(body.id), { status: "temporary", expiresAt: body.expiresAt });
    else throw httpError(400, "Action mémoire inconnue.");
    changed("structured_memory", action);
    return result;
  }

  // Écritures faites hors de ce module (import d'un fichier, commandes conversationnelles) :
  // elles signalent le changement ici pour que l'invalidation reste au même endroit.
  /** @param {{ store?: string, action?: string, subjectId?: string | null }} [change] */
  function notifyChanged({ store = "private_memory", action = "external", subjectId = null } = {}) { changed(store, action, subjectId); }

  return Object.freeze({ applyPrivate, applyStructured, exportPrivate, listPrivate, listStructured, notifyChanged, privateProfiles, privateSettings, privateStatus });
}

module.exports = { PRIVATE_ACTIONS, STRUCTURED_ACTIONS, createMemoryWrites };
