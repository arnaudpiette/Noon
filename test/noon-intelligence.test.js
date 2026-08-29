"use strict";

// Vérifie le routage des modèles, le budget et la réduction de l’historique transmis.
const test = require("node:test"); const assert = require("node:assert/strict");
const { selectModelRoute, trimHistoryByCharacters, updateConversationSummary } = require("../lib/noon-intelligence");
test("route Luna, Terra et Sol selon la difficulté", () => { assert.equal(selectModelRoute({ question: "Bonjour" }).model, "gpt-5.6-luna"); assert.equal(selectModelRoute({ question: "Explique la hiérarchie visuelle" }).model, "gpt-5.6-terra"); assert.equal(selectModelRoute({ question: "Analyse en profondeur l'architecture logicielle" }).model, "gpt-5.6-sol"); });
test("le budget économie force Luna", () => { assert.equal(selectModelRoute({ question: "Fais un audit complet", budgetMode: "ECO" }).model, "gpt-5.6-luna"); });
test("le profil économique reste sur Luna pour une tâche complexe et plusieurs fichiers", () => {
  const route = selectModelRoute({
    question: "Fais un audit complet de ces documents",
    profile: "economical",
    attachments: 3,
  });

  assert.equal(route.model, "gpt-5.6-luna");
  assert.equal(route.effort, "low");
});
test("une demande légère reste sur Luna même avec le profil maximum", () => {
  assert.equal(
    selectModelRoute({ question: "Merci", profile: "maximum" }).model,
    "gpt-5.6-luna"
  );
});
test("la longueur et plusieurs documents ne suffisent plus à sélectionner Sol", () => {
  const longQuestion = `Présente clairement ces éléments : ${"contenu ".repeat(260)}`;

  assert.equal(
    selectModelRoute({ question: longQuestion, attachments: 2 }).model,
    "gpt-5.6-terra"
  );
});
test("borne l’historique en conservant le récent", () => { const h = [{ content: "a".repeat(10) }, { content: "b".repeat(10) }, { content: "c".repeat(10) }]; assert.deepEqual(trimHistoryByCharacters(h, 20), h.slice(1)); });
test("résume localement les décisions retirées de la fenêtre immédiate", () => { const summary = updateConversationSummary("- Contexte antérieur", [{ role: "user", content: "Le projet Kasa doit rester en lecture seule. Ma prochaine action est de vérifier le router." }, { role: "assistant", content: "Décision validée : conserver React Router." }]); assert.match(summary, /Contexte antérieur/); assert.match(summary, /lecture seule/); assert.match(summary, /React Router/); });
