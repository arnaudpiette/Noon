## 5 — DEUX PRIORITÉS P0 : VOIX NOON (CEDAR / NOUVEAU REALTIME) ET MODE DEV

### 5.A — P0 VOIX : Cedar maintenant, Arbor seulement si l’API le permet

**Décision ferme : l’expérience vocale est une fonctionnalité cœur, pas une amélioration cosmétique.** Elle progresse immédiatement, **en parallèle** de la tranche DEV active : ne pas casser les validations en cours, ne pas attendre Figma/SelfDev pour fiabiliser la voix.

- **Identité vocale :** choisir `cedar` comme voix explicite et cohérente, pour le TTS (`gpt-4o-mini-tts`), `gpt-realtime-2.1` et `gpt-live-1` lorsque la combinaison est acceptée par le fournisseur. La langue par défaut est le français ; timbre masculin constant, naturel, réactif ; réglages de débit et micro ne changent pas l’identité.
- **Arbor :** voix cible souhaitée mais **non listée** dans les références officielles API consultées le 12/10/2026. Ne jamais mettre `arbor` en production, ni prétendre reproduire exactement la voix de ChatGPT, sans publication officielle, accès API confirmé et essai réel. Conserver la veille de disponibilité officielle.
- **Divergence technique immédiate :** auditer `services/voice/voice-identity.js`, `docs/VOICE_IDENTITY.md`, `/tts`, Live/WebRTC, la sélection de voix et les fallbacks. La doc du dépôt faisait de Marin la voix par défaut puis Cedar le fallback ; c’est **l’inverse de la nouvelle cible**. Ne pas supprimer un fallback de sécurité sans remplacement explicite ; ne jamais laisser une autre voix s’activer silencieusement.
- **Option A à évaluer en premier : `gpt-live-1` (API Live).** Full-duplex (écoute/parole simultanées), interruptions, petits accusés de réception, délégation de calcul et d’outils au **backend Noon existant** via **client delegation**, sans recréer de cerveau parallèle. Tester l’accès réel à l’API Live sur la clé du projet. Les permissions, hard rules, Skill Registry, Goal, audit et approbations restent côté Noon.
- **Option B à évaluer : `gpt-realtime-2.1`** (modèle speech-to-speech avec raisonnement et outils), et **`gpt-realtime-2.1-mini`** pour les usages simples/budget. Ce sont les successeurs du vieux `gpt-realtime` ; tester leurs comportements plutôt que supposer une amélioration dans tous les scénarios. La famille historique `gpt-realtime` est annoncée pour arrêt le 20 janvier 2027.
- **Pas de promotion sans benchmark réel** : même scénario pour GPT-Live vs Realtime 2.1 (et la chaîne STT → Noon → TTS actuelle), en français ; délai voix, silences, interruptions, bruit, AirPods, cohérence conversation/texte, mémoire/contextes, suppression des doubles déclenchements, outils et approvals, stabilité WebRTC/reconnexion/veille, consommation API et batterie. Un jugement de qualité audio et de naturel en conditions d’usage compte davantage qu’un simple test unitaire.
- **Coûts** : GPT-Live-1 est facturé à la durée de la session (référence tarifaire 0,05 USD/minute **hors backend et outils**) ; Realtime 2.1 est facturé aux tokens de texte/audio ; prévoir plafond par session/jour et terminaison explicite des sessions inactives. Ne pas faire durer une session en arrière-plan par défaut.
- **iPhone** : partager la même identité Cedar et les règles de sécurité ; autoriser une nouvelle session après handoff Mac↔iPhone, mais ne pas promettre une continuité sans coupure du flux audio ni un hotword permanent iOS. L’application mobile pourra réutiliser le même backend Noon et ses vérifications.

**Critère de sortie VOIX P0 :** sur le Mac réel, session vocale Cedar naturelle, conversation en français avec interruption et reprise, traitement d’une tâche déléguée, refus exact d’une action sensible sans approbation, affichage de la transcription et du job, arrêt/reconnexion propres ; comparaison de latence, coût et fiabilité documentée sur au moins 10 scénarios représentatifs. Aucun changement de voix silencieux ; iPhone préparé pour le même contrat.

**Documentation officielle consultée :** [GPT-Live 1](https://developers.openai.com/api/docs/models/gpt-live-1), [démarrage GPT-Live](https://developers.openai.com/api/docs/guides/live), [sessions Live et voix](https://developers.openai.com/api/docs/guides/live-conversations), [Realtime 2.1](https://developers.openai.com/api/docs/models/gpt-realtime-2.1), [options Realtime](https://developers.openai.com/api/docs/guides/realtime-conversations), [TTS et Cedar](https://developers.openai.com/api/docs/guides/text-to-speech), [dépréciations](https://developers.openai.com/api/docs/deprecations), [tarifs](https://developers.openai.com/api/docs/pricing).

### 5.B — P0 DEV : terminer le mode DEV de manière sûre et utile

**P0 — Ne pas repartir de zéro.** La roadmap technique et ses tranches réelles priment sur un ancien ordre théorique « Sandbox puis Permission puis Goal », car plusieurs de ces éléments existent déjà.

**P0.1 — Reprise technique** : lire `AGENTS.md`, vérifier `pwd`, branche, HEAD, statut Git, diff, fichier de tâche éventuel, tests, flags, permissions, artefacts non suivis. Aucun clean/reset/commit/push non demandé. Ne pas utiliser les fichiers d’état obsolètes comme preuve du travail courant.

**P0.2 — Tranche 4.6 Goal Retry Chain V1** : `rootTaskId`, lien parent/tentative, numéro, raisons, cumulative time/cost, reliquat budgets, approbations exactes, annulation, idempotence, reprise sans replay de mutation. `RETRY_CANDIDATE` demeure une proposition ; jamais de retry implicite.

**P0.3 — Fiabilité Native DEV / Sandbox / approbations** : permission réduite par intersection, commande allowlistée, chemins canoniques, fichier cible empreinté, test/lint/build/diff, journaux bornés, pas de secrets, pas d’écrasement de dirty files. Déterminer si une isolation macOS renforcée est nécessaire avant de laisser Noon exécuter du code non fiable.

**P0.4 — Parcours Electron réel** : terminal ouvert/créé, commandes autorisées, Preview, Problems, Source Control, capture, annulation, sortie Agent Loop, affichage des justifications et frais. Protéger l’UI existante et valider l’utilisation sur l’installation actuelle.

**P0.5 — Qualité** : tests ciblés + voisins → `npm test` → lint → build → `git diff --check` → smoke packagé/manuel selon risque ; ne jamais annoncer un PASS non exécuté. Budget modèle/per task, pas de saut vers un fournisseur coûteux sans gain prouvé.

**Sortie P0 :** une demande DEV réelle devient plan vérifiable → intervention autorisée → patch délimité → tests/synthèse de preuves → verdict → éventuelle demande de correction/retry → compte rendu clair, sans faux succès ni perte du travail préexistant.

