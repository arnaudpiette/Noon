# Validation du bundle installé — 5 septembre 2026

## INSTALLED APP

Cible exclusivement inspectée : `/Applications/Noon.app`.
Référence : `out/Noon-darwin-x64/Noon.app`.

**INSTALLED_ASAR_MATCH: FAIL**

Comparaison SHA-256 des fichiers extraits des deux ASAR :

| Fichier | Résultat |
|---|---|
| server.js | FAIL — différent |
| services/voice/voice-identity.js | FAIL — absent du bundle installé |
| public/app.js | FAIL — différent |
| public/ui-utils.js | FAIL — différent |
| public/live-voice.js | FAIL — différent |

Version installée : **1.0.6**. Bundle ID : **com.arnaudpiette.noon**.
La version seule ne distingue pas le bundle legacy du package corrigé. Le bundle installé reste legacy.

## VOICE

Le main Electron installé affecte `app.getPath("userData")` à `NOON_DATA_DIR`. Le fichier attendu `/Users/arnaudpiette/Library/Application Support/Noon/voice-identity.json` est **absent**.

Selected VoiceIdentity : **NONE — aucun choix enregistré trouvé**. Aucun choix modifié ou supposé.

| Essai | Résultat | Voice demandée / confirmée |
|---|---|---|
| Chat TTS, identité masculine attendue | NOT EXECUTED | Non observée pendant cet audit |
| Salut Noon, détection et identité audible | NOT EXECUTED | Non observée pendant cet audit |
| Conversation Live, identité audible | NOT EXECUTED | Requête et confirmation provider non observées |
| Fenêtre fermée sans Quit | NOT EXECUTED | Non observée |
| Restart complet, persistance | NOT EXECUTED | Aucun choix persistant à vérifier |
| Full quit, absence de réponse | NOT EXECUTED | Comportement attendu : NO RESPONSE, aucun helper V1 |
| Cohérence entre modes | NOT VERIFIED | Aucun choix humain ni comparaison audible |

Aucun PASS/FAIL acoustique ne peut être attribué sans confirmation humaine. Les essais du bundle corrigé sont bloqués par son absence dans /Applications. La tentative de lecture de la liste des processus a été refusée par le sandbox ; aucun état running/stopped n’est déduit de cette tentative.

## DAILY BRIEF UI

PACKAGED_MARKDOWN_UI : **NOT EXECUTED**, bundle corrigé non installé.
LOADING_STATE : **NOT EXECUTED visuellement** ; state persistant `ready` confirmé, ce qui ne prouve pas le rendu.
Timestamp conservé : **05/09/2026 11:28:54 Europe/Paris**, valeur `2026-09-05T09:28:54.785Z` relue dans `personal-brief.json`.
Un seul brief du 5 septembre dans l’état conservé. Les badges sources persistés correspondent à l’observation précédente ; aucune nouvelle validation visuelle.

## SOURCES

- Apple Reminders : **REAL READ VERIFIED**, preuve antérieure côté service/state, 5 éléments ; statut relu, aucune nouvelle lecture Apple déclenchée.
- Apple Notes : **REAL READ VERIFIED**, preuve antérieure côté service/state, 50 éléments retournés ; aucune nouvelle lecture Apple déclenchée.
- Capacités WRITE Apple : **non promues / non testées**.
- Noon Memory / Projects : badges `ready`, pas de nouvelle preuve de lecture utile.
- Google Calendar / Gmail / GitHub : **NOT CONNECTED / NOT TESTED**.

## CATCH-UP

REAL STARTUP CATCH-UP : **NOT VERIFIED**.
REAL 07:00 : **NOT VERIFIED**.
REAL SLEEP/WAKE : **NOT VERIFIED**.
Aucun trigger historique inventé.

## STATUTS ET BLOCAGES

**P1.2 STATUS: PARTIAL**
**P1.3 STATUS: PARTIAL**

Prérequis restants : installer le package corrigé dans `/Applications/Noon.app`, refaire la comparaison ASAR, effectuer l’audition avec choix explicite de l’utilisateur, puis réaliser les essais vocaux et visuels dans cette application.

L’audition préparée au tour précédent se lance depuis le dépôt avec :

```sh
node scripts/audition-voice.js "$HOME/Library/Application Support/Noon"
```

Elle n’a pas été lancée pendant cet audit. Les résultats d’écoute ne sont pas inférés du nom d’une voix.

Aucun code modifié, aucune correction nouvelle, aucun test/build/package relancé : le problème constaté est l’identité de l’installation, pas un bug reproduit dans le bundle corrigé. Aucun remplacement d’application, reset, clean, commit ou push effectué.
