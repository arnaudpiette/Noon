"use strict";

// Commandes explicites de mémoire. Elles sont volontairement déterministes :
// le contenu de la conversation ne choisit ni le profil ni une action d'écriture.

const { createDocumentMemoryImporter, isPrivateScope } = require("./document-memory-importer");

const SUBJECTS = new Set(["arnaud", "alexandra", "sinan", "kaan", "household", "noon", "projects"]);
const MEMORY_TIME_ZONE = "Europe/Paris";

// Détection explicite des commandes d'import documentaire
const DOCUMENT_IMPORT_PATTERN = /^(?:noon,?\s*)?(?:retiens|souviens-toi|m[eé]morise|enregistre|importe|garde)\b.*(?:\b(?:dossier|documents?|fichiers?|pi[eè]ces?\s+jointes?|rapport|texte)\b|\btout\s+ce\s+qui\s+est\s+(?:important|utile|pertinent)\s+ici\b|\bce\s+que\s+je\s+viens\s+de\s+(?:te\s+donner|t['’]envoyer|te\s+transmettre|partager)\b)/i;

// Détection de l'inspection de mémoire séparant générale et privée ou par source
const MEMORY_INSPECT_PATTERN = /^(?:noon,?\s*)?(?:montre(?:-moi)?|affiche|qu['’]as-tu\s+m[eé]moris[eé]|quelles?\s+informations?\s+(?:as-tu|sont)\s+m[eé]moris[eé]es?)\s+(?:.*?(?:m[eé]moire|enregistr[eé]|import[eé]|provenant|dossier|document|fichier).*)$/i;

function clean(value, max = 12000) {
  return String(value || "").replace(/[\0\r\n]+/g, " ").replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "").slice(0, max);
}

function cleanDirectStatement(raw) {
  let statement = clean(raw);
  // Supprimer les préfixes d'instruction parasites
  statement = statement.replace(/^(?:que\s+|qu['’]\s*|de\s+)/i, "").trim();
  statement = statement.replace(/^(?:noon,?\s*)?(?:retiens|souviens-toi|m[eé]morise|enregistre)\s+(?:que\s+|qu['’]\s*)?/i, "").trim();
  statement = statement.replace(/[.!?]+$/, "").trim();
  return statement;
}

function subjectFor(text) {
  const normalized = String(text || "").toLocaleLowerCase("fr");
  if (/\balexandra\b/.test(normalized)) return "alexandra";
  if (/\bsinan\b/.test(normalized)) return "sinan";
  if (/\bkaan\b/.test(normalized)) return "kaan";
  if (/\b(?:foyer|famille)\b/.test(normalized)) return "household";
  return "arnaud";
}

function localDateKey(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: MEMORY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftDateKey(key, days) { return localDateKey(new Date(new Date(`${key}T12:00:00Z`).getTime() + days * 86_400_000)); }

function importDateRange(query, now = new Date()) {
  const normalized = String(query || "").toLocaleLowerCase("fr");
  const today = localDateKey(now);
  const exact = require("../intents/temporal-parser").parseTemporal(normalized, { now, timeZone: MEMORY_TIME_ZONE }).date;
  if (exact) return { start: exact, end: exact };
  if (/\b(?:r[eé]cemment|recently)\b/.test(normalized)) return { start: shiftDateKey(today, -7), end: today };
  if (/\b(?:cette semaine|this week)\b/.test(normalized)) {
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
    return { start: shiftDateKey(today, 1 - weekday), end: today };
  }
  return null;
}

function parseConversationMemoryCommand(text) {
  const source = clean(text, 4000);
  if (!source) return null;

  // 1. Vérifier d'abord s'il s'agit d'un import documentaire
  if (DOCUMENT_IMPORT_PATTERN.test(source)) {
    return {
      action: "import_document",
      subjectId: subjectFor(source),
      rawQuery: source,
    };
  }

  // 2. Vérifier s'il s'agit d'une inspection de mémoire
  if (MEMORY_INSPECT_PATTERN.test(source)) {
    return {
      action: "inspect",
      subjectId: subjectFor(source),
      query: source,
    };
  }

  // 3. Commande directe d'enregistrement : "Noon, retiens que je préfère React"
  let match = source.match(/^(?:noon,?\s*)?(?:retiens|souviens-toi|m[eé]morise|enregistre)\s+(?:que\s+)?(.+)$/i);
  if (match) {
    const rawStatement = match[1];
    // Double vérification : si l'énoncé fait référence à un dossier/document, c'est un import
    if (/\b(?:tout\s+ce\s+qui\s+est\s+important\s+dans\s+ce|les\s+informations\s+de\s+ce|ce\s+qui\s+est\s+utile\s+dans\s+(?:ce|les)|dans\s+ce\s+dossier|dans\s+ce\s+document)\b/i.test(rawStatement)) {
      return {
        action: "import_document",
        subjectId: subjectFor(source),
        rawQuery: source,
      };
    }
    const statement = cleanDirectStatement(rawStatement);
    return { action: "save", subjectId: subjectFor(source), statement };
  }

  // 4. Recherche de mémoire
  match = source.match(/^(?:noon,?\s*)?(?:qu['’]est-ce que tu sais sur|que sais-tu sur|que sais tu sur)\s+(.+)$/i);
  if (match) {
    const subjectId = subjectFor(match[1]);
    const query = clean(match[1]);
    const onlySubject = new RegExp(`^${subjectId}$`, "i").test(query);
    return { action: "search", subjectId, query: onlySubject ? "" : query };
  }
  match = source.match(/^(?:noon,?\s*)?(?:cherche|recherche|retrouve)\s+(?:dans\s+)?(?:ma\s+)?m[eé]moire\s+(.+)$/i);
  if (match) return { action: "search", subjectId: subjectFor(match[1]), query: clean(match[1]) };

  // 5. Modification et suppression
  match = source.match(/^(?:noon,?\s*)?(?:modifie|corrige|mets à jour)\s+(?:dans\s+)?(?:ma\s+)?m[eé]moire\s+(.+?)\s+(?:en|par)\s+(.+)$/i);
  if (match) return { action: "update", subjectId: subjectFor(source), previous: clean(match[1]), statement: clean(match[2]) };
  match = source.match(/^(?:noon,?\s*)?(?:oublie|supprime|efface)\s+(?:de\s+)?(?:ma\s+)?m[eé]moire\s+(.+)$/i);
  if (match) return { action: "delete", subjectId: subjectFor(source), previous: clean(match[1]) };

  return null;
}

function matchingMemories(service, subjectId, query) {
  const needle = clean(query, 4000).toLocaleLowerCase("fr");
  return service.listMemories({ subjectId, includeDeleted: false })
    .filter((item) => item.statement.toLocaleLowerCase("fr").includes(needle));
}

function executeConversationMemoryCommand(serviceOrContext, command, options = {}) {
  // Support à la fois d'un simple service (ex: tests historiques) ou d'un contexte étendu
  const isContext = serviceOrContext && typeof serviceOrContext === "object" && ("privateMemoryService" in serviceOrContext || "personalRepository" in serviceOrContext);
  const privateService = isContext ? serviceOrContext.privateMemoryService : serviceOrContext;
  const personalRepo = isContext ? serviceOrContext.personalRepository : (options.personalRepository || null);
  const attachmentResolver = isContext ? serviceOrContext.attachmentResolver : (options.attachmentResolver || null);
  const documentImporter = (isContext && serviceOrContext.documentImporter)
    ? serviceOrContext.documentImporter
    : createDocumentMemoryImporter({ personalRepository: personalRepo, privateMemoryService: privateService });

  if (!privateService?.available && !personalRepo) {
    return { status: "unavailable", answer: "La mémoire locale est indisponible." };
  }
  if (!command || !SUBJECTS.has(command.subjectId)) return null;

  // -------------------------------------------------------------
  // ACTION : IMPORT DOCUMENTAIRE
  // -------------------------------------------------------------
  if (command.action === "import_document") {
    let resolvedDocuments = [];
    if (attachmentResolver) {
      const resolutionContext = {
        conversationId: options.conversationId,
        sessionId: options.sessionId,
        currentAttachments: options.currentAttachments || [],
      };
      resolvedDocuments = attachmentResolver.resolveAttachmentReferences
        ? attachmentResolver.resolveAttachmentReferences(command.rawQuery, resolutionContext)
        : [attachmentResolver.resolveAttachmentReference(command.rawQuery, resolutionContext)].filter(Boolean);
    } else if (Array.isArray(options.currentAttachments) && options.currentAttachments.length > 0) {
      resolvedDocuments = [...options.currentAttachments];
    }

    if (!resolvedDocuments.length) {
      return {
        status: "no_document",
        answer: "Aucun document trouvé à mémoriser. Joignez un document ou précisez le fichier concerné.",
      };
    }

    const importResult = {
      success: false, sources: [], extractedCount: 0, savedCount: 0, updatedCount: 0,
      duplicateCount: 0, ignoredCount: 0, generalCount: 0, privateCount: 0,
      evolvingCount: 0, conflicts: [], memoryIds: [], errorCount: 0,
    };
    try {
      for (const resolvedDoc of resolvedDocuments) {
        if (!resolvedDoc.extractedText && resolvedDoc.content) resolvedDoc.extractedText = resolvedDoc.content;
        else if (!resolvedDoc.extractedText && attachmentResolver) resolvedDoc.extractedText = attachmentResolver.extractTextFromAttachment(resolvedDoc);
        const itemResult = documentImporter.importDocumentToMemory(resolvedDoc, { subjectId: command.subjectId });
        importResult.sources.push(itemResult.source);
        for (const key of ["extractedCount", "savedCount", "updatedCount", "duplicateCount", "ignoredCount", "generalCount", "privateCount", "evolvingCount", "errorCount"]) importResult[key] += Number(itemResult[key]) || 0;
        importResult.conflicts.push(...(itemResult.conflicts || []));
        importResult.memoryIds.push(...(itemResult.memoryIds || []));
      }
      importResult.success = importResult.savedCount + importResult.updatedCount > 0 || importResult.duplicateCount > 0 && importResult.errorCount === 0;
    } catch {
      importResult.errorCount += 1;
    }

    const formattedAnswer = documentImporter.formatImportResponse(importResult);

    if (!importResult.success) {
      const verifiedCount = importResult.savedCount + importResult.updatedCount;
      if (importResult.conflicts.length && verifiedCount === 0 && importResult.errorCount === 0) return {
        status: "needs_clarification",
        answer: `${importResult.conflicts.length} contradiction(s) détectée(s). Aucune ancienne information n’a été écrasée.`,
        memoryIds: [], importResult,
      };
      return {
        status: verifiedCount > 0 ? "partial" : "error",
        answer: verifiedCount > 0
          ? `Import incomplet : ${verifiedCount} information(s) vérifiée(s), mais au moins une écriture a échoué.`
          : "Je n’ai pas pu enregistrer ces informations dans la mémoire persistante.",
        memoryIds: importResult.memoryIds || [],
        importResult,
      };
    }

    return {
      status: "saved",
      answer: formattedAnswer,
      memoryIds: importResult.memoryIds || [],
      importResult,
    };
  }

  // -------------------------------------------------------------
  // ACTION : INSPECT (Séparation Mémoire Générale / Mémoire Privée)
  // -------------------------------------------------------------
  if (command.action === "inspect") {
    const rawQuery = String(command.query || "").toLowerCase();
    const generalItems = [];
    const privateItems = [];

    // Détection d'un nom de fichier ciblé dans la requête (ex: personal-context.txt)
    const fileMatch = rawQuery.match(/([a-z0-9_.-]+\.(?:txt|pdf|docx|md|csv))/i);
    const targetFile = fileMatch ? fileMatch[1].toLowerCase() : null;

    // Détection d'une date (ex: hier)
    const requestedRange = importDateRange(rawQuery);
    const dateMatches = (itemDate) => !requestedRange || itemDate >= requestedRange.start && itemDate <= requestedRange.end;

    // 1. Lire la mémoire générale depuis personalRepo
    if (personalRepo) {
      const allGeneral = personalRepo.listMemories({ limit: 500 });
      for (const item of allGeneral) {
        if (item.useAllowed === false || item.status === "rejected" || item.status === "expired") continue;
        const text = typeof item.value === "string" ? item.value : JSON.stringify(item.value);
        const itemFile = (item.sourceReference || item.metadata?.sourceFilename || "").toLowerCase();
        const itemDate = localDateKey(item.metadata?.importedAt || item.createdAt || item.updatedAt);

        if (targetFile && !itemFile.includes(targetFile)) continue;
        if (!dateMatches(itemDate)) continue;

        generalItems.push(text);
      }
    }

    // 2. Lire la mémoire privée depuis privateService
    if (privateService && privateService.available) {
      const allPrivate = privateService.listMemories({ includeDeleted: false });
      for (const item of allPrivate) {
        if (item.status === "deleted") continue;
        const text = item.statement;
        const itemFile = (item.sourceReference || item.payload?.sourceFilename || "").toLowerCase();
        const itemDate = localDateKey(item.payload?.importedAt || item.createdAt || item.updatedAt);

        if (targetFile && !itemFile.includes(targetFile)) continue;
        if (!dateMatches(itemDate)) continue;

        privateItems.push(text);
      }
    }

    const lines = [];
    lines.push("Mémoire générale :");
    if (generalItems.length) {
      for (const item of generalItems) lines.push(`- ${item}`);
    } else {
      lines.push("aucune information.");
    }

    lines.push("");
    lines.push("Mémoire privée :");
    if (privateItems.length) {
      for (const item of privateItems) lines.push(`- ${item}`);
    } else {
      lines.push("aucune information.");
    }

    return {
      status: "inspected",
      answer: lines.join("\n"),
      generalCount: generalItems.length,
      privateCount: privateItems.length,
    };
  }

  // -------------------------------------------------------------
  // ACTION : SAVE DIRECTE
  // -------------------------------------------------------------
  if (command.action === "save") {
    if (!command.statement) return { status: "needs_clarification", answer: "Que dois-je retenir exactement ?" };

    const statement = command.statement;
    const isPrivate = isPrivateScope(statement);

    try {
      if (isPrivate && privateService && privateService.available) {
        const item = privateService.createMemory({
          subjectId: command.subjectId,
          category: "general",
          statement,
          sensitivity: "medium",
          status: "confirmed",
          confidence: 1,
          consentStatus: "granted",
          apiPolicy: "local_only",
          sourceType: "explicit-voice-or-chat",
        });
        return {
          status: item.duplicate ? "unchanged" : "saved",
          scope: "private",
          answer: item.duplicate
            ? "Cette information est déjà dans votre mémoire privée."
            : "C’est retenu dans votre mémoire privée.",
          memoryIds: [item.id],
        };
      } else if (!isPrivate && personalRepo) {
        // Enregistrer en mémoire générale
        const existing = personalRepo.listMemories({ limit: 500 });
        const duplicate = existing.find((m) => {
          const val = typeof m.value === "string" ? m.value : JSON.stringify(m.value);
          return val.toLowerCase().trim() === statement.toLowerCase().trim();
        });

        if (duplicate) {
          return {
            status: "unchanged",
            scope: "general",
            answer: "Cette information est déjà dans votre mémoire générale.",
            memoryIds: [duplicate.id],
          };
        }

        const item = personalRepo.upsertMemory({
          type: "work_preference",
          subject: "Préférence personnelle",
          value: statement,
          status: "confirmed",
          confidence: 1,
          explicitConfirmation: true,
          sensitivity: "normal",
          sourceType: "explicit-voice-or-chat",
          metadata: { profileId: command.subjectId, scope: "general" },
        });

        return {
          status: "saved",
          scope: "general",
          answer: "C’est retenu dans votre mémoire générale.",
          memoryIds: [item.id],
        };
      } else if (privateService && privateService.available) {
        // Fallback compatibilité si personalRepo absent
        const item = privateService.createMemory({
          subjectId: command.subjectId,
          category: "general",
          statement,
          sensitivity: "low",
          status: "confirmed",
          confidence: 1,
          consentStatus: "granted",
          apiPolicy: "contextual",
          sourceType: "explicit-voice-or-chat",
        });
        return {
          status: item.duplicate ? "unchanged" : "saved",
          scope: "private",
          answer: item.duplicate
            ? "Cette information est déjà dans votre mémoire privée."
            : "C’est retenu dans votre mémoire privée.",
          memoryIds: [item.id],
        };
      }
    } catch {
      return {
        status: "error",
        answer: "Je n’ai pas pu enregistrer cette information dans la mémoire persistante.",
      };
    }
  }

  // -------------------------------------------------------------
  // ACTION : SEARCH
  // -------------------------------------------------------------
  if (command.action === "search") {
    const matches = privateService ? matchingMemories(privateService, command.subjectId, command.query) : [];
    if (!matches.length) return { status: "not_found", answer: "Je n’ai trouvé aucune information correspondante dans votre mémoire privée." };
    return { status: "found", answer: matches.slice(0, 5).map((item) => item.statement).join(" "), memoryIds: matches.slice(0, 5).map((item) => item.id) };
  }

  // -------------------------------------------------------------
  // ACTION : UPDATE & DELETE
  // -------------------------------------------------------------
  if (!privateService) return { status: "unavailable", answer: "La mémoire privée locale est indisponible." };

  const matches = matchingMemories(privateService, command.subjectId, command.previous);
  if (!matches.length) return { status: "not_found", answer: "Je n’ai pas trouvé cette information dans votre mémoire privée." };
  if (matches.length > 1) return { status: "needs_clarification", answer: "Plusieurs souvenirs correspondent. Dites la phrase complète à modifier ou à oublier.", memoryIds: matches.map((item) => item.id) };
  if (command.action === "update") {
    const item = privateService.updateMemory(matches[0].id, { statement: command.statement, status: "confirmed", consentStatus: "granted" }, "correction explicite par conversation");
    return { status: "updated", answer: "L’information a été mise à jour dans votre mémoire privée.", memoryIds: [item.id] };
  }
  privateService.forgetMemory(matches[0].id);
  return { status: "deleted", answer: "Cette information a été oubliée de votre mémoire privée.", memoryIds: [matches[0].id] };
}

module.exports = {
  cleanDirectStatement,
  executeConversationMemoryCommand,
  importDateRange,
  parseConversationMemoryCommand,
};
