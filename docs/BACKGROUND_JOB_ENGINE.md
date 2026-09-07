# Background Job Engine — étape 33

## Périmètre livré

Le moteur centralise les nouveaux travaux différés dans `services/jobs/`. Il repose sur la base SQLite locale existante, sans dépendance native supplémentaire. Le flag `jobs.engine` démarre en `SHADOW` : Noon calcule la décision inline/background mais la queue n’a aucune autorité tant qu’un déploiement `LIMITED` ou `ON` n’a pas passé les évaluations.

Les jobs ne stockent que des références structurées. Les types `REFERENCE_ONLY` refusent les champs de contenu brut, secrets, tokens et mots de passe. `PUBLIC_RESEARCH` accepte une question publique préalablement nettoyée et bornée ; les résultats détaillés restent dans le cache de recherche et la queue ne conserve que l’identifiant de l’`EvidencePack`.

## Sources de vérité

| Responsabilité | Source de vérité | Statut |
|---|---|---|
| Schéma et état d’un job | table SQLite `background_jobs` | nouveau, canonique |
| Types et capacités | `job-registry.js` | nouveau, canonique |
| Claim, lease, retry, cancel, checkpoint | `background-job-engine.js` | nouveau, canonique |
| Horaire IANA/DST et occurrences | `job-scheduler.js` | nouveau, prêt à migrer |
| Réponses OpenAI background historiques | `background-analyses.json` | legacy conservé |
| Brief quotidien à 07:00 | timers Electron + route daily brief | legacy autoritaire |
| Timeouts réseau/recherche/délégation | services propriétaires | hors queue, intentionnel |

## États

`CREATED → QUEUED → RUNNING`, puis `SUCCEEDED`, `FAILED`, `BLOCKED`, `WAITING`, `RETRY_SCHEDULED` ou `CANCEL_REQUESTED → CANCELLED`. Un lease expiré devient `INTERRUPTED`; seuls les handlers déclarés `resumable` repassent en queue. Un résultat externe incertain devient `BLOCKED` et n’est jamais rejoué automatiquement.

## Concurrence et pression

- claim transactionnel `BEGIN IMMEDIATE` avec condition d’état ;
- limite globale et limites `LIGHT`, `MODEL`, `HEAVY_IO` ;
- priorité `URGENT/HIGH/NORMAL/LOW` avec vieillissement borné ;
- taille maximale de queue ;
- idempotency key unique et déduplication/coalescence des travaux actifs ;
- retry exponentiel borné et budget temps par job ;
- dépendances exécutées uniquement après succès des parents.

## API locale

- `POST /jobs` : créer un job autorisé par le flag ;
- `GET /jobs` : liste filtrée par profil, workspace et état ;
- `GET /jobs/:id` : détail contrôlé par profil ;
- `POST /jobs/:id/cancel` : annulation coopérative ;
- `POST /jobs/recover` : reprise explicite après réveil.

L’authentification locale existante s’applique à toutes ces routes.

## Inventaire legacy audité

- `services/openai/background-analysis.js` : suivi distant Responses API, persistance JSON et polling manuel ;
- `electron/main.js` : timers du brief créatif/personnel, reprise après réveil et retry ;
- `services/automations/scheduler.js` : définitions cron du brief ;
- `services/follow-up/follow-up-service.js` : échéances métier persistées ;
- recherche publique/personnelle, délégation et multimodal : timeouts locaux d’une requête ;
- renderer : polling d’activité/connexion, animation audio et debounce de brouillon ;
- moteur transactionnel : détection des exécutions interrompues, sans replay aveugle.

## Limites assumées avant promotion

Le brief quotidien n’est pas migré : ses tests DST/catch-up et son comportement utilisateur doivent être comparés en shadow avant bascule. Les notifications sont visibles via l’activité de session et consignées dans l’audit local ; une notification macOS native dédiée reste à câbler. Les handlers read-only `PUBLIC_RESEARCH` et `MAINTENANCE` sont câblés ; les autres types restent `BLOCKED/HANDLER_UNAVAILABLE` tant qu’un handler contrôlé n’est pas enregistré. Il n’existe aucun scheduler distribué ni synchronisation multi-appareils.

## Prochaine étape

Après validation en `LIMITED`, la prochaine couche architecturale est la synchronisation multi-appareils. Elle ne fait pas partie de l’étape 33.
