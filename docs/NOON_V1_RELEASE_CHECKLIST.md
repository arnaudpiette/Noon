# Noon V1 — checklist de release et d’usage quotidien

## Utilisateur

- [ ] Noon démarre depuis `/Applications` et après connexion si activé.
- [x] Le chat API répond avec une vraie clé/API et persiste après redémarrage (renderer packagé encore à vérifier).
- [ ] Le microphone, le casque, STT et TTS fonctionnent avec les permissions macOS.
- [x] STT et TTS distants répondent réellement via Noon sur audio artificiel ; ne vaut pas validation du microphone ou de la sortie physique.
- [x] La mémoire locale chiffrée retrouve une information confirmée, exclut le hors sujet et ne ressuscite pas après oubli/redémarrage.
- [ ] Le brief arrive une seule fois vers 07:00 Europe/Paris, y compris après veille.
- [ ] Gmail et Calendar affichent leur couverture réelle et leurs erreurs d’authentification.
- [ ] Les racines de fichiers autorisées sont correctes ; une analyse n’écrit rien.
- [ ] Une mutation affiche une prévisualisation/approbation et ne s’exécute qu’une fois.
- [ ] Le Control Center distingue core, optionnel et dégradé.
- [ ] Un backup fixture est validé et restauré avant de dépendre de Noon au quotidien.

## Développeur

- [x] 923 tests de baseline passent pendant l’étape 45, sans skip ni TODO.
- [x] 109 évaluations passent sans warning ni fail.
- [x] lint/build passent.
- [x] preflight et vérification statique x64 passent.
- [x] smoke du démarrage packagé x64 passe dans une session macOS autorisée (13,6 s, profil isolé, arrêt propre).
- [ ] installation DMG/ZIP dans `/Applications` testée manuellement.
- [ ] signature Developer ID et notarisation validées.
- [ ] build et smoke arm64 validés.
- [x] parcours Chat API live validé en serveur isolé, streaming et restart inclus.
- [ ] parcours Voice E2E réel validé.
- [x] local-only bloque réellement les trois providers vocaux distants : Realtime, STT et TTS.
- [ ] Gmail/Calendar sandbox ou comptes réels validés sans donnée privée dans les logs.
- [ ] offline packagé, sleep/wake, crash recovery et session longue validés.
- [ ] aucune P0 et les P1 du périmètre V1 sont fermées.

## Parcours E2E à conserver

| Parcours | État audit | Effets interdits |
|---|---|---|
| Chat simple + restart | REAL OPENAI VERIFIED / PACKAGED NOT_VERIFIED | perte/duplication de conversation |
| Mémoire confirmée | REAL LOCAL VERIFIED / PACKAGED NOT_VERIFIED | mémoire non pertinente ou `local_only` distante |
| Lecture fichier | TESTÉ SIMULÉ | écriture/modification |
| Mutation fichier | TESTÉ SIMULÉ | overwrite sans ordre, replay, symlink escape |
| Gmail read/draft/send | MOCK UNIQUEMENT | send avant ordre/approval, double send |
| Calendar free slot/create | MOCK UNIQUEMENT | pause 12:30–13:30, move/delete implicite |
| Brief 07:00/catch-up | TESTÉ SIMULÉ | doublon ou faux vide |
| Background job | TESTÉ SIMULÉ | replay aveugle |
| Approval différée | TESTÉ SIMULÉ | exécution après fingerprint stale |
| Offline | TESTÉ SIMULÉ | faux succès distant |
| Voice | PARTIAL — REAL STT/TTS PROVIDERS, NO REAL MIC | bypass sécurité texte, provider distant en local-only |
| Packaged x64 | VERIFIED_STARTUP | profil réel isolé ; UI/micro non couverts |
| Local-only | REAL LOCAL VERIFIED | appel réseau, sync, notification sensible |

## Critère de promotion

`RELEASE_CANDIDATE_READY` exige les cases package, sécurité critique, migration, backup, Chat et Voice E2E réels, ainsi que zéro P0. Avant cela, conserver un canal interne et des flags prudents.
