# Context Builder central

Le Context Builder de Noon se trouve dans
`services/context/context-builder.js`. Il répond à trois questions avant un
appel distant : quoi charger, pourquoi le charger et ce qui est autorisé à
quitter la machine.

## Contrat stable A1

`buildContext(input)` reste l’unique API de construction du contexte. Il ne
possède ni stockage ni source métier : il délègue la mémoire, les workspaces,
les permissions, les objectifs et le contexte ambiant à leurs propriétaires.

Entrées réellement prises en charge : `query`, `intent`, `channel`,
`conversationId`, `projectId`, `workspaceId`, `mode`, `sessionContext`,
`requestedTools`, `maxContextTokens`, `includePrivate`,
`includeConversation`, `purpose`, `peopleIds`, `confirmedMemoryIds`,
`decisionContext` et les versions/instructions de cache associées. Les
consommateurs existants peuvent continuer à transmettre leur objet de requête
complet : les champs inconnus sont ignorés.

La sortie historique est préservée (`system`, `userContext`, `conversation`,
`runtime`, `localContext`, `remoteModelContext`, `segments`, `metadata`). La
vue contractuelle A1 ajoute sans recopier de contenu :

- `sources`, `included`, `excluded` : type, identifiant, décision, raison et
  classification de confidentialité ;
- `budget` : plafond, consommation, économies et troncature ;
- `privacy` : compteurs de classifications et éléments filtrés ;
- `cache` : hit/miss et statistiques de segments ;
- `diagnostics` : version de contrat, intention, canal, durée et comptes.

Ces vues d'observabilité n'incluent jamais une valeur de mémoire, un contenu
de message, une note, un corps d'e-mail ou un secret.

`localContext` est destiné aux traitements locaux autorisés. `remoteModelContext`
est construit séparément et ne reçoit que les éléments que `MemoryEngine` a
déjà autorisés; `local_only`, les consentements manquants et les éléments
rejetés restent exclus. La politique finale par provider appartient à
`ProviderPrivacyPolicy`. Une donnée `PRIVATE` n'est donc pas automatiquement
envoyée : elle reste soumise à cette politique au moment de l'appel.

Le builder est utilisable hors ligne : il ne contacte aucun provider. Les
permissions sont relues avant le cache dynamique afin qu'une révocation soit
prise en compte immédiatement. Les invalidations explicites restent
`invalidateMemory`, `invalidateProject`, `invalidateSession`,
`invalidateProfile`, `invalidatePermissions` et `invalidatePrivacy`.

## Résolution canonique A2

Avant la sélection mémoire, le builder consulte localement le
`CanonicalEntityResolver` pour une entité `PROJECT`. Cette façade relit les
alias déjà détenus par le registre de projets, le catalogue Focus, les
workspaces et les références de session; elle n’a ni base ni cache persistant.
Elle retourne uniquement `RESOLVED`, `AMBIGUOUS` ou `NOT_FOUND`.

Une résolution projet certaine devient le `projectId` effectif utilisé pour la
recherche mémoire et le segment projet. Une ambiguïté ne sélectionne aucun
projet. Le diagnostic `diagnostics.entityResolution` expose seulement statut,
type, identifiant, méthode, source, confiance et nombre de candidats — jamais
le texte de la requête ou un alias.

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

## Sources contextuelles autorisées A3

`ContextBuilder` reste l'unique agrégateur. Son API historique
`buildContext()` est synchrone et ne lit aucune source opérationnelle. Le
chemin `buildContextAsync()` construit d'abord le même contexte A1/A2, puis
demande à `AuthorizedContextSources` de sélectionner les lectures utiles avant
tout accès.

| Source | Propriétaire canonique | Lecture A3 | Portée et cache |
| --- | --- | --- | --- |
| Notes | `apple-notes` via `searchNotes()` | prédicat titre dans Notes, 3 résultats | local, sans corps ni cache A3 |
| Rappels | `apple-reminders` | actifs/échéance proche, 5 | local, volatile |
| Calendar | `google-calendar` | fenêtre demandée ou 26 h, 5 | distant, non mis en cache |
| Gmail | `gmail` via `PersonalSearchEngine` | recherche ciblée, metadata/extrait minimal, 3 | distant, cache existant de recherche (30 s) |
| Fichiers | `FileSearchAdapter` via `PersonalSearchEngine` | racines autorisées, projet résolu si disponible, 3 | local, cache existant de recherche (30 s) |
| Git | `inspectGitStatus()` | un résumé sans diff | local, non mis en cache |
| Exécution | `ExecutionTrackingEngine.list()` | un résumé et comptes bornés | local, volatile |

Une source non pertinente est `SKIPPED_NOT_RELEVANT`; les états distingués sont
`AVAILABLE`, `UNAVAILABLE`, `UNAUTHORIZED`, `NOT_CONFIGURED` et `ERROR`.
L'autorisation est vérifiée avant `read()`. Les titres/contenus Notes, Gmail,
Rappels, Calendar et Fichiers restent `localOnly`; seuls les résumés Git et
exécution explicitement éligibles peuvent atteindre le contexte distant après
`ProviderPrivacyPolicy`.

La sélection est déterministe : une question générale ne déclenche aucune
lecture A3; les indices agenda sélectionnent Calendar/Rappels, un e-mail Gmail,
un dépôt Git/exécution et les mots-clés explicites Notes ou fichiers leur source
respective. Chaque source a un quota propre (Notes 3, Rappels/Calendar 5,
Gmail/Fichiers 3, Git 1 et Exécution 4) et une échéance de 5 secondes. Une
échéance, une erreur ou une absence d'autorisation est isolée dans le
diagnostic : les autres sources sélectionnées continuent. Les doublons ne sont
fusionnés qu'en présence d'une identité canonique explicite, jamais sur une
simple similitude de texte.

Une entité A2 ambiguë ne déclenche ni Git, ni fichiers, ni suivi de projet.
Un échec de connecteur est enregistré dans `diagnostics.sourceDiagnostics` sans
interrompre la construction. Ces diagnostics ne contiennent que sélection,
statut, compteur, troncature et durée; aucun contenu, chemin, requête ou nom.

`searchNotes()` borne la requête à 500 caractères et la transmet comme argument
`osascript`, jamais comme code AppleScript. Notes filtre d'abord ses métadonnées
sur le titre; Node ne reçoit ensuite que les candidats (maximum 10), classe au plus 3 résultats et
ne lit `plaintext` que si un appel explicite demande `includeBody: true`. Le
chemin A3 utilise `includeBody: false`; `listRecentNotes()` reste inchangé pour
les consommateurs historiques, notamment Daily Brief.
