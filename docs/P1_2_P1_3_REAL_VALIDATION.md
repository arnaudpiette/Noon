# P1.2 / P1.3 — correction et validation du 5 septembre 2026

## VOICE

**Statut : PARTIAL — écoute manuelle NOT EXECUTED.** Aucune nouvelle voix masculine n’a été sélectionnée sans l’utilisateur.

Cause établie de la divergence entre rapport et application : `/Applications/Noon.app/Contents/Resources/app.asar` ne contient pas `services/voice/voice-identity.js`. Son serveur impose `marin` dans Realtime et essaie `[marin, cedar]` en TTS. Son renderer possède aussi une sélection de voix système indépendante. La configuration du dépôt ne prouvait donc pas celle du bundle installé. L’attribution de la voix féminine à un appel précis reste **non prouvée** : aucune capture audio ni trace du payload de cette session ne permet de départager le timbre de `marin` et le fallback système.

Le parcours réellement codé est `WakeWordService.detected → noon://wake → greetArnaudWithDailyBrief → speakNoon → POST /tts → audio PCM`. Il ne crée pas une session Realtime. Conversation Live suit `liveVoiceButton → VoiceIdentity → POST /realtime/session → /v1/realtime/calls → WebRTC`. Les deux chemins convergent sur VoiceIdentity dans le dépôt corrigé.

| PATH | VOICE VALUE | USED BY | CANONICAL/LEGACY |
|---|---|---|---|
| services/voice/voice-identity.js | marin par défaut ; choix sauvegardé commun TTS/Realtime | toutes les résolutions | CANONICAL, défaut non validé à l’écoute |
| `<NOON_DATA_DIR>/voice-identity.json` | choix utilisateur validé dans le catalogue commun | chargement par VoiceIdentity au démarrage | CANONICAL, aucune sélection effectuée pendant cet audit |
| services/voice/realtime-config.js | instructions issues de VoiceIdentity ; aucune voix littérale | instructions Live | CANONICAL |
| server.js `/realtime/session` | `resolvedVoice.voice` dans `audio.output.voice` | OpenAI Realtime | CANONICAL |
| server.js `/tts` | `attempt.voice`, deux essais du même locuteur | Chat, lecture du brief, wake word | CANONICAL |
| public/live-voice.js | résolution serveur + voix confirmée par événement provider | audio WebRTC | CANONICAL ; déconnexion si divergence |
| public/app.js | header réel, aucune valeur de remplacement | métriques TTS | CANONICAL |
| public/app.js, avant correction | Thomas/Nicolas/Daniel/Alex/Olivier/Henri/Paul/Jacques/Cedar/Marin puis première voix française ou système | secours speechSynthesis | LEGACY supprimé |
| VoiceIdentity, avant correction | cedar après deux essais marin | secours TTS | changement de locuteur supprimé |
| application installée, server.js | marin ; puis cedar en TTS | bundle ancien | LEGACY toujours installé |
| application installée, public/app.js | sélection système indépendante | secours système | LEGACY toujours installé |
| .env / .env.backup / .env.example / config.js | aucun sélecteur Voice/TTS/Realtime trouvé | configuration | aucun override vocal identifié |
| tests et scénarios d’évaluation | marin, cedar et autres valeurs de fixture | tests uniquement | NON RUNTIME |
| scripts/audition-voice.js | catalogue commun exporté par VoiceIdentity | audition manuelle explicitement lancée | OUTIL MANUEL, aucun moteur ajouté |

OpenAI documente 13 voix TTS et 10 voix Realtime. Le catalogue commun utilisé pour l’audition est `alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar`. `fable, nova, onyx` ne sont pas sélectionnables pour une identité commune. Les catalogues ne constituent pas une classification fiable du genre perçu. Même nom ne signifie pas rendu acoustique identique entre modèles. Le payload impose la voix ; aucune omission volontaire ne laisse le provider choisir sa valeur par défaut.

