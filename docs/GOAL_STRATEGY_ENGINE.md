# Goal & Strategy Engine

Le GoalStrategyEngine est la source de vérité stratégique de Noon. Il sépare strictement trois niveaux :

- **WHY** : objectifs, outcomes et critères de réussite ;
- **HOW** : stratégies, jalons et projets liés ;
- **WHAT / WHEN** : tâches, priorités et placement calendrier, qui restent la responsabilité des moteurs existants.

## Limites d’autorité

Le moteur ne crée aucune tâche, aucun événement, aucun e-mail et aucun fichier. Il ne calcule pas la priorité opérationnelle et ne place aucun créneau. Un objectif ne constitue jamais une permission d’agir.

Les identités de projets et workspaces sont validées via leurs services canoniques puis référencées par ID. Elles ne sont jamais recopiées dans le registre stratégique.

## Cycle de vie

Un objectif inféré reste un `GoalCandidate` en `PENDING_CONFIRMATION`. Seule une confirmation explicite peut créer un objectif actif. Les transitions majeures, jalons et stratégies requièrent également une confirmation. Une stratégie est versionnée ; les références aux `DecisionRecord` sont conservées sans copier les décisions ni les Hard Rules.

Statuts d’objectif : `DRAFT`, `ACTIVE`, `PAUSED`, `ACHIEVED`, `ABANDONED`, `SUPERSEDED`.

Horizons : `SHORT_TERM`, `MEDIUM_TERM`, `LONG_TERM`, `OPEN_ENDED`.

## Progression honnête

Méthodes possibles : `MEASURED`, `ESTIMATED`, `MILESTONE_BASED`, `USER_REPORTED`, `UNKNOWN`.

Le temps calendrier, le nombre de tâches terminées, l’activité d’une application ou la clôture d’un projet ne prouvent jamais automatiquement une progression. Sans preuve suffisante, la valeur reste `UNKNOWN`. Une transition vers `ACHIEVED` exige des critères ou jalons satisfaits ainsi qu’une confirmation explicite.

## Alignement

`GoalAlignmentService` produit `DIRECT`, `SUPPORTING`, `NEUTRAL`, `CONFLICTING` ou `UNKNOWN`. Il expose un seul signal stratégique : PriorityEngine reste l’unique moteur de priorité. PlanningEngine reste l’unique moteur de placement temporel.

## Contexte, vie privée et observabilité

ContextBuilder demande au moteur au plus cinq références compactes pertinentes. Un objectif `LOCAL_ONLY` est filtré avant le contexte distant. Les scopes profil, workspace et projet sont appliqués avant sélection.

La télémétrie contient uniquement IDs, statuts, compteurs et durées. Les titres, outcomes, contraintes et contenus de stratégie ne sont jamais journalisés.

## Rollout

- `goals.engine` : `LIMITED` — objectifs explicites, outcomes, jalons et liens ;
- `goals.alignment` : `SHADOW` — signal stratégique sans réordonnancement silencieux ;
- `goals.progress` : `LIMITED` — évaluations factuelles ;
- `goals.reviews` : `OFF` — proactivité stratégique différée.

Le registre accepte un repository injecté. Le serveur utilise actuellement le repository mémoire de rollout ; une persistence durable dédiée reste à raccorder avant promotion générale.
