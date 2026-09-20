# Noon

Noon est un assistant professionnel local Electron organisé autour des modes DA et DEV, du Focus projet, d’une mémoire courte et de journaux structurés.

## Sécurité des intégrations

Les intégrations Gmail, Calendar, Contacts, Drive, GitHub, Figma, Apple Rappels et Raccourcis utilisent une architecture commune. Les lectures autorisées sont distinctes des écritures. Toute action distante affiche un aperçu et nécessite une autorisation ponctuelle liée au contenu exact.

Le développement démarre en mode sécurisé :

```sh
DRY_RUN_EXTERNAL_WRITES=true npm start
```

Dans Electron, les jetons sont chiffrés avec `safeStorage`. En serveur Node seul, aucun jeton n’est persisté en clair.

## Commandes

```sh
npm test
npm run lint
npm run build
npm start
```

Consultez [CLOUD_INTEGRATIONS_SETUP.md](CLOUD_INTEGRATIONS_SETUP.md), [PERMISSIONS_AND_APPROVALS.md](PERMISSIONS_AND_APPROVALS.md) et [MANUAL_TEST_CHECKLIST.md](MANUAL_TEST_CHECKLIST.md) avant toute activation d’écriture externe.

Assistant local Electron avec conversations texte, pièces jointes, recherche Web, voix classique OpenAI et conversation vocale Realtime.

## Conversations et analyse locale

Les modes Chat et Assistant vocal partagent la même mémoire et les mêmes outils d’analyse en lecture seule. Noon peut explorer les projets du Focus, rechercher et lire des fichiers dans les emplacements explicitement autorisés, analyser les pièces jointes et déléguer une analyse de code approfondie à Codex. Les fichiers secrets, caches et dossiers exclus restent bloqués.

Le menu « Historique » classe les conversations dans un maximum de quinze dossiers, avec quinze conversations par dossier. « Général » reçoit automatiquement l’ancien historique. Une limite atteinte bloque la création ou le déplacement sans supprimer silencieusement de conversation. L’historique brut reste complet localement ; seule la fenêtre de contexte envoyée au modèle est bornée et résumée.

Dans les réglages macOS, « Dossiers locaux autorisés » ouvre le sélecteur natif et permet d’accorder une permission en lecture seule ou en lecture et création, puis de la révoquer immédiatement. Les outils du modèle restent en lecture seule tant qu’un workflow de création vérifié et confirmé n’est pas utilisé.

## Création de livrables

Après avoir autorisé un dossier en « lecture et création », Chat et Conversation Live peuvent créer de nouveaux fichiers DOCX, PDF, PNG, XLSX, PPTX, Markdown, HTML, RTF, TXT, JSON et CSV. Les fichiers sont générés dans un emplacement temporaire, relus ou validés selon leur format, puis renommés atomiquement. Le nom est versionné : aucun fichier existant n’est écrasé. Chaque résultat apparaît dans la conversation avec les actions Ouvrir, Finder et Copier le chemin.

## Prérequis et lancement

- Node.js récent et macOS pour l’application Electron.
- Une clé API OpenAI placée uniquement dans `.env` : `OPENAI_API_KEY=...`.
- `npm install`, puis `npm start`. Pour le serveur seul : `npm run server`, puis ouvrir `http://127.0.0.1:3000/app`.

Le port peut être remplacé pour les tests avec `NOON_PORT=3100 npm run server`.

La clé reste dans le processus serveur. Le renderer Electron utilise WebRTC et ne reçoit jamais la clé.

## Voix

Le micro classique transcrit une phrase, puis lit la réponse avec `gpt-4o-mini-tts`, une voix masculine `marin` (`cedar` en secours) et une consigne vocale masculine explicite. « Conversation Live » ouvre une session WebRTC speech-to-speech avec `gpt-realtime-2.1-mini` par défaut et conserve la même identité vocale.

Les réglages audio permettent de choisir séparément le microphone et la sortie son. Les périphériques connectés, notamment les casques et AirPods, sont actualisés automatiquement. Sur macOS, Noon demande explicitement l’autorisation du microphone et propose un accès direct aux réglages système en cas de refus.

Langues : français, anglais, espagnol (Espagne et Mexique), portugais brésilien, russe, japonais, mandarin et néerlandais. Le mode Automatique répond dans la langue détectée. L’accent est indépendant de la langue.

Commandes possibles : « Passe en mode DEV », « Passe en mode DA », « Focus sur Kasa », « Retire le Focus », « Parle anglais », « Habla español de México » ou « Parle français avec un accent russe ».

Mini privilégie coût et fluidité. Max utilise `gpt-realtime-2.1`, demande une confirmation à chaque nouvelle session et est désactivé lorsque le budget est en mode économie/protection/blocage.

## Salut Noon et point du jour

