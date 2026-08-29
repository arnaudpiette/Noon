# Review & Learning Engine

Le moteur de revue est la source unique des bilans d’exécution quotidiens et hebdomadaires de Noon. Les calculs restent locaux et déterministes ; aucune conversation, aucun titre de tâche et aucun contenu privé brut n’est nécessaire aux statistiques.

## Flux

1. `ExecutionTrackingEngine` fournit les états, les preuves et les horaires prévus/réels.
2. `DailyPlanStore` fournit la capacité, les replannings, les déplacements et la stabilité.
3. le dépôt proactif fournit uniquement les états agrégés des recommandations et feedbacks.
4. `ReviewLearningEngine` calcule couverture, erreurs robustes, stabilité et tendances prudentes.
5. les sorties sont séparées en ajustements temporaires, hints de planning, recommandations et candidats mémoire.
6. tout candidat long terme passe par `MemoryEngine.proposeCandidate()` et reste `inferred`, `local_only` et inutilisable jusqu’à validation.

## Fiabilité

Une durée réelle n’est analysée que si `actualStart` et `actualEnd` existent, si la confiance vaut au moins `0.8` et si la source est une confirmation explicite, un rappel terminé, un résultat exact d’outil ou un état projet. Un créneau simplement dépassé reste inconnu.

La médiane des durées, erreurs et ratios est préférée à la moyenne pour résister aux valeurs extrêmes. Une tendance d’estimation demande au moins cinq échantillons ; un candidat mémoire en demande au moins huit, avec 75 % des observations orientées dans le même sens. Les multiplicateurs sont plafonnés à `1.35`.

## Temps et idempotence

Les limites journalières et hebdomadaires sont calculées en `Europe/Paris`, y compris pendant les changements d’heure. Chaque revue possède `reviewId`, période, version et empreinte des seules données opérationnelles. Une empreinte identique ne recrée ni revue ni candidat.

## Intégrations

- le Planning Engine consomme les hints souples sans modifier ses Hard Rules ;
- le Daily Brief consomme la dernière revue, et la vision du lundi reçoit la revue de la semaine précédente ;
- le Proactive Engine reste l’unique point de diffusion des recommandations ;
- `GET /reviews`, `POST /reviews/daily` et `POST /reviews/weekly` exposent le service local.

Les routes d’écriture exigent `X-Noon-Request: 1`. Aucun déclencheur horaire supplémentaire n’a été créé.
