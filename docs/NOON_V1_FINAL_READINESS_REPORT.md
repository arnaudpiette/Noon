# Noon V1 — rapport final de readiness

## Observation quotidienne réelle — Jour 1 (13 septembre 2026)

Périmètre : `/Applications/Noon.app`, usage personnel local, sans Picovoice, sans promotion Astra, sans changement de voix, sans écriture distante et sans modification fonctionnelle. Cette entrée initialise une observation de 3 à 7 jours ; elle ne constitue pas encore un rapport long-run.

| Mesure | État observé | Classification |
|---|---|---|
| Uptime au relevé | 7 min 10 s depuis le dernier lancement contrôlé | `BASELINE` |
| Démarrages journalisés sur 24 h | 27 `startup-begin` / 27 `server-started` / 27 `startup-server-ready` ; inclut les cycles de validation manuels | `EXPECTED`, pas un compteur de crashs |
| Crash / erreur / warning local | 0 événement `error`, 0 événement `warning` dans `logs/noon.log` sur 24 h | `CONFIRMED_LOCAL` |
| SQLite | `HEALTHY`, raison `OK`, 14 ms lors des cycles puis 14 ms ou moins sur les relevés suivants | `PACKAGED REAL` |
| Gmail | `connected` après les relances ; diagnostic actif `HEALTHY / OK`, 171 ms | `PACKAGED REAL READ` |
| Google Calendar | `connected` après les relances ; diagnostic actif `HEALTHY / OK`, 280 ms | `PACKAGED REAL READ` |
| Apple Notes | diagnostic actif `HEALTHY / OK`, 4 037 ms | `PACKAGED REAL READ` |
| Apple Reminders | diagnostic actif `HEALTHY / OK`, 1 060 ms après un timeout antérieur à 10 022 ms | `RECOVERED`, stabilité multi-jour à confirmer |
| Daily Brief | un seul brief daté du 13 septembre, Markdown présent, génération terminée | `PACKAGED REAL PERSISTED` |
| Sources du brief | Gmail, Calendar, mémoire Noon et projets `ready`; Notes et Reminders `unavailable` au moment de la génération; GitHub `disconnected` | `PARTIAL`, aucun faux empty |
| SafeStorage Google | Gmail et Calendar restent `connected` après cinq Quit/relaunch sans nouvel OAuth | `PACKAGED REAL`, à réobserver chaque jour |
| Instance unique | seconde ouverture : 1 processus principal, 1 serveur local | `PASS` |
| Arrêt propre | après Quit : 0 processus principal, 0 helper, 0 listener sur le port local | `PASS` |
| CPU / RAM au repos | 0,0 % CPU ponctuel ; 204,2 Mio RSS pour le processus principal | `BASELINE`, pas encore une tendance |
| Démarrage | premier cycle prêt en 2 s ; cycles suivants en 1 s ; mesure chaude précise 1 789 ms | `BASELINE` |
| Routage modèle cumulé | Luna 5, Terra 25 au relevé ; aucune fréquence Astra exploitable dans la fenêtre d’audit bornée | `LOCAL METRICS`, Astra reste `SHADOW` |
| Picovoice | clé absente | `WAITING_FOR_ACCESS_KEY` |
| Arbor | identité inchangée, aucun fallback autorisé | `WAITING_FOR_PROVIDER_API` |

Points restant à observer réellement : passage à 07:00, sleep/wake, persistance mémoire après usages réels, mode local-only via interaction humaine confirmée, panne réseau, évolution CPU/RAM sur plusieurs heures et fréquence Astra shadow. Le service de backup réel n’a pas été déclenché : les stores sensibles du registre lifecycle courant sont déclarés `encrypted:false`, donc aucune copie privée non chiffrée supplémentaire n’a été créée.

Problème utilisateur suivi :

| Date | Area | Symptom | Severity | Reproducible | Root cause known? | Fix required? |
|---|---|---|---|---|---|---|
| 2026-09-13 | Apple Reminders | Une lecture a expiré à environ 10 s avec `SERVICE_UNAVAILABLE`, puis un diagnostic ultérieur a réussi | `DEGRADED / RECOVERED` | Pas encore | Timeout Apple Events probable, non prouvé | Non avant reproduction répétée |

Statut Jour 1 : **`LOCAL_DAILY_USE_PARTIAL`**. Aucun défaut critique observé ; durée insuffisante pour `LOCAL_DAILY_USE_READY`.

## Intégration GPT-6 Astra — ModelRouter (8 septembre 2026)

