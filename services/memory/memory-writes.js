"use strict";

// V3-L7 (A.6) — côté écriture de MemoryEngine : un seul point d'entrée pour créer, corriger,
// confirmer, oublier, bloquer ou purger un souvenir, quelle que soit la mémoire qui le stocke.
// Aucun stockage nouveau, aucune donnée déplacée : chaque action délègue au service existant
// (mémoire privée chiffrée ou mémoire structurée) et garde exactement son comportement.
// Après chaque écriture réussie, `onChange` est appelé une fois : c'est là que le serveur
// invalide les caches de contexte et de recherche, pour qu'un souvenir oublié ne ressorte pas.

const PRIVATE_ACTIONS = Object.freeze(["create", "update", "confirm", "forget", "purge", "profile-settings", "settings"]);
const STRUCTURED_ACTIONS = Object.freeze(["create", "confirm", "correct", "temporary", "forget", "block", "extend"]);

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const id = (value) => String(value || "");

function createMemoryWrites({ privateMemoryService = null, structuredRepository = null, operationalProfile = null, onChange = null } = {}) {
  function changed(store, action, subjectId = null) {
    if (typeof onChange === "function") onChange({ store, action, subjectId: subjectId ? String(subjectId) : null });
  }

  function privateStatus() {
    return privateMemoryService?.available
      ? { available: true, reason: null }
      : { available: false, reason: privateMemoryService?.reason || "Mémoire privée indisponible." };
  }

  function requirePrivate() {
    const status = privateStatus();
    if (!status.available) throw httpError(503, status.reason);
    return privateMemoryService;
  }

  function requireStructured() {
    if (!structuredRepository) throw httpError(503, "Mémoire structurée indisponible.");
    return structuredRepository;
  }

  // Lectures brutes destinées aux écrans de gestion (pas au contexte modèle, qui passe
  // par getRelevantContext et ses filtres de confidentialité).
  function listPrivate(filters = {}) { return requirePrivate().listMemories(filters); }
  function privateProfiles() { const service = requirePrivate(); return { profiles: service.listProfiles(), settings: service.settings() }; }
  function privateSettings() { return requirePrivate().settings(); }
  function exportPrivate(subjectId) { return requirePrivate().exportSubject(String(subjectId || "arnaud")); }
  function listStructured({ query = "", ...filters } = {}) {
    const repository = requireStructured();
    const text = String(query || "").slice(0, 200);
    return text ? repository.searchMemories(text, filters) : repository.listMemories(filters);
  }

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
  function notifyChanged({ store = "private_memory", action = "external", subjectId = null } = {}) { changed(store, action, subjectId); }

  return Object.freeze({ applyPrivate, applyStructured, exportPrivate, listPrivate, listStructured, notifyChanged, privateProfiles, privateSettings, privateStatus });
}

module.exports = { PRIVATE_ACTIONS, STRUCTURED_ACTIONS, createMemoryWrites };
