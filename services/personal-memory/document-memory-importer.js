"use strict";

const crypto = require("crypto");
const { SECRET_PATTERN } = require("../persistence/repositories/personal-intelligence-repository");

// Patterns pour détecter les secrets ou credentials
const EXTENDED_SECRET_PATTERN = /(?:sk-[A-Za-z0-9_-]{12,}|api[_-]?key\s*[:=]|password\s*[:=]|mot\s+de\s+passe\s*[:=]|BEGIN\s+(?:RSA\s+|EC\s+)?PRIVATE\s+KEY|bearer\s+[A-Za-z0-9._-]+|token\s*[:=]|secret\s*[:=]|seed\s+phrase|credential)/i;

// Contenus compris mais volontairement non mémorisés.
const INSTRUCTION_PATTERN = /^(?:analyse|analyser|explique|expliquer|résume|résumer|compare|comparer|écris|écrire|crée|créer|corrige|corriger|donne-moi|donne moi|dis-moi|dis moi|montre-moi|montre moi|affiche)\b/i;

const OPINION_PATTERN = /\b(?:à\s+mon\s+avis|selon\s+moi|je\s+(?:pense|trouve)\s+que|(?:tr[eè]s\s+)?(?:brillant[e]?|intelligent[e]?|g[eé]nial[e]?|formidable|stupide|idiot[e]?|nul(?:le)?|sympa))\b|\ballergique\s+aux?\s+(?:cons|imb[eé]ciles)\b/i;

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

