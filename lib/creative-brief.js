"use strict";
const fs = require("fs"); const path = require("path");
const TIME_ZONE = "Europe/Paris";
const CREATIVE_BRIEF_SYSTEM_PROMPT = `Prépare un brief en français, lisible en environ cinq minutes, sur les évolutions récentes réellement conséquentes de la publicité et de la direction artistique, du design numérique, du branding, de l’UX/UI, de l’illustration et des outils créatifs assistés par IA.

Recherche les informations les plus récentes dans des sources fiables et variées. Vérifie la date de publication et, lorsqu’elle est différente, la date réelle de l’événement. Maintiens un équilibre éditorial entre les disciplines, sans inventer une actualité pour remplir chaque catégorie.

Écarte les annonces anecdotiques, les simples effets de mode sans conséquence professionnelle, les communiqués purement promotionnels, les informations invérifiables et les répétitions d’un jour à l’autre sans évolution notable.

Pour chaque sujet retenu, indique :
1. un titre court ;
2. ce qui s’est passé ;
3. pourquoi cela compte ;
4. ce qu’un directeur artistique, graphiste, illustrateur, UX/UI designer, web designer ou développeur web peut concrètement en tirer ;
5. les sources avec des liens directs.

Distingue clairement les faits vérifiés des analyses et des inférences. Termine par une section « À retenir aujourd’hui » contenant l’évolution la plus importante et une action, un test, un outil ou une piste créative immédiatement applicable. Si l’actualité du jour est faible, produis un brief plus court plutôt que d’ajouter des éléments sans importance.`;
function localParts(date, timeZone = TIME_ZONE) { const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date); return Object.fromEntries(parts.map(({ type, value }) => [type, value])); }
function localDateKey(date = new Date(), timeZone = TIME_ZONE) { const p = localParts(date, timeZone); return `${p.year}-${p.month}-${p.day}`; }
function isDueToday({ now = new Date(), time = "08:00", lastSuccessDate = null, timeZone = TIME_ZONE } = {}) { const p = localParts(now, timeZone); return `${p.hour}:${p.minute}` >= time && lastSuccessDate !== localDateKey(now, timeZone); }
function nextRunAt({ now = new Date(), time = "08:00", timeZone = TIME_ZONE } = {}) { for (let offset = 60_000; offset <= 48 * 60 * 60_000; offset += 60_000) { const candidate = new Date(now.getTime() + offset); const p = localParts(candidate, timeZone); if (`${p.hour}:${p.minute}` === time && candidate > now) return candidate; } throw new Error("Impossible de calculer la prochaine exécution du brief."); }
function buildCreativeBriefPrompt({ date, recentTopics = [] } = {}) {
  const history = recentTopics.slice(0, 40).map((item) => {
    const parts = [item.date, item.theme, item.title, item.url, item.summary]
      .filter(Boolean);
    return `- ${parts.join(" — ")}`;
  }).join("\n");
  return {
    system: CREATIVE_BRIEF_SYSTEM_PROMPT,
    user: `Date locale à utiliser : ${date || localDateKey()}. Donne la priorité aux évolutions des dernières 24 à 72 heures.\n\nSujets récemment traités à ne pas répéter sans évolution conséquente :\n${history || "Aucun sujet récent."}\n\nLorsqu’un sujet revient avec une évolution importante, présente-le explicitement comme une mise à jour.`,
  };
}
function createCreativeBriefStore(filePath) {
  const empty = { version: 1, status: "idle", nextScheduledAt: null, lastAttemptAt: null, lastSuccessAt: null, lastSuccessDate: null, error: null, briefs: [], topics: [] };
  function load() { try { return { ...empty, ...JSON.parse(fs.readFileSync(filePath, "utf8")) }; } catch { return { ...empty }; } }
  function save(value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); const tmp = `${filePath}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(tmp, filePath); return value; }
  function markGenerating(date = new Date()) { return save({ ...load(), status: "generating", lastAttemptAt: date.toISOString(), error: null }); }
  function markScheduled(date) { const current = load(); return save({ ...current, status: current.lastSuccessDate === localDateKey() ? "ready" : "scheduled", nextScheduledAt: date instanceof Date ? date.toISOString() : String(date || "") || null }); }
  function markReady(brief, date = new Date()) { const current = load(); const briefs = [brief, ...(current.briefs || []).filter((item) => item.date !== brief.date)].slice(0, 30); return save({ ...current, status: "ready", lastSuccessAt: date.toISOString(), lastSuccessDate: brief.date, error: null, briefs, topics: [...(brief.topics || []), ...(current.topics || [])].slice(0, 150) }); }
  function markError(error) { return save({ ...load(), status: "error", error: String(error?.message || error).slice(0, 500) }); }
  return { load, save, markScheduled, markGenerating, markReady, markError };
}
module.exports = { CREATIVE_BRIEF_SYSTEM_PROMPT, TIME_ZONE, buildCreativeBriefPrompt, createCreativeBriefStore, isDueToday, localDateKey, nextRunAt };