Le réveil « Salut Noon » est détecté localement avec Picovoice lorsqu’il a été configuré et activé. Après détection, Noon affiche le Brief Noon puis annonce « Bonjour Arnaud » et lit le point du jour si la réponse vocale est activée.

Le brief quotidien est programmé à `07:00` dans le fuseau `Europe/Paris`. Si l’application n’était pas lancée à cette heure, Noon rattrape une seule génération au prochain démarrage. Consultez [NOON_WAKE_WORD_SETUP.md](NOON_WAKE_WORD_SETUP.md) pour configurer le mot-clé local.

## Budget et sécurité

Le sous-budget vocal vaut 11 USD par mois par défaut (`NOON_VOICE_BUDGET_USD`). Avertissement à 70 %, protection à 90 %, blocage des nouvelles sessions à 100 %. Une session inactive ferme après deux minutes et sa durée maximale est vingt minutes; ces délais sont configurables avec `NOON_REALTIME_IDLE_TIMEOUT_MS` et `NOON_REALTIME_MAX_SESSION_MS`.

Les coûts Realtime sont enregistrés localement et ajoutés au budget général. Les réponses sont dédupliquées par identifiant. Les outils vocaux restent en lecture seule, limités aux racines autorisées; aucune commande shell ou écriture arbitraire n’est exposée.

## Registre local des projets

Le menu Focus sépare les dossiers autorisés des projets réellement détectés. Le bouton « Actualiser les projets » lance une analyse locale bornée, sans appel OpenAI. Le registre persistant `projects-registry.json` est ignoré par Git.

La détection utilise un score fondé sur Git, `package.json`, README, Vite, `src`, frontend/backend et certaines racines créatives identifiables. `node_modules`, `.git`, builds, caches, applications macOS et fichiers secrets sont exclus. Applications et Téléchargement ne sont jamais analysés automatiquement.

Les commandes vocales peuvent sélectionner Kasa, Mon Vieux Grimoire, Qwenta, Smokonomy, Teasfolio ou le portfolio uniquement lorsque leur projet a réellement été détecté.

## Dépannage et validation matérielle

- Micro refusé : Réglages Système macOS → Confidentialité et sécurité → Microphone, puis relancer Noon.
- Réseau coupé : Noon tente deux reconnexions, puis permet de continuer en texte ou avec le micro classique.
- Pas de son : choisir la sortie audio dans les réglages Noon, vérifier la sortie macOS puis terminer/recréer la session Live.
- Lancer les contrôles automatiques avec `npm test`.

Tests manuels à faire avec un microphone : les neuf langues/variantes ci-dessus, accents russe et français, interruption pendant la parole, commandes DA/DEV et Focus, coupure réseau/reconnexion, refus du microphone et blocage du budget vocal.

## Intelligence personnelle locale

L’onglet « Personnel » regroupe le portrait opérationnel, la mémoire structurée, les projets vivants, la boîte d’entrée, les recommandations explicables et les indicateurs d’efficacité. Ces données sont enregistrées dans `personal-intelligence.sqlite` sous le dossier privé `userData` d’Electron. `long-term-memory.json` et `project-journals.json` sont importés par une migration idempotente après sauvegarde et restent conservés.

Les tendances déduites statistiquement du comportement restent des hypothèses jusqu’à confirmation. Noon peut analyser et proposer, mais ne crée aucun événement Calendar, n’envoie aucun e-mail et ne modifie aucun fichier existant sans ordre explicite. Les suggestions de créneaux sont uniquement en lecture et protègent la pause de 12 h 30 à 13 h 30.

Le runtime conversationnel peut aussi retenir automatiquement un fait durable explicitement énoncé ou extrait localement d’une pièce jointe. La sélection est déterministe et bornée : salutations, anecdotes, exemples signalés comme fictifs, informations incertaines et secrets sont exclus. Chaque écriture est relue dans SQLite avant toute notification. Les données sensibles restent chiffrées dans la mémoire privée avec la politique `local_only`, tandis qu’une décision nommant sans ambiguïté le Focus actif est associée à `project:<id>`. Les commandes naturelles de consultation, correction et oubli interrogent toujours les repositories réels.

Fonctions expérimentales, désactivées par défaut :

```sh
ENABLE_RESPONSE_COMPACTION=false
RESPONSE_COMPACTION_THRESHOLD_TOKENS=120000
ENABLE_BACKGROUND_ANALYSIS=false
NOON_MAX_PROACTIVE_NOTIFICATIONS=3
```

La compaction conserve le flux stateless `store: false` et retombe automatiquement sur la gestion actuelle si elle n’est pas supportée. Une analyse background ne démarre qu’après une action explicite. Voir [docs/personal-intelligence-architecture.md](docs/personal-intelligence-architecture.md) pour le schéma, les permissions, les migrations et les limites.
