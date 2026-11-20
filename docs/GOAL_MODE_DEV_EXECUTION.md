# Goal Mode — exécution DEV (réservation, dispatch, libération)

## Prérequis avant branchement serveur

Le service `services/goals/goal-mode-dev-dispatch-service.js` n'est **pas** câblé à `server.js`. Avant de le brancher sur un vrai `nativeDevFacade`, ces tranches doivent être livrées :

1. **Journal Native DEV fiable** (`services/dev/dev-task-journal.js` et chemin B3) :
   - **enregistrement de démarrage synchrone** à l'entrée de `runTask` (façade ou orchestrateur), **avant tout `await`** : aujourd'hui, sur le chemin B3, `journal.start` n'est écrit qu'après l'analyse du codebase (`baselineTask`). Une tâche en cours d'analyse est invisible, et elle ne laisse aucune trace après un redémarrage ;
   - **lecture qui refuse en cas d'erreur** : `load()` renvoie aujourd'hui `null` sur un fichier illisible ou corrompu, ce qui revient à « tâche inconnue » ;
   - **correspondance exacte entre `taskId` et fichier** : `safeId` remplace et tronque les caractères, et le `taskId` stocké n'est pas comparé à celui demandé.

   Une fois livré, ce journal servira de contrôle supplémentaire dans `dispatch()` et `releaseExecution()`, en plus du ledger DEV.
2. **Contrôle des routes d'annulation et de statut** (4C-1D) : `GET /api/dev/native/tasks/:id` et `POST /api/dev/native/tasks/:id/cancel` acceptent aujourd'hui un `taskId` de l'espace `goal-mode-dev-`. Un client HTTP pourrait donc annuler ou observer une tâche Goal Mode en dehors du protocole de réservation.

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
- `test/dev-task-id-namespace.test.js` : espace réservé et inventaire des appelants de `runTask`.
