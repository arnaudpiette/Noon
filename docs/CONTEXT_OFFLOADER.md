# Context Offloader V1

## Rôle

Le Context Offloader complète le `ContextBuilder` sans remplacer sa sélection,
la continuité de session ni la compaction du provider. Quand le budget du
builder va écarter un item déjà sélectionné, il crée la référence pendant
l'évaluation de cet item, avant le `continue` qui l'enlève du contexte actif.
Il ne crée aucun nouveau résumé et ne recopie pas le payload.

Le flux reste :

`sources → ContextBuilder → contexte actif + références locales → récupération explicite → NoonOrchestrator → compaction provider éventuelle`.

## Contrat V1

Une référence contient l'autorité (`sourceType`, `sourceId`), les portées
profil/workspace/projet/session/conversation, la classe de confidentialité,
`localOnly`, une empreinte stable du contenu, une estimation de taille, une
expiration et la raison de l'éviction. `subjectScope` distingue la personne
concernée du `profileScope` propriétaire. `resolvable` rend explicite l'absence
d'une relecture canonique par identifiant.

La portée n'est jamais déduite du corps brut d'une requête. Le serveur la
résout à partir de la session de continuité persistée et, lorsqu'il existe,
du workspace canonique associé au même profil. Profil, session et conversation
sont obligatoires ; workspace et projet, s'ils sont présents, doivent aussi
correspondre. Sans cette portée, l'offload et toute récupération sont refusés,
mais le contexte ordinaire reste utilisable.

Le registre ne stocke jamais le contenu. Une récupération :

1. exige les portées exactes de la référence ;
2. transmet le contexte d'autorisation actuel à l'autorité canonique ;
3. exige une autorisation actuelle positive et refuse l'usage distant si la
   politique actuelle ne l'autorise plus ;
4. relit l'autorité existante par `sourceType/sourceId` ;
5. réapplique la classification privacy au contenu relu ;
6. compare l'empreinte du contenu courant ;
7. échoue explicitement si la référence est inconnue, expirée, périmée,
   hors portée ou non résoluble.

La classe privacy, `localOnly` ou toute autre métadonnée enregistrée dans la
référence est une restriction et un diagnostic local, jamais une preuve de
permission. La décision actuelle de l'autorité et de la privacy reste
obligatoire à chaque résolution.

`ContextBuilder` ne récupère que les IDs fournis dans `offloadRefIds`. Il ne
réinjecte jamais automatiquement l'ensemble du registre. Les références elles-
mêmes restent dans `localContext.offloadedRefs` et n'entrent pas dans
`remoteModelContext`. Une réinjection distante ne contient que la valeur relue
et autorisée ; ni l'ID de référence, ni `sourceId`, ni les métadonnées
`localOnly`, d'expiration ou d'empreinte ne sont projetés.

Le chemin chat canonique accepte uniquement une sélection bornée d'identifiants
opaques déjà présents dans le registre local. Il ne reçoit ni contenu, ni
profil, ni workspace à choisir ; chaque ID est relu sous la session active
avant d'être ajouté au contexte. Cette sélection n'est pas une autorisation et
ne crée aucune route d'injection de résultat.

## Sources et limites

`MemoryEngine` sait relire les mémoires privées et structurées, les projets et
les messages conversationnels lorsque leur autorité expose un lookup réel.
Une source legacy sans lookup, un résumé de session synthétique, un objectif ou
une source autorisée asynchrone évincée reste `resolvable: false`.

Le V1 est volontairement **éphémère** : son registre vit en mémoire et ne survit
pas au redémarrage. Il est borné à 500 références par défaut (maximum
configurable 5 000), chaque référence expire après 30 minutes par défaut et au
plus tard après 24 heures. Les références expirées sont purgées lors des
écritures et lectures de liste ; la limite de capacité évince les plus
anciennes. Aucune table SQLite, aucun repository et aucune migration ne sont
ajoutés. Après redémarrage, un ancien ID échoue avec
`OFFLOAD_REF_NOT_FOUND` ; Noon ne prétend pas avoir restauré la référence.

La personnalité, les Hard Rules, les permissions courantes et la demande
active ne sont jamais candidates à l'offload. Elles conservent leur autorité et
restent prioritaires même lorsque leur coût dépasse le budget réservé aux
éléments secondaires. Ce cas expose explicitement
`mandatoryBudgetExceeded` et `mandatoryBudgetOverageTokens` ; il n'est pas
confondu avec une troncature d'éléments secondaires.

## Observabilité

Les métriques exposent seulement des compteurs allowlistés : références créées,
récupérées, non résolubles et taille approximative. Elles n'incluent ni
contenu, ni `sourceId`, ni portée, ni empreinte, ni métadonnée `localOnly`, ni
payload privé.

## Hors périmètre V1

Une V2 pourrait persister uniquement les références et leurs empreintes dans
SQLite, avec migration, purge d'expiration et preuve de reprise. Elle ne devrait
toujours pas persister les payloads ni introduire de résumé LLM concurrent.
