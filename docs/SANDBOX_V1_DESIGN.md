# Sandbox V1 — audit ciblé et design minimal

## Statut et vocabulaire

Ce document décrit la première tranche livrée de la roadmap Sandbox. Elle ne
prétend pas que Noon possède une sandbox générale pour les processus backend.

Trois niveaux doivent rester distincts :

- **autorité** : qui peut demander une action et sous quelles permissions ;
- **restrictions applicatives** : commandes reconnues, racine canonique,
  environnement réduit, limites et contrôles avant/après exécution ;
- **isolation OS** : frontière imposée par le système contre les accès fichiers,
  le réseau et les descendants, même si le programme enfant est hostile.

`shell: false`, une allowlist, un `cwd` ou un prompt ne sont pas une isolation
OS. Tant qu'aucun backend OS n'est vérifié, le niveau honnête est
`APPLICATION_CONSTRAINED`, jamais `OS_SANDBOXED`.

## Autorités canoniques à conserver

La Sandbox V1 ne décide ni permission, ni approbation, ni succès métier :

| Responsabilité | Autorité canonique |
| --- | --- |
| Sécurité de l'action | `OperationalSecurityPolicy` |
| `PROCEED` / `CONFIRM` / `DENY` / `GUIDE` | `InterventionPermissionEngine` |
| Cycle de vie d'une approbation exacte | `ApprovalEngine` |
| Effets de bord, revalidation et vérification | `TransactionalExecutionEngine` |
| Limites d'exécution de l'objectif | Goal Budget Manager, en amont du contrat |
| Agrégation des preuves | `AgentEvaluationEngine`, sans autorité |

Le dépôt ne contient actuellement aucun module portant littéralement le nom
`Goal Budget Manager`. Les limites observées sont réparties entre les contrats
DEV (`maxDuration`, `maxIterations`, coût), le budget de coût DEV et les bornes
du `TransactionalExecutionEngine`. V1 doit accepter une décision de budget
amont normalisée sans recréer un moteur de budget.

Une approbation ne peut jamais augmenter les capacités de sandbox. Les
capacités effectives sont toujours l'intersection entre le profil Sandbox,
les permissions et contraintes courantes, le scope Workspace courant et les
limites de budget courantes.

## Audit de l'existant

### Chemins qui lancent un processus

