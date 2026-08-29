# Context Builder central

Le Context Builder de Noon se trouve dans
`services/context/context-builder.js`. Il répond à trois questions avant un
appel distant : quoi charger, pourquoi le charger et ce qui est autorisé à
quitter la machine.

Il ne stocke aucune donnée. Les souvenirs restent lus exclusivement par
`MemoryEngine`, les règles viennent du `Hard Rules Registry` et la personnalité
vient de `lib/noon-system-prompt.js`.

## Priorité des sources

1. Hard Rules applicables, jamais tronquées ;
2. personnalité centrale ;
3. contexte explicite et permissions runtime ;
4. projet actif uniquement ;
5. conversation récente indispensable ;
6. mémoires confirmées et pertinentes ;
7. résumé conversationnel et contexte secondaire.

Les règles critiques peuvent dépasser exceptionnellement le budget annoncé :
elles ne sont jamais supprimées pour faire tenir une mémoire secondaire.

## Confidentialité

Le résultat sépare :

- `localContext`, qui peut référencer des données conservées sur la machine ;
- `remoteModelContext`, qui ne contient que les éléments marqués comme
  envoyables par `MemoryEngine`.

Une mémoire `local_only`, une mémoire sans consentement ou une mémoire
`confirm_each_use` non confirmée n'entre jamais dans `remoteModelContext`.
Les métadonnées indiquent son exclusion par ID et motif, sans journaliser son
contenu.

## Budgets par canal

| Canal | Budget par défaut |
| --- | ---: |
| Chat | 6 000 tokens |
| Live Voice | 1 600 tokens |
| Brief | 8 000 tokens |
| Background | 5 000 tokens |
| Projet | 6 000 tokens |

L'estimation volontairement prudente utilise environ quatre caractères par
token. Le builder expose le budget, l'estimation, la troncature et les indices
de complexité pour un futur routeur.

## Intégration actuelle

Le chat texte standard utilise le Context Builder pour la personnalité, les
Hard Rules, la mémoire, le projet et la conversation récente. Les instructions
spécifiques aux pièces jointes, au Focus et aux outils restent assemblées dans
`askAI()` jusqu'à l'extraction du futur Orchestrator.

Restent volontairement legacy à cette étape :

- Live Voice et sa construction d'instructions ;
- briefs créatif et personnel ;
- tâches background ;
- sélection complète des outils ;
- routeur Luna/Terra/Sol.

## Comparaison représentative

Les tests caractérisent trois situations :

- une commande Vite ne charge ni Calendar ni profils familiaux ;
- Live Voice limite la lecture à 5 éléments et 4 messages, avec 1 600 tokens ;
- une question ciblée conserve une mémoire utile au lieu d'un contexte
  exhaustif fictif de 24 000 caractères (environ 6 000 tokens).

Les événements DEBUG `context-builder.summary` contiennent seulement les
comptages, identifiants, budgets et statuts de filtrage, jamais le texte privé.
