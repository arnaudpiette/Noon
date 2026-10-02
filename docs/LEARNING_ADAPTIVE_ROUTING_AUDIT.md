# Audit Learning / Adaptive Routing

## Portée et niveau de preuve

Audit statique du code au commit `597c920` et des tests ciblés existants. Aucune
base personnelle, aucun fournisseur, aucune Automation macOS et aucun runtime
Electron n'ont été utilisés. Une capacité décrite comme « câblée » a un appel
identifié ; elle n'est pas pour autant validée au runtime.

Aucun document nommé « Roadmap 5 » n'est présent dans les fichiers suivis. Les
documents de référence retrouvés sont `docs/review-learning-engine.md`,
`docs/proactive-engine.md`, `docs/MULTI_PROVIDER_ROUTING.md` et la synthèse
SQLite.

## Matrice

| Capacité | Implémentation | Consommateur réel | Preuve / test | Écart | Statut |
| --- | --- | --- | --- | --- | --- |
| Collecte d'observations d'exécution | `ExecutionTrackingEngine` alimente `ReviewLearningEngine` via `trackingProvider` dans `server.js`. Les durées fiables exigent dates, confiance >= 0,8 et source reconnue. | Génération quotidienne/hebdomadaire via les routes `/reviews/*` et `DailyBriefEngine.reviewProvider`. | `services/review/review-learning-engine.js`, `test/review-learning-engine.test.js`. | Le périmètre est filtré par `subjectScope` pour ExecutionTracking, mais pas par projet. | Câblée, tests déterministes existants. |
| Feedback proactif | `ProactiveEngine.feedback()` met à jour recommandation, événement feedback et métrique dans la transaction du repository. Les valeurs négatives `not_useful`, `later`, `dont_remind` modifient statut/cooldown ou rejet. | Route serveur de feedback proactif, puis agrégation dans les reviews. | `services/proactive/proactive-engine.js`, `test/proactive-engine.test.js`, `test/proactive-feedback-atomicity.test.js`, `test/review-learning-scope.test.js`. | `subject_scope` est maintenant enregistré et filtré en SQL avant `LIMIT`; les lignes historiques `NULL` restent exclues des reviews ciblées. Le contrat de review ne définit pas de scope projet. | Câblée ; isolation profil déterministe. |
| Génération de reviews | `ReviewLearningEngine` calcule couverture, tendances, hints, candidats mémoire et métriques locales ; `ReviewLearningRepository.save()` est transactionnel. | `POST /reviews/daily`, `POST /reviews/weekly`, `GET /reviews` et Daily Brief. | `test/review-learning-engine.test.js`, `test/review-learning-repository-concurrency.test.js` (26/26 avec la suite Review lors de la dernière validation). | Aucun appel direct `/reviews` retrouvé dans `public/` ou `electron/`; le Daily Brief est le consommateur UI indirect identifié. | Câblée côté serveur et Daily Brief. |
| Hints de planning appris | Le Planning lit la dernière review hebdomadaire `arnaud` : `bufferMultiplierHint` augmente les durées et `maxPlannedUtilizationHint` borne la capacité. | `DailyPlanningEngine.buildPlan()` via `learningHintsProvider` dans `server.js`. | `services/planning/daily-planning-engine.js`, `test/daily-planning-engine.test.js`. | `avoidFragmentationHint` est seulement reporté dans `learningHintsApplied`; `timeOfDayHints` et `runtimeAdjustments` ne modifient pas le placement. Le scope est codé en dur à `arnaud`, sans projet. | Partiellement appliquée. |
| Hints proactifs appris | `notificationGroupingHint` réduit temporairement le plafond de notifications à deux. | `ReviewLearningEngine.persistAndLearn()` appelle `ProactiveEngine.applyReviewHints()` pour une nouvelle review. | `test/proactive-engine.test.js`. | État en mémoire du processus, non persisté ; perdu au redémarrage. Les autres insights ne deviennent pas des règles. | Partiellement appliquée. |
| Candidats mémoire issus des reviews | Les tendances suffisamment fiables passent par `MemoryEngine.proposeCandidate()`. | Appel réel depuis `ReviewLearningEngine.persistAndLearn()`. | `test/review-learning-engine.test.js`; documentation Review. | Candidat `inferred`/local-only, non appliqué automatiquement ; cela respecte l'absence de vérité persistante silencieuse. | Câblée, volontairement non automatique. |
| Observations de performance modèle | `NoonObservability.recordModelCall()` normalise et enregistre provider, modèle, succès, échec, latence, tokens, coût, fallback et escalation dans `model_performance_samples`. | `NoonOrchestrator` appelle `recordModelCall()` ; `server.js` attache `ModelPerformanceEngine`. | `services/observability/noon-observability.js`, `services/orchestration/noon-orchestrator.js`, `test/model-performance-observability.test.js`. | L'échec de persistance est isolé de l'observabilité ; aucune donnée personnelle n'est stockée. Pas de scope profil/projet dans le schéma. | Câblée, tests déterministes existants. |
| Agrégation de performance | `ModelPerformanceEngine.snapshot()` groupe par domaine, qualité, provider et modèle ; minimum cinq échantillons, confiance medium à partir de huit. | Appelé par `AdaptiveRoutingService.evaluate()`. | `test/model-performance-engine.test.js`, `test/model-performance-repository.test.js`. | Agrégats globaux sur la base locale, pas d'isolation profil/projet ; aucune surface UI ou route dédiée retrouvée. | Câblée en interne. |
| Routing adaptatif | `AdaptiveRoutingService` construit scores, latence historique et route proposée à partir des observations stables. | `selectConfiguredModelRoute()` l'appelle seulement lorsque `router.adaptive-learning` est en shadow. | `test/adaptive-routing-service.test.js`, `test/cost-aware-routing.test.js`, `services/config/feature-flag-registry.js`. | Le flag est `SHADOW` par défaut et la route active n'est jamais remplacée : le résultat est renvoyé comme `adaptiveShadow` et audité. Les scores n'influencent réellement le classement que dans le chemin cost-aware multi-provider, lui-même désactivé par défaut. | Câblée, shadow uniquement. |
| Model Router et fallback | `selectModelRoute()` applique signaux déterministes, qualité, capacité, disponibilité, coût, fournisseurs autorisés et fallback contrôlé. | Chat, Daily Brief, orchestration et chemins DEV passent par le routeur configuré. | `lib/noon-intelligence.js`, `server.js`, tests de routing/cost-aware existants. | Les données Learning ne changent pas la sélection active ; données insuffisantes donnent `INSUFFICIENT_EVIDENCE` ou `INSUFFICIENT_STABLE_EVIDENCE` dans le shadow. | Câblée ; adaptation active absente volontairement. |