| Chemin | Lancement actuel | Restrictions existantes | Limites constatées |
| --- | --- | --- | --- |
| Terminal DEV `USER` | `WorkspaceTerminalService.runCommand()` conserve son chemin historique `spawn()` | classifieur fermé, `shell: false`, argv structurés, `cwd` réel lié au Workspace, environnement allowlisté, sortie bornée et expurgée | exclu de V1 ; pas de contrôle OS du réseau, filesystem ou descendants |
| Terminal DEV `NOON` `SAFE_READ` | `WorkspaceTerminalService` délègue à `dev-process-runner` | contrat canonique, revalidation, environnement réduit, deadline, `AbortSignal`, sorties bornées ; le service conserve historique et Problems | `SAFE_READ` ne rend pas le script inoffensif ; pas de confinement OS des fichiers, réseau ou descendants |
| Agent Loop DEV | passe uniquement par le terminal propriétaire `NOON` précédent | une exécution active par session, validation et observation bornées, aucun retry automatique ; aucun appel direct à `child_process` | même limite d'isolation OS que le terminal `NOON` |
| Validations Native DEV | `NativeRepositoryTools` passe par `dev-validation-runner`, puis `dev-process-runner`, depuis le skill transactionnel `noon_dev_run_validation` | classifieur fermé, argv structurés, `cwd` du contrat, environnement minimal, timeout, `AbortSignal`, sortie bornée ; autorisation puis revalidation via `TransactionalExecutionEngine` | un script `npm` autorisé reste du code arbitraire du dépôt ; accès réseau/filesystem et descendants non confinés |
| Validations du spécialiste DEV | `DevDelegationRunner` passe par le runner de validation commun | même classifieur, limites communes, contrôles pré/post Git et contrat commun | pas de confinement OS |
| Adaptateur spécialiste Codex | `CodexSpecialistAgent` utilise `spawn()` | exécutable résolu, environnement allowlisté, mode Codex `workspace-write`, non interactif et éphémère, timeout puis `SIGTERM`/`SIGKILL`, sortie bornée | le mode Codex est une frontière appartenant au CLI, pas à Noon ; la documentation existante exclut une garantie de refus de lecture fichier par fichier ; arrêt de l'arbre descendant non prouvé |
| Pont Codex historique | `lib/codex-bridge.js` utilise `execFile()` | mode Codex `read-only`, projet absolu, timeout et buffer borné | frontière déléguée au CLI ; environnement non normalisé par Noon ; réseau et descendants non prouvés |
| Préflight, statut et diff Git | `RepositoryPreflight`, `DevGitDiffService`, `lib/git-status.js` utilisent `execFile[Sync]()` | argv fixes, opérations Git de lecture, cwd explicite, délais sur plusieurs appels | exécuteurs dispersés ; pas de frontière OS ; certaines formes synchrones ne sont pas annulables |
| Connecteurs locaux Apple et lectures GitHub | lancent `osascript`, helper natif, `shortcuts` ou `git` | API de connecteur, opérations structurées, délais selon le chemin, approvals pour les écritures externes | hors périmètre DEV V1 ; ces processus disposent de capacités macOS spécifiques et exigent une analyse dédiée |
| Fixtures benchmark | scripts et runtime dédiés lancent Git et validations | fixtures temporaires, autorisation benchmark et contrôles de session | environnement de test, pas une primitive de sandbox applicative ; hors V1 |

Le renderer Electron est bien configuré avec `contextIsolation: true`,
`nodeIntegration: false` et `sandbox: true`. Cette sandbox protège le renderer ;
elle ne confine pas les sous-processus lancés par le backend Node composé dans
le processus principal.

### Workspace, chemins et symlinks

- `WorkspaceEngine.bindRoot()` canonise la racine avec `realpath` et la compare
  aux racines autorisées selon le mode lecture/écriture.
- `WorkspaceTerminalService` ne sélectionne qu'une racine réelle exactement
  liée au Workspace.
- `DevTaskContract`, `RepositoryPreflight`, `NativeRepositoryTools` et
  `OperationalSecurityPolicy` refont des contrôles de racine et de liens
  symboliques pour leurs propres opérations.
- `isPathInsideRoots()` est une comparaison de chemins résolus ; il doit être
  précédé d'une canonicalisation appropriée. Il ne limite pas ce qu'un binaire
  enfant peut ouvrir après son lancement.

Ces contrôles protègent les opérations médiées par Noon. Ils ne constituent
pas une politique filesystem imposée à un processus enfant.

### Commandes, environnement, réseau et Git

`dev-command-policy.js` accepte uniquement les validations nommées et deux
formes ciblées à arguments relatifs. Il refuse notamment installation de
paquets, `sudo`, mutations Git destructives et push. Cette grammaire empêche
l'injection de shell dans le lanceur actuel, mais `npm test`, `npm run build`
ou `npm run lint` exécutent les scripts du dépôt, lesquels peuvent ouvrir des
fichiers, lancer des descendants ou utiliser le réseau.

Les environnements ne sont pas homogènes : le terminal et Codex utilisent des
allowlists différentes, Native utilise un petit objet explicite, tandis que la
validation du spécialiste hérite de `process.env`. Aucun chemin inspecté ne
fournit un blocage OS du réseau. Les règles Git/destructives sont des décisions
applicatives et des contrôles de diff/HEAD, pas un empêchement système.

### Durée, annulation et nettoyage

- Native dispose d'un timeout et d'un `AbortSignal` via `execFile()`.
- Le spécialiste Codex ajoute une escalade du processus direct de `SIGTERM` à
  `SIGKILL` après deux secondes.
