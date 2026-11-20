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

## Garanties du dispatch (4C-1B)

- `prepare()` réserve via `reserveExecutionWithExactProjection`, puis mesure l'empreinte bornée du repository cible. Les chemins protégés par AGENTS.md ne sont jamais ni lus ni hashés : `benchmark-workspaces/`, `dev-cost-ledger.json`, `dev-task-journal/`, secrets, bases personnelles, `node_modules`, caches et builds. Ils sont exclus par pathspec Git et par un filtre local.
- `dispatch()` revérifie tout de façon synchrone, avant le premier `await` :
  - le statut et le binding de la réservation ;
  - le ledger DEV (0 appel) ;
  - le run (`RUNNING`) et le Goal (`ACTIVE`, confirmé, même version) ;
  - le temps restant et le budget DEV ;
  - les permissions, par intersection ;
  - l'empreinte de la cible.

  Il passe ensuite `PREPARED → MAY_HAVE_STARTED` par CAS, **avant** d'appeler une seule fois le dispatcher, sans jamais réessayer.
- `MAY_HAVE_STARTED` et `UNKNOWN` partent en réconciliation (4C-2), jamais en rejeu.
- L'espace de `taskId` `goal-mode-dev-` est réservé. Toutes les entrées HTTP, UI, retry et benchmark qui atteignent Native DEV le refusent, après normalisation (trim, NFKC, casse, caractères invisibles, tirets) : voir `services/dev/dev-task-id-namespace.js`. Un test d'inventaire échoue dès qu'un appelant de `runTask` apparaît sans avoir été audité.

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
- `test/goal-mode-dev-dispatch-service.test.js` : 4C-1B, empreinte, Goal, RELEASED × dispatch.
- `test/goal-mode-execution-release.test.js` : RELEASED (transitions, forme, ledger, course, SQLite, compatibilité ancien ↔ nouveau code).
- `test/dev-task-id-namespace.test.js` : espace réservé et inventaire des appelants de `runTask`.
