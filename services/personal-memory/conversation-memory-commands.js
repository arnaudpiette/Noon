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
  return String(value || "").replace(/[\0\r\n]+/g, " ").replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "").trim().slice(0, max);
}

function cleanDirectStatement(raw) {
  let statement = clean(raw);
  // Supprimer les préfixes d'instruction parasites
  statement = statement.replace(/^(?:que\s+|qu['’]\s*|de\s+)/i, "").trim();
  statement = statement.replace(/^(?:noon,?\s*)?(?:retiens|souviens-toi|m[eé]morise|enregistre)\s+(?:que\s+|qu['’]\s*)?/i, "").trim();
  statement = statement.replace(/[.!?]+$/, "").trim();
  return statement;
}

function requestedMemoryScope(text) {
  const source = String(text || "").toLocaleLowerCase("fr");
  if (/\bm[eé]moire\s+(?:locale\s+)?(?:priv[eé]e|sensible)\b|\bm[eé]moire\s+locale\s+priv[eé]e\b/.test(source)) return "private";
  if (/\bm[eé]moire\s+(?:de\s+ce\s+projet|du\s+projet)\b/.test(source)) return "project";
  if (/\bm[eé]moire\s+(?:g[eé]n[eé]rale|persistante)\b/.test(source)) return "general";
  return null;
}

function stripMemoryScope(text) {
  return cleanDirectStatement(String(text || "")
    .replace(/^(?:dans\s+)?(?:ta|ma|la)\s+m[eé]moire\s+(?:locale\s+)?(?:priv[eé]e|sensible|g[eé]n[eé]rale|persistante)\s+(?:que\s+)?/i, "")
    .replace(/^(?:dans\s+)?(?:la\s+)?m[eé]moire\s+(?:de\s+ce\s+projet|du\s+projet)(?:\s+.+?)?\s+que\s+/i, "")
    .replace(/^(?:dans\s+)?(?:la\s+)?m[eé]moire\s+(?:de\s+ce\s+projet|du\s+projet)\s+/i, "")
    .replace(/\s+(?:de|dans)\s+(?:ta|ma|la)\s+m[eé]moire\s+(?:locale\s+)?(?:priv[eé]e|sensible|g[eé]n[eé]rale|persistante)\s*$/i, "")
    .replace(/\s+(?:de|dans)\s+(?:la\s+)?m[eé]moire\s+(?:de\s+ce\s+projet|du\s+projet)\s*$/i, ""));
}

function normalizeFrenchCommand(text) {
  return clean(text, 4000).toLocaleLowerCase("fr").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[’']/g, " ").replace(/-/g, " ")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function parseMemoryReadIntent(source) {
  const normalized = normalizeFrenchCommand(source);
  const hasMemoryNoun = /\b(?:memoire|memorise(?:e|es|s)?|retenu|garde(?:e|es|s|r)?|enregistre(?:e|es|s)?)\b/.test(normalized);
  const questionShape = /^(?:noon )?(?:qu as tu|qu est ce que tu as|que sais tu|qu est ce que tu sais|quelles? informations? as tu|montre moi|affiche)/.test(normalized);
  const auditShape = /^(?:noon )?(?:analyse|analyser|verifie|verifier|audite|auditer)\b.*\b(?:retenu|memorise|memoire|enregistre|garde)\b/.test(normalized);

  if (!questionShape && !auditShape) return null;
  if (!auditShape && !hasMemoryNoun && !/\b(?:sais tu|tu sais) sur moi\b/.test(normalized)) return null;

  let requestedScope = requestedMemoryScope(source);
  if (/\b(?:memoire privee|memoire sensible|garde localement)\b/.test(normalized)) requestedScope = "private";
  if (/\b(?:sur ce projet|memoire (?:de ce|du) projet)\b/.test(normalized)) requestedScope = "project";
  if (/\bmemoire (?:generale|persistante)\b/.test(normalized)) requestedScope = "general";

  let query = "";
  const targeted = normalized.match(/\b(?:concernant|sur)\s+(.+)$/);
  if (targeted) query = targeted[1].replace(/^(?:moi|ce projet)$/, "").trim();
  const temporal = /\baujourd hui\b/.test(normalized) ? "aujourd'hui" : "";
  if (temporal) query = temporal;

  const subjectIds = subjectsFor(source);

  // Dans un audit multi-profils, les noms sont des cibles de lecture,
  // pas une chaîne à rechercher littéralement dans les souvenirs.
  if (auditShape && subjectIds.length > 1) query = "";

  return {
    action: "memory_read",
    intent: auditShape ? "MEMORY_AUDIT" : query ? "MEMORY_READ" : "MEMORY_INVENTORY",
    subjectId: subjectIds[0] || subjectFor(source),
    subjectIds,
    query,
    requestedScope,
    revealPrivate: requestedScope === "private",
    readOnly: true,
  };
}

function subjectFor(text) {
  const normalized = String(text || "").toLocaleLowerCase("fr");
  if (/\balexandra\b/.test(normalized)) return "alexandra";
  if (/\bsinan\b/.test(normalized)) return "sinan";
  if (/\bkaan\b/.test(normalized)) return "kaan";
  if (/\b(?:foyer|famille)\b/.test(normalized)) return "household";
  return "arnaud";
}

function subjectsFor(text) {
  const normalized = String(text || "").toLocaleLowerCase("fr");

  const patterns = [
    ["arnaud", /\barnaud\b/],
    ["alexandra", /\balexandra\b/],
    ["sinan", /\bsinan\b/],
    ["kaan", /\bkaan\b/],
    ["household", /\b(?:foyer|famille)\b/],
    ["noon", /\bnoon\b/],
    ["projects", /\bprojets?\b/],
  ];

  return patterns
    .map(([id, pattern]) => ({ id, index: normalized.search(pattern) }))
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.id)
    .filter((id, index, values) => values.indexOf(id) === index);
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
  let requestedScope = requestedMemoryScope(source);
  if (/\bsur ce projet\b/i.test(source)) requestedScope = "project";


  // Une commande explicite "Retiens que..." décrit d'abord des faits à mémoriser.
  // Les mots "document" ou "fichier" présents plus loin dans le contenu ne doivent
  // pas détourner toute la commande vers l'import documentaire.
  const explicitSaveMatch = source.match(
    /^(?:noon,?\s*)?(?:retiens|souviens-toi|m[eé]morise|enregistre)\s+(?:que\s+|qu['’]\s*)(.+)$/i
  );

  if (explicitSaveMatch) {
    const rawStatement = explicitSaveMatch[1];

    // Une vraie demande d'import reste prioritaire même sous la forme "... que ...".
    if (/\b(?:tout\s+ce\s+qui\s+est\s+important\s+dans\s+ce|les\s+informations\s+de\s+ce|ce\s+qui\s+est\s+utile\s+dans\s+(?:ce|les)|dans\s+ce\s+dossier|dans\s+ce\s+document)\b/i.test(rawStatement)) {
      return {
        action: "import_document",
        subjectId: subjectFor(source),
        rawQuery: source,
      };
    }

    const statement = stripMemoryScope(rawStatement);

    return {
      action: "save",
      subjectId: subjectFor(source),
      statement,
      requestedScope,
    };
  }

  // 1. Vérifier d'abord s'il s'agit d'un import documentaire
  if (DOCUMENT_IMPORT_PATTERN.test(source)) {
    return {
      action: "import_document",
      subjectId: subjectFor(source),
      rawQuery: source,
    };
  }

  const memoryRead = parseMemoryReadIntent(source);
  if (memoryRead) return memoryRead;

  // 2. Vérifier s'il s'agit d'une inspection de mémoire
  if (MEMORY_INSPECT_PATTERN.test(source)) {
    return {
      action: "inspect",
      subjectId: subjectFor(source),
      query: source,
      requestedScope,
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
    const statement = stripMemoryScope(rawStatement);
    return { action: "save", subjectId: subjectFor(source), statement, requestedScope };
  }

  match = source.match(/^(?:noon,?\s*)?qu['’]as-tu\s+retenu(?:\s+sur\s+ce\s+projet)?$/i);
  if (match) return { action: "inspect", subjectId: "arnaud", query: "", requestedScope };
  match = source.match(/^(?:noon,?\s*)?qu['’]as-tu\s+gard[eé]\s+(?:en\s+m[eé]moire|localement)$/i);
  if (match) return { action: "inspect", subjectId: "arnaud", query: "", requestedScope };

  match = source.match(/^(?:noon,?\s*)?qu['’]as-tu\s+(?:retenu|gard[eé])(?:\s+(?:dans|sur|concernant)\s+(.+))?$/i);
  if (match) return { action: requestedScope ? "search" : "inspect", subjectId: subjectFor(source), query: stripMemoryScope(match[1] || ""), requestedScope };
  match = source.match(/^(?:noon,?\s*)?qu['’]as-tu\s+dans\s+(?:ta|ma)\s+m[eé]moire(?:\s+(?:locale\s+)?(?:priv[eé]e|sensible|g[eé]n[eé]rale|persistante))?(?:\s+(?:sur|concernant)\s+(.+))?$/i);
  if (match) return { action: requestedScope ? "search" : "inspect", subjectId: subjectFor(source), query: clean(match[1] || ""), requestedScope };
  match = source.match(/^(?:noon,?\s*)?qu['’]est-ce que tu sais sur moi\s*$/i);
  if (match) return { action: "inspect", subjectId: "arnaud", query: "", requestedScope };
  match = source.match(/^(?:noon,?\s*)?quelles?\s+informations?\s+as-tu\s+enregistr[eé]es?\s+(aujourd['’]hui)\s*$/i);
  if (match) return { action: "inspect", subjectId: "arnaud", query: match[1], requestedScope };
  if (/^(?:noon,?\s*)?(?:non,?\s*)?(?:oublie|supprime|efface)\s+(?:ça|cela)$/i.test(source)) return { action: "delete_recent", subjectId: "arnaud" };

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
  if (match) return { action: "delete", subjectId: subjectFor(source), previous: stripMemoryScope(match[1]), requestedScope };
  match = source.match(/^(?:noon,?\s*)?(?:oublie|supprime|efface)\s+(.+?)(?:\s+(?:de|dans)\s+(?:ta|ma|la)\s+m[eé]moire(?:\s+(?:locale\s+)?(?:priv[eé]e|sensible|g[eé]n[eé]rale|persistante))?)$/i);
  if (match) return { action: "delete", subjectId: subjectFor(source), previous: clean(match[1]), requestedScope };

  return null;
}

function matchingMemories(service, subjectId, query) {
  const needle = clean(query, 4000).toLocaleLowerCase("fr");
  return service.listMemories({ subjectId, includeDeleted: false })
    .filter((item) => item.statement.toLocaleLowerCase("fr").includes(needle));
}

function commandReceipt({ success, operation, scope, persisted, memoryIds = [] }) {
  return { success, operation, scope, automatic: false, persisted, created: operation === "create" && success ? 1 : 0, updated: operation === "update" && success ? 1 : 0, deleted: operation === "delete" && success ? 1 : 0, skipped: operation === "skip" && success ? 1 : 0, memoryIds };
}

function activeGeneralMemories(repository) {
  if (!repository?.listMemories) return [];
  return repository.listMemories({ limit: 500 }).filter((item) => item.useAllowed !== false && !["rejected", "expired", "blocked"].includes(item.status));
}

function activePrivateMemories(service) {
  if (!service?.available) return [];
  return service.listMemories({ includeDeleted: false }).filter((item) => item.status === "confirmed");
}

function memoryText(item) { return typeof item.value === "string" ? item.value : JSON.stringify(item.value); }
function includesQuery(value, query) { return normalizeFrenchCommand(value).includes(normalizeFrenchCommand(query)); }

function executeMemoryRead({ personalRepository, privateMemoryService }, command, options = {}) {
  const dateRange = importDateRange(command.query);
  const dateMatches = (value) => !dateRange || (() => { const key = localDateKey(value); return key >= dateRange.start && key <= dateRange.end; })();
  let general = activeGeneralMemories(personalRepository).filter((item) => dateMatches(item.createdAt || item.updatedAt));
  let privateItems = activePrivateMemories(privateMemoryService).filter((item) => dateMatches(item.createdAt || item.updatedAt));
  const projectSubject = options.projectId ? `project:${options.projectId}` : null;
  const project = projectSubject ? privateItems.filter((item) => item.subjectId === projectSubject) : [];
  privateItems = privateItems.filter((item) => !item.subjectId.startsWith("project:"));

  const requestedSubjectIds = Array.isArray(command.subjectIds)
    ? command.subjectIds.filter((id) => SUBJECTS.has(id))
    : [];

  if (command.intent === "MEMORY_AUDIT" && requestedSubjectIds.length > 1) {
    const labels = {
      arnaud: "Arnaud",
      alexandra: "Alexandra",
      sinan: "Sinan",
      kaan: "Kaan",
      household: "Foyer",
      noon: "Noon",
      projects: "Projets",
    };

    const subjectCounts = {};
    const memoryIds = [];
    const lines = ["Audit mémoire local :"];
    let generalCount = 0;
    let privateCount = 0;

    for (const subjectId of requestedSubjectIds) {
      const subjectGeneral = general.filter((item) => {
        const profileId = item.metadata?.profileId || "arnaud";
        return profileId === subjectId;
      });

      const subjectPrivate = privateItems.filter(
        (item) => item.subjectId === subjectId
      );

      subjectCounts[subjectId] = subjectGeneral.length + subjectPrivate.length;
      generalCount += subjectGeneral.length;
      privateCount += subjectPrivate.length;

      memoryIds.push(
        ...subjectGeneral.map((item) => item.id),
        ...subjectPrivate.map((item) => item.id)
      );

      lines.push(
        "",
        `${labels[subjectId] || subjectId} : ${subjectCounts[subjectId]} information(s)`
      );

      if (subjectGeneral.length) {
        lines.push(
          `- mémoire générale : ${subjectGeneral.length}`,
          ...subjectGeneral.slice(0, 8).map((item) => `  - ${memoryText(item)}`)
        );
      }

      if (subjectPrivate.length) {
        const categories = [...new Set(subjectPrivate.map((item) => item.category))];

        lines.push(
          `- mémoire privée locale : ${subjectPrivate.length} (${categories.join(", ")})`
        );

        if (command.revealPrivate) {
          lines.push(
            ...subjectPrivate.slice(0, 8).map((item) => `  - ${item.statement}`)
          );
        }
      }

      if (!subjectGeneral.length && !subjectPrivate.length) {
        lines.push("- aucune mémoire persistante active");
      }
    }

    return {
      status: "inspected",
      intent: command.intent,
      answer: lines.join("\n"),
      generalCount,
      privateCount,
      projectCount: 0,
      subjectCounts,
      memoryIds,
    };
  }

  let query = command.query || "";
  if (query && options.projectName && normalizeFrenchCommand(query) === normalizeFrenchCommand(options.projectName)) command.requestedScope = "project";
  if (query && options.projectId && normalizeFrenchCommand(query) === normalizeFrenchCommand(options.projectId)) command.requestedScope = "project";
  if (dateRange) query = "";
  if (query) {
    general = general.filter((item) => includesQuery(`${item.subject} ${memoryText(item)}`, query));
    privateItems = privateItems.filter((item) => includesQuery(`${item.category} ${item.statement}`, query));
    const projectMatches = project.filter((item) => includesQuery(`${item.category} ${item.statement} ${item.payload?.projectName || ""}`, query));
    if (command.requestedScope === "private") general = [];
    if (command.requestedScope === "general") privateItems = [];
    const selectedProject = command.requestedScope === "project" || projectMatches.length ? projectMatches : [];
    const values = [
      ...general.slice(0, 10).map((item) => memoryText(item)),
      ...(command.revealPrivate ? privateItems.slice(0, 10).map((item) => item.statement) : []),
      ...selectedProject.slice(0, 10).map((item) => item.statement),
    ];
    if (!values.length && privateItems.length && !command.revealPrivate) return { status: "found", intent: command.intent, answer: `J’ai ${privateItems.length} information(s) privée(s) locale(s) correspondante(s). Demande-moi explicitement de montrer ma mémoire privée pour afficher leur contenu.`, generalCount: general.length, privateCount: privateItems.length, projectCount: selectedProject.length, memoryIds: privateItems.map((item) => item.id) };
    return { status: values.length ? "found" : "not_found", intent: command.intent, answer: values.length ? values.join("\n") : "Je n’ai trouvé aucune mémoire persistante correspondante.", generalCount: general.length, privateCount: privateItems.length, projectCount: selectedProject.length, memoryIds: [...general, ...privateItems, ...selectedProject].map((item) => item.id) };
  }

  if (command.requestedScope === "private") {
    return { status: privateItems.length ? "found" : "not_found", intent: command.intent, answer: privateItems.length ? `Mémoire privée locale :\n${privateItems.slice(0, 20).map((item) => `- ${item.statement}`).join("\n")}` : "Je n’ai actuellement aucune mémoire privée active.", generalCount: 0, privateCount: privateItems.length, projectCount: 0, memoryIds: privateItems.map((item) => item.id) };
  }
  if (command.requestedScope === "project") {
    return { status: project.length ? "found" : "not_found", intent: command.intent, answer: project.length ? `Projet actif :\n${project.slice(0, 20).map((item) => `- ${item.statement}`).join("\n")}` : "Je n’ai actuellement aucune mémoire active pour ce projet.", generalCount: 0, privateCount: 0, projectCount: project.length, memoryIds: project.map((item) => item.id) };
  }
  if (!general.length && !privateItems.length && !project.length) return { status: "not_found", intent: command.intent, answer: "Je n’ai actuellement aucune mémoire persistante active.", generalCount: 0, privateCount: 0, projectCount: 0, memoryIds: [] };
  const lines = [`J’ai actuellement ${general.length} information(s) générale(s), ${privateItems.length} information(s) privée(s) locale(s) et ${project.length} information(s) liée(s) au projet actif.`];
  if (general.length) lines.push("", "Mémoire générale :", ...general.slice(0, 8).map((item) => `- ${memoryText(item)}`));
  if (privateItems.length) {
    const categories = [...new Set(privateItems.map((item) => item.category))].slice(0, 8);
    lines.push("", `Mémoire privée locale : ${privateItems.length} information(s) dans les catégories ${categories.join(", ")}. Les valeurs sensibles ne sont pas affichées sans demande explicite.`);
  }
  if (project.length) lines.push("", "Projet actif :", ...project.slice(0, 8).map((item) => `- ${item.statement}`));
  return { status: "inspected", intent: command.intent, answer: lines.join("\n"), generalCount: general.length, privateCount: privateItems.length, projectCount: project.length, memoryIds: [...general, ...privateItems, ...project].map((item) => item.id) };
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

  if (command.action === "memory_read") return executeMemoryRead({ personalRepository: personalRepo, privateMemoryService: privateService }, command, options);

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
      success: false,
      sources: [],
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
    try {
      for (const resolvedDoc of resolvedDocuments) {
        if (!resolvedDoc.extractedText && resolvedDoc.content) resolvedDoc.extractedText = resolvedDoc.content;
        else if (!resolvedDoc.extractedText && attachmentResolver) resolvedDoc.extractedText = attachmentResolver.extractTextFromAttachment(resolvedDoc);
        const itemResult = documentImporter.importDocumentToMemory(resolvedDoc, { subjectId: command.subjectId });
        importResult.sources.push(itemResult.source);
        for (const key of ["extractedCount", "savedCount", "updatedCount", "duplicateCount", "ignoredCount", "refusedCount", "generalCount", "privateCount", "projectCount", "evolvingCount", "errorCount"]) {
          importResult[key] += Number(itemResult[key]) || 0;
        }

        for (const reason of ["opinion", "instruction", "unsupported"]) {
          importResult.ignoredReasons[reason] += Number(itemResult.ignoredReasons?.[reason]) || 0;
        }

        for (const reason of ["secret", "unavailable_store"]) {
          importResult.refusedReasons[reason] += Number(itemResult.refusedReasons?.[reason]) || 0;
        }
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
        answer: formattedAnswer,
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
    if (personalRepo && command.requestedScope !== "private" && command.requestedScope !== "project") {
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
    if (privateService && privateService.available && command.requestedScope !== "general") {
      const privateSubject = command.requestedScope === "project" && options.projectId ? `project:${options.projectId}` : null;
      const allPrivate = privateService.listMemories({ includeDeleted: false, ...(privateSubject ? { subjectId: privateSubject } : {}) });
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
    const atomicStatements = documentImporter?.splitIntoAtomicStatements
      ? documentImporter.splitIntoAtomicStatements(statement)
      : [];
    const isPrivate = command.requestedScope === "private" || isPrivateScope(statement);

    try {
      if (atomicStatements.length > 1 && documentImporter?.importDocumentToMemory) {
        const importResult = documentImporter.importDocumentToMemory(
          {
            name: "conversation-memory.txt",
            content: statement,
          },
          {
            subjectId: command.subjectId,
            requestedScope: command.requestedScope || null,
            projectId: options.projectId || null,
            projectName: options.projectName || null,
            sourceType: "explicit-voice-or-chat",
            sourceReference: null,
          }
        );

        const changedCount = importResult.savedCount + importResult.updatedCount;
        const persisted = importResult.success === true;
        const resolvedScope = importResult.projectCount > 0
          ? "project"
          : importResult.generalCount > 0 && importResult.privateCount > 0
            ? "mixed"
            : importResult.privateCount > 0
              ? "private"
              : "general";

        const curatedLines = [];

        if (persisted) {
          curatedLines.push(`${changedCount} information(s) retenue(s) après segmentation.`);
        } else if (importResult.conflicts?.length) {
          curatedLines.push(`${importResult.conflicts.length} contradiction(s) nécessite(nt) une vérification.`);
        } else if (importResult.ignoredCount > 0 || importResult.refusedCount > 0) {
          curatedLines.push("Aucune nouvelle mémoire enregistrée.");
        } else {
          curatedLines.push("Je n’ai pas pu enregistrer ces informations dans la mémoire persistante.");
        }

        if (importResult.ignoredCount > 0) {
          curatedLines.push(`${importResult.ignoredCount} élément(s) ignoré(s).`);

          if (importResult.ignoredReasons?.opinion > 0) {
            curatedLines.push(`- ${importResult.ignoredReasons.opinion} opinion(s) ou formulation(s) subjective(s)`);
          }

          if (importResult.ignoredReasons?.instruction > 0) {
            curatedLines.push(`- ${importResult.ignoredReasons.instruction} instruction(s) ou demande(s) d’action`);
          }

          if (importResult.ignoredReasons?.unsupported > 0) {
            curatedLines.push(`- ${importResult.ignoredReasons.unsupported} élément(s) sans catégorie de mémoire durable`);
          }
        }

        if (importResult.refusedCount > 0) {
          curatedLines.push(`${importResult.refusedCount} élément(s) refusé(s).`);

          if (importResult.refusedReasons?.secret > 0) {
            curatedLines.push(`- ${importResult.refusedReasons.secret} secret(s) ou identifiant(s) sensible(s) détecté(s)`);
          }

          if (importResult.refusedReasons?.unavailable_store > 0) {
            curatedLines.push(`- ${importResult.refusedReasons.unavailable_store} élément(s) dont le stockage requis était indisponible`);
          }
        }

        const curatedAnswer = curatedLines.join("\n");

        return {
          status: persisted
            ? (changedCount > 0 ? "saved" : "unchanged")
            : importResult.conflicts?.length
              ? "needs_clarification"
              : "error",
          scope: resolvedScope,
          answer: curatedAnswer,
          memoryIds: importResult.memoryIds || [],
          importResult,
          receipt: {
            success: persisted,
            operation: "curated_save",
            scope: resolvedScope,
            automatic: false,
            persisted,
            created: importResult.savedCount,
            updated: importResult.updatedCount,
            deleted: 0,
            skipped: importResult.duplicateCount,
            memoryIds: importResult.memoryIds || [],
          },
        };
      }
      if ((isPrivate || command.requestedScope === "project") && privateService && privateService.available) {
        const subjectId = command.requestedScope === "project" && options.projectId ? `project:${options.projectId}` : command.subjectId;
        const item = privateService.createMemory({
          subjectId,
          category: "general",
          statement,
          sensitivity: "medium",
          status: "confirmed",
          confidence: 1,
          consentStatus: "granted",
          apiPolicy: isPrivate ? "local_only" : "contextual",
          sourceType: "explicit-voice-or-chat",
        });
        const verified = item?.id ? privateService.getMemory(item.id) : null;
        if (!verified || verified.statement !== statement || verified.apiPolicy !== (isPrivate ? "local_only" : "contextual")) throw new Error("MEMORY_READ_BACK_FAILED");
        return {
          status: item.duplicate ? "unchanged" : "saved",
          scope: command.requestedScope === "project" ? "project" : "private",
          answer: item.duplicate
            ? "Cette information est déjà dans votre mémoire privée."
            : "C’est retenu dans votre mémoire privée.",
          memoryIds: [item.id],
          receipt: commandReceipt({ success: true, operation: item.duplicate ? "skip" : "create", scope: command.requestedScope === "project" ? "project" : "private", persisted: true, memoryIds: [item.id] }),
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
            receipt: commandReceipt({ success: true, operation: "skip", scope: "general", persisted: true, memoryIds: [duplicate.id] }),
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
        const verified = item?.id ? personalRepo.getMemory(item.id) : null;
        if (!verified || String(verified.value) !== statement) throw new Error("MEMORY_READ_BACK_FAILED");

        return {
          status: "saved",
          scope: "general",
          answer: "C’est retenu dans votre mémoire générale.",
          memoryIds: [item.id],
          receipt: commandReceipt({ success: true, operation: "create", scope: "general", persisted: true, memoryIds: [item.id] }),
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
        const verified = item?.id ? privateService.getMemory(item.id) : null;
        if (!verified || verified.statement !== statement) throw new Error("MEMORY_READ_BACK_FAILED");
        return {
          status: item.duplicate ? "unchanged" : "saved",
          scope: "private",
          answer: item.duplicate
            ? "Cette information est déjà dans votre mémoire privée."
            : "C’est retenu dans votre mémoire privée.",
          memoryIds: [item.id],
          receipt: commandReceipt({ success: true, operation: item.duplicate ? "skip" : "create", scope: "private", persisted: true, memoryIds: [item.id] }),
        };
      }
    } catch {
      return {
        status: "error",
        answer: "Je n’ai pas pu enregistrer cette information dans la mémoire persistante.",
        receipt: commandReceipt({ success: false, operation: "create", scope: command.requestedScope || (isPrivate ? "private" : "general"), persisted: false }),
      };
    }
  }

  // -------------------------------------------------------------
  // ACTION : SEARCH
  // -------------------------------------------------------------
  if (command.action === "search") {
    if (command.requestedScope === "general" && personalRepo) {
      const matches = personalRepo.searchMemories(command.query || "", { limit: 5 }).filter((item) => item.status !== "rejected" && item.status !== "expired");
      if (!matches.length) return { status: "not_found", answer: "Je n’ai trouvé aucune information correspondante dans votre mémoire générale." };
      return { status: "found", scope: "general", answer: matches.map((item) => typeof item.value === "string" ? item.value : JSON.stringify(item.value)).join(" "), memoryIds: matches.map((item) => item.id) };
    }
    const searchSubject = command.requestedScope === "project" && options.projectId ? `project:${options.projectId}` : command.subjectId;
    const matches = privateService ? matchingMemories(privateService, searchSubject, command.query) : [];
    if (!matches.length) return { status: "not_found", answer: "Je n’ai trouvé aucune information correspondante dans votre mémoire privée." };
    return { status: "found", answer: matches.slice(0, 5).map((item) => item.statement).join(" "), memoryIds: matches.slice(0, 5).map((item) => item.id) };
  }

  if (command.action === "delete_recent") {
    const recentIds = Array.isArray(options.recentMemoryIds) ? [...new Set(options.recentMemoryIds)].slice(0, 20) : [];
    if (!recentIds.length) return { status: "needs_clarification", answer: "Quelle information dois-je oublier exactement ?" };
    const deleted = [];
    for (const id of recentIds) {
      const privateItem = privateService?.getMemory?.(id);
      if (privateItem && privateItem.status !== "deleted") {
        privateService.forgetMemory(id);
        const verified = privateService.getMemory(id);
        if (verified?.status === "deleted" && verified.statement === "") deleted.push(id);
        continue;
      }
      const generalItem = personalRepo?.getMemory?.(id);
      if (generalItem && generalItem.status !== "rejected") {
        personalRepo.forgetMemory(id);
        const verified = personalRepo.getMemory(id);
        if (verified?.status === "rejected" && verified.useAllowed === false) deleted.push(id);
      }
    }
    if (deleted.length !== recentIds.length) return { status: "error", answer: "Je n’ai pas pu vérifier l’oubli de toutes les informations concernées.", receipt: commandReceipt({ success: false, operation: "delete", scope: "mixed", persisted: false, memoryIds: deleted }) };
    return { status: "deleted", answer: "Je viens d’oublier cette information.", memoryIds: deleted, receipt: commandReceipt({ success: true, operation: "delete", scope: "mixed", persisted: true, memoryIds: deleted }) };
  }

  // -------------------------------------------------------------
  // ACTION : UPDATE & DELETE
  // -------------------------------------------------------------
  if (!privateService) return { status: "unavailable", answer: "La mémoire privée locale est indisponible." };

  const deleteSubject = command.requestedScope === "project" && options.projectId ? `project:${options.projectId}` : command.subjectId;
  const matches = matchingMemories(privateService, deleteSubject, command.previous);
  if (!matches.length) return { status: "not_found", answer: "Je n’ai pas trouvé cette information dans votre mémoire privée." };
  if (matches.length > 1) return { status: "needs_clarification", answer: "Plusieurs souvenirs correspondent. Dites la phrase complète à modifier ou à oublier.", memoryIds: matches.map((item) => item.id) };
  if (command.action === "update") {
    const item = privateService.updateMemory(matches[0].id, { statement: command.statement, status: "confirmed", consentStatus: "granted" }, "correction explicite par conversation");
    const verified = privateService.getMemory(item.id);
    if (!verified || verified.statement !== command.statement) return { status: "error", answer: "Je n’ai pas pu vérifier la mise à jour dans la mémoire persistante.", receipt: commandReceipt({ success: false, operation: "update", scope: "private", persisted: false }) };
    return { status: "updated", answer: "L’information a été mise à jour dans votre mémoire privée.", memoryIds: [item.id], receipt: commandReceipt({ success: true, operation: "update", scope: "private", persisted: true, memoryIds: [item.id] }) };
  }
  privateService.forgetMemory(matches[0].id);
  const forgotten = privateService.getMemory(matches[0].id);
  if (!forgotten || forgotten.status !== "deleted" || forgotten.statement !== "") return { status: "error", answer: "Je n’ai pas pu vérifier l’oubli dans la mémoire persistante.", receipt: commandReceipt({ success: false, operation: "delete", scope: "private", persisted: false }) };
  return { status: "deleted", answer: "Cette information a été oubliée de votre mémoire privée.", memoryIds: [matches[0].id], receipt: commandReceipt({ success: true, operation: "delete", scope: "private", persisted: true, memoryIds: [matches[0].id] }) };
}

module.exports = {
  cleanDirectStatement,
  commandReceipt,
  executeConversationMemoryCommand,
  importDateRange,
  parseConversationMemoryCommand,
  parseMemoryReadIntent,
  requestedMemoryScope,
  stripMemoryScope,
  executeMemoryRead,
};
