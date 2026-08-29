# Noon Evaluation Engine

Cette suite mesure les contrats comportementaux de Noon au-dessus des tests unitaires existants. Elle fonctionne hors ligne par défaut, avec des données fictives et des adaptateurs déterministes. Elle ne lit ni base utilisateur, ni fichier personnel, ni connecteur réel.

## Commandes

- `npm run eval:smoke` : parcours rapide non critique.
- `npm run eval:critical` : invariants de sécurité, confidentialité, approbation et idempotence.
- `npm run eval` ou `npm run eval:full` : corpus hors ligne complet.
- `npm run eval:live` : sélection réservée aux scénarios live ; aucun scénario live n'est activé par défaut.
- `npm run noon:check` : lint, évaluations critiques et tests complets.

Le rapport JSON est écrit dans `.noon-evals/latest.json`, répertoire ignoré par Git. Les champs susceptibles de contenir du contenu, un secret, un token, un mot de passe ou un prompt sont expurgés.

## Baseline

La baseline est versionnée dans `test/evals/baseline/noon-baseline.json`. Sa mise à jour n'est jamais automatique :

```sh
node scripts/run-evaluations.js --update-baseline --accept-baseline
```

Toute modification doit être relue dans le diff. Les invariants critiques ont une tolérance nulle et leur échec bloque la release.

## Ajouter un scénario

Le schéma canonique contient `scenarioId`, `category`, `description`, `input`, `initialState`, `mocks`, `expected`, `invariants`, `metrics`, `tolerances` et `tags`. Un identifiant reste stable dans le temps. Les métriques et tolérances sont propres au scénario.
