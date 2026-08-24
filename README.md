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

## Prérequis et lancement

- Node.js récent et macOS pour l’application Electron.
- Une clé API OpenAI placée uniquement dans `.env` : `OPENAI_API_KEY=...`.
- `npm install`, puis `npm start`. Pour le serveur seul : `npm run server`, puis ouvrir `http://127.0.0.1:3000/app`.

Le port peut être remplacé pour les tests avec `NOON_PORT=3100 npm run server`.

La clé reste dans le processus serveur. Le renderer Electron utilise WebRTC et ne reçoit jamais la clé.

## Voix

Le micro classique transcrit une phrase, puis lit la réponse avec `gpt-4o-mini-tts` et la voix `cedar` (`marin` en secours). « Conversation Live » ouvre une session WebRTC speech-to-speech avec `gpt-realtime-2.1-mini` par défaut.

Langues : français, anglais, espagnol (Espagne et Mexique), portugais brésilien, russe, japonais, mandarin et néerlandais. Le mode Automatique répond dans la langue détectée. L’accent est indépendant de la langue.

Commandes possibles : « Passe en mode DEV », « Passe en mode DA », « Focus sur Kasa », « Retire le Focus », « Parle anglais », « Habla español de México » ou « Parle français avec un accent russe ».

Mini privilégie coût et fluidité. Max utilise `gpt-realtime-2.1`, demande une confirmation à chaque nouvelle session et est désactivé lorsque le budget est en mode économie/protection/blocage.

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
- Pas de son : vérifier la sortie audio macOS et terminer/recréer la session Live.
- Lancer les contrôles automatiques avec `npm test`.

Tests manuels à faire avec un microphone : les neuf langues/variantes ci-dessus, accents russe et français, interruption pendant la parole, commandes DA/DEV et Focus, coupure réseau/reconnexion, refus du microphone et blocage du budget vocal.