- Le terminal `NOON` `SAFE_READ` et l'Agent Loop reçoivent leur deadline,
  annulation et grâce d'arrêt du runner commun. Une intention d'annulation
  reste `CANCELLED` côté Problems ; l'absence de fermeture observée reste
  explicitement `CLEANUP_UNCONFIRMED`. Le terminal `USER` reste historique.
- `TransactionalExecutionEngine.cancel()` empêche les étapes suivantes, mais
  n'interrompt pas à lui seul un handler déjà en cours. Il ne remplace donc pas
  le mécanisme d'arrêt du runner de processus.
- Aucun chemin général n'identifie, n'attend et ne nettoie de façon déterministe
  un groupe de processus complet.

La Sandbox ne doit jamais supprimer, restaurer ou nettoyer le workspace pour
réparer un arrêt. Un échec de nettoyage produit un état explicite
`CLEANUP_UNCONFIRMED` et exige inspection, sans destruction automatique.

### Écritures et exécution transactionnelle

Les écritures Native structurées passent par `OperationalSecurityPolicy`, les
guards des tools, puis `TransactionalExecutionEngine`, avec revalidation et
vérification. C'est la voie canonique à préserver. En revanche, le moteur
transactionnel ne peut pas journaliser ou compenser les effets cachés d'un
script de validation. Classer une commande comme `SAFE_READ` ne prouve donc pas
que le programme exécuté est sans effets de bord.

### Modes isolés déjà présents

- Le mode UI Validation emploie un profil fixe séparé, des fixtures fixes sous
  `/private/tmp`, refuse les symlinks, retire plusieurs variables sensibles,
  force le safe mode/local-only et bloque les routes externes concernées. Il
  isole les données de test du profil personnel ; ce n'est pas une sandbox de
  processus.
- Les fixtures benchmark sont des workspaces synthétiques avec leur propre plan
  d'autorisation ; elles ne confinent pas le programme exécuté.
- Le CLI Codex expose ses modes `read-only` et `workspace-write`, mais leur
  garantie appartient à cette dépendance et ne couvre pas tous les lanceurs de
  Noon.
- Les extensions V1 annoncent explicitement `IN_PROCESS_TRUSTED` et ne sont pas
  conçues pour du code hostile.
- La sandbox du renderer Electron ne s'applique pas au backend.

## Écarts de sécurité

1. Il n'existe pas d'enveloppe d'exécution unique pour les processus DEV.
2. Il n'existe pas de preuve d'isolation OS des fichiers ou du réseau pour les
   validations.
3. Un script autorisé peut lancer des descendants et produire des effets non
   médiés par `TransactionalExecutionEngine`.
4. Les environnements, buffers, délais et politiques d'arrêt divergent.
5. L'annulation du processus direct ne prouve pas l'arrêt de son arbre.
6. `SAFE_READ` décrit l'intention de la commande, pas ses capacités réelles.
7. Une décision de policy ou une approval ne porte actuellement aucun contrat
   de capacités d'isolation vérifiables.
8. Le paquet macOS active le Hardened Runtime seulement lorsqu'il est signé et
   déclare notamment les capacités réseau client/serveur. Il ne déclare pas
   `com.apple.security.app-sandbox`. Le comportement développement, paquet non
   signé et paquet signé/notarisé ne peut donc pas être supposé identique.

## Sandbox V1 livrée : enveloppe des validations DEV pilotées par Noon

### Périmètre réel

La première tranche couvre uniquement les processus de validation DEV lancés
par Noon :

1. les commandes classées `SAFE_READ` d'un terminal propriétaire `NOON`, donc
   l'Agent Loop ;
2. `NativeRepositoryTools.runSafeCommand()` ;
3. `DevDelegationRunner.executeValidation()`.

