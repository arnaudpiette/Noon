# Intent & Command Engine

## But et source de vérité

Noon accepte plusieurs canaux, mais normalise chaque demande dans le même
contrat avant tout raisonnement ou toute exécution :

```text
Input → Input Adapters → IntentCommandEngine → NormalizedIntent → NoonOrchestrator
```

Les responsabilités sont volontairement séparées :

- adaptation du canal : `services/intents/input-adapters.js` ;
- compréhension et résolution : `services/intents/intent-command-engine.js` ;
- définitions des commandes : `services/intents/command-registry.js` ;
- validation des contrats : `services/intents/intent-schema.js` ;
- résolution temporelle : `services/intents/temporal-parser.js` ;
- références de session : `services/intents/recent-entity-context.js` ;
- résolution de workspace : `WorkspaceEngine` ;
- exécution : `NoonOrchestrator`, puis `SkillRegistry` ;
- validation des actions sensibles : `ApprovalEngine`.

Le parseur est sans effet de bord. `requiresTool` décrit un besoin potentiel ;
il ne déclenche jamais lui-même un outil.

## InputEnvelope

Le contrat commun contient : `inputId`, `channel`, `rawText`, `transcript`,
`uiAction`, `shortcutPayload`, `structured`, `timestamp`, `conversationId`,
`workspaceId`, `sessionId`, `locale`, `originTrust` et `metadata`.

Les canaux acceptés sont `chat`, `voice`, `shortcut`, `ui`, `system`,
`proactive` et `brief`. Une origine `external_content` est rejetée : le texte
d'un e-mail, d'un document, d'une page Web ou d'un résultat d'outil ne peut
pas devenir implicitement une commande utilisateur.

## NormalizedIntent

Chaque sortie validée contient : `intentId`, `intentPolicyVersion`, `type`,
`action`, `entities`, `target`, `workspaceId`, `projectId`, `conversationId`,
`mode`, `temporal`, `confidence`, `ambiguity`, `sourceChannel`, `origin`,
`originalInputRef`, `explicitOrder`, `negated`, `requiresReasoning`,
`requiresSearch`, `requiresTool`, `expectedResponseType`, `parseOnly`,
`ignored`, `searchScopes`, `steps` et `dependencyMode`.

Types retenus : `ASK`, `SEARCH`, `CREATE`, `UPDATE`, `DELETE`, `OPEN`,
`NAVIGATE`, `PLAN`, `REMIND`, `SCHEDULE`, `SUMMARIZE`, `COMPARE`, `GENERATE`,
`SWITCH_CONTEXT`, `CONTROL`, `CONFIRM`, `REJECT`, `CONTINUE`, `CANCEL` et
`COMPOUND`.

## Résolution

- Les commandes simples et structurées sont déterministes.
- Les dates absolues et relatives, heures, durées et parties de journée sont
  normalisées dans le fuseau `Europe/Paris`.
- Les noms de workspace sont confiés au `WorkspaceEngine`. Un homonyme ou une
  cible absente produit une ambiguïté explicite ; aucune bascule silencieuse.
- `ce fichier`, `ce projet`, `la précédente` et `celle-là` consultent un petit
  registre sessionnel borné et expirant. Zéro ou plusieurs candidats impose
  une clarification.
- Un intent composé conserve ses étapes et indique `sequential` ou `parallel`.

## Approbations et sécurité linguistique

`oui` et `non` ciblent une approbation seulement lorsqu'elle est unique.
Plusieurs approbations restent ambiguës. « oui mais modifie… » devient une
mise à jour de l'action en attente, jamais une confirmation. Les négations,
questions hypothétiques et actions citées comme exemples sont protégées afin
de ne pas devenir des ordres.

## Fallback sémantique

Le fallback modèle est désactivé par défaut et réservé aux formulations
réellement non résolues lorsque l'appelant l'autorise explicitement. Il passe
par le routeur Luna/Terra/Sol central, utilise `store: false`, demande un JSON
Schema strict et revalide la sortie localement. Une sortie invalide redevient
un `ASK` ambigu et n'exécute rien.

## Migration

Le chat et la voix envoyée au cerveau sont normalisés avant
`NoonOrchestrator`. Les commandes UI, raccourcis, mode, Focus et la route
locale historique sont observés en shadow tout en conservant leur comportement
legacy. Les événements `intent_legacy_match` et `intent_legacy_mismatch`
permettent de mesurer la parité avant suppression progressive des anciens
parseurs. Le wake word reste volontairement séparé : il réveille l'interface,
mais n'est pas une autorisation métier.

## Observabilité et confidentialité

Les événements couvrent réception, résolution, ambiguïté, échec, fallback,
latence, canal, type et version de politique. Ils ne contiennent ni texte,
transcript, nom de fichier, chemin local, contenu de document ou données
personnelles. Seuls des catégories, compteurs, durées et identifiants non
sensibles sont conservés.

## Tests

Le corpus de caractérisation couvre le français, l'anglais, l'espagnol, les
sept canaux, les commandes composées, approbations, ambiguïtés, négations,
références récentes, temporalité, workspaces homonymes et contenu externe.
Les tests vérifient également la convergence chat/voix/raccourci/UI et
l'absence de texte privé dans les métriques.
