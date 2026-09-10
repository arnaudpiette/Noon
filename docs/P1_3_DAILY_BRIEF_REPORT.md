# Validation P1.3 — Daily Brief

Date de validation initiale : 3 septembre 2026

Dernière reprise : 8 septembre 2026
Statut : **PARTIAL**

## Verdict

Le Daily Brief de Noon est cohérent et sûr au niveau du code et des tests automatisés. Le moteur produit un seul brief logique par journée dans le fuseau `Europe/Paris`, partage les exécutions concurrentes, résiste aux changements d’heure, continue en mode dégradé lorsqu’une source ou le modèle est indisponible et n’accorde aucune autorisation d’écriture implicite.

La P1.3 n’est toutefois pas fermée : l’historique applicatif réel prouve désormais des générations quotidiennes persistées jusqu’au 8 septembre et une lecture Apple Notes réussie, mais pas l’heure ni la cause exacte de chaque déclenchement. Aucune exécution n’a été observée en direct à 07:00 ou après veille/réveil, Google reste déconnecté et Apple Rappels est actuellement indisponible. Le statut ne peut donc pas être élevé à `PASS_REAL`.

## Preuves obtenues

- `AUTOMATED` — 136/136 tests ciblés réussis, 0 échec, le 8 septembre 2026.
- `FULL REGRESSION` — 970/970 tests réussis, 0 échec et 0 skip.
- `CRITICAL EVALS` — 54/54 scénarios critiques réussis, gate `PASS`.
- `PACKAGED` — bundle macOS x64 1.0.6 reconstruit et vérifié ; smoke de démarrage `PASS` en 6 578 ms avec profil isolé.
- `REAL LOCAL HISTORY` — des briefs distincts sont persistés pour les 6, 7 et 8 septembre 2026 avec une clé canonique `morning-brief:YYYY-MM-DD:Europe/Paris` ; le brief du 8 septembre a réellement appelé `gpt-5.6-terra` une fois et a été conservé comme succès.
- `REAL APPLE SOURCE` — Apple Notes est enregistrée `ready` dans les briefs réels des 6, 7 et 8 septembre. Apple Rappels était `ready` le 6 septembre puis `unavailable` les 7 et 8 septembre, sans empêcher la génération.
- `REAL DEGRADED SOURCES` — Google Calendar et Gmail sont explicitement `disconnected`, jamais assimilés à une liste vide réussie ; aucun événement ni e-mail n’a été inventé.
- `AUTOMATED` — une journée produit un seul objet `brief_YYYY-MM-DD` ; deux déclenchements concurrents partagent la même exécution.
- `AUTOMATED` — la planification utilise `Europe/Paris` sans double exécution pendant les transitions DST.
- `AUTOMATED` — le brief consomme le Daily Plan, le Priority Engine et la revue centrale, sans créer de pipeline concurrent.
- `AUTOMATED` — une source indisponible ne bloque pas le brief ; un échec modèle produit un rendu local déterministe marqué comme dégradé.
- `AUTOMATED` — trois priorités maximum, déduplication, protection de 12:30 à 13:30, absence de chevauchement et découpe des tâches longues.
- `AUTOMATED` — les blocs proposés portent la couleur Myrtille et la signature Noon, sans invité, mais aucune écriture Calendar n’est effectuée silencieusement.
- `AUTOMATED` — Gmail reste limité à la lecture et aux brouillons ; aucun e-mail n’est envoyé par le brief.
- `AUTOMATED` — les instructions malveillantes issues des sources sont ignorées, les mémoires `local_only` ne suivent aucun flux distant et les métriques ne contiennent pas de contenu privé.
- `CODE INSPECTION` — Electron contrôle l’état courant avant génération, effectue le rattrapage au lancement/réveil/déverrouillage, programme un retry borné après erreur et n’affiche la notification qu’après succès.

Commande de validation :

```text
node --test test/daily-brief-engine.test.js test/daily-brief-freshness.test.js test/morning-brief.test.js test/priority-engine.test.js test/integrations-and-workflows.test.js test/background-job-engine.test.js test/context-builder.test.js test/operational-security-policy.test.js test/connector-validation.test.js test/daily-planning-engine.test.js
```

Résultat ciblé : `136 tests, 136 pass, 0 fail, 0 skipped`.

Validation complémentaire : `npm test` → `970/970` ; `npm run eval:critical` → `54/54` ; `npm run package:mac:x64`, `npm run verify:mac` et `npm run release:smoke` → `PASS`.

## Ce qui n’est pas prouvé

- déclenchement réel du bundle macOS à 07:00 ;
- rattrapage réel après veille/réveil ou déverrouillage ;
- notification unique observée dans ces conditions ;
- collecte réelle Gmail et Google Calendar avec les scopes attendus ;
- lecture réelle Apple Notes et Rappels avec permission Automation accordée puis refusée ;
- génération distante réelle avec Google connecté ;
- comportement sur plusieurs journées consécutives et autour d’un changement DST réel.

Les tests utilisent des doubles et des dates simulées. Ils prouvent les invariants du moteur, pas le fonctionnement des comptes, du réseau, des permissions macOS ni du scheduler dans le bundle.

## Risques résiduels

1. Une suspension macOS ou un ordre d’événements inattendu peut retarder ou dupliquer le déclenchement malgré l’idempotence côté serveur.
2. Une autorisation OAuth ou Automation manquante peut réduire fortement le contenu sans que l’utilisateur distingue immédiatement une dégradation normale d’une mauvaise configuration.
3. La notification et l’ouverture du brief dépendent de l’intégration Electron réelle, non pilotée dans cette validation.
4. Les transitions DST sont couvertes par simulation, mais pas par une observation longue durée du bundle.

## Critères de fermeture

La P1.3 pourra être déclarée `PASS_REAL` après une session packagée contrôlée qui démontre :

1. un déclenchement unique à 07:00 en `Europe/Paris` ;
2. un rattrapage unique après veille autour de 07:00 ;
3. une notification unique et l’ouverture du brief correspondant ;
4. une collecte réelle Gmail/Calendar et Notes/Rappels avec états de permissions visibles ;
5. la continuité du brief lorsqu’une source est refusée ou indisponible ;
6. l’absence d’envoi Gmail et d’écriture Calendar sans ordre et validation explicites ;
7. des logs sans titre, contenu, adresse, token ou autre donnée privée brute.

## Conclusion normalisée

```text
P1.3 — DAILY BRIEF

Status: PARTIAL
Automated validation: PASS (136/136 targeted; 970/970 full)
Critical evaluations: PASS (54/54)
Packaged x64 startup: PASS_REAL (6,578 ms)
Persisted daily history: PASS_REAL_LOCAL (2026-09-06 through 2026-09-08)
Apple Notes source: PASS_REAL_LOCAL
Apple Reminders source: PARTIAL
Packaged 07:00 trigger: NOT_VERIFIED
Sleep/wake catch-up: NOT_VERIFIED
Real Google sources: DISCONNECTED
Idempotence and DST: PASS_SIMULATED
Degraded mode: PASS_SIMULATED
Security and privacy guards: PASS_AUTOMATED

Release impact:
DAILY_USE_BETA remains blocked until the packaged real-world session passes.
```
