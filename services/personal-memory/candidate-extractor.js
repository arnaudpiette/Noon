"use strict";

const { isEvolvingData, isPrivateScope, isSecret, privateCategory, splitIntoAtomicStatements } = require("./document-memory-importer");

const EXPLICIT_PATTERNS = [/\bje pr[eé]f[eè]re\s+(.{3,300})/i, /\bma pr[eé]f[eé]rence (?:est|:)\s*(.{3,300})/i, /\bretiens que\s+(.{3,300})/i, /\bsouviens-toi que\s+(.{3,300})/i];
const GREETING_PATTERN = /^(?:bonjour|bonsoir|salut|hello|merci|au revoir)[\s!.?]*$/i;
const QUESTION_PATTERN = /^(?:qui|que|quoi|quel(?:le)?s?|comment|pourquoi|o[uù]|quand|combien|est-ce que|peux-tu|pourrais-tu)\b/i;
const FICTION_PATTERN = /\b(?:ficti(?:f|ve|fs|ves)|imaginaire|par exemple|supposons?|cas d['’]école|pour l['’]exercice)\b/i;
const TRANSLATION_PATTERN = /\b(?:traduis|traduire|traduction|reformule|reformuler|corrige ce texte|résume ce texte)\b/i;
const UNCERTAIN_PATTERN = /\b(?:peut-être|peut etre|j['’]hésite|je réfléchis|j['’]envisage|il se pourrait|probablement)\b/i;
const TEMPORARY_PATTERN = /\b(?:aujourd['’]hui seulement|juste aujourd['’]hui|pour cette fois|temporairement|cette semaine seulement|en ce moment pour ce test)\b/i;

function cleanStatement(value, max = 1200) { return String(value || "").replace(/[\0\r\n]+/g, " ").replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "").slice(0, max); }

function memoryKey(statement, category, projectId = null) {
  const text = statement.toLocaleLowerCase("fr");
  let detail = category;
  if (/\b(?:javascript|typescript|python|java|rust|php|swift|kotlin)\b/i.test(text) && category === "preference") detail = "code_language";
  else if (/\b(?:voix|voice)\b.*\b(?:défaut|default)\b/i.test(text)) detail = "default_voice";
  else if (/\b(?:langue|français|anglais|espagnol|portugais)\b/i.test(text) && category === "preference") detail = "language";
  else if (/\b(?:interface|ui)\b/i.test(text) && category === "preference") detail = "interface";
  return `${projectId ? `project:${projectId}:` : "personal:"}${detail}`;
}

