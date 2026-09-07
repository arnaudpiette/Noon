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
