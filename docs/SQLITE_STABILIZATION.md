# Stabilisation SQLite — synthèse ciblée

Cette synthèse couvre les chemins de persistance examinés pendant la phase de
stabilisation SQLite. Elle décrit des preuves statiques et des validations
déterministes historiques sur des bases temporaires. Elle ne constitue ni une
validation Electron, ni une validation sur une base personnelle réelle, ni une
garantie globale pour tous les accès SQLite de Noon.

## Matrice

| Zone | Invariant | Protection observée | Preuve / test | Limite | Statut |
| --- | --- | --- | --- | --- | --- |
| Ouverture de base personnelle | Une connexion concurrente attend brièvement au lieu d'échouer immédiatement sur un verrou d'écriture. | `createPersonalDatabase()` applique `PRAGMA busy_timeout=1500` avant schéma, migrations et écritures d'initialisation ; WAL et clés étrangères restent activés. | `test/personal-database-concurrency.test.js` : 3 contrôles inter-connexions avec worker (PRAGMA, libération avant échéance, verrou persistant). | `DatabaseSync` bloque le thread appelant pendant cette attente bornée ; ce réglage n'est pas un retry applicatif et ne résout pas toute contention. | Corrigé — preuve déterministe historique. |
| Migrations additives | Une colonne manquante est ajoutée ; une erreur réelle ne devient pas une migration réussie ; la version n'est enregistrée qu'après succès. | `ensureColumn()` inspecte `PRAGMA table_info` avant `ALTER TABLE` ; seule une collision SQLite exacte de la colonne attendue est tolérée, puis sa postcondition est vérifiée. Les erreurs BUSY/LOCKED et inattendues sont propagées. La connexion est fermée à l'échec. | `test/personal-database-migrations.test.js` : 7 contrôles d'idempotence, données historiques, collision concurrente, erreurs et reprise. | Un DDL peut avoir été appliqué avant un échec ultérieur : la reprise est idempotente, sans promettre un rollback DDL global. | Corrigé — preuve déterministe historique. |
| ExecutionTracking — statistiques de durée | Pour une même clé statistique, lecture, calcul et UPSERT ne perdent pas un incrément concurrent. | `recordDuration()` ouvre une transaction courte `BEGIN IMMEDIATE` lorsqu'elle la possède ; elle participe à une transaction appelante sans la terminer. Calcul, fenêtre de 50 échantillons et UPSERT partagent la transaction. | `test/execution-tracking-duration-concurrency.test.js` : 4 contrôles, dont deux connexions avec worker, rollback d'écriture et rollback externe. Régression Engine sur le rejeu conservant un échantillon. | L'item d'exécution, son événement et l'agrégat ne sont pas rendus atomiques ensemble par ce correctif. L'idempotence dépend toujours de la déduplication d'événements du chemin appelant. | Corrigé — preuve déterministe historique. |
| Mémoire privée — `updateMemory()` | La mémoire chiffrée, sa version et son audit réussissent ou échouent ensemble. | Validations et chiffrement sont préparés avant la transaction ; mise à jour, version et audit passent par le helper réentrant (`BEGIN IMMEDIATE` possédé, savepoint appelant). Les notifications suivent seulement un commit possédé. | Régressions historiques de mémoire privée : succès, pannes après écriture et audit, rollback externe, échec interne sous transaction appelante, chiffrement et isolation de profil. | Les tests utilisent des fixtures et injections de panne ; pas de validation sur mémoire personnelle réelle. | Corrigé — preuve déterministe historique. |
| Mémoire privée — `forgetMemory()`, `purgeSubject()`, `rollbackMigration()` | Suppressions ou statuts, versions et audit restent cohérents ; aucune notification de succès avant un commit possédé. | Les trois opérations réutilisent `transaction()`. `purgeSubject()` sélectionne puis supprime versions et mémoires dans la même transaction, filtrée par profil. `rollbackMigration()` restreint ses cibles éligibles avant suppressions, statuts et audit. | `test/private-memory-destructive-atomic.test.js` et suites privées/migration : 23 contrôles historiques sur bases temporaires, y compris savepoint, rollback externe, pannes intermédiaires, audit et isolation de profil. | Les notifications externes restent hors transaction par nécessité : une erreur de notification après commit ne signifie pas un rollback SQLite. | Corrigé — preuve déterministe historique. |
| Learning — feedback proactif | Recommandation, feedback et métrique ne laissent pas d'état partiel. | Le chemin de feedback proactif exécute les trois écritures via la transaction du repository lorsqu'elle existe, avec participation à une transaction appelante. | `test/proactive-feedback-atomicity.test.js` : 4 contrôles historiques (succès, panne métrique, commit/rollback externes et échec interne). | Les courses distinctes de `ReviewLearningRepository.save()` sont couvertes séparément ci-dessous. | Corrigé — preuve déterministe historique. |
| Sync — mutations et curseur | Une mutation appliquée est cohérente avec son changement ; le curseur n'avance pas si une enveloppe échoue. | Le repository Sync utilise une transaction possédée ou un savepoint appelant. Le traitement d'enveloppe et la progression du curseur conservent l'échec explicite. | `test/sync-atomicity.test.js` : 6 contrôles historiques de rollback de révision/changement, mutation reçue, requête distante, transaction externe et curseur. | La preuve porte sur les scénarios injectés ; elle ne constitue pas un test de synchronisation distante réelle. | Corrigé — preuve déterministe historique. |
| Transactional Execution — recovery | Les étapes récupérées et l'état d'exécution restent cohérents lors d'une récupération interrompue. | Chaque récupération passe par la transaction réentrante du repository ; les étapes et l'exécution sont persistées avant commit, avec rollback sur erreur et savepoint appelant. | Régressions historiques de recovery : commit groupé, panne, transaction externe et échec interne. | Le périmètre est la récupération Transactional Execution, pas toutes les transitions de tous les moteurs. | Corrigé — preuve déterministe historique. |
| Learning — déduplication de `save()` par fingerprint | Un même fingerprint rejoué produit une ligne et le record déjà persisté. | `save()` prend une transaction courte réentrante avant sa recherche de fingerprint ; la contrainte unique reste la défense SQL complémentaire. | `test/review-learning-repository-concurrency.test.js` : deux connexions avec worker, verrou effectif et résultat idempotent. | La preuve est déterministe sur SQLite temporaire, non sur une base personnelle réelle. | Corrigé — preuve déterministe. |
| Learning — allocation de `review_version` | Les versions sont strictement croissantes dans le périmètre `(review_type, subject_scope, period_start, period_end)`. | La même transaction sérialise recherche de fingerprint, lecture de la dernière version et insert ; un savepoint isole l'opération dans une transaction appelante. | `test/review-learning-repository-concurrency.test.js` : deux connexions, fingerprints distincts, versions `1` puis `2`, et nouveau profil à `1`. | Le générateur actuel utilise un `reviewId` déterministe par type/profil/période ; des révisions applicatives distinctes exigeraient un identifiant distinct, sujet hors périmètre. | Corrigé — preuve déterministe. |
| Job Store | La revendication concurrente d'un job ne doit pas attribuer deux fois le même job. | `claimNext()` utilise une transaction courte et une mise à jour conditionnelle ; aucune modification n'a été faite dans cette phase. | Inspection de `services/jobs/job-store.js` et de ses tests existants. | `create()` insère puis appelle `transition()` hors transaction : une panne entre les deux peut laisser un job dans son état initial. Risque statique non reproduit, laissé hors périmètre afin de ne pas élargir cette stabilisation. | Inchangé — risque statique documenté. |