// Heuristique pour déterminer le sujet, avec continuité locale entre phrases.
function resolveSubject(statement, previousSubject = null) {
  const normalized = String(statement || "").toLowerCase().trim();

  if (/\balexandra\b/.test(normalized)) {
    return { subjectId: "alexandra", nextSubject: "alexandra" };
  }
  if (/\bsinan\b/.test(normalized)) {
    return { subjectId: "sinan", nextSubject: "sinan" };
  }
  if (/\bkaan\b/.test(normalized)) {
    return { subjectId: "kaan", nextSubject: "kaan" };
  }
  if (/\barnaud\b/.test(normalized)) {
    return { subjectId: "arnaud", nextSubject: "arnaud" };
  }
  if (/\b(?:foyer|famille|maison)\b/.test(normalized)) {
    return { subjectId: "household", nextSubject: "household" };
  }

  if (/^elle\b/.test(normalized) && previousSubject === "alexandra") {
    return { subjectId: "alexandra", nextSubject: "alexandra" };
  }

  if (/^il\b/.test(normalized) && ["arnaud", "sinan", "kaan"].includes(previousSubject)) {
    return { subjectId: previousSubject, nextSubject: previousSubject };
  }

  if (/^(?:je|j['’]|mon\b|ma\b|mes\b|moi\b)/.test(normalized)) {
    return { subjectId: "arnaud", nextSubject: "arnaud" };
  }

  return { subjectId: "arnaud", nextSubject: previousSubject };
}

function detectSubject(statement, previousSubject = null) {
  return resolveSubject(statement, previousSubject).subjectId;
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
    const sourceType = String(options.sourceType || "document");
    const sourceReference = options.sourceReference === null
      ? null
      : String(options.sourceReference || filename);
    const sourceTag = sourceType === "document" ? "document-import" : "explicit-memory";
    const requestedScope = ["private", "project", "general"].includes(options.requestedScope)
      ? options.requestedScope
      : null;
    const projectId = String(options.projectId || "").trim();
    const projectName = String(options.projectName || "").trim();

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
      ignoredReasons: {
        opinion: 0,
        instruction: 0,
        unsupported: 0,
      },
      refusedCount: 0,
      refusedReasons: {
        secret: 0,
        unavailable_store: 0,
      },
      generalCount: 0,
      privateCount: 0,
      projectCount: 0,
      evolvingCount: 0,
      conflicts: [],
      memoryIds: [],
      errorCount: 0,
    };

    if (!textContent.trim()) {
      return result;
    }

    if (requestedScope === "project" && !projectId) {
      result.errorCount += 1;
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

    let activeSubject = null;

    for (const statement of atomicStatements) {
      // 1. Filtrage strict des secrets
      if (isSecret(statement)) {
        result.refusedCount += 1;
        result.refusedReasons.secret += 1;
        continue;
      }

      if (INSTRUCTION_PATTERN.test(statement)) {
        result.ignoredCount += 1;
        result.ignoredReasons.instruction += 1;
        continue;
      }

      if (OPINION_PATTERN.test(statement)) {
        result.ignoredCount += 1;
        result.ignoredReasons.opinion += 1;
        continue;
      }

      // 2. Classification
      const detectedPrivate = isPrivateScope(statement);
      const forcedPrivate = requestedScope === "private";
      const forcedProject = requestedScope === "project";
      const usePrivateStore = detectedPrivate || forcedPrivate || forcedProject;
      const isEvolving = isEvolvingData(statement);

      const category = usePrivateStore
        ? (detectedPrivate ? privateCategory(statement) : "general")
        : null;

      if (isEvolving) result.evolvingCount += 1;

      const subjectResolution = resolveSubject(statement, activeSubject);
      const subjectId = forcedProject
        ? `project:${projectId}`
        : subjectResolution.subjectId;

      activeSubject = subjectResolution.nextSubject;

      // 3. Déduplication et gestion de l'évolution
      if (usePrivateStore) {
        if (!privateMemoryService || !privateMemoryService.available) {
          result.refusedCount += 1;
          result.refusedReasons.unavailable_store += 1;
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
                apiPolicy: forcedProject ? "contextual" : "local_only",
                payload: {
                  ...(matchedMemory.payload || {}),
                  stability: "evolving",
                  scope: forcedProject ? "project" : "private",
                  projectName: forcedProject ? projectName || null : null,
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
              if (forcedProject) result.projectCount += 1;
              else result.privateCount += 1;
              result.memoryIds.push(updated.id);
              const index = existingPrivate.findIndex((item) => item.id === updated.id);
              if (index >= 0) existingPrivate[index] = verified;
            } else result.errorCount += 1;
          } else if (negationChanged(matchedMemory.statement, statement)) {
            result.conflicts.push({ scope: forcedProject ? "project" : "private", existingMemoryId: matchedMemory.id, sourceId: documentId, resolutionRequired: true });
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
            apiPolicy: forcedProject ? "contextual" : "local_only",
            sourceType,
            sourceReference,
            tags: [sourceTag, isEvolving ? "evolving" : "stable"],
            payload: {
              sourceFilename: filename,
              sourceId: documentId,
              importedAt: nowIso,
              stability: isEvolving ? "evolving" : "stable",
              scope: forcedProject ? "project" : "private",
              projectName: forcedProject ? projectName || null : null,
            },
          });
          const verified = created?.id ? privateMemoryService.getMemory(created.id) : null;
          if (created && !created.duplicate && verified?.statement === statement && verified.sourceReference === sourceReference) {
            result.savedCount += 1;
            if (forcedProject) result.projectCount += 1;
            else result.privateCount += 1;
            result.memoryIds.push(created.id);
            existingPrivate.push(verified);
            if (verified.status === "pending_review" && verified.payload?.conflictWithId) result.conflicts.push({ scope: forcedProject ? "project" : "private", memoryId: verified.id, existingMemoryId: verified.payload.conflictWithId, resolutionRequired: true });
          } else if (created?.duplicate) {
            result.duplicateCount += 1;
          } else result.errorCount += 1;
        }
      } else {
        // Mémoire générale (stockée dans personalRepository)
        if (!personalRepository) {
          result.refusedCount += 1;
          result.refusedReasons.unavailable_store += 1;
          continue;
        }

        let matchedGeneral = null;
        let highestSim = 0;
        for (const existing of existingGeneral) {
          const existingProfileId = existing.metadata?.profileId || "arnaud";
          if (existingProfileId !== subjectId) continue;

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
            : /d[eé]veloppe|travaille|m[eé]tier|directeur|directrice|graphisme|design/i.test(statement)
              ? "identity_role"
              : isEvolving
                ? "temporary_information"
                : null;

          if (!memoryType) {
            result.ignoredCount += 1;
            result.ignoredReasons.unsupported += 1;
            continue;
          }

          const created = personalRepository.upsertMemory({
            type: memoryType,
            subject: sourceType === "document" ? `Document — ${filename}` : "Mémoire explicite",
            value: statement,
            sourceType,
            sourceReference,
            status: "confirmed",
            confidence: 1,
            explicitConfirmation: true,
            sensitivity: "normal",
            useAllowed: true,
            metadata: {
              profileId: subjectId,
              sourceFilename: filename,
              sourceId: documentId,
              importedAt: nowIso,
              stability: isEvolving ? "evolving" : "stable",
              scope: "general",
            },
          });
          const verified = created?.id ? personalRepository.getMemory(created.id) : null;
          if (verified && normalizeForComparison(verified.value) === normalizeForComparison(statement) && verified.sourceReference === sourceReference) {
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
    const totalSaved = importResult.savedCount + importResult.updatedCount;
    const ignoredReasons = importResult.ignoredReasons || {};
    const refusedReasons = importResult.refusedReasons || {};
    const lines = [];

    if (totalSaved > 0 || importResult.duplicateCount > 0) {
      lines.push(
        "Import terminé.",
        "",
        `${totalSaved} information(s) mémorisée(s) :`,
        `- ${importResult.generalCount} en mémoire générale`,
        `- ${importResult.privateCount} en mémoire privée`,
        `- ${importResult.projectCount || 0} en mémoire projet`
      );
    } else if (
      importResult.ignoredCount > 0
      || importResult.refusedCount > 0
      || importResult.conflicts?.length
    ) {
      lines.push("Import terminé sans nouvelle mémoire.");
    } else {
      return "Je n’ai pas pu enregistrer ces informations dans la mémoire persistante.";
    }

    if (importResult.evolvingCount > 0) {
      lines.push(`${importResult.evolvingCount} information(s) marquée(s) comme évolutive(s).`);
    }

    if (importResult.duplicateCount > 0) {
      lines.push(`${importResult.duplicateCount} information(s) déjà connue(s).`);
    }

    if (importResult.ignoredCount > 0) {
      lines.push(`${importResult.ignoredCount} élément(s) ignoré(s).`);

      if (ignoredReasons.opinion > 0) {
        lines.push(`- ${ignoredReasons.opinion} opinion(s) ou formulation(s) subjective(s)`);
      }

      if (ignoredReasons.instruction > 0) {
        lines.push(`- ${ignoredReasons.instruction} instruction(s) ou demande(s) d’action`);
      }

      if (ignoredReasons.unsupported > 0) {
        lines.push(`- ${ignoredReasons.unsupported} élément(s) sans catégorie de mémoire durable`);
      }
    }

    if (importResult.refusedCount > 0) {
      lines.push(`${importResult.refusedCount} élément(s) refusé(s).`);

      if (refusedReasons.secret > 0) {
        lines.push(`- ${refusedReasons.secret} secret(s) ou identifiant(s) sensible(s) détecté(s)`);
      }

      if (refusedReasons.unavailable_store > 0) {
        lines.push(`- ${refusedReasons.unavailable_store} élément(s) dont le stockage requis était indisponible`);
      }
    }

    if (importResult.conflicts?.length) {
      lines.push(`${importResult.conflicts.length} contradiction(s) nécessite(nt) une vérification.`);
    }

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
  resolveSubject,
  isEvolvingData,
  isPrivateScope,
  privateCategory,
  isSecret,
  negationChanged,
  normalizeForComparison,
  splitIntoAtomicStatements,
  tokenSimilarity,
};