Statut : **VERIFIED** avec rollout recommandé **SHADOW**. `gpt-6-astra` est enregistré comme quatrième niveau du ModelRouter canonique, derrière `router.astra=SHADOW`. Aucun router, engine, orchestrateur, pipeline d'outils ou privilège n'a été ajouté. Le seuil Astra (`88`) vaut deux fois le seuil Sol (`44`) et exige plusieurs signaux forts ou une préférence utilisateur explicite ; budget contraint et local-only empêchent l'appel. Le fallback Astra → Sol est borné, sans boucle, et observé.

L'appel API réel non sensible a confirmé le modèle effectif `gpt-6-astra`, le streaming (193 deltas), un TTFT de 2 414 ms, 7 914 ms au total, 45 tokens d'entrée, 197 de sortie et un coût estimé de 0,0103 USD. Sur trois fixtures synthétiques identiques à effort `medium`, Sol et Astra ont chacun satisfait 100 % des contraintes structurées ; Sol a moyenné 1 995 ms TTFT, 4 649 ms total et 0,01192 USD, contre 5 155 ms, 10 537 ms et 0,04705 USD pour Astra. Ce petit échantillon ne justifie pas une promotion au-delà de `SHADOW`.

Validation de régression après intégration : **976/976 tests**, **54/54 évaluations critiques**, build et lint réussis.