Sont exclus de V1 : terminal propriétaire `USER`, processus du spécialiste
Codex, pont Codex historique, connecteurs Apple, processus de release,
benchmarks, providers, extensions et toute commande libre. Ces exclusions sont
des limites, pas des garanties implicites.

V1 apporte une admission et une enveloppe applicatives communes. Elle ne
déclare une capacité `filesystemContainment` ou `networkDenied` satisfaite que
si un backend OS ultérieur, vérifié pour la plateforme courante, l'atteste. Si
une demande exige l'une de ces capacités avant cette vérification, elle échoue
fermée avec `SANDBOX_CAPABILITY_UNAVAILABLE` avant le spawn.

### Menace et capacités couvertes

V1 réduit :

- injection par composition de commande ;
- substitution de workspace/session/cwd ;
- fuite accidentelle de secrets par environnement ;
- processus sans deadline ou sortie non bornée ;
- résultat de processus ancien appliqué à une autre session ;
- incohérence d'annulation et faux succès après arrêt incertain ;
- élargissement de capacités par une approval.

Sans backend OS vérifié, V1 ne protège pas contre un binaire ou script hostile
qui lit ailleurs, écrit ailleurs, ouvre le réseau ou détache un descendant.

### Contrat normalisé

Un objet immuable `SandboxExecutionContractV1` est construit exclusivement à
partir du contexte autoritaire, jamais à partir d'un payload renderer libre :

```text
version: 1
executionId, owner: NOON, purpose: DEV_VALIDATION
workspaceId, workspaceSessionId, canonicalWorkspaceRoot
commandProfileId, executableIdentity, argv
environmentProfileId
limits: { wallTimeMs, terminateGraceMs, stdoutBytes, stderrBytes }
requiredCapabilities: {
  filesystemContainment, networkDenied, descendantContainment
}
authority: {
  policyDecisionId, policyVersion, actionFingerprint,
  budgetDecisionId, approvalId|null
}
isolation: {
  level: APPLICATION_CONSTRAINED|OS_SANDBOXED,
  backendId|null, verifiedCapabilities
}
createdAt, expiresAt
```

Les références `authority` servent à corréler et auditer. Elles ne sont jamais
une preuve suffisante : juste avant le spawn, V1 re-résout la session et la
racine, revalide la policy et le budget, vérifie la décision exacte et
l'expiration, puis calcule l'intersection des capacités. Une approval exacte
peut satisfaire une exigence métier amont ; elle ne modifie ni le profil de
commande, ni l'environnement, ni le réseau, ni les racines, ni les limites.

`commandProfileId` désigne une entrée versionnée du classifieur existant. Le
renderer ne fournit ni exécutable, ni argv, ni environnement. La résolution de
l'exécutable doit être canonique et contrôlée au lancement ; hériter aveuglément
de `PATH` n'est pas une identité d'exécutable.

### Point d'application et comportement livré

