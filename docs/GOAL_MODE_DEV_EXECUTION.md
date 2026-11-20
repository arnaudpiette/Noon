# Goal Mode — exécution DEV (réservation, dispatch, libération)

## Branchement serveur et activation

**Activation réelle du flag `goals.mode-dev` : interdite tant que B3 (UI d'approbation) n'est pas livré.** 4C-2 (réconciliation et coûts) est livré. Sans B3, aucune approbation exacte ne peut être donnée par l'utilisateur.

- **B1, livré : runtime composé, non exposé.** `services/goals/goal-mode-dev-runtime.js` assemble toute la chaîne : runs, planning, propositions, admission, projection, réservation, approbation et dispatch. Il s'appuie sur les services canoniques du serveur : `personalDatabase`, `devCostBudgetService`, `nativeDevJournal`, `approvalManager`, `operationalSecurityPolicy`, `devProjectRuleResolver`, la façade Native DEV B3, et le routage fournisseur déjà utilisé par Native DEV.
  - **Flag `goals.mode-dev`** : `OFF` par défaut, exige `goals.engine` et `dev.native-core`, et figure dans le test de gel. Il est lu **au démarrage** : le changer exige un redémarrage. Quand il est `OFF`, le runtime n'est pas construit.
  - **Robustesse** : un échec de composition est audité (`goals.mode-dev.runtime_unavailable`) et n'empêche jamais Noon de démarrer.
  - **Permissions vivantes**, intersectées par le dispatch :
    - écriture du repository = repository couvert par une racine `read-write` du workspace ;
    - réseau = `OperationalSecurityPolicy` (ni `DENY` ni `UNAVAILABLE`) **et** `dev.native-core` en `LIMITED` ;
    - écriture Git et actions destructives : jamais.
  - **Règles projet** : résolues dans `prepare` depuis le workspace autoritatif, liées au binding v2 (`rulesFingerprint`) et à l'affichage local, envoyées à l'identique, et revérifiées avant la consommation. Un changement donne `RULES_CHANGED`, sans CAS.
  - **Tâches Native DEV interrompues** : signalées une fois au démarrage (façade B3 et coordinateur), par un audit sans contenu (compteurs seulement), sans aucune action. Ce signalement n'est pas exécuté en safe mode (`NOON_SAFE_MODE=1`), qui suspend aussi les travaux de fond.
  - **Planning** : il fait un appel fournisseur payant, déclenché seulement par une demande explicite (B2), flag actif. Les tests utilisent toujours un fournisseur factice.
- **B2, livré : surface HTTP**, `services/goals/goal-mode-dev-http-routes.js` et `goal-mode-dev-http-contract.js`, préfixe `/api/goals/mode-dev/`.
  - **Aiguillage** : une seule ligne dans `server.js`, placée **avant** les blocs `GET /api/goals*` et `POST /api/goals/*` génériques. Le serveur n'appelle jamais le dispatch directement : il passe toujours par le handler.
  - **Garde-fous** : `404 GOAL_MODE_DEV_DISABLED` si le runtime n'est pas composé ou si le flag vaut `OFF` **au moment de la requête** (coupe-circuit dynamique), puis en-tête `x-noon-request: 1` obligatoire (sinon 403). Corps limité à 8 Kio, clés exactes.
  - **Routes** :

    | Méthode | Chemin |
    |---|---|
    | `POST` | `runs`, `runs/start`, `planning`, `dispatch/prepare`, `dispatch/resume`, `dispatch/renew`, `runs/pause`, `runs/resume`, `runs/stop`, `dispatch/cancel`, `dispatch/release` |
    | `GET` | `runs/:runId`, `runs/:runId/proposals/:stepId`, `runs/:runId/reservations/:reservationId` |

    Réponse en cas de succès : `{status: "ok", result}`. En cas d'erreur : `{status: "error", code, message}` (message générique), avec seulement des détails sûrs (`reservationId`, statut).
  - **Aucune autorité client** : `taskId`, chemins, permissions, `capabilityCeilings`, `projectInstructions` et `localOnly` sont refusés (400). `decision` est **obligatoire** (`approve` ou `reject`), sans valeur par défaut. Le planning exige `confirmProviderCall: true`. Le jeton et l'affichage ne sont renvoyés que par `prepare` et `renew`, et aucune réponse ne contient de `taskId`.
  - **Plafonds de capacités fixés par le serveur** : `network: true`, `gitWrite: false`, `destructiveActions: false`.
  - **`localOnly` dérivé des politiques existantes**, jamais codé en dur : sensibilité du Goal (`LOCAL_ONLY`) ou préférence utilisateur `runtime.executionPreference = LOCAL_ONLY`. Une préférence illisible est traitée comme `LOCAL_ONLY`. Le refus `422 LOCAL_ONLY_REQUIRED` intervient avant la création du run, avant le planning, avant `prepare`, et avant un `resume approve`, sans toucher à l'approbation. *Limite* : il n'existe aujourd'hui aucun champ de confidentialité explicite sur un projet ou un workspace. Le jour où il existera, il faudra l'ajouter à cette dérivation.
  - **`resume` est synchrone** : la requête reste ouverte pendant toute la tâche Native DEV.
    - Le serveur garde les délais par défaut de Node : `requestTimeout` 300 s (réception de la requête seulement), `headersTimeout` 60 s, `keepAliveTimeout` 5 s, `timeout` 0. **Aucune limite côté serveur ne coupe une réponse longue** : c'est vérifié par un test.
    - La limite réelle est celle du client (UI ou `fetch`). Une déconnexion ne coupe pas le dispatch (vérifié par un test), et l'état reste lisible par `GET runs/:runId/reservations/:reservationId`.
  - **Audit** : route, statut HTTP et code seulement. Jamais de corps, de jeton, d'affichage ni de règles.
  - **Activer le flag** exige `LIMITED` avec un pourcentage ou une liste d'autorisation pour `goals.engine`, `dev.native-core` et `goals.mode-dev`. Sans contexte de workspace, un `LIMITED` sans pourcentage reste `OFF`.
- **B3, à venir : UI d'approbation.** Carte dédiée, affichage local, aucun jeton dans `localStorage`.
- **4C-2, livré : réconciliation et coûts** (voir la section dédiée plus bas).

*Livrés avant le branchement : le contrôle des routes d'annulation, de statut, de budget et de preuves (4C-1D), et le journal Native DEV fiable (voir plus bas).*

## Cycle de vie d'une réservation DEV

Une réservation est stockée dans l'état du Goal Run (`executionReservations`). Elle est persistée en ajout seul dans `goal_strategy_records`, et chaque écriture passe par un CAS sur la révision.

| Statut | Signification | Transitions autorisées |
|---|---|---|
| `PREPARED` | Réservée (4C-0/4C-1A), rien n'est engagé | `MAY_HAVE_STARTED`, `UNKNOWN`, `RELEASED` |
| `MAY_HAVE_STARTED` | Le CAS a été franchi avant le dispatch : l'exécution a peut-être commencé | `RECONCILED`, `UNKNOWN` |
| `RECONCILED` | Observation terminale complète, usage comptabilisé une seule fois | — |
| `UNKNOWN` | Issue incertaine : bloque toute nouvelle réservation DEV du run | — |
| `RELEASED` | Libérée explicitement, jamais engagée, ne consomme rien | — |

Une nouvelle réservation exige que toutes les précédentes soient closes (`RECONCILED` ou `RELEASED`) et qu'il n'existe aucun `UNKNOWN`.

## Garanties du dispatch (4C-1B, 4C-1C)

- `prepare()` réserve via `reserveExecutionWithExactProjection`, mesure l'empreinte bornée du repository cible, puis émet une approbation `ApprovalEngine` liée au contrat exact (voir ci-dessous). Les chemins protégés par AGENTS.md ne sont jamais ni lus ni hashés : `benchmark-workspaces/`, `dev-cost-ledger.json`, `dev-task-journal/`, secrets, bases personnelles, `node_modules`, caches et builds. Ils sont exclus par pathspec Git et par un filtre local.
- `resume()` est la **seule entrée publique** : `dispatch` est interne et n'est appelé que par `ApprovalEngine`, après une approbation exacte. Il revérifie tout de façon synchrone, avant le premier `await` :
  - le statut et le binding de la réservation ;
  - le ledger DEV (0 appel) ;
  - le run (`RUNNING`) et le Goal (`ACTIVE`, confirmé, même version) ;
  - le temps restant et le budget DEV ;
  - les permissions, par intersection ;
  - l'empreinte de la cible.

  Il **consomme** ensuite l'approbation, passe `PREPARED → MAY_HAVE_STARTED` par CAS, puis appelle une seule fois le dispatcher, sans jamais réessayer.
- `MAY_HAVE_STARTED` et `UNKNOWN` partent en réconciliation (4C-2), jamais en rejeu.
- L'espace de `taskId` `goal-mode-dev-` est réservé. Toutes les entrées HTTP, UI, retry et benchmark qui atteignent Native DEV le refusent, après normalisation (trim, NFKC, casse, caractères invisibles, tirets) : voir `services/dev/dev-task-id-namespace.js`. Un test d'inventaire échoue dès qu'un appelant de `runTask` apparaît sans avoir été audité.

## Approbation exacte (4C-1C)

- **Liaison.** `prepare()` crée une approbation `ApprovalEngine` (`skillName: "goal_mode_dev"`, `operation: "dispatch_exact_contract"`, `target = taskId`). Ses arguments exacts contiennent `runId`, `reservationId`, `reservedRevision`, `stepId`, `taskId`, `goalId`, `goalVersion`, `proposalFingerprint`, l'**empreinte du contrat** (sha256 canonique de toute la copie gelée de 4C-1A) et l'**empreinte de la cible**. Ses préconditions (statut et révision de la réservation, empreinte de la cible, statut et version du Goal) sont recalculées en direct au moment de reprendre. Une approbation ne vaut donc ni pour un autre contrat, ni pour une autre réservation, ni pour un rejeu.
- **Reprise.** `resume({ approvalId, resumeToken, decision })` enchaîne :
  1. une lecture bornée (`getPreparedGoalModeDevDispatchExactAction`), qui n'approuve rien ;
  2. la comparaison de l'action avec le contrat interne ;
  3. un pré-contrôle aux codes précis : un refus à ce stade ne touche pas l'approbation ;
  4. `resumeApprovedAction` avec l'option `consumeAtBoundary`.
- **Usage unique, consommé avant le CAS.** Avec l'option `consumeAtBoundary` (désactivée par défaut, sans effet sur les autres appelants), l'approbation est consommée de façon durable **juste avant** le CAS. Il n'y a donc jamais de dispatch sans approbation consommée. Un CAS perdu après consommation « brûle » l'approbation, et une erreur après consommation la laisse consommée, avec un code d'échec audité.
- **Expirée, refusée, annulée, en échec.** Aucun CAS, la réservation reste `PREPARED`, **sans libération implicite**. La suite passe par un renouvellement explicite ou par `releaseExecution`.
- **Renouvellement.** `renewApproval({ reservationId })` est explicite et audité (`approval.cancelled` avec `supersededBy`, `approval.created`). Il est réservé à une réservation encore `PREPARED` à sa révision, et jamais après une tentative de dispatch. L'ancien jeton devient inutilisable.
- **Durée de validité.** 5 minutes, plafonnées par l'échéance du run moins 1 s. Une préparation trop proche de l'échéance est refusée **avant** la réservation.
- **Affichage local, rien de persisté.** L'approbation montre le titre du Goal, la consigne exacte du step, le repository, les permissions accordées, le coût maximal, le nombre d'appels maximal et la durée maximale. Le dépôt d'approbations et l'audit ne conservent que des identifiants, des empreintes et des statuts.
- **Redémarrage.** `ApprovalEngine` annule toute approbation en attente (`RESTART_RECONFIRMATION_REQUIRED`). La réservation reste `PREPARED`, sans contexte de reprise : il faut la libérer explicitement.

## Pause, reprise, arrêt et statut (4C-1D)

- **`pauseRun({ runId, expectedRevision, reasonCode, releasePrepared })`**, et **`stopRun`** pour `BLOCKED` et `CANCELLED` :
  - la transition du run, par CAS, fait foi ;
  - les approbations en attente du run sont ensuite annulées (auditées), et un échec d'annulation est rapporté (`approvalCancelFailures`) ;
  - même sans annulation, aucune réservation `PREPARED` ne peut plus démarrer : la règle d'état 4C-0 n'autorise le départ qu'à la révision qui suit la réservation, run `RUNNING`.
- **Une réservation `PREPARED` reste `PREPARED` par défaut.** L'option `releasePrepared`, désactivée par défaut, la libère par `releaseExecution` (ledger à 0 et CAS). Un refus, par exemple un ledger non nul, **n'annule pas la pause**. Il est rapporté dans `release` (`released: false`, `code`) et audité (`goal_mode_dev.release_on_halt`), jamais silencieux.
- **La pause n'arrête pas DEV.** Une réservation `MAY_HAVE_STARTED` continue, et l'arrêt est une action séparée.
- **`resumeRun`** ne fonctionne que depuis `PAUSED` ou `BLOCKED`. Il ne réactive rien et signale `releaseRequired` (réservations `PREPARED` d'avant l'arrêt) et `reconciliationRequired`. Le renouvellement d'approbation reste refusé : il faut libérer explicitement, puis proposer un nouveau step.
- **L'échéance du run continue de courir** pendant la pause (`admittedAt + maxDuration`).
- **`WAITING_APPROVAL` n'est pas utilisé** pendant une approbation DEV : changer de statut rendrait le départ impossible.
- **`cancelExecution({ runId, reservationId })`** demande l'arrêt d'une tâche `MAY_HAVE_STARTED` dispatchée par cette instance :
  - un seul `cancelTask`, et un second appel n'a pas d'effet de plus ;
  - un échec natif est rapporté et l'appel peut être réessayé ;
  - le statut de la réservation **ne change pas** : seule la réconciliation (4C-2) tranche l'issue ;
  - pas d'approbation, mais l'action est explicite et auditée ;
  - refusée pour `PREPARED` (il faut libérer), `RELEASED` et `UNKNOWN`.
- **`executionStatus`** renvoie une projection minimale : statut du run et de la réservation, et statut, verdict et catégorie Native DEV. Jamais de consigne, de chemin ni de contenu.
- **Routes fermées à l'espace `goal-mode-dev-`** (même normalisation) : `GET /api/dev/native/tasks/:id`, `POST …/cancel`, `GET /api/dev/budget?taskId=`, les fonctions `get` et `cancel` de l'UI Native DEV, les preuves de décision (`devDecisionConsumer`) et l'arrêt du benchmark Native. Un test d'inventaire couvre aussi `cancelTask`, `getTaskStatus` et `projectDecisionEvidence`.

## Journal Native DEV fiable

`services/dev/dev-task-journal.js` tient un fichier JSON par `taskId`, dans `DATA_DIRECTORY/dev-task-journal`.

- **Enregistrement de démarrage synchrone.** `facade.runTask` appelle `journal.claim(taskId)` **avant tout `await`**, avant l'orchestrateur. Une tâche lancée est donc visible sur disque dès cet instant, y compris pendant l'analyse et après un redémarrage. Si le `taskId` est déjà connu (`DEV_TASK_ALREADY_EXISTS`) ou si le journal est indisponible (`DEV_TASK_JOURNAL_UNAVAILABLE`), l'orchestrateur n'est jamais appelé. En fin de `runTask`, tout enregistrement encore non terminal passe à `FAIL`, `CANCELLED` ou au verdict de la tâche.
- **Écriture durable et exclusive.** Le fichier temporaire complet est écrit avec `fsync`, puis lié au nom final par `link` (refusé s'il existe déjà), puis le dossier parent reçoit un `fsync`. Repli sans lien physique : création exclusive `wx`, `fsync` du fichier, puis `fsync` du dossier. Un enregistrement n'est **jamais écrasé** : `start` ne fait que prolonger un enregistrement `CLAIMED`, ou crée de façon exclusive (chemin du coordinateur).
- **Lecture stricte.** `lookup` renvoie `ABSENT` (fichier inexistant seulement), `PRESENT` (`taskId` exact) ou `UNREADABLE` (corrompu, illisible, `taskId` différent). `load` renvoie `null` seulement si le fichier est absent, et lève une erreur sinon. À l'affichage, `getTaskStatus` et `recoverInterrupted` renvoient un statut explicite `JOURNAL_UNREADABLE`, jamais « inconnu ».
- **Correspondance exacte.** Nom de fichier `task-<sha256(taskId)>.json`. Les anciens fichiers `safeId` sont relus **seulement si leur `taskId` est exactement celui demandé**. Ils ne sont jamais réécrits ni renommés : toute mise à jour donne `DEV_TASK_JOURNAL_LEGACY_READ_ONLY`.
- **Goal Mode.** Le journal est **obligatoire** :
  - pour la réservation remise par 4C-1A (donc `prepare`) ;
  - pour le dispatch, au pré-contrôle comme à la revérification interne avant consommation ;
  - pour `releaseExecution`.

  Un journal qui connaît la tâche (`PRESENT`) ou illisible refuse l'opération. Comme la réservation de démarrage précède tout `await`, une réservation `MAY_HAVE_STARTED` avec un journal `ABSENT` et un ledger à 0 prouve, après un redémarrage, que la façade n'a jamais lancé la tâche : c'est une base pour 4C-2.
- **Limite de downgrade.** Une version de Noon antérieure ne connaît que les noms `safeId`. Elle ne voit pas les fichiers `task-<sha256>.json` : elle traite ces tâches comme inconnues à l'affichage, et pourrait relancer un même `taskId` (comportement antérieur). Les données ne sont pas corrompues.
- **Pas de nettoyage.** Le dossier grossit sans rotation ni purge. Toute purge future devra préserver les tâches Goal Mode non réconciliées. Un fichier illisible bloque son `taskId` pour toujours (fail-closed) : il faut un diagnostic, jamais un effacement automatique.
- **`recoverInterrupted` est appelé au démarrage depuis B1** (audit sans contenu, aucune action, pas en safe mode).

## Réconciliation et coûts (4C-2)

`services/goals/goal-mode-dev-observation.js` contient le lecteur d'observation et le relais vers le store. Le service de dispatch porte la réconciliation.

- **Sources**, en lecture seule :
  - le **ledger DEV** fait foi pour les appels et le coût : entrées du `taskId` exact, sans `RELEASED` ;
  - le **journal** fait foi pour l'état terminal et le démarrage ;
  - le résultat Native DEV en mémoire sert seulement de recoupement. Un écart avec le ledger donne `UNKNOWN (USAGE_INCOMPLETE)`.
- **Décisions**, depuis `MAY_HAVE_STARTED` :

  | Journal | Ledger | Issue |
  |---|---|---|
  | terminal | réglé | `RECONCILED` avec un pas, appels et coût exacts (`basis: ACTUAL`) |
  | terminal | appels au coût réel inconnu ou au résultat inconnu (`UNKNOWN_PENDING`) | `RECONCILED` **prudent** : coût estimé, borne haute, `observedActualCost: null`, `basis: ESTIMATED_UPPER_BOUND`, visible dans l'audit et dans la réponse de la route |
  | terminal `CANCELLED` | réglé | `RECONCILED` (annulation observée complètement) |
  | non terminal, dispatch disparu | quelconque | `UNKNOWN` : `CANCELLED` si un arrêt avait été demandé, sinon `OUTCOME_UNCERTAIN` |
  | non terminal, dispatch en cours dans ce processus | — | aucune transition |
  | quelconque | entrée `RESERVED` | aucune transition (en cours) |
  | illisible | — | aucune transition |
  | `ABSENT` | au moins une entrée | `UNKNOWN (PERSISTENCE_UNCERTAIN)` |
  | `ABSENT` | aucune entrée | **« jamais lancée »** : `RECONCILED` avec `observedSteps: 0`, 0 appel, coût 0 (`basis: NEVER_LAUNCHED`) |

- **Garde-fous de « jamais lancée »** : la conclusion n'est admise qu'en **fin de `resume`**, dans le processus qui a dispatché (la façade réserve son démarrage avant tout `await`, dans le même tour que le CAS) ; **au démarrage**, sous verrou exclusif ; ou **par action explicite**, avec le verrou détenu par ce processus, aucun dispatch en cours ici, et au moins **2 min** écoulées depuis `mayHaveStartedAt`.
- **Comptabilité** : l'usage du run est augmenté une seule fois (pas, appels, coût). Les itérations internes de Native DEV ne comptent pas comme des essais Goal (`observedRetries: 0`). Le budget DEV, déjà débité appel par appel, ne reçoit aucune écriture. La **durée** est rapportée (début et fin du journal) mais **non persistée**.
- **Déclencheurs** : fin de `resume` (le résultat est joint à la réponse), scan au démarrage, et route `POST /api/goals/mode-dev/dispatch/reconcile`. Toute réconciliation ne fait **qu'un CAS** sur la réservation : jamais d'appel au dispatcher, à l'arrêt ni au ledger. Elle est idempotente : une réservation déjà close renvoie `UNCHANGED`. Les réservations `RELEASED` sont ignorées.
- **Verrou exclusif sur `DATA_DIRECTORY`** (`services/runtime/data-directory-lock.js`, fichier `noon-data.lock`) :
  - créé de façon atomique (`wx`, `fsync` du fichier puis du dossier) au démarrage, hors safe mode, avant le scan ;
  - libéré à l'arrêt et à la sortie du processus ;
  - s'il est détenu par un autre processus vivant (`HELD`), **périmé** (processus disparu, `STALE`) ou illisible, il n'y a **aucun scan** et l'audit `goals.mode-dev.RECONCILE_SCAN_SKIPPED_LOCK` est écrit. **Un verrou périmé n'est jamais repris automatiquement** : après un arrêt brutal, le scan au démarrage et les conclusions explicites qui exigent le verrou restent indisponibles, jusqu'à ce que l'utilisateur supprime ce fichier en connaissance de cause.
- **Limite de downgrade** : une version de Noon antérieure à 4C-2 refuse de relire un run qui contient un `RECONCILED` à 0 pas. C'est la même classe de limite que pour `RELEASED` (option A) : refus propre, sans corruption.
- **Hors périmètre** : la sortie d'un `UNKNOWN`, qui bloque définitivement le DEV du run.

## Libération explicite (`RELEASED`)

`runStore.releaseExecution(runId, { expectedRevision, reservationId })` :

- n'est **jamais automatique** : ni le service de dispatch, ni le démarrage de Noon, ni une migration ne libère de réservation ;
- exige un backend atomique, la révision exacte (CAS), une dernière réservation en `PREPARED` et un **ledger DEV à 0 appel** pour sa tâche. Sans ledger, l'opération est refusée (`GOAL_MODE_EXECUTION_RELEASE_LEDGER_REQUIRED`). Un ledger non nul, invalide ou en erreur donne aussi un refus (`…_LEDGER_ENGAGED`) ;
- refuse toujours `MAY_HAVE_STARTED`, `UNKNOWN`, `RECONCILED` et `RELEASED` ;
- ne consomme rien et invalide tout ticket de dispatch en mémoire (`GOAL_MODE_DEV_DISPATCH_RESERVATION_CLOSED`) ;
- ne permet **pas** de réserver de nouveau le même step : l'identité de la réservation et le `taskId` sont déterministes. Une nouvelle proposition (autre `stepId` ou autre empreinte) est requise.

La réservation de planning est hors périmètre : elle garde son modèle actuel, sans libération.

### Compatibilité des données et limite de downgrade (option A)

- **Aucune réécriture des données existantes.** `RELEASED` est un statut additif, sans nouveau champ dans la réservation. Les lignes déjà persistées restent valides et sont relues à l'identique.
- **Limite de downgrade, acceptée et documentée.** Une version de Noon antérieure à `RELEASED` revalide strictement chaque état au chargement. Elle **refuse de relire un Goal Run qui contient une réservation `RELEASED`** (`GOAL_MODE_EXECUTION_INVALID`). Le refus est propre et typé, sans corruption ; seuls les runs concernés sont touchés, les autres runs et le reste de la base restent lisibles. Le `SCHEMA_VERSION` global n'est pas modifié.
- Les réservations `PREPARED` orphelines déjà présentes ne sont jamais converties automatiquement. Elles restent bloquantes jusqu'à une libération explicite contrôlée par le ledger, ou jusqu'à `markExecutionUnknown`.

## Tests de référence

- `test/goal-mode-execution-reservation.test.js` : 4C-0 / 4C-1A.
- `test/goal-mode-dev-dispatch-service.test.js` : 4C-1B (par `resume`), 4C-1C, empreinte, Goal, RELEASED × dispatch.
- `test/approval-engine-consume-boundary.test.js` : option `consumeAtBoundary` et lecture bornée Goal Mode d'`ApprovalEngine`.
- `test/goal-mode-execution-release.test.js` : RELEASED (transitions, forme, ledger, course, SQLite, compatibilité ancien ↔ nouveau code).
- `test/dev-task-journal-reliability.test.js` : réservation de démarrage exclusive, ordre des `fsync` (y compris dans le repli), lecture stricte, noms exacts, anciens fichiers, `interrupted`.
- `test/native-dev-facade-journal.test.js` : réservation de démarrage avant tout `await`, état terminal, relance refusée après redémarrage, `JOURNAL_UNREADABLE` explicite.
- `test/goal-mode-dev-http-contract.test.js` : contrat B2 (clés exactes, `decision`, projections, statuts, erreurs minimales).
- `test/goal-mode-dev-http-transport.test.js` : bout en bout B2 au niveau transport (vrai serveur HTTP de test, vrai runtime, fournisseur et façade factices), délais d'attente et déconnexion.
- `test/goal-mode-dev-http-server.test.js` : garde-fous B2 sur le vrai serveur, dans un processus enfant sans `.env` ni clés de fournisseurs.
- `test/goal-mode-dev-observation.test.js` : lecteur d'observation (toutes les décisions), relais, état `RECONCILED` à engagement nul.
- `test/data-directory-lock.test.js` : verrou exclusif (atomicité, `HELD`, `STALE` sans reprise, deux processus, arrêt brutal).
- `test/goal-mode-dev-runtime.test.js` : composition B1, permissions vivantes, règles projet, signalement des tâches interrompues, câblage serveur et flag.
- `test/dev-task-id-namespace.test.js` : espace réservé, inventaire des appelants de `runTask`, `cancelTask`, `getTaskStatus` et `projectDecisionEvidence`, câblage des routes.
