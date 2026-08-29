"use strict";

// Source de vérité des contraintes permanentes de Noon. Le registre déclare
// les règles ; les barrières de sécurité restent appliquées par les composants
// indiqués dans `enforcedBy` et jamais par le prompt seul.

const PRIORITY_ORDER = Object.freeze({
  security: 700,
  privacy: 600,
  permissions: 500,
  system: 400,
  user_permanent: 300,
  mode: 200,
  project: 100,
  preference: 0,
});

const PRIVATE_PROFILE_IDS = Object.freeze([
  "arnaud", "alexandra", "sinan", "kaan", "household", "noon", "projects", "project:*",
]);

const PERMISSION_LEVEL_CAPABILITIES = Object.freeze({
  read: "READ",
  draft: "PREPARE",
  write: "WRITE",
  external: "EXECUTE",
  destructive: "EXECUTE",
});

const RULES = Object.freeze([
  rule("security.destructive_confirmation", "security", "Une action destructive nécessite toujours une confirmation explicite et liée au contenu exact.", ["*"], "code", ["skills/permissions", "approval-manager"]),
  rule("security.external_action_confirmation", "security", "Une action externe difficile à annuler nécessite une autorisation explicite.", ["*"], "both", ["skills/permissions", "approval-manager", "system-prompt"]),
  rule("security.no_secret_exposure", "security", "Ne jamais exposer une clé, un jeton, un secret ou un raisonnement interne privé.", ["*"], "both", ["redaction", "token-store", "system-prompt"]),
  rule("security.sensitive_delete_confirmation", "security", "Une suppression sensible exige une confirmation renforcée.", ["*"], "code", ["skills/permissions", "approval-manager"], {}, { legacyPrivateKey: "sensitive-delete-confirm", legacyPrivateStatement: "Aucune suppression sensible sans confirmation renforcée." }),
  rule("system.understand_before_action", "system", "Comprendre la demande et son périmètre avant d’agir.", ["chat", "live", "brief", "projects", "tools"], "both", ["system-prompt", "skills/permissions"], {}, { legacyPrivateKey: "understand-before-action", legacyPrivateStatement: "Comprendre avant d’agir." }),

  rule("privacy.private_memory_service_only", "privacy", "La mémoire privée doit être consultée uniquement par le service privé autorisé.", ["memory", "chat", "live", "brief"], "code", ["memory-engine", "private-memory-service"]),
  rule("privacy.minimize_remote_context", "privacy", "N’envoyer à un service distant que le contexte personnel strictement pertinent et autorisé.", ["memory", "chat", "live", "brief"], "both", ["memory-engine", "system-prompt"]),
  rule("privacy.profile_ids_stable", "privacy", "Les profils privés restent séparés et leurs identifiants ne doivent pas être renommés ou fusionnés.", ["memory"], "code", ["private-memory-service"], { profileIds: PRIVATE_PROFILE_IDS }),

  rule("permissions.level_mapping", "permissions", "Les niveaux techniques read, draft, write, external et destructive correspondent aux capacités READ, PREPARE, WRITE et EXECUTE.", ["tools", "files", "email", "calendar"], "code", ["skills/permissions"], { mapping: PERMISSION_LEVEL_CAPABILITIES }),

  rule("email.read_requires_scope", "permissions", "La lecture d’un e-mail exige le périmètre de lecture autorisé.", ["email"], "code", ["gmail-connector", "skills/permissions"]),
  rule("email.draft_allowed", "permissions", "Noon peut préparer un brouillon lorsqu’une permission de préparation est disponible.", ["email", "brief"], "code", ["gmail-connector", "skills/permissions"]),
  rule("email.send_requires_explicit_permission", "permissions", "Préparer un brouillon n’autorise jamais son envoi ; l’envoi exige une autorisation explicite distincte.", ["email", "brief"], "both", ["gmail-connector", "approval-manager", "system-prompt"], {}, { legacyOperational: "Aucun e-mail envoyé sans ordre", legacyPrivateKey: "email-explicit-order", legacyPrivateStatement: "Aucun e-mail envoyé sans ordre explicite." }),

  rule("files.allowed_roots_only", "permissions", "Tout accès fichier doit rester dans une racine locale explicitement autorisée.", ["files", "projects"], "code", ["local-permissions", "skills/permissions", "path-utils"]),
  rule("files.respect_root_mode", "permissions", "Une racine en lecture seule ne peut pas être utilisée pour une écriture.", ["files", "projects"], "code", ["local-permissions", "skills/permissions"]),
  rule("files.no_overwrite", "permissions", "Ne jamais écraser silencieusement un fichier existant.", ["files", "projects"], "code", ["artifact-generator", "versioning"]),
  rule("files.protect_originals", "permissions", "Protéger les fichiers originaux et créer une nouvelle version plutôt que les altérer silencieusement.", ["files", "projects"], "both", ["artifact-generator", "versioning", "system-prompt"], {}, { legacyPrivateKey: "protect-originals", legacyPrivateStatement: "Protéger les originaux." }),
  rule("files.no_delete_without_confirmation", "permissions", "Aucun fichier existant ne doit être supprimé sans permission et confirmation adaptées.", ["files", "projects"], "both", ["skills/permissions", "approval-manager", "system-prompt"], {}, { legacyOperational: "Aucun fichier existant modifié sans ordre" }),
  rule("files.reject_symlink_escape", "security", "Refuser un chemin ou lien symbolique qui sort d’une racine autorisée.", ["files", "projects"], "code", ["path-utils", "skills/permissions"]),

  rule("calendar.protected_lunch", "user_permanent", "La pause de 12 h 30 à 13 h 30 est protégée et ne reçoit aucune tâche automatique.", ["calendar", "scheduling", "brief"], "code", ["time-slot-service", "morning-brief"], { start: "12:30", end: "13:30", timezone: "Europe/Paris" }, { legacyOperational: "Pause protégée entre 12 h 30 et 13 h 30", legacyPrivateKey: "protected-break", legacyPrivateStatement: "Pause protégée de 12 h 30 à 13 h 30." }),
  rule("calendar.noon_color", "user_permanent", "Les tâches Noon créées avec l’autorisation correspondante utilisent la couleur Myrtille lorsque le connecteur le permet.", ["calendar", "scheduling", "brief"], "code", ["morning-brief", "google-calendar"], { color: "Myrtille" }, { legacyPrivateKey: "focus-myrtille", legacyPrivateStatement: "La création automatique de blocs Focus couleur Myrtille exige une activation explicite.", legacyRequiresOptIn: true }),
  rule("calendar.no_double_booking", "system", "Ne pas proposer un bloc qui chevauche un événement ou un bloc Noon déjà planifié.", ["calendar", "scheduling", "brief"], "code", ["time-slot-service", "morning-brief"]),
  rule("calendar.existing_event_change_confirmation", "permissions", "Déplacer ou supprimer un événement existant nécessite une validation distincte.", ["calendar", "scheduling", "brief"], "both", ["google-calendar", "approval-manager", "system-prompt"], {}, { legacyOperational: "Aucun événement déplacé ou supprimé sans validation", legacyPrivateKey: "calendar-destructive-confirm", legacyPrivateStatement: "Aucun événement déplacé ou supprimé sans validation." }),
  rule("calendar.auto_create_scope", "permissions", "L’autorisation de créer une tâche Noon ne donne aucun droit de modifier ou supprimer les autres événements.", ["calendar", "scheduling"], "code", ["google-calendar", "approval-manager"]),
  rule("calendar.create_requires_order", "permissions", "Créer un événement Calendar exige un ordre explicite.", ["calendar", "scheduling", "brief"], "both", ["google-calendar", "skills/permissions"], {}, { legacyOperational: "Aucun événement Calendar créé sans ordre explicite" }),

  rule("memory.local_only", "privacy", "Une mémoire local_only peut être utilisée localement mais ne doit jamais être envoyée à un modèle distant.", ["memory", "chat", "live", "brief"], "code", ["memory-engine", "private-context-builder"]),
  rule("memory.confirm_each_use", "privacy", "Une mémoire confirm_each_use ne peut quitter la machine qu’après confirmation explicite pour l’usage courant.", ["memory", "chat", "live", "brief"], "code", ["memory-engine", "private-context-builder"]),
  rule("memory.consent_required", "privacy", "Une mémoire soumise au consentement ne peut être utilisée sans consentement accordé.", ["memory", "chat", "live", "brief"], "code", ["private-memory-service", "memory-engine"]),
  rule("memory.no_key_exposure", "security", "La clé de chiffrement de la mémoire privée ne doit jamais être exposée ou journalisée.", ["memory"], "code", ["memory-crypto", "safeStorage"]),
  rule("memory.no_invention", "system", "Une hypothèse ne doit jamais être enregistrée ou présentée comme un fait confirmé.", ["memory", "chat", "live", "brief"], "both", ["private-memory-service", "personal-repository", "system-prompt"], {}, { legacyPrivateKey: "no-invention", legacyPrivateStatement: "Ne jamais présenter une hypothèse comme un fait." }),

  rule("conversation.no_invention", "system", "Ne jamais inventer un fait, un fichier, une source, un résultat ou une action effectuée.", ["chat", "live", "brief", "projects"], "llm", ["system-prompt"]),
  rule("conversation.verify_local_files", "system", "Vérifier les fichiers locaux nécessaires avant d’affirmer leur contenu.", ["chat", "live", "projects", "files"], "both", ["system-prompt", "read-file-skill"]),
  rule("conversation.concrete_next_action", "user_permanent", "Proposer une prochaine action concrète lorsqu’elle est utile.", ["chat", "live", "brief", "projects"], "llm", ["system-prompt"], {}, { legacyOperational: "Propositions concrètes avec prochaine action", legacyPrivateKey: "concrete-next-action", legacyPrivateStatement: "Proposer une prochaine action concrète." }),
  rule("conversation.avoid_repetition", "user_permanent", "Ne pas répéter inutilement une information déjà signalée sans changement réel.", ["chat", "live", "brief"], "both", ["deduplication-service", "system-prompt"], {}, { legacyOperational: "Pas de répétition inutile d’une information déjà signalée" }),

  rule("brief.schedule_0700", "user_permanent", "Le brief quotidien cible 07:00 dans le fuseau Europe/Paris et la vision hebdomadaire est produite le lundi.", ["brief"], "code", ["electron-scheduler", "creative-brief"], { time: "07:00", timezone: "Europe/Paris", weeklyDay: "monday" }, { legacyOperational: ["Brief quotidien à 7 h", "Vision de la semaine chaque lundi"], legacyPrivateKey: "daily-weekly-brief", legacyPrivateStatement: "Brief quotidien à 7 h et vision hebdomadaire le lundi." }),
  rule("brief.rank_instead_of_copy", "system", "Le brief hiérarchise les éléments utiles au lieu de recopier toutes les sources.", ["brief"], "both", ["morning-brief", "brief-prompt"]),
  rule("brief.no_artificial_empty_section", "system", "Ne pas fabriquer une section vide uniquement pour respecter un modèle de brief.", ["brief"], "llm", ["brief-prompt"]),

  rule("projects.no_unverified_content", "system", "Les métadonnées projet ne remplacent jamais la lecture des fichiers utiles.", ["projects", "chat", "live"], "both", ["system-prompt", "file-skills"]),
  rule("projects.modes_stable", "user_permanent", "Les modes DA, DEV, Soutenance et Focus restent disponibles selon leur périmètre.", ["projects", "chat", "live"], "code", ["mode-controller"], {}, { legacyOperational: "Modes DA, Dev, Soutenance et Focus" }),

  rule("voice.single_identity", "system", "La voix de Noon doit conserver une identité unique, indépendamment du modèle de raisonnement utilisé.", ["voice", "live"], "llm", ["voice-instructions"]),
  rule("routing.minimum_capable_model", "system", "Utiliser le modèle le moins coûteux capable de traiter correctement la tâche.", ["routing", "chat", "live", "brief"], "code", ["noon-intelligence"]),
]);

