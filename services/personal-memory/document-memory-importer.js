"use strict";

const crypto = require("crypto");
const { SECRET_PATTERN } = require("../persistence/repositories/personal-intelligence-repository");

// Patterns pour détecter les secrets ou credentials
const EXTENDED_SECRET_PATTERN = /(?:sk-[A-Za-z0-9_-]{12,}|api[_-]?key\s*[:=]|password\s*[:=]|mot\s+de\s+passe\s*[:=]|BEGIN\s+(?:RSA\s+|EC\s+)?PRIVATE\s+KEY|bearer\s+[A-Za-z0-9._-]+|token\s*[:=]|secret\s*[:=]|seed\s+phrase|credential)/i;

// Catégories privées (local-first, chiffrées)
const PRIVATE_PATTERNS = [
  /\b(?:alexandra|partenaire|conjointe?|femme|mari|époux|épouse|couple)\b/i,
  /\b(?:sinan|kaan|enfant|enfants|fils|fille|famille|foyer|parent)\b/i,
  /\b(?:sant[eé]|m[eé]dical|m[eé]decin|traitement|maladie|h[oô]pital)\b/i,
  /\b(?:finance|argent|revenu|salaire|compte|banque|imp[oô]t|patrimoine|dette|cr[eé]dit)\b/i,
  /\b(?:juridique|justice|avocat|tribunal|proc[eè]s|contrat\s+judiciaire|contentieux)\b/i,
  /\b(?:adresse|domicile|habite\s+[àa]|r[eé]sidence|coordonn[eé]es|t[eé]l[eé]phone)\b/i,
  /\b(?:carte\s+d['’]identit[eé]|passeport|sécurit[eé]\s+sociale)\b/i,
];

// Catégories évolutives
const EVOLVING_PATTERNS = [
  /\b(?:fin\s+de\s+formation|formation\s+jusqu['’]au?|date\s+de\s+fin)\b/i,
  /\b(?:revenu|salaire|montant|budget|tarif|prix)\b/i,
  /\b(?:planning|horaire|rendez-vous|disponibilit[eé]|semaine|mois)\b/i,
  /\b(?:version|release|v\d+\.\d+)\b/i,
  /\b(?:abonnement|forfait|statut\s+actuel|en\s+cours)\b/i,
  /\b(?:priorit[eé]\s+actuelle|objectif\s+du\s+moment)\b/i,
];

// Heuristique pour déterminer le sujet
function detectSubject(statement) {
  const normalized = String(statement || "").toLowerCase();
  if (/\balexandra\b/.test(normalized)) return "alexandra";
  if (/\bsinan\b/.test(normalized)) return "sinan";
  if (/\bkaan\b/.test(normalized)) return "kaan";
  if (/\b(?:foyer|famille|maison)\b/.test(normalized)) return "household";
  return "arnaud";
}

function normalizeForComparison(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:je|tu|il|elle|nous|vous|ils|le|la|les|un|une|des|du|de|d|en|pour|avec|sans|et|ou|a|est|son|sa|ses|qui|que|dans|par|sur)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSimilarity(left, right) {
  const leftTokens = new Set(normalizeForComparison(left).split(" ").filter((t) => t.length > 2));
  const rightTokens = new Set(normalizeForComparison(right).split(" ").filter((t) => t.length > 2));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? intersection / union : 0;
}

function negationChanged(left, right) {
  const negative = (value) => /\b(?:ne|n['’]|pas|plus|jamais|aucun|sans)\b/i.test(String(value || ""));
  return negative(left) !== negative(right);
}

function isSecret(text) {
  return SECRET_PATTERN.test(text) || EXTENDED_SECRET_PATTERN.test(text);
}

function isPrivateScope(statement) {
  return PRIVATE_PATTERNS.some((pattern) => pattern.test(statement));
}

function isEvolvingData(statement) {
  return EVOLVING_PATTERNS.some((pattern) => pattern.test(statement));
}

function privateCategory(statement) {
  if (/\b(?:partenaire|conjointe?|femme|mari|époux|épouse|couple)\b/i.test(statement)) return "family_relationship";
  if (/\b(?:enfant|enfants|fils|fille|parent)\b/i.test(statement)) return "family_child";
  if (/\b(?:sant[eé]|m[eé]dical|traitement|maladie|h[oô]pital)\b/i.test(statement)) return "health";
  if (/\b(?:revenu|salaire|banque|imp[oô]t|dette|cr[eé]dit)\b/i.test(statement)) return "finance";
  if (/\b(?:juridique|justice|avocat|tribunal|proc[eè]s|contentieux)\b/i.test(statement)) return "legal";
  if (/\b(?:adresse|domicile|r[eé]sidence|t[eé]l[eé]phone)\b/i.test(statement)) return "address";
  return "identity";
}

// Découpe un texte brut en phrases/propositions atomiques
function splitIntoAtomicStatements(text) {
  if (!text || typeof text !== "string") return [];

  // Découpage par retours à la ligne ou points suivis d'espace/majuscule
  const rawSegments = text
    .split(/(?:\r?\n)+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ÿ0-9])/))
    .map((seg) => seg.replace(/^[-*•–—\d.)\s]+/, "").trim())
    .filter((seg) => seg.length >= 8);

  const statements = [];
  for (const segment of rawSegments) {
    // Ignorer les entêtes vides ou instructions de format
    if (/^(?:titre|sommaire|chapitre|page\s+\d+|table\s+des\s+mati[eè]res|notes?|remarques?)$/i.test(segment)) {
      continue;
    }
    // Nettoyer la ponctuation finale excessive
    const cleaned = segment.replace(/[;]+$/, "").trim();
    if (cleaned.length >= 8) {
      statements.push(cleaned);
    }
  }
  return statements;
}

function createDocumentMemoryImporter({ personalRepository, privateMemoryService } = {}) {
  if (!personalRepository && !privateMemoryService) {
    throw new TypeError("Au moins un service de mémoire est requis.");
  }

  function importDocumentToMemory(document, options = {}) {
    const filename = String(document?.filename || document?.name || "document.txt");
    const documentId = String(document?.id || `doc-${crypto.randomUUID()}`);
    const textContent = String(document?.extractedText || document?.content || "");

    const result = {
      success: false,
      source: {
        id: documentId,
        filename,
      },
      extractedCount: 0,
      savedCount: 0,
      updatedCount: 0,
      duplicateCount: 0,
      ignoredCount: 0,
      generalCount: 0,
      privateCount: 0,
      evolvingCount: 0,
      conflicts: [],
      memoryIds: [],
      errorCount: 0,
    };

    if (!textContent.trim()) {
      return result;
    }

    const atomicStatements = splitIntoAtomicStatements(textContent);
    result.extractedCount = atomicStatements.length;

    if (!atomicStatements.length) {
      return result;
    }

    const nowIso = new Date().toISOString();

    // Récupérer les mémoires existantes pour déduplication et détection de conflits
    const existingGeneral = personalRepository ? personalRepository.listMemories({ limit: 500 }) : [];
    const existingPrivate = (privateMemoryService && privateMemoryService.available)
      ? privateMemoryService.listMemories({ includeDeleted: false })
      : [];

    for (const statement of atomicStatements) {
      // 1. Filtrage strict des secrets
      if (isSecret(statement)) {
        result.ignoredCount += 1;
        continue;
      }

      // 2. Classification
      const isPrivate = isPrivateScope(statement);
      const isEvolving = isEvolvingData(statement);
      const category = isPrivate ? privateCategory(statement) : null;
      if (isEvolving) result.evolvingCount += 1;

      const subjectId = detectSubject(statement);

      // 3. Déduplication et gestion de l'évolution
      if (isPrivate) {
        if (!privateMemoryService || !privateMemoryService.available) {
          result.ignoredCount += 1;
          continue;
        }

        // Vérifier dans les souvenirs privés existants
        let matchedMemory = null;
        let highestSim = 0;
        for (const existing of existingPrivate) {
          if (existing.subjectId !== subjectId || existing.category !== category) continue;
          const sim = tokenSimilarity(existing.statement, statement);
          if (sim > 0.65 && sim > highestSim) {
            highestSim = sim;
            matchedMemory = existing;
          }
        }

        if (matchedMemory) {
          if (isEvolving && normalizeForComparison(matchedMemory.statement) !== normalizeForComparison(statement)) {
            // Mise à jour de la donnée évolutive avec historique
            const updated = privateMemoryService.updateMemory(
              matchedMemory.id,
              {
                statement,
                status: "confirmed",
                confidence: 1,
                consentStatus: "granted",
                apiPolicy: "local_only",
                payload: {
                  ...(matchedMemory.payload || {}),
                  stability: "evolving",
                  sourceFilename: filename,
                  sourceId: documentId,
                  updatedFromDocumentAt: nowIso,
                },
              },
              `Mise à jour documentaire depuis ${filename}`
            );
            const verified = updated?.id ? privateMemoryService.getMemory(updated.id) : null;
            if (verified?.statement === statement && verified.sourceReference === matchedMemory.sourceReference) {
              result.updatedCount += 1;
              result.privateCount += 1;
              result.memoryIds.push(updated.id);
              const index = existingPrivate.findIndex((item) => item.id === updated.id);
              if (index >= 0) existingPrivate[index] = verified;
            } else result.errorCount += 1;
          } else if (negationChanged(matchedMemory.statement, statement)) {
            result.conflicts.push({ scope: "private", existingMemoryId: matchedMemory.id, sourceId: documentId, resolutionRequired: true });
          } else {
            // Doublon sémantique
            result.duplicateCount += 1;
          }
        } else {
          // Création nouveau souvenir privé
          const created = privateMemoryService.createMemory({
            subjectId,
            category,
            statement,
            sensitivity: "medium",
            status: "confirmed",
            confidence: 1,
            consentStatus: "granted",
            apiPolicy: "local_only",
            sourceType: "document",
            sourceReference: filename,
            tags: ["document-import", isEvolving ? "evolving" : "stable"],
            payload: {
              sourceFilename: filename,
              sourceId: documentId,
              importedAt: nowIso,
              stability: isEvolving ? "evolving" : "stable",
              scope: "private",
            },
          });
          const verified = created?.id ? privateMemoryService.getMemory(created.id) : null;
          if (created && !created.duplicate && verified?.statement === statement && verified.sourceReference === filename) {
            result.savedCount += 1;
            result.privateCount += 1;
            result.memoryIds.push(created.id);
            existingPrivate.push(verified);
            if (verified.status === "pending_review" && verified.payload?.conflictWithId) result.conflicts.push({ scope: "private", memoryId: verified.id, existingMemoryId: verified.payload.conflictWithId, resolutionRequired: true });
          } else if (created?.duplicate) {
            result.duplicateCount += 1;
          } else result.errorCount += 1;
        }
      } else {
        // Mémoire générale (stockée dans personalRepository)
        if (!personalRepository) {
          result.ignoredCount += 1;
          continue;
        }

        let matchedGeneral = null;
        let highestSim = 0;
        for (const existing of existingGeneral) {
          const existingText = typeof existing.value === "string" ? existing.value : JSON.stringify(existing.value || "");
          const sim = tokenSimilarity(existingText, statement);
          if (sim > 0.65 && sim > highestSim) {
            highestSim = sim;
            matchedGeneral = existing;
          }
        }

        if (matchedGeneral) {
          const existingVal = typeof matchedGeneral.value === "string" ? matchedGeneral.value : JSON.stringify(matchedGeneral.value || "");
          if (isEvolving && normalizeForComparison(existingVal) !== normalizeForComparison(statement)) {
            // Mise à jour de la donnée évolutive dans le repo général
            const updated = personalRepository.upsertMemory({
              ...matchedGeneral,
              value: statement,
              status: "confirmed",
              confidence: 1,
              explicitConfirmation: true,
              sourceType: "document",
              sourceReference: filename,
              updatedAt: nowIso,
              metadata: {
                ...(matchedGeneral.metadata || {}),
                sourceFilename: filename,
                sourceId: documentId,
                stability: "evolving",
                updatedAt: nowIso,
                versions: [
                  ...((matchedGeneral.metadata && matchedGeneral.metadata.versions) || []),
                  { previousValue: matchedGeneral.value, updatedAt: nowIso },
                ],
              },
            });
            const verified = updated?.id ? personalRepository.getMemory(updated.id) : null;
            if (verified && normalizeForComparison(verified.value) === normalizeForComparison(statement)) {
              result.updatedCount += 1;
              result.generalCount += 1;
              result.memoryIds.push(updated.id);
              const index = existingGeneral.findIndex((item) => item.id === updated.id);
              if (index >= 0) existingGeneral[index] = verified;
            } else result.errorCount += 1;
          } else if (negationChanged(existingVal, statement)) {
            result.conflicts.push({ scope: "general", existingMemoryId: matchedGeneral.id, sourceId: documentId, resolutionRequired: true });
          } else {
            result.duplicateCount += 1;
          }
        } else {
          // Création dans la mémoire générale
          const memoryType = /pr[eé]f/i.test(statement)
            ? "work_preference"
            : /d[eé]veloppe|travaille|m[eé]tier|directeur|graphisme|design/i.test(statement)
              ? "identity_role"
              : isEvolving
                ? "temporary_information"
                : "work_preference";

          const created = personalRepository.upsertMemory({
            type: memoryType,
            subject: `Document — ${filename}`,
            value: statement,
            sourceType: "document",
            sourceReference: filename,
            status: "confirmed",
            confidence: 1,
            explicitConfirmation: true,
            sensitivity: "normal",
            useAllowed: true,
            metadata: {
              profileId: "arnaud",
              sourceFilename: filename,
              sourceId: documentId,
              importedAt: nowIso,
              stability: isEvolving ? "evolving" : "stable",
              scope: "general",
            },
          });
          const verified = created?.id ? personalRepository.getMemory(created.id) : null;
          if (verified && normalizeForComparison(verified.value) === normalizeForComparison(statement) && verified.sourceReference === filename) {
            result.savedCount += 1;
            result.generalCount += 1;
            result.memoryIds.push(created.id);
            existingGeneral.push(verified);
          } else result.errorCount += 1;
        }
      }
    }

    // 4. Vérification effective en base SQLite
    const effectiveTotal = result.savedCount + result.updatedCount;
    if (result.errorCount === 0 && (effectiveTotal > 0 || (result.duplicateCount > 0 && result.extractedCount > 0))) {
      result.success = true;
    }

    return result;
  }

  function formatImportResponse(importResult) {
    if (!importResult.success) {
      return "Je n’ai pas pu enregistrer ces informations dans la mémoire persistante.";
    }

    const totalSaved = importResult.savedCount + importResult.updatedCount;
    const lines = [
      "Import terminé.",
      "",
      `${totalSaved} information(s) mémorisée(s) :`,
      `- ${importResult.generalCount} en mémoire générale`,
      `- ${importResult.privateCount} en mémoire privée`,
    ];

    if (importResult.evolvingCount > 0) {
      lines.push(`${importResult.evolvingCount} information(s) marquée(s) comme évolutive(s).`);
    }
    if (importResult.duplicateCount > 0) {
      lines.push(`${importResult.duplicateCount} information(s) déjà connue(s).`);
    }
    if (importResult.ignoredCount > 0) {
      lines.push(`${importResult.ignoredCount} élément(s) sensible(s) ignoré(s).`);
    }
    if (importResult.conflicts?.length) lines.push(`${importResult.conflicts.length} contradiction(s) nécessite(nt) une vérification.`);

    return lines.join("\n");
  }

  return {
    formatImportResponse,
    importDocumentToMemory,
    isEvolvingData,
    isPrivateScope,
    isSecret,
    splitIntoAtomicStatements,
  };
}

module.exports = {
  createDocumentMemoryImporter,
  detectSubject,
  isEvolvingData,
  isPrivateScope,
  privateCategory,
  isSecret,
  normalizeForComparison,
  splitIntoAtomicStatements,
  tokenSimilarity,
};
