# Audit de parité fonctionnelle Noon

Audit fondé sur le code de Noon 1.0.6 au 25 août 2026. « Parité » désigne ici une alternative locale réaliste, pas l’accès aux fonctions propriétaires de ChatGPT.

| Fonction | Comportement attendu | État actuel de Noon | Preuve dans le code | Statut | Manque constaté | Correction réalisée | Test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Conversation texte | Envoyer, annuler, réessayer | Responses API, contrôleur Abort et reprise du brouillon | `server.js` `/ai`, `/ai/stream`; `public/app.js` `sendQuestion` | Fonctionnel | — | Flux SSE et erreurs conservés | `npm test` |
| Réponses en streaming | Affichage progressif | SSE local et texte progressif | `server.js` `/ai/stream`, `readNoonEventStream` | Fonctionnel | — | Conservé | Test manuel |
| Historique brut | Persister sans couper les messages | JSON atomique par session | `conversation-memory.json`, `rememberConversation` | Fonctionnel | Ancienne fenêtre de 30 échanges confondue avec le stockage | Historique brut conservé; contexte borné séparément | `conversation-index.test.js` |
| Classement | 15 dossiers × 15 conversations | Registre version 2 et Général | `lib/conversation-index.js`, routes `/conversation-folders` | Partiellement fonctionnel | Réordonnancement et glisser-déposer UI restent à finaliser | Migration, création, recherche, limites et suppression API | Tests unitaires |
| Mémoire durable | Voir, modifier, supprimer, désactiver | Éditeur local existant | `lib/long-term-memory.js`, `/memory`, panneau Réglages | Fonctionnel | Exclusion conversation par conversation absente | Aucun changement destructif | `long-term-memory.test.js` |
| Contexte long | Résumé progressif sans perdre le brut | 30 échanges/48 k caractères + résumé local | `getConversationHistory`, `conversation-summaries.json` | Fonctionnel | Résumé heuristique, non sémantique | Séparation brut/contexte corrigée | `noon-intelligence.test.js` |
| Pièces jointes | Plusieurs formats et comparaison | 3 fichiers, texte, image, PDF, bureautique, tableurs | `validateAttachment`, `prepareAttachments` | Fonctionnel | Dépend de la compatibilité Responses API du format | Outils locaux restent disponibles avec pièces jointes | Tests serveur + manuel |
| Markdown | Markdown nettoyé, code, tableaux | Renderer DOM sécurisé, liens HTTPS | `renderNoonResponse`, `escapeHtml`, CSP | Partiellement fonctionnel | Coloration syntaxique et mathématiques avancées absentes | XSS et liens externes bornés | `ui-utils.test.js` |
| Recherche Web | Sources cliquables et quota | `web_search`, sources, 2 appels/question | `askAI`, `extractWebSources` | Fonctionnel | Internet requis | Conserve les outils locaux en parallèle | Test manuel |
| Outils locaux | Lire/rechercher/expliquer un projet | Outils en lecture seule + Focus + Codex | `NOON_TOOLS`, `ask_codex`, `lib/path-utils.js` | Fonctionnel | Pas d’écriture arbitraire | Chat et voix partagent le moteur | Tests sécurité |
| Création de fichiers | Livrables vérifiés et atomiques | DOCX, PDF, PNG, XLSX, PPTX et formats texte reliés au Chat et à la voix | `services/production/artifact-generator.js`, outil `create_artifact` | Fonctionnel | Les mises en page complexes restent simples | Écriture temporaire, validation, versionnage et cartes de fichiers | `artifact-generator.test.js` |
| Génération d’images | API d’image | Aucun flux complet connecté | — | Manquant | Nécessite une API et une UI dédiées | Non simulé | — |
| Voix classique | Transcription et réponse masculine | Transcribe + TTS, périphériques configurables | `/transcribe`, `/tts`, `getNoonAudioConstraints` | Fonctionnel | Test matériel requis | Marin/Cedar et sélection périphérique conservés | Checklist manuelle |
| Voix Realtime | Audio bidirectionnel, interruption, transcript | WebRTC, reconnexion, outils via `ask_noon_brain` | `public/live-voice.js`, `/realtime/session`, `/realtime/tool` | Fonctionnel | Dépend réseau/API/micro macOS | Même mémoire et outils que Chat | `security-and-realtime.test.js` |
| Dossiers locaux | Accès explicitement borné | Racines configurées, realpath, exclusions | `config.js`, `lib/path-utils.js`, `isPathAllowed` | Partiellement fonctionnel | Sélecteur natif d’autorisation lecture/création absent | Aucun accès global ajouté | `projects-registry.test.js` |
| Permissions sensibles | Confirmation avant écriture externe | Approval manager lié au contenu | `services/approvals/approval-manager.js` | Fonctionnel | Certaines intégrations restent non connectées | Conservé | `integrations-and-workflows.test.js` |
| Brief 7 h | Paris, rattrapage, idempotence, notification | Planificateur Electron et store daté | `electron/main.js`, `lib/creative-brief.js` | Fonctionnel | Contenu dépend des sources connectées | Reprise veille et notification conservées | `creative-brief.test.js` |
| Intégrations | Gmail, Calendar, Drive, GitHub, Figma, Rappels | Connecteurs et statuts présents | `services/connectors/*` | Partiellement fonctionnel | OAuth/configuration externe nécessaire selon service | Gmail lecture seule consolidé | Tests intégrations |
| Sécurité Electron | Isolation, preload minimal, CSP | Sandbox, CSP, navigation bloquée, coffre macOS | `electron/main.js`, `electron/preload.js`, `public/index.html` | Fonctionnel | Signature/notarisation de diffusion non configurée | Conservé | `electron-app-core.test.js`, packaging |
| Notifications | Réponse et brief | Notification Web/macOS opt-in | `notifyAnswerReady`, `Notification` Electron | Fonctionnel | Autorisation macOS | Conservé | Test manuel |
| Coûts | Tokens, transcription, Realtime, Web | Budgets locaux et quotas | `getBudgetStatus`, `getVoiceBudgetStatus` | Fonctionnel | Estimation selon tarifs configurés | Conservé | Tests Realtime |

## Limites de produit

- Les fonctions propriétaires sans API publique ne sont pas revendiquées.
- Noon n’obtient jamais un accès automatique à tout le Mac.
- Les générateurs produisent des livrables structurés simples. La mise en page éditoriale complexe et la modification d’images existantes restent une phase dédiée.
- La gestion par dossiers dispose du stockage et des API sûres ; le déplacement par glisser-déposer, les instructions par dossier et les références par dossier restent à compléter.