// Version déterministe : toute modification d'identifiant ou de formulation
// produit une nouvelle clé de cache sans faire du cache une source de vérité.
const HARD_RULES_VERSION = `rules-${RULES.length}-${RULES.reduce(
  (sum, entry) => sum + entry.id.length + entry.statement.length,
  0
)}`;

function rule(id, hierarchy, statement, scopes, enforcement, enforcedBy, value = {}, legacy = {}) {
  return Object.freeze({
    id,
    category: id.split(".")[0],
    hierarchy,
    weight: PRIORITY_ORDER[hierarchy],
    priority: "hard",
    scopes: Object.freeze([...scopes]),
    enabled: true,
    statement,
    value: Object.freeze({ ...value }),
    enforcement,
    enforcedBy: Object.freeze([...enforcedBy]),
    ...legacy,
  });
}

function createHardRulesRegistry({ debug = null } = {}) {
  const byId = new Map(RULES.map((entry) => [entry.id, entry]));

  function inferIntent(value, projectId = null) {
    const text = String(value || "").toLocaleLowerCase("fr");
    if (/\b(mail|e-mail|email|gmail|brouillon|destinataire)\b/.test(text)) return "email";
    if (/\b(agenda|calendar|calendrier|rendez-vous|créneau|planifi|planning)\b/.test(text)) return "calendar";
    if (/\b(fichier|dossier|document|code|source|enregistre|exporte|supprime)\b/.test(text)) return projectId ? "projects" : "files";
    if (/\b(mémoire|souvenir|profil|rappelle-toi)\b/.test(text)) return "memory";
    if (/\b(voix|micro|audio|parle|conversation live)\b/.test(text)) return "voice";
    if (/\b(brief|point du jour|matin)\b/.test(text)) return "brief";
    return projectId ? "projects" : "conversation";
  }

  function getRule(id) { return byId.get(String(id)) || null; }

  function getRulesForContext({ intent = null, tools = [], mode = null, projectId = null, channel = "chat" } = {}) {
    const contexts = new Set([channel, intent, mode ? String(mode).toLowerCase() : null].filter(Boolean));
    for (const tool of tools || []) contexts.add(String(tool).split(/[._]/)[0]);
    if (projectId) contexts.add("projects");
    const selected = RULES.filter((entry) => entry.enabled &&
      (entry.scopes.includes("*") || entry.scopes.some((scope) => contexts.has(scope))))
      .sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id));
    debug?.("hard-rules.selected", { channel, intent: intent || null, count: selected.length, ruleIds: selected.map((entry) => entry.id) });
    return selected;
  }

  function resolveConflict(candidates = []) {
    return [...candidates].filter(Boolean).sort((left, right) =>
      (right.weight ?? PRIORITY_ORDER[right.hierarchy] ?? 0) -
      (left.weight ?? PRIORITY_ORDER[left.hierarchy] ?? 0))[0] || null;
  }

  function evaluatePermission({ resource, action, explicitPermission = false, confirmed = false } = {}) {
    if (resource === "email" && action === "draft") return { allowed: true, ruleId: "email.draft_allowed" };
    if (resource === "email" && action === "send") return { allowed: explicitPermission && confirmed, ruleId: "email.send_requires_explicit_permission" };
    if (resource === "files" && action === "overwrite") return { allowed: explicitPermission && confirmed, ruleId: "files.no_overwrite" };
    if (resource === "files" && action === "delete") return { allowed: explicitPermission && confirmed, ruleId: "files.no_delete_without_confirmation" };
    return { allowed: explicitPermission, ruleId: null };
  }

  function isProtectedCalendarTime(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    const time = new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(date);
    return time >= "12:30" && time < "13:30";
  }

  function canUseMemoryRemotely(memory, confirmedIds = []) {
    if (!memory) return { allowed: false, ruleId: "privacy.minimize_remote_context" };
    if (memory.apiPolicy === "local_only") return { allowed: false, ruleId: "memory.local_only" };
    if (memory.apiPolicy === "confirm_each_use" && !confirmedIds.includes(memory.id)) {
      return { allowed: false, ruleId: "memory.confirm_each_use" };
    }
    if (memory.consentRequired && memory.consentStatus !== "granted") {
      return { allowed: false, ruleId: "memory.consent_required" };
    }
    return { allowed: true, ruleId: null };
  }

  function matchesLegacyMemory(memory) {
    if (memory?.type !== "permanent_constraint") return false;
    const content = `${memory.subject || ""} ${typeof memory.value?.rule === "string" ? memory.value.rule : ""}`.toLocaleLowerCase("fr");
    return RULES.some((entry) => {
      const values = Array.isArray(entry.legacyOperational) ? entry.legacyOperational : [entry.legacyOperational];
      return values.filter(Boolean).some((value) => content.includes(value.toLocaleLowerCase("fr")));
    });
  }

  function legacyOperationalRules() {
    return RULES.flatMap((entry) => Array.isArray(entry.legacyOperational)
      ? entry.legacyOperational
      : entry.legacyOperational ? [entry.legacyOperational] : []);
  }

  function legacyPrivateRules() {
    return RULES.filter((entry) => entry.legacyPrivateKey)
      .map((entry) => [entry.legacyPrivateKey, entry.legacyPrivateStatement || entry.statement, entry.legacyRequiresOptIn === true]);
  }

  return {
    getAllRules: () => [...RULES], getRule, getRulesForContext, inferIntent, resolveConflict,
    evaluatePermission, isProtectedCalendarTime, canUseMemoryRemotely,
    matchesLegacyMemory, legacyOperationalRules, legacyPrivateRules,
    permissionLevelCapabilities: () => ({ ...PERMISSION_LEVEL_CAPABILITIES }),
    privateProfileIds: () => [...PRIVATE_PROFILE_IDS],
    version: () => HARD_RULES_VERSION,
  };
}

module.exports = {
  PERMISSION_LEVEL_CAPABILITIES,
  PRIORITY_ORDER,
  PRIVATE_PROFILE_IDS,
  RULES,
  HARD_RULES_VERSION,
  createHardRulesRegistry,
};
