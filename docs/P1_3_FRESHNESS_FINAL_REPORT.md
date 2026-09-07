# P1.3 — Daily Brief freshness, date canonique et chargement

Audit initial : 6 septembre 2026, environ 22:14 Europe/Paris. Reprise : 7 septembre 2026, environ 20:19 Europe/Paris. Aucun changement de date système.

## ROOT CAUSE

Deux défauts confirmés dans le bundle installé avant correction :

1. `GET /daily-brief` retournait `personalBriefStore.load().briefs[0]` comme `current`, sans comparaison avec la date Europe/Paris.
2. `loadCreativeBrief()` affichait ce contenu même avec `status=generating`, puis ne reconsultait pas le serveur à la fin de la génération. Une réponse reçue pendant le catch-up pouvait donc conserver indéfiniment le contenu de la veille et « Génération en cours… ».

Le statut persisté n'était pas une preuve d'activité : une génération interrompue pouvait laisser `generating` sur disque. La planification pouvait également écraser un état d'erreur. Le correctif calcule l'activité depuis les promesses du moteur et préserve les états lors d'une mise à jour de planification.

## AUDIT DE L'ÉTAT RÉEL

Lecture seule des données avant correction : `~/Library/Application Support/noon/personal-brief.json`.

- `status`: `ready`.
- `lastAttemptAt`: `2026-09-06T18:08:10.768Z`.
- `lastSuccessAt`: `2026-09-06T18:08:10.768Z` (ancienne implémentation : début de tentative, pas fin effective).
- `lastSuccessDate`: `2026-09-06`.
- Brief courant stocké : `brief_2026-09-06`, date `2026-09-06`, `generatedAt=2026-09-06T18:08:17.302Z` (ancienne implémentation : horodatage avant composition).
- Brief historique du 5 : `c800232b-2c88-4468-b3c1-bdbc628dcb4a`, `generatedAt=2026-09-05T09:28:54.785Z`, soit 11:28:54 à Paris.

Preuves dans `logs/noon.log` et `tool-audit.json` :

- 6 septembre, serveur prêt à `18:08:10.365Z`.
- Fenêtre prête à `18:08:10.981Z`.
- `daily-brief.ready` à `18:08:41.865Z`, `brief_2026-09-06`, un appel modèle, génération non dégradée, durée totale 31 092 ms.

Qualification A–F :

| Hypothèse | Résultat |
|---|---|
| A. Le brief du 6 n'a jamais été généré | Faux à l'heure de l'audit : brief et événement ready présents. |
| B. Le renderer peut conserver le 5 après génération du 6 | Défaut confirmé par le code installé et reproduit par les tests du loader. Pas de capture DOM historique de l'instant signalé. |
| C. Catch-up absent | Contredit par la tentative immédiatement après le démarrage et l'événement ready 31 secondes plus tard. |
| D. Chargement non terminé visuellement | Le loader n'avait aucun rafraîchissement après une réponse generating. Cause reproductible. |
| E. Ancien bundle/store | Le bundle installé possédait déjà DailyBriefEngine et lisait personal-brief. Les blocs Brief correspondaient au code avant ce correctif. Les fichiers complets server/app différaient du workspace pour d'autres changements antérieurs. |
| F. Plusieurs stores | Oui : personal-brief canonique et creative-brief historique. Ce dernier servait encore aux sujets de veille, pas à la sélection courante de cette route. |

## CURRENT BRIEF SOURCE

`GET /daily-brief/current` → `DailyBriefEngine.getCurrent()` → `personal-brief.json`, recherche par `brief.date == localDateKey(now, Europe/Paris)`. Les anciens alias utilisent la même résolution. Une valeur `lastSuccessDate` incohérente ou un historique mal ordonné ne décide plus du brief courant.

## HISTORICAL BRIEF SOURCE

Même store canonique. `GET /daily-brief/history?date=YYYY-MM-DD` et sélecteur explicite « Brief précédent — date ». Le contenu historique est marqué « Brief historique ». Aucune migration ni suppression des anciens briefs.

## Why 05/09 was displayed on 06/09

La route exposait la dernière entrée disponible pendant le catch-up. Le renderer l'affichait comme courant tout en affichant generating, puis ne rechargeait pas le résultat final. Les traces prouvent que le brief du 6 était terminé à 20:08:41 Paris ; elles ne constituent pas une capture de l'écran de l'utilisateur à cet instant.

## Catch-up

Politique existante conservée : génération automatique activée, heure configurée atteinte (07:00 par défaut), absence du brief courant ; aucun cutoff du soir n'existait. Le mode sans génération automatique et le mode sûr bloquent le catch-up. Un échec impose quinze minutes avant une nouvelle tentative automatique. Startup et scheduler consultent la même décision canonique ; renderer/reconnexion réseau peuvent demander le courant sans créer un second pipeline.