## Défauts démontrés corrigés

- Attente SQLite absente entre connexions personnelles : `2f6c7ab` configure le
  `busy_timeout` commun et borné.
- Assertion obsolète de version de schéma : `e822ca8` vérifie la version
  réellement enregistrée après initialisation.
- Erreurs de migrations additives masquées : `82a3a21` distingue strictement
  la collision de colonne des erreurs SQLite réelles.
- Mise à jour perdue des statistiques de durée : `26cbd4f` rend le calcul et
  l'UPSERT atomiques à la frontière de `recordDuration()`.
- Mise à jour de mémoire privée, version et audit partiels : `cbeb491` les
  regroupe transactionnellement.
- Feedback proactif Learning partiel : `4bd5e90` regroupe recommandation,
  feedback et métrique.
- Courses `ReviewLearningRepository.save()` sur fingerprint et version :
  transaction réentrante et contrôles inter-connexions sur SQLite temporaire.
- Mutations Sync et avance de curseur incohérentes : `b4b3880` applique les
  transactions réentrantes aux chemins concernés.
- Recovery Transactional Execution partiel : `374f252` groupe étapes et état
  d'exécution.
- Opérations destructives de mémoire privée partielles : `ce47b2a` groupe
  suppressions/statuts et audit.

## Écarts ouverts

1. `services/jobs/job-store.js#create` reste une séquence insert puis
   transition hors transaction. Une panne entre les deux peut laisser un job
   dans son état initial. Ce risque statique a été documenté mais volontairement
   laissé hors du périmètre des correctifs SQLite déjà réalisés.
2. Le correctif des statistiques ExecutionTracking ne rend pas atomiques
   ensemble l'item, l'événement et l'agrégat ; c'est une limite de frontière
   transactionnelle connue, pas une régression attribuée à ce correctif.

## Zones laissées inchangées

- Job Store : `claimNext()` disposait déjà d'une transaction courte et d'une
  transition conditionnelle. Le risque séparé de `create()` nécessite une
  décision dédiée ; le modifier ici aurait étendu le chantier hors des défauts
  reproduits.
- Les transactions existantes ne sont pas remplacées mécaniquement par des
  `BEGIN IMMEDIATE`. Les corrections ciblent seulement les invariants où une
  écriture partielle ou une mise à jour perdue avait été démontrée.

## Clôture limitée et prochaine action

Les défauts démontrés dans les zones corrigées ci-dessus disposent de preuves
statiques et de validations déterministes historiques sur bases temporaires.
La stabilisation SQLite reste **PARTIAL** : les deux courses de
`ReviewLearningRepository.save()` sont corrigées, mais les limites Job Store et
ExecutionTracking ci-dessus restent hors du périmètre traité.

La prochaine action de roadmap reste l'examen de l'existant Learning / Adaptive
Routing avant toute nouvelle architecture. Il ne doit pas être confondu avec
une extension de cette correction transactionnelle.