## Clarifications

### Données qui influencent réellement le choix du modèle

La route active repose sur les signaux de requête, profil, budget, capacités,
disponibilité fournisseur/modèle, coût et politiques de rollout dans
`lib/noon-intelligence.js`. Les performances historiques (succès, premier
passage, échecs qualité, fallback, escalation, latence et coût) sont collectées
et agrégées, mais ne modifient aujourd'hui que la route **shadow**. Elles ne
changent pas la route active dans `server.js`.

### Règles apprises, validation et fallback

- Les hints de review sont des ajustements souples : deux seulement influencent
  effectivement le planning, et le regroupement de notifications est temporaire.
- Les candidats mémoire restent proposés et local-only jusqu'au flux de
  validation Memory existant.
- Les feedbacks négatifs sont traités dans Proactive (cooldown, dismissal,
  métrique) ; ils contribuent aux agrégats de review, mais ne réécrivent pas le
  Model Router.
- En cas de données insuffisantes, le routing adaptatif renvoie un statut
  explicite et ne propose pas de shadow. Les fallbacks du routeur canonique
  restent indépendants de Learning.

### Scopes et `reviewId`

`ReviewLearningRepository.getLatest()` définit la portée de `review_version` :
type, sujet, début et fin de période. La génération actuelle construit toutefois
un `reviewId` déterministe pour le même type/sujet/période. Deux contenus de
review distincts pour cette même période rencontreraient donc la clé primaire
avant de pouvoir coexister comme révisions. Aucun consommateur ni document ne
présente les révisions applicatives multiples comme un contrat ; c'est une
limite de modèle à décider, pas un défaut corrigé par cette phase.

L'isolation `subjectScope` est effective pour ExecutionTracking, les routes
Reviews et, depuis cette correction, les recommandations/feedbacks qui les
alimentent : le scope est porté par les producteurs fiables (route app, drifts
ExecutionTracking et Brief `arnaud`), persisté, inclus dans la déduplication et
filtré avant agrégation et `LIMIT`. Les entrées historiques sans scope restent
visibles uniquement aux lectures générales ; elles n'alimentent aucune review
ciblée. `projectId` reste une métadonnée de recommandation : les reviews ne
reçoivent ni ne promettent une portée projet, donc aucune attribution ou filtre
projet n'a été inventé. Les routes Reviews et recommandations app valident la
liste actuelle des profils ; le chemin de dérive ExecutionTracking propage son
scope existant sans l'ériger en nouvelle autorité d'identité. Les hints de
planning sont câblés pour `arnaud`. Un appel Proactive sans scope reste
volontairement `NULL` : il n'est jamais attribué implicitement à Arnaud ni
consommé par une review ciblée.
Les observations de modèles et le routing adaptatif sont globaux à la base
locale : ils ne sont ni profil- ni projet-spécifiques.

## Écarts démontrés

1. L'adaptive routing est implémenté mais ne possède aucune autorité sur la
   sélection active : mode `SHADOW` par défaut, comparaison/audit uniquement.
2. Trois sorties de review (`avoidFragmentationHint`, `timeOfDayHints`,
   `runtimeAdjustments`) ne sont pas appliquées par le planning ; elles sont
   respectivement projetées ou seulement exposées.

## Prochaine tâche minimale

Choisir, sans modifier l'architecture, si l'adaptation doit rester durablement
en `SHADOW` ou si un consommateur explicitement autorisé doit comparer sa route
active au shadow. Cette décision doit rester séparée de toute nouvelle
architecture Adaptive Routing.