Preuve supplémentaire à la reprise du 7 septembre : tentative réelle à `2026-09-07T05:00:51.737Z` (07:00:51 Paris), événement `daily-brief.ready` à `05:01:14.646Z`, `brief_2026-09-07`, un appel modèle. Le store contient un seul exemplaire pour cette date. Ce déclenchement a eu lieu avec le bundle précédent ; le nouveau bundle n'est pas présenté comme déjà observé à 07:00.

## Europe/Paris current-date handling

Source canonique `localDateKey`, timezone `Europe/Paris`. Tests explicites à 21:59:59/22:00 UTC en été et 22:59:59/23:00 UTC en hiver, ainsi qu'à 23:30 UTC. Affichage generatedAt également en Europe/Paris. Les nouveaux horodatages generatedAt et lastSuccessAt correspondent à la fin de génération ; les dates historiques restent intactes.

## Loading state

LOADING pour la requête ; GENERATING seulement si le moteur possède une exécution active du jour ; READY, PARTIAL, FAILED ou MISSING ensuite. Rafraîchissement toutes les 1,5 secondes pendant génération et toutes les 60 secondes dans la vue du jour ; rechargement à l'ouverture, au retour de focus et au retour réseau. Les réponses réseau dépassées ne peuvent plus remplacer la réponse récente. Les deux indicateurs sont mis à jour en cas d'erreur.

## Stale state

L'ancien contenu est retiré lors du chargement et n'est pas affiché comme courant. En cas d'absence ou d'échec, un message cite explicitement la date du jour. L'ancien brief reste disponible dans le sélecteur d'historique avec son libellé. Les sources indisponibles ne sont pas converties en sources vides.

## Same-day dedupe

Promesses actives indexées par date dans le moteur existant. Dix demandes concurrentes du courant et dix appels generate rejoignent un seul brief et une seule collecte. Déduplication persistée par date également après redémarrage.

## Next-day rotation

La date précédente ne satisfait jamais la recherche courante. Tests de restart N+1, de réponses renderer arrivant dans le désordre et de deux générations de part et d'autre de minuit Paris. Pas de nouveau moteur.

## Security / sources

Le raccordement canonique ne déclenche plus la création externe de brouillons Gmail. Les blocs demeurent des propositions ; pas d'ajout de chemin d'envoi, d'écriture Calendar, de modification de tâche ou de fichier utilisateur. Les écritures internes de persistance Noon restent nécessaires au brief et à son plan. Markdown sécurisé inchangé : titres, gras, listes et test XSS conservés.

Apple Reminders et Apple Notes : lectures réelles antérieurement confirmées, statuts conservés. Google Calendar, Gmail, GitHub : NOT CONNECTED, aucune intégration P1.4 entreprise. Voice non modifiée pendant ce correctif.

## Packaged UI

Package x64 construit puis installé le 7 septembre 2026 dans `/Applications/Noon.app`. Ancienne application sauvegardée : `/Applications/Noon-backup-20260907-201928.app`.

Les six fichiers `server.js`, `public/app.js`, `public/index.html`, `lib/creative-brief.js`, `services/daily-brief/daily-brief-engine.js`, `electron/main.js` extraits de l'ASAR installé correspondent exactement au workspace. ASAR SHA-256 : `a5cf03ed3b7f9517d05537c00001e12024f6406e56f070f8b766e57a9bbff232`.

Signature ad hoc locale appliquée et vérifiée ; aucune prétention de signature Developer ID/notarisation. La variable du terminal ELECTRON_RUN_AS_NODE a été retirée pour lancer le vrai runtime graphique.

Validation physique confirmée par l'utilisateur après installation :

- PACKAGED UI : PASS.
- SAFESTORAGE : PASS.
- CURRENT-DAY BRIEF : PASS.
- RESTART DEDUPE : PASS.

Ces résultats proviennent du test utilisateur dans l'application installée, et non d'une observation automatisée du navigateur. Le blocage du trousseau est levé ; aucun mot de passe n'a été transmis dans la conversation.

## Validation

| Contrôle | Résultat |
|---|---|
| Tests before | 940 |
| Tests after | 955 PASS, 0 FAIL |
| Critical evals | 54/54 PASS |
| Build | PASS |
| Lint | PASS |
| Package macOS x64 | PASS après accès réseau pour Electron |
| git diff --check | PASS |
| Markdown / XSS | PASS, renderer sécurisé conservé |
| Architecture V1 | Aucun nouvel Engine |
| Regressions | Aucune détectée par la suite automatisée |

## P1.3 status

VERIFIED pour le correctif freshness, date canonique et état de chargement : tests automatisés réussis et validation physique du bundle installé confirmée par l’utilisateur.

Remaining blocker : aucun pour ce correctif. Validation de cycle de vie restante : REAL SLEEP/WAKE non observé ; REAL 07:00 documenté dans les traces du bundle précédent, pas encore observé sur le bundle corrigé. Les quatre PASS utilisateur ne constituent pas une validation de ces deux scénarios.

Aucun reset, clean, commit automatique ou push. P1.4 non commencé.