function classifyCategory(statement) {
  if (isPrivateScope(statement)) return privateCategory(statement);
  if (/\b(?:je préfère|ma préférence|privilégie|à partir de maintenant|désormais).*(?:exemples?|réponses?|utilise|langage|interface|ton|format)|\bje préfère\b/i.test(statement)) return "preference";
  if (/\b(?:je travaille|mon métier|je suis|mon rôle|profession)\b/i.test(statement)) return "identity_role";
  if (/\b(?:objectif|je veux durablement|je souhaite à long terme)\b/i.test(statement)) return "objective";
  if (/\b(?:toujours|habituellement|chaque semaine|chaque jour|mon habitude)\b/i.test(statement)) return "habit";
  if (/\b(?:devient|sera|utiliserons|on utilisera|ne recommande plus|décidé|décision|par défaut)\b/i.test(statement)) return "decision";
  if (/\b(?:j['’]utilise|nous utilisons|stack|technologie|framework|outil)\b/i.test(statement)) return "tooling";
  return null;
}

function projectRelation(statement, options = {}) {
  const projectId = cleanStatement(options.projectId || options.focusId || "", 80);
  const projectName = cleanStatement(options.projectName || options.focusName || "", 120);
  if (!projectId && !projectName) return null;
  const text = statement.toLocaleLowerCase("fr");
  const explicitlyNamed = [projectName, projectId].filter(Boolean).some((name) => text.includes(name.toLocaleLowerCase("fr")));
  return explicitlyNamed && /\b(?:voix|stack|projet|composant|framework|technologie|décision|par défaut|pour|sur)\b/i.test(statement)
    ? { id: projectId || projectName, name: projectName || projectId } : null;
}

function scoreCandidate(statement, category, options = {}) {
  const privateScope = isPrivateScope(statement), evolving = isEvolvingData(statement), project = projectRelation(statement, options);
  const durableMarker = /\b(?:à partir de maintenant|désormais|maintenant|principalement|toujours|par défaut|chaque|mon métier|je travaille|je préfère|devient|utiliserons|on utilisera)\b/i.test(statement);
  const scores = { futureUsefulness: category ? 0.82 : 0.35, durability: evolving ? 0.55 : durableMarker ? 0.92 : 0.72, confidence: UNCERTAIN_PATTERN.test(statement) ? 0.45 : 0.96, sensitivity: privateScope ? 1 : 0, projectRelevance: project ? 1 : 0, temporalNature: evolving ? 1 : 0 };
  scores.total = Number(((scores.futureUsefulness * 0.35) + (scores.durability * 0.3) + (scores.confidence * 0.25) + ((project || privateScope) ? 0.1 : 0)).toFixed(3));
  return { scores, project, privateScope, evolving };
}

function shouldIgnore(source, statement) {
  if (!statement || statement.length < 8 || GREETING_PATTERN.test(statement) || QUESTION_PATTERN.test(statement)) return true;
  if (FICTION_PATTERN.test(statement) || TRANSLATION_PATTERN.test(source) || TEMPORARY_PATTERN.test(statement)) return true;
  if (/^(?:analyse|explique|résume|compare|écris|crée|corrige)\b/i.test(statement)) return true;
  return isSecret(statement);
}

function extractAutonomousMemoryCandidates(text, options = {}) {
  const source = String(text || "").trim();
  if (!source || TRANSLATION_PATTERN.test(source)) return [];
  const candidates = [];
  for (const raw of splitIntoAtomicStatements(source.length < 8 ? "" : source)) {
    const statement = cleanStatement(raw);
    if (shouldIgnore(source, statement)) continue;
    const category = classifyCategory(statement);
    if (!category) continue;
    const evaluation = scoreCandidate(statement, category, options);
    if (evaluation.scores.total < 0.72 || evaluation.scores.confidence < 0.7) continue;
    const scope = evaluation.privateScope ? "private" : evaluation.project ? "project" : "general";
    candidates.push({ statement, category, scope, subjectId: scope === "project" ? `project:${evaluation.project.id}` : "arnaud", projectName: evaluation.project?.name || null, sensitivity: evaluation.privateScope ? "high" : "low", apiPolicy: evaluation.privateScope ? "local_only" : "contextual", stability: evaluation.evolving ? "evolving" : "stable", memoryKey: memoryKey(statement, category, evaluation.project?.id || null), scores: evaluation.scores, sourceType: options.sourceType || "automatic-conversation", sourceReference: options.sourceReference || null });
  }
  return candidates;
}

function extractExplicitMemoryCandidates(text) {
  const source = String(text || "").replace(/[\r\n]+/g, " ").trim();
  for (const pattern of EXPLICIT_PATTERNS) {
    const match = source.match(pattern);
    if (!match) continue;
    const rawStatement = cleanStatement(match[1], 300);
    if (/\b(?:tout\s+ce\s+qui\s+est\s+(?:important|utile|pertinent)|ce\s+(?:dossier|document|fichier)|la\s+pi[eè]ce\s+jointe|les\s+fichiers?|ce\s+que\s+je\s+viens\s+de)\b/i.test(rawStatement)) continue;
    return [{ subjectId: "arnaud", category: /pr[eé]f/i.test(match[0]) ? "preference" : "general", statement: rawStatement, sensitivity: "low", status: "candidate", confidence: 1, apiPolicy: "contextual", sourceType: "explicit-user-message" }];
  }
  return [];
}

module.exports = { classifyCategory, extractAutonomousMemoryCandidates, extractExplicitMemoryCandidates, memoryKey, scoreCandidate };