`services/security/dev-process-runner.js` est le **Policy Enforcement Point**
commun, pas un moteur d'autorisation. Il reçoit le contrat normalisé et des
dépendances injectables (`spawn`, horloge, résolution d'exécutable), puis :

1. vérifie la version et le but du contrat ;
2. re-résout Workspace/session/racine et refuse toute divergence ;
3. revalide policy et budget auprès de leurs propriétaires ;
4. vérifie que toutes les capacités requises sont effectivement disponibles ;
5. reconstruit executable/argv depuis le profil versionné ;
6. construit l'environnement minimal depuis un profil fermé ;
7. lance sans shell et sans stdin, avec sorties et deadline bornées ;
8. sur timeout/annulation, demande l'arrêt, attend une grâce bornée, puis
   applique l'escalade supportée ;
9. n'annonce `CANCELLED`, `TIMEOUT` ou `PASS` qu'après un état terminal prouvé ;
10. produit uniquement métadonnées expurgées, compteurs, reason codes et
    empreintes techniques.

Les trois consommateurs V1 ont cessé de lancer directement leurs validations :
Native B3/API/UI, délégation du spécialiste principale et terminal `NOON`
`SAFE_READ` (donc Agent Loop). `WorkspaceTerminalService` reste propriétaire
de l'historique, du polling/streaming, du statut public, de `Problems`, de
`lastValidationState` et de l'intention d'annulation. Le runner ne lui expose
que `onSpawn({ pid })`, des événements de sortie bornés et un résultat final ;
il n'expose jamais le `ChildProcess`. `TransactionalExecutionEngine` reste
propriétaire du cycle Native. Aucun nouveau chemin d'approbation n'est créé.

Lorsque `resolveContext` et `revalidate` sont synchrones, le runner lance le
processus avant le retour de `run()` ; lorsqu'un hook retourne une promesse ou
un thenable, il attend cette autorisation avant tout spawn. Une précondition
nécessaire au démarrage synchrone du terminal `NOON` qui n'est pas satisfaite
est refusée avant spawn : elle ne produit pas un faux terminal démarré.

Les benchmarks Native et spécialiste, le terminal `USER`, Codex et les
providers ne sont pas migrés et restent explicitement exclus.

### Fail closed

Le lancement est refusé avant création du processus lorsque :

- workspace, session, racine réelle ou profil de commande diffèrent ;
- la décision de sécurité ou de budget est absente, expirée ou moins
  permissive ;
- l'exécutable n'est pas celui du profil ;
- une capacité requise n'est pas prouvée par le backend actif ;
- les limites sont invalides ou dépassent les maxima produit ;
- le backend d'isolation demandé est indisponible ;
- un champ inconnu tente d'élargir le contrat.

Une panne de revalidation ou de nettoyage ne devient jamais un succès. Une
panne d'observabilité ne modifie pas la décision de sécurité ; les événements
restent best effort et ne reçoivent ni commande libre, ni environnement, ni
stdout/stderr bruts, ni chemin personnel.

## Développement, Electron packagé et macOS

- En développement, les enfants héritent des droits du processus Node qui
  lance Noon.
- Dans Electron, la sandbox du renderer ne borne pas le processus principal ni
  ses enfants backend.
- Le package actuel peut être non signé ; le Hardened Runtime n'est activé que
  lorsqu'une identité de signature est fournie.
- Les entitlements actuels autorisent le réseau client et serveur et ne
  déclarent pas l'App Sandbox. Ils répondent à d'autres fonctions de Noon et ne
  peuvent pas être modifiés implicitement pour Sandbox V1.
- Les architectures x64 et arm64, l'ASAR, les helpers natifs, la signature et la
  notarisation peuvent changer la disponibilité d'un backend d'isolation.

Avant de choisir une technologie OS, une tranche séparée doit vérifier, sans
supposition : versions macOS cibles, disponibilité et statut supporté de l'API,
compatibilité Node/Electron, processus signés et non signés, x64/arm64,
Hardened Runtime, entitlements, héritage vers les descendants, blocage réseau,
montages/racines, signaux et nettoyage. La simple présence d'un exécutable sur
la machine de développement ne suffit pas. Aucune technologie n'est retenue
dans ce document.

## Critères d'acceptation V1

1. Les trois chemins couverts utilisent le même runner ; aucun spawn de
   validation ne subsiste dans ces consommateurs.
2. Le contrat est construit côté serveur depuis Workspace, policy, budget et
   profil de commande canoniques.
3. Une approval ne peut changer aucune capacité Sandbox.
4. Workspace/session/racine et décision sont revalidés juste avant le spawn.
5. Executable et argv proviennent du profil fermé, sans composition textuelle.
6. L'environnement commun est minimal et ne contient aucun secret provider,
   token, credential ou `HOME` personnel.
7. Deadline, buffers, annulation et grâce d'arrêt sont bornés ; un nettoyage
   non prouvé reste `CLEANUP_UNCONFIRMED`.
8. Un résultat tardif ou d'une autre session est rejeté.
9. Aucune absence de sortie ou terminaison ambiguë ne devient `PASS` ou
   `EMPTY`.
10. Toute capacité OS requise mais non attestée bloque avant le spawn.
11. L'historique Terminal/Problems, le journal transactionnel, les approvals,
    les budgets et l'évaluation conservent leurs propriétaires actuels.
12. L'état public expose le niveau réel `APPLICATION_CONSTRAINED` ou
    `OS_SANDBOXED`, jamais un libellé plus fort que la preuve disponible.

## Tests déterministes livrés et à maintenir

Avec racines temporaires, faux Workspace, policy/budget simulés et faux
`spawn`, sans provider, réseau, Electron ou profil personnel :

- contrat valide reconstruit exactement executable/argv/environnement ;
- commande inconnue, argv supplémentaire et executable substitué refusés ;
- racine symlinkée, workspace/session changés et contrat expiré refusés ;
- révocation de permission ou budget entre préparation et spawn refusée ;
- approval présente mais tentative d'élargir réseau/racine/limites refusée ;
- capacité OS requise et backend absent refusée avant tout spawn ;
- environnement sensible et `HOME` personnel absents ;
- stdout/stderr bornés avec troncature explicite, jamais succès inventé ;
- timeout et annulation suivent `RUNNING` → demande d'arrêt → état terminal ou
  `CLEANUP_UNCONFIRMED`, sans suppression du workspace ;
- résultat tardif et hors session ignoré par Terminal/Problems ;
- Native conserve autorisation, TEE, validation finale et journal existants ;
- délégation conserve préflight, diff review et verdict Noon ;
- un test d'architecture interdit le retour de lancements directs pour les
  trois validations couvertes.

Les régressions du runner couvrent aussi le fast-path synchrone (spawn avant
le retour de `run`) et le hook asynchrone (aucun spawn avant autorisation). Les
régressions terminal couvrent le refus du faux démarrage, l'annulation avec
`CLEANUP_UNCONFIRMED`, et le résultat `NOON` tardif qui ne doit pas écraser une
validation `USER` plus récente.

Les suites à étendre sont principalement :

- `test/workspace-terminal-service.test.js` ;
- `test/workspace-agent-execution-loop.test.js` ;
- `test/native-dev-core.test.js` ;
- `test/dev-specialist-delegation.test.js` ;
- une nouvelle suite ciblée `test/dev-process-runner.test.js` ;
- `test/v1-architecture-freeze.test.js` pour le câblage canonique.

## Fichiers de la première tranche

La tranche a introduit ou modifié :

- nouveau `services/security/dev-process-runner.js` ;
- `services/dev/workspace-terminal-service.js` ;
- `services/security/dev-validation-runner.js` ;
- `services/delegation/dev-delegation-runner.js` ;
- `services/dev/native-repository-tools.js` ;
- composition ciblée dans `server.js` ;
- tests ciblés listés ci-dessus ;
- mise à jour de ce document après preuve du niveau réellement atteint.

Le premier patch ne doit toucher ni `ApprovalEngine`, ni
`InterventionPermissionEngine`, ni `TransactionalExecutionEngine`, ni
`AgentEvaluationEngine`, ni les providers. Toute nécessité de modifier leur
contrat constitue un point d'arrêt et une décision d'architecture séparée.

## Décision V1

La primitive étendue est le couple `dev-command-policy` + lanceurs injectables
des services DEV, derrière un runner commun. Cette tranche améliore de façon
vérifiable l'admission, la confidentialité de l'environnement, les limites et
le cycle de vie. Elle ne promet pas de confiner du code hostile.

Une sandbox OS générale reste bloquée sur le choix et la qualification d'un
backend compatible. Jusqu'à cette qualification, toute fonctionnalité qui
exige réellement l'absence de réseau ou le confinement filesystem doit être
refusée, non simulée par une allowlist ou un `cwd`.