Le paquet macOS x64 a été reconstruit et sa vérification statique est **PASS** (`com.arnaudpiette.noon`, 1.0.6, x86_64). Le précédent `TypeError: fetch failed` n'a pas été reproduit après arrêt propre de l'instance Noon active : quatre profils isolés successifs, puis le paquet reconstruit, ont atteint `/health` et terminé **PASS**. La cause historique reste indéterminée (concurrence d'instance ou incident Chromium transitoire plausibles, non démontrés) et n'a donc motivé aucun contournement. Le paquet reste non signé Developer ID et non notarized.

Tarifs canoniques vérifiés lors de l'intégration : 10 USD/M tokens d'entrée, 1 USD/M cache et 50 USD/M sortie. Async tool calling et mid-turn steering restent `AVAILABLE_NOT_ENABLED`. VoiceIdentity et Arbor sont inchangés.

## Precheck P1.4 — Control Center et SQLite (9 septembre 2026)

Statut : **VERIFIED** pour le precheck SQLite ; P1.4 connecteurs reste **PARTIAL**. La base packagée réelle est située dans le `userData` canonique (`~/Library/Application Support/Noon/personal-intelligence.sqlite`). Elle existait avant la correction, est lisible, `PRAGMA integrity_check` retourne `ok` et sa migration canonique est en version 13. Le faux `CONFIGURATION_ERROR` venait du health check de `server.js`, qui comparait cette version à la constante obsolète `10` au lieu de `SCHEMA_VERSION` (`13`). La comparaison a été corrigée sans migration, suppression, recréation ou modification des données.

Après reconstruction, installation dans `/Applications/Noon.app` et relance sur les mêmes données : SQLite est **HEALTHY / OK**, `userActionRequired=false`, et le statut global passe de **UNAVAILABLE / NOT_READY** à **DEGRADED / DEGRADED_READY**. Gmail reste honnêtement `AUTH_REQUIRED` avec auth manquante ; Calendar, Apple Notes, Apple Reminders et les modèles non testés restent `UNKNOWN`. Le modèle local reste indisponible avec provider `NONE`, ce qui n'est pas une panne du cœur. La stratégie de backup canonique existe, mais aucune sauvegarde valide n'est encore présente (`NONE`, affiché `UNKNOWN`) ; la migration est `CLEAN / HEALTHY`.

Validation : **978/978 tests**, **54/54 évaluations critiques**, build, lint, package x64, vérification statique, smoke packagé et `git diff --check` réussis. L'ASAR installé correspond exactement à l'ASAR construit.

## Validation P1.3 — Daily Brief (reprise le 8 septembre 2026)

Statut : **PARTIAL**. Les invariants du brief quotidien sont validés par 136/136 tests ciblés, 970/970 tests complets et 54/54 évaluations critiques. Le bundle x64 reconstruit démarre réellement, l'historique local contient des briefs quotidiens jusqu'au 8 septembre et Apple Notes a été lue avec succès. Aucun déclenchement n'a toutefois été observé en direct à 07:00 ou après veille/réveil ; Gmail et Google Calendar restent déconnectés, et Apple Rappels est actuellement indisponible.

Rapport détaillé : [`P1_3_DAILY_BRIEF_REPORT.md`](./P1_3_DAILY_BRIEF_REPORT.md).

## Validation P1.2 — Voice (2 septembre 2026)

Statut : **PARTIAL**. Les providers STT et TTS ont été appelés réellement via Noon avec des données artificielles, la parité d'architecture et la sécurité local-only ont été renforcées, mais aucune preuve de microphone, sortie audible, TCC, WebRTC ou wake word réel n'a pu être obtenue faute de fenêtre applicative pilotable. L'inventaire Picovoice de l'environnement de test n'exposait que `NULL Capture Device`, pas un microphone physique.

- `REAL PROVIDER STT` : OpenAI `gpt-4o-mini-transcribe`, transcription française exacte en 581 ms et phrase technique Mongoose/Node/Express exacte en 1 135 ms. Source audio synthétique locale, donc **pas** une preuve de microphone réel.
- `REAL PROVIDER TTS` : OpenAI `gpt-4o-mini-tts`, voix `marin`, 220 800 octets PCM, premier flux serveur à 1 982 ms. Le fichier audio est valide ; l'audibilité matérielle n'est pas certifiée.
- `AUTOMATED REAL LOCAL` : local-only refuse Realtime, STT et TTS avant réseau avec HTTP 409 et `LOCAL_ONLY_REMOTE_VOICE_BLOCKED`.
- `AUTOMATED` : le micro classique suit `capture → /transcribe → sendQuestion → IntentCommandEngine → NoonOrchestrator → ContextBuilder/MemoryEngine/ModelRouter → /tts`. Realtime doit désormais déléguer toute question/action à `ask_noon_brain`; seuls mode, Focus et style vocal restent déterministes dans l'adaptateur Live.
- `AUTOMATED` : cleanup MediaStream/WebRTC/audio, approvals ambiguës/expirées/one-shot, identité vocale et absence de contenu parlé dans les métriques restent couverts.
- `PACKAGED` : bundle x64 reconstruit et smoke PASS en 12 877 ms, profil isolé. Micro, TCC, WebRTC, TTS audible et wake word packagés : `NOT_VERIFIED`.
- non-régression finale : 929/929 tests, 54/54 évaluations critiques, build/lint PASS.

`marin` est l'identifiant de voix OpenAI canonique de `VoiceIdentity`, utilisé par Realtime et TTS. `cedar` est uniquement le fallback explicite après deux échecs `marin`; ce n'est ni un provider ni un moteur local.

## Validation P1.1 — chat, mémoire et continuité (2 septembre 2026)

Statut : **PARTIAL**. Le chat réel via l'API locale de Noon et OpenAI, la persistance conversationnelle après redémarrage, le mode local-only et le cycle mémoire local chiffré sont vérifiés. Le parcours renderer et le chat/mémoire dans l'application packagée ne sont pas certifiés : aucun navigateur intégré n'était disponible pour piloter l'UI, et le coffre `safeStorage` n'existe que dans Electron.

- `REAL OPENAI` : Luna a répondu correctement en streaming à une question HTTP/WebSocket ; 31 deltas, premier token 1 202 ms, réponse modèle 1 972 ms, 2 778 tokens d'entrée, 35 de sortie, coût estimé 0,0005976 USD.
- `REAL OPENAI + RESTART` : une conversation artificielle a retenu le nom de code « Orion », l'a retrouvé au tour suivant puis après arrêt/redémarrage, avec le même identifiant de session canonique.
- `REAL LOCAL` : candidat mémoire non injecté, confirmation et correction orange → violette, pertinence positive, exclusion hors sujet, oubli immédiat et absence après réouverture SQLite avec la même clé.
- `REAL LOCAL` : passage explicite en mode local-only, réponse honnête sans modèle local et `remoteCalls: 0`, puis retour explicite au mode normal.
- `PACKAGED` : build x64 et smoke de démarrage réussis ; chat/mémoire packagés non vérifiés.
- corrections P1.1 : séparation capacités runtime/capacités modèle ; alias OpenAI valide pour les noms d'outils d'extension ; retrait du bonus de pertinence qui injectait les profils legacy hors sujet.
- non-régression finale : 927/927 tests, 54/54 évaluations critiques, build/lint PASS.

Confidentialité : les appels Responses utilisent `store:false`; les traces contrôlées ne contiennent pas les prompts bruts et exposent uniquement empreintes, identifiants et métriques bornées.

Audit final exécuté le 1er septembre 2026 sur `main`, worktree volontairement préservé. Aucun reset, clean, commit, push ou retrait de legacy.

## Executive summary

**Noon V1 readiness : `INTERNAL_ALPHA_READY`.**

Le cœur déterministe, les invariants de sécurité, la persistance, les migrations, les backups et le démarrage du bundle macOS x64 sont vérifiés. Noon n'est pas `DAILY_USE_BETA_READY` : le chat API live, la chaîne voix réelle, le brief observé à 07:00 et les connecteurs réels ne sont pas vérifiés. Il n'est pas `RELEASE_CANDIDATE_READY` : Developer ID/notarisation et arm64 manquent.

- P0 : 0 constaté.
- P1 : 5 familles — chat/voix live, connecteurs réels, brief réel, distribution signée/notarisée, arm64.
- P2 : `server.js` volumineux, CSP styles inline, compatibilité JSON, benchmarks idle/longue session.

## Capacités réelles

- `OPERATIONAL` (4) : mémoire/règles/contexte, approval/exécution transactionnelle, artefacts, workspaces.
- `OPERATIONAL_DEGRADED` (1) : planning/priorité/suivi/revue, avec couverture réduite si une source distante manque.
- `PARTIAL` (12) : chat, voix, recherches personnelle/publique, multimodal, Gmail, Calendar, Notes/Reminders, GitHub/Figma, Daily Brief, Control Center, build x64.
- `PREPARED` (2) : sync et remote.
- `EXPERIMENTAL` (6) : décision/goals/portfolio, proactivité/notifications, jobs, offline runtime, extensions internes, contexte ambiant.
- `DISABLED` (2) : modèle local et extensions externes.
- `NOT_IMPLEMENTED` (1) : auto-update production.
- `BLOCKED` (1) : build arm64 sur cette toolchain.

La matrice détaillée et ses preuves sont dans `docs/NOON_V1_CAPABILITIES.md`.

## Architecture, source de vérité et legacy

Flux constaté : entrée texte/voix → adaptateur d'intention → `IntentCommandEngine` → `NoonOrchestrator` → `ContextBuilder`/routeur/skills → policy → approval si nécessaire → exécution transactionnelle → résultat/session/attention.

Les propriétaires canoniques sont figés dans `docs/architecture/NOON_V1_ARCHITECTURE.md`. Les doublons apparents sont classés :

- `services/personal-memory/context-builder.js` est un adaptateur privé borné, pas le ContextBuilder canonique ;
- `services/approvals/approval-manager.js` est un alias de compatibilité de l'Approval Engine ;
- `askAI()` dans `server.js` est une façade de compatibilité qui délègue au NoonOrchestrator ;
- timers Electron, stockage JSON et parseurs historiques restent `KEEP_COMPAT`/`QUARANTINE` jusqu'à preuve de migration complète.

`server.js` reste à 6 941 lignes et conserve bootstrap, HTTP, wiring, compatibilité, routes de connecteurs, brief et voix. Aucun second orchestrateur conversationnel n'a été trouvé, mais cette concentration demeure une dette de maintenabilité.

## Sécurité et confidentialité

Statut automatisé sécurité : `PASS`. Statut confidentialité opérationnelle : `PARTIAL`, car comptes, micro et interaction humaine ne sont pas testés live.

- renderer isolé : context isolation, sandbox, Node désactivé, sécurité Web active ;
- API sur boucle locale uniquement, avec secret local sur les routes protégées ;
- mutations via policy, approval exacte/one-shot, fingerprint et exécution transactionnelle ;
- racines fichiers, realpath, symlinks et préconditions stale vérifiés ;
- contenu Web/e-mail/média traité comme donnée non fiable, avec prompt injection testée ;
- `local_only`, profils protégés, traces expurgées, `store:false`, EXIF/GPS retirés ;
- extensions/remote/sync sensibles OFF ou SHADOW par défaut ;
- `npm audit --omit=dev` : 0 vulnérabilité de production connue.

## E2E et limites

| Parcours | Résultat | Preuve |
|---|---|---|
| Chat simple / restart | PASS_REAL_API | OpenAI live, streaming, persistance et reprise après arrêt complet |
| Mémoire / fichier / mutation | PASS_REAL_LOCAL | mémoire SQLite chiffrée réelle ; fichier/mutation simulés, isolation et anti-rejeu |
| Gmail / Calendar | MOCK_ONLY | aucun compte réel modifié |
| Brief 07:00 / DST / catch-up | PASS_SIMULATED | scheduler réel non observé à 07:00 |
| Background job / approval différée | PASS_SIMULATED | persistance, restart, stale, no replay |
| Offline / local-only | PASS_REAL_LOCAL | activation chat réelle, dégradation honnête et `remoteCalls: 0` |
| Voice | PARTIAL | identité/config/policy testées ; micro, STT, TTS et wake word réels non testés |
| Control Center | PASS_SIMULATED | read models/routes testés ; inspection UI manuelle absente |
| Extension failure | PASS_SIMULATED | crash isolé et permissions bornées |
| Crash/backup/migration | PASS_SIMULATED | fixtures, corruption, idempotence et restore protégés |
| Bundle x64 startup | PASS_REAL | binaire lancé hors sandbox, health atteint, arrêt propre |
| Installation / arm64 / notarisation | NOT_VERIFIED | aucune preuve disponible |

## Package, performance et coûts

- preflight release : PASS ; bundle 1.0.6 x86_64 : PASS ;
- signature locale/ad hoc présente ; Developer ID absent ; notarisation absente ;
- smoke packagé : PASS, 13 631 ms, profil isolé, loopback `127.0.0.1` ;
- CPU/RAM idle, sleep/wake, longue session et fuite mémoire : `NOT_VERIFIED` ;
- suite complète : 9,9 s ; évaluations complètes : 109 scénarios en 57 ms ;
- instrumentation coûts présente ; appel Luna P1.1 estimé à 0,0005976 USD (2 778 tokens entrée, 35 sortie).

## Tests exécutés

| Suite | Run | Pass | Fail | Warning/skip |
|---|---:|---:|---:|---:|
| `npm test` | 927 | 927 | 0 | 0 |
| évaluations complètes | 109 | 109 | 0 | 0 |
| évaluations critiques | 54 | 54 | 0 | 0 |
| sécurité/intégration ciblée | 64 | 64 | 0 | 0 |
| offline/voix/recovery ciblée | 47 | 47 | 0 | 0 |
| build/lint | 1 pipeline | PASS | 0 | 0 |
| preflight/verify/smoke x64 | 3 | 3 | 0 | 0 |
| audit dépendances production | 1 | PASS | 0 vulnérabilité | 0 |

Non exécutés : chat/mémoire via renderer packagé, OAuth/provider Gmail/Calendar/Figma, micro/AirPods/wake word, observation du brief à 07:00, installation `/Applications`, sleep/wake réel, session longue, arm64, Developer ID et notarisation.

## Failure injection et non-régression

Sont couverts : audit/persistance indisponibles, disque plein, manifeste altéré, migration en échec, crash avant validation, provider absent, auth expirée, réseau/OpenAI indisponibles, résultat de mutation inconnu, stale file/calendar, duplicate/replay, extension en panne et renderer compromis. Aucun faux succès ni retry aveugle de mutation n'est accepté.

## Gel V1

L'architecture des responsabilités est gelée, mais le produit n'est pas déclaré release candidate. Ne pas créer une seconde source de vérité ; ne pas contourner NoonOrchestrator pour les workflows modèle ; ne pas contourner Security/Approval/Execution pour les mutations ; ne pas remettre de logique métier dans `server.js` ; ne pas créer de permissions propres aux connecteurs ; ne pas dupliquer MemoryEngine ; ne pas séparer les logiques assistant texte et voix.

## Top 5 next actions

1. Valider dans le renderer packagé le chat et le coffre mémoire `safeStorage` avec des données non sensibles.
2. Exécuter la matrice voix réelle : micro, STT, TTS marin, wake word, fenêtre fermée et refus d'approbation.
3. Observer le brief à 07:00 après sleep/wake et vérifier l'absence de doublon.
4. Tester Gmail/Calendar en sandbox puis les permissions Notes/Reminders, sans données privées dans les logs.
5. Produire et tester arm64, Developer ID, notarisation et installation `/Applications` avant diffusion.

## Conclusion normalisée

```text
NOON V1 — FINAL STATUS

Readiness:
INTERNAL_ALPHA_READY

Critical blockers:
0 P0 (5 familles P1 empêchent la beta quotidienne/release candidate)

Operational capabilities:
4 (+1 operational degraded)

Partial capabilities:
12

Prepared-only capabilities:
2

Critical tests:
PASS

Security:
PASS

Privacy:
PARTIAL

Packaged macOS app:
VERIFIED

Offline:
PARTIAL

Voice:
PARTIAL

Daily Brief:
PARTIAL

Backups / Migration:
VERIFIED

Architecture:
FROZEN
```
