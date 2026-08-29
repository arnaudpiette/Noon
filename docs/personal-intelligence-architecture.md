# Intelligence personnelle de Noon

## Architecture

Noon conserve son architecture Electron/Node CommonJS et son serveur lié à `127.0.0.1`. La nouvelle couche est additive : les anciens fichiers JSON restent disponibles pendant la transition.

```text
Sources autorisées en lecture seule
  -> boîte d'entrée locale normalisée
  -> signaux projet déterministes
  -> portrait + mémoire structurée
  -> score local et anti-répétition
  -> recommandation expliquée
  -> validation explicite si une action est engageante
  -> suivi et métriques sans contenu intégral
```

Les services sont répartis entre `services/persistence`, `services/personal-intelligence`, `services/scheduling` et `services/openai`. Les outils exposés au modèle passent par le registre `skills/` existant.

## Stockage et schéma

La base `personal-intelligence.sqlite` est créée dans le dossier de données Electron (`app.getPath("userData")`, transmis au serveur par `NOON_DATA_DIR`). Elle utilise `node:sqlite`, WAL, les clés étrangères et des index ciblés. Si `node:sqlite` est indisponible, Noon démarre avec un fallback JSON privé.

Tables :

- `schema_migrations` : version, nom et date d'application ;
- `memory_items` : type, sujet, valeur JSON, source, statut, confiance, expiration, sensibilité et droit d'utilisation ;
- `projects` : objectif, statut, prochaine action, échéance, priorité, temps, décisions, blocages et relations ;
- `inbox_items` : source normalisée, action, projet, échéance, effort, importance, statut et fraîcheur ;
- `recommendations` : hash, score, explication, présentations, réponse, cooldown et réactivation ;
- `followups` : résultat, durée estimée/réelle, blocage, prochaine action et date ;
- `feedback_events` et `metrics_events` : événements chiffrés sans contenu conversationnel.

Une table FTS5 est utilisée lorsqu'elle est disponible. Sinon, la recherche exacte locale reste fonctionnelle.

## Mémoire et portrait opérationnel

Les statuts sont `confirmed`, `inferred`, `temporary`, `rejected`, `expired` et `blocked`. La confiance est bornée entre 0 et 1. Une préférence observée reste `inferred` jusqu'à une confirmation explicite. Les éléments expirés, refusés, bloqués ou avec `use_allowed = false` ne sont jamais injectés dans un prompt.

Les secrets, clés, tokens et mots de passe sont refusés. Les sources sont référencées sans recopier le contenu complet des e-mails ou documents. L'écran « Ce que Noon sait de moi » permet de rechercher, confirmer, corriger, rendre temporaire, prolonger, oublier ou bloquer une information.

Les règles permanentes initiales comprennent le brief à 7 h, la vision du lundi, la pause 12 h 30–13 h 30, les modes Noon, l'absence d'envoi Gmail, de modification de fichier ou d'écriture Calendar sans ordre explicite, la prochaine action concrète et l'anti-répétition.

## Projets, boîte d'entrée et priorité

Un projet actif doit avoir une prochaine action. Les signaux locaux couvrent notamment l'absence de prochaine action, l'inactivité, l'échéance proche, un blocage ou une estimation dépassée. Ils restent présentés comme des détections avec une confiance, pas comme des faits déclarés par l'utilisateur.

La boîte d'entrée conserve seulement les métadonnées et extraits utiles. La paire `source_type/source_reference` est unique : une nouvelle synchronisation met à jour l'élément existant. Les données distantes en cache peuvent être marquées anciennes hors ligne et aucune source distante n'est modifiée par cette couche.

Le score de priorité est normalisé de 0 à 100. Les pondérations par défaut sont : urgence 20 %, impact 20 %, échéance 16 %, priorité projet 12 %, adéquation durée 9 %, énergie 5 %, risque de blocage 8 %, confiance 8 %, avec pénalités de coût d'interruption 8 % et répétition 10 %. Les pondérations sont exportées et testables.

## Proactivité, anti-répétition et suivi

