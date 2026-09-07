# Portfolio & Capacity Engine

Le `PortfolioCapacityEngine` répond à une seule question : l’ensemble des engagements actifs est-il réaliste au regard d’une capacité humaine explicitement connue ? Il ne place aucun créneau, ne modifie aucune priorité et n’altère ni projet, ni objectif, ni calendrier.

## Sources de vérité

| Responsabilité | Service canonique |
| --- | --- |
| Agrégation du portefeuille | `PortfolioCapacityEngine` |
| Disponibilité humaine | `CapacityService`, alimenté par Calendar, Planning et configuration |
| Identité et état projet | service Project existant |
| Objectifs et stratégie | `GoalStrategyEngine` |
| Importance des tâches | `PriorityEngine` |
| Placement des créneaux | `DailyPlanningEngine` |
| Arbitrages | `DecisionSupportEngine` |
| Durées réellement exécutées | `ExecutionTrackingEngine` |
| Apprentissage des estimations | `ReviewLearningEngine` |
| Proactivité | `ProactiveEngine` |
| Capacité machine | `BackgroundJobEngine` |
| Autorisation opérationnelle | `OperationalSecurityPolicy` |
| Mutations réelles | `TransactionalExecutionEngine` |
| Évaluations | `NoonEvaluationEngine` |

## Contrats

- `PortfolioItem` référence un projet, objectif ou workspace ; il ne copie jamais une entité complète.
- `CapacitySnapshot` distingue capacité brute, indisponibilité, engagements fixes, capacité protégée, buffer, capacité flexible, capacité planifiée et capacité restante.
- `CapacityDemand` utilise une fourchette `minimum/expected/maximum`, une source et une confiance. Une estimation absente reste `null`, jamais zéro.
- `Overload` utilise `HEALTHY`, `TIGHT`, `OVERLOADED`, `SEVERELY_OVERLOADED` ou `UNKNOWN`.
- `CapacityScenario` clone un snapshot et simule des changements. Il expose toujours zéro écriture Calendar, projet et objectif.

## Sécurité et confidentialité

Une panne Calendar ne devient jamais du temps libre. L’application active et le contexte ambiant n’augmentent ni ne réduisent la capacité. La pause protégée est une donnée consommée depuis les Hard Rules/Planning, jamais redéfinie ici. Les résumés distants excluent les items `localOnly`, les titres, chemins et profils. La télémétrie contient seulement états, comptes, durées et références hachées.

## Déploiement

- `portfolio.engine`: `LIMITED`
- `portfolio.capacity`: `LIMITED`
- `portfolio.overload`: `SHADOW`
- `portfolio.scenarios`: `OFF`

Le premier rollout expose les snapshots read-only. Les scénarios restent derrière un flag séparé. Les intégrations Proactive, Daily Brief et Weekly Review sont volontairement différées jusqu’à validation des sources réelles Calendar/Planning/Project.

## Limites actuelles

La façade et ses contrats sont opérationnels hors ligne, mais l’adaptation production des données Calendar, Project et Planning n’est pas encore branchée dans `server.js`. Les snapshots sont conservés en mémoire courte et ne constituent jamais la source de vérité. Aucun écran Portfolio n’est ajouté à cette étape.
