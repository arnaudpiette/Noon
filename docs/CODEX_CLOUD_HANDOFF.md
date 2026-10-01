# Reprise Noon dans Codex Cloud

## Point de départ

- Dépôt : `https://github.com/arnaudpiette/Noon.git`
- Branche : `v2/multi-provider`
- Correctif Learning : `1e6a664` — `fix(learning): serialize review persistence`
- Synthèse SQLite : `05b9b9b` — `docs(persistence): summarize SQLite stabilization`

Avant toute modification, lire `AGENTS.md`, puis vérifier `git status --short`,
la branche et le HEAD. Préserver tout changement local existant. Ne pas créer
de worktree, lancer de benchmark complexe, accéder à une base personnelle, ni
faire de push supplémentaire sans instruction explicite.

## Environnement Cloud

1. Sélectionner le dépôt et la branche `v2/multi-provider`.
2. Utiliser Node `v22.23.2`, version observée lors des validations récentes.
   Le dépôt utilise `node:sqlite` et `DatabaseSync` pour les contrôles SQLite.
3. Exécuter `npm ci`.
4. Vérifier `node --version`, `git status --short` et `git rev-parse HEAD`.

La version Node n'est pas verrouillée par `package.json` (`engines` absent) ni
par un fichier `.nvmrc`, `.node-version` ou `.tool-versions`. Le choix de
`v22.23.2` est donc une compatibilité observée, pas une contrainte déclarée :
ne pas modifier cette configuration dans le cadre de la reprise sans demande
explicite.

## Garanties SQLite établies

Les preuves détaillées sont dans `docs/SQLITE_STABILIZATION.md`. Elles sont
déterministes et emploient uniquement des bases temporaires ; elles ne valent
pas validation Electron, macOS, OAuth, TCC, Notes/Rappels ou base personnelle.

- `busy_timeout=1500` est appliqué à chaque connexion personnelle, avant les
  migrations ; WAL et clés étrangères sont préservés.
- Les migrations additives vérifient les colonnes et propagent les erreurs
  SQLite réelles au lieu de les convertir en succès.
- Les statistiques de durée ExecutionTracking sont atomiques pour leur propre
  lecture/calcul/UPSERT.
- Mémoire privée : `updateMemory()`, `forgetMemory()`, `purgeSubject()` et
  `rollbackMigration()` groupent leurs écritures SQLite et leurs audits selon
  leur frontière transactionnelle.
- Feedback proactif Learning, mutations/cursor Sync et recovery Transactional
  Execution disposent de régressions transactionnelles ciblées.
- `ReviewLearningRepository.save()` sérialise maintenant la recherche de
  fingerprint, l'allocation de version et l'insert. Deux connexions ont été
  vérifiées : même fingerprint idempotent avec une ligne ; fingerprints
  distincts donnent les versions `1` puis `2` dans
  `(review_type, subject_scope, period_start, period_end)`.

## Validations exactes

Résultats exécutés pour le correctif Learning :

- `node --test test/review-learning-repository-concurrency.test.js test/review-learning-engine.test.js` : 26/26 PASS.
- `npm run lint` : PASS.
- `npm run build` : PASS.
- `git diff --check` : PASS.

Résultats historiques consignés dans la synthèse : contention SQLite,
migrations, ExecutionTracking, mémoire privée, feedback Learning, Sync et
recovery. Ne pas les présenter comme relancés dans Cloud sans les exécuter.

Pour une reprise ciblée Learning, utiliser d'abord :

```bash
node --test test/review-learning-repository-concurrency.test.js test/review-learning-engine.test.js
npm run lint
npm run build
git diff --check
```

Ne pas lancer `npm test`, `npm run noon:check`, `eval:full` ou les scripts de
benchmark sans instruction distincte : ils dépassent ce périmètre.

## Écarts et limites connus

- `services/jobs/job-store.js#create()` insère puis appelle `transition()` hors
  transaction. Une panne intermédiaire peut laisser un job dans son état
  initial ; risque statique documenté, non reproduit dans cette phase.
- ExecutionTracking ne rend pas atomiques ensemble l'item, l'événement et
  l'agrégat de durée. Le correctif porte uniquement sur l'agrégat.
- Le générateur de reviews utilise actuellement un `reviewId` déterministe par
  type/profil/période. Des révisions applicatives distinctes nécessiteraient
  un identifiant distinct ; ce sujet n'a pas été traité.
- Les contrôles macOS/TCC, Notes, Rappels, OAuth, Electron et bases personnelles
  sont hors de portée de Codex Cloud et ne doivent pas être simulés comme
  validés.

## Prochaine tâche minimale

Examiner l'existant Learning et Adaptive Routing avant toute nouvelle
architecture. Cette étape est un audit : ne pas modifier Job Store, le modèle
de review, ou les frontières ExecutionTracking sans une demande ciblée et une
preuve reproduite.