Le hash d'une recommandation associe source, référence, action et projet. Un cooldown de 24 h bloque une répétition, sauf changement de source, rapprochement d'échéance ou hausse sensible du risque. Le nombre de recommandations non urgentes est limité par `NOON_MAX_PROACTIVE_NOTIFICATIONS` (3 par défaut). De 12 h 30 à 13 h 30, seules les urgences ayant un score d'au moins 80 peuvent apparaître.

Chaque recommandation distingue « Je sais », « J'ai détecté », « J'en déduis », la proposition et le besoin de validation. Les retours disponibles sont utile, pas utile, trop long, déjà signalé, mauvais moment et mauvaise priorité.

Un seul suivi `pending` est conservé par recommandation. Les résultats acceptés sont terminé, à poursuivre, bloqué, annulé et mal estimé. Un suivi peut mettre à jour la prochaine action locale, mais ne déclenche jamais une action distante.

## Permissions

| Capacité | Lecture/analyse | Préparation | Exécution engageante |
| --- | --- | --- | --- |
| Fichiers autorisés | libre | nouveau livrable dans un dossier écrivable | modification/suppression sur ordre explicite |
| Gmail | recherche autorisée | brouillon selon les règles existantes | envoi interdit sans ordre et validation |
| Calendar | lecture et suggestion de créneaux | proposition Myrtille | création, déplacement ou suppression sur ordre explicite |
| Git/GitHub | inspection | proposition | opération engageante sur ordre et autorisation dédiée |
| Mémoire | recherche locale | préférence inférée | confirmation uniquement par l'utilisateur |

Une autorisation est liée à une action précise. Rien d'engageant en attente n'est rejoué automatiquement au retour du réseau.

## Migrations et récupération

La migration `legacy-personal-data-v1` importe `long-term-memory.json` et `project-journals.json`. Elle sauvegarde d'abord les sources dans `migration-backup/`, génère des identifiants stables, travaille dans une transaction SQLite et inscrit un marqueur idempotent. Les fichiers historiques ne sont pas supprimés. En cas d'erreur, la source reste intacte et Noon continue en mode dégradé.

## Conversations longues et analyses background

La compaction Responses est derrière `ENABLE_RESPONSE_COMPACTION`. Son seuil en tokens vient de `RESPONSE_COMPACTION_THRESHOLD_TOKENS`. Les appels conservent `store: false`, les `call_id`, résultats d'outils et items opaques. Une erreur de compatibilité retire seulement `context_management` et rejoue la requête stateless actuelle.

Le mode background est derrière `ENABLE_BACKGROUND_ANALYSIS`. Il ne démarre qu'après une demande explicite et uniquement pour un audit, plusieurs documents, un document long ou une comparaison complexe. Le statut peut être listé, interrogé et annulé. L'identifiant distant est stocké dans un fichier local mode `0600` seulement pendant l'exécution, puis supprimé quand la tâche atteint un état terminal. Le traitement background implique néanmoins un stockage temporaire côté OpenAI pour le polling.

## Feature flags

```text
ENABLE_RESPONSE_COMPACTION=false
RESPONSE_COMPACTION_THRESHOLD_TOKENS=120000
ENABLE_BACKGROUND_ANALYSIS=false
NOON_MAX_PROACTIVE_NOTIFICATIONS=3
```

Les fonctions expérimentales sont désactivées par défaut et possèdent un fallback.

## Hors ligne

Le portrait, la mémoire, les projets, la boîte d'entrée en cache, l'historique, Focus et les métriques restent locaux. Les connecteurs distants, les nouveaux appels OpenAI, la recherche Web et la voix OpenAI restent indisponibles. Les propositions de créneaux peuvent utiliser le dernier agenda fourni et portent alors le marqueur `stale`. Le retour du réseau ne déclenche aucune action distante.

## Tests et limites connues

Les tests couvrent mémoire, migration, portrait, projets, boîte d'entrée, score, anti-répétition, créneaux, suivi, compaction, background et non-régression générale. Les scénarios rejouables se trouvent dans `test/fixtures/personal-intelligence-evaluations.json`.

Limites : les collecteurs ne synchronisent que les connecteurs déjà configurés ; aucune recherche sémantique ni embedding n'est ajouté ; `node:sqlite` est encore signalé expérimental par Node 22 ; le fallback JSON offre moins de requêtes avancées ; le polling background nécessite une connexion et un état distant temporaire.
