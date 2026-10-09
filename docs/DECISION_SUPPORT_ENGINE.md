# Decision Support Engine

`DecisionSupportEngine` est la source de vérité pour comparer des options et formuler une recommandation structurée. Il ne recherche pas, ne choisit pas le modèle, ne planifie pas et n'exécute aucune action.

## Pipeline

`DecisionRequest → critères et contraintes → preuves référencées → évaluations → trade-offs → incertitude → recommandation → utilisateur décide`.

Les contraintes dures sont évaluées en code et rendent une option `INFEASIBLE`. Une valeur absente reste `UNKNOWN`; aucune moyenne artificielle ne lui est attribuée. Les indices internes servent uniquement à ordonner et ne sont jamais présentés comme une probabilité.

## Autonomie et confidentialité

- `recommendationIsAction` et `actionAuthorized` restent toujours `false`.
- Un choix est enregistré uniquement avec `userConfirmed: true`.
- Un choix de projet ne crée jamais une préférence durable.
- Les preuves `localOnly`, d'un autre workspace ou d'un autre profil sont filtrées.
- Les journaux ne contiennent que des identifiants et compteurs pseudonymisés.

## Rollout

- `decision.engine`: `SHADOW` ;
- `decision.sensitivity`: `LIMITED` ;
- `decision.history`: `OFF` tant que la persistance durable et l'interface de validation ne sont pas activées.

Le premier périmètre est `COMPARE`. Les types `CHOOSE`, `RANK`, `TRADEOFF`, `GO_NO_GO`, `WHAT_IF` et `REVIEW_DECISION` partagent le contrat mais ne déclenchent aucune automatisation.

## Portfolio Capacity — wiring V2 shadow

`PortfolioCapacityEngine.decisionRequest()` est le premier consommateur du contrat strict `schemaVersion: 2`.

Le wiring reste limité au mode local et read-only :

- l'état courant devient une option `CURRENT_STATE` ;
- au moins une alternative explicite est requise, afin que Decision Support reçoive toujours au moins deux options ;
- le snapshot projette uniquement des observations structurées de charge temporelle, marge de capacité et signal d'échéance ;
- ces observations sont `SYSTEM_OBSERVATION` / `SYSTEM` / `VERIFIED` et sont attestées séparément via `attestedEvidenceIds` ;
- une marge de capacité inconnue reste `null` et produit une contrainte `UNKNOWN`, jamais un faux zéro ;
- le nombre de clusters d'échéance est une observation factuelle, pas une preuve automatique de surcharge ;
- aucune vérification n'est exécutée par ce wiring ;
- `recommendationIsAction`, `actionAuthorized` et `verificationAuthorized` restent toujours `false`.

Le wiring Portfolio ne modifie ni Goal, ni Planning, ni Calendar, ni projet. `DECIDED` reste un verdict intellectuel et ne constitue jamais une permission d'exécution.