Sources : [TTS OpenAI](https://developers.openai.com/api/docs/guides/text-to-speech), [Realtime OpenAI](https://platform.openai.com/docs/api-reference/realtime).

### Audition et choix persistant

Depuis le dépôt, avec `OPENAI_API_KEY` disponible (le script charge `.env`) :

```sh
node scripts/audition-voice.js "$HOME/Library/Application Support/Noon"
```

Le script propose chaque voix du catalogue commun, appelle le provider, joue le WAV via `afplay`, puis permet uniquement de sauvegarder une voix dont la lecture a réussi. Entrée vide à la fin conserve la configuration. Une erreur provider est affichée et ne choisit aucune autre voix. La disponibilité réelle est donc vérifiée lors de l’audition, sans prétendre que toutes les voix sont accessibles au compte.

Pour un lancement du serveur depuis ce dépôt sans `NOON_DATA_DIR`, passer le chemin du dépôt à la place. Redémarrer l’application corrigée après le choix. Le bundle ancien actuellement installé ne lit pas ce choix ; produire un package ne remplace pas `/Applications/Noon.app`.

| Test audible requis | Résultat |
|---|---|
| Chat → lecture TTS | NOT EXECUTED |
| Conversation Live | NOT EXECUTED |
| « Salut Noon » | NOT EXECUTED |
| Nouvelle session après fermeture de fenêtre | NOT EXECUTED |
| Restart complet puis nouvelle session | NOT EXECUTED |

La conservation du choix est testée par deux nouveaux processus Node, pas par une écoute après restart Electron. Le fallback est désormais un retry du même locuteur ; l’indisponibilité reste visible et ne déclenche pas de voix système.

## DAILY BRIEF UI

Cause : affectation directe du contenu à `personalBriefContent.textContent`. Aucun renderer Markdown existant n’a été trouvé dans les utilitaires de présentation. Ajout d’un renderer DOM limité dans `public/ui-utils.js`, appelé uniquement pour le brief personnel. `DailyBriefEngine` n’est pas modifié.

- Markdown : **PASS AUTOMATED** — h1/h2/h3, gras, italique, listes à puces et numérotées, paragraphes.
- XSS : **PASS AUTOMATED** — aucune interprétation HTML, uniquement éléments autorisés et nœuds texte ; script, img/onerror et URL javascript restent du texte inerte. Aucun nouveau lien cliquable n’est créé ; les liens de sources existants conservent leur mécanisme HTTPS et l’ouverture externe Electron.
- Loading / état « Brief prêt » : **PASS AUTOMATED**, test exécutant la fonction réelle `loadCreativeBrief` avec un DOM de test.
- generatedAt : **PASS AUTOMATED**, valeur d’origine intacte ; jamais recalée à 07:00.
- Rendu visuel dans l’application packagée : **NOT VERIFIED**.

## CATCH-UP

Preuves lues sans modifier les données :

- `~/Library/Application Support/Noon/logs/noon.log`, ligne 169 : `server-started` à `2026-09-05T09:28:06.880Z`, soit **11:28:06 Europe/Paris**.
- `personal-brief.json` : `lastAttemptAt=2026-09-05T09:28:42.909Z`, `lastSuccessAt=2026-09-05T09:28:54.785Z`.
- Brief `c800232b-2c88-4468-b3c1-bdbc628dcb4a` : `date=2026-09-05`, `generatedAt=2026-09-05T09:28:54.785Z`, soit **05/09/2026 11:28:54**. Pas de champ `briefDate` distinct ; la clé métier est `date`.
- Un seul brief du 5 septembre est conservé ; l’entrée précédente date du 3 septembre. Pas de snapshot de l’état immédiatement avant lancement.
- Le bundle installé exécute encore `/brief/generate` puis `/personal-brief/generate`, et non le DailyBriefEngine canonique du dépôt. Cela correspond au format UUID observé dans le state.

Trigger : **startup catch-up probable**, cohérent avec démarrage tardif et ancien scheduler, mais aucune trace ne distingue startup, action manuelle ou autre déclencheur gagnant. La notification est conditionnelle dans le code ; son émission effective n’est pas journalisée.

**REAL STARTUP CATCH-UP → NOT VERIFIED**. Absence du brief avant lancement : non prouvée directement. Duplicate brief : **NO dans l’état conservé**, nombre d’exécutions historiques non prouvé. Notification : **NOT VERIFIED**. **REAL 07:00 → NOT VERIFIED** pour cette version corrigée. **REAL SLEEP/WAKE → NOT VERIFIED**. Les traces anciennes à 07:00 ne valident pas le bundle corrigé.

La déduplication same-day et les appels concurrents sont couverts par `test/daily-brief-engine.test.js` ; ce sont des preuves automatisées, pas la reconstitution du trigger du 5 septembre.

## SOURCES

Le state réel correspond exactement aux badges rapportés. Inspection de `capture` dans le service packagé : `ready` avec `count` n’est produit qu’après résolution de l’opération de lecture ; une erreur produit `unavailable`.

- Apple Reminders : **lecture réelle confirmée côté service/state**, 5 éléments retournés par le connecteur osascript.
- Apple Notes : **lecture réelle confirmée côté service/state**, 50 éléments retournés ; limite et parsing du connecteur, pas preuve d’exhaustivité de la bibliothèque.
- Noon Memory : `ready` est ajouté statiquement après `localContext()` ; **lecture individuelle / contenu utile NOT VERIFIED**.
- Projects : même limite ; **lecture individuelle / contenu utile NOT VERIFIED**.
- Google Calendar : **NOT CONNECTED**, non testé.
- Gmail : **NOT CONNECTED**, non testé.
- GitHub : **NOT CONNECTED**, non testé.

La matrice conserve Notes/Reminders en PARTIAL mais précise cette preuve réelle de lecture. Aucun statut opérationnel global ni validation des écritures ou du refus de permission n’en découle.

## REGRESSION

Résultats finaux consignés à la fin de ce rapport. Aucun reset, clean, commit, push, nouveau moteur, travail Gmail/Calendar ou remplacement de l’application installée.

- `npm test` : **PASS, 934/934**, aucun skip. Inclut redémarrage du choix vocal en nouveaux processus, absence de sélecteur legacy dans les chemins runtime, Markdown/XSS/états/timestamp, catch-up same-day après réinstanciation du moteur et absence de seconde collecte/génération.
- `npm run eval:critical` : **PASS, 54/54**, aucun warning/error/skip.
- `npm run build` : **PASS** (scripts lint et lint:release du dépôt).
- `npm run lint` : **PASS** ; syntaxe du script d’audition également vérifiée.
- `npm run package:mac:x64` : **PASS** après relance avec accès réseau ; première tentative limitée par résolution réseau. Artefact : `out/Noon-darwin-x64/Noon.app`.
- `npm run verify:mac` : **PASS**, x86_64, version 1.0.6, aucun blocker ; avertissement signature absente/invalide, non notarisé.
- Comparaison ASAR/local : **MATCH** pour server.js, VoiceIdentity, app.js, ui-utils.js et live-voice.js.
- `git diff --check` : **PASS**.

STOP. Validation acoustique et choix utilisateur restent nécessaires ; aucun statut VOICE VERIFIED n’est attribué.
