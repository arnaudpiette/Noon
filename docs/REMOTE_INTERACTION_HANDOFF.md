# Remote Interaction & Handoff

## Statut réel

L'étape 35 livre les contrats et le moteur local/provider-agnostic. Les transports `LOCAL_NETWORK`, `SECURE_RELAY` et `SYNC_MAILBOX` sont des mocks en mémoire : aucune socket réseau, aucun relais cloud, aucun serveur LAN et aucune application iOS ne sont activés. Tous les flags Remote sont `SHADOW` ou `OFF` par défaut.

## Séparation des responsabilités

- **SyncEngine** réplique l'état durable autorisé.
- **RemoteInteractionEngine** authentifie une interaction utilisateur distante et la transmet au pipeline Noon.
- **RemoteTransportRouter** choisit un transport disponible sans modifier `requestId` ni l'intention.
- **SessionContinuityEngine** reste la source de vérité de la session logique.
- **Conversation Store** reste la source de vérité du message final ; les deltas ne sont que temporaires.
- **NoonOrchestrator**, Intent, Security, Approval, Execution, Jobs et Multimodal restent les seules autorités métier.

## Contrats

`RemoteInput` contient : `remoteInputId`, `deviceId`, `deviceSessionId`, `channel`, `conversationId`, `workspaceId`, `payload`, `timestamp`, `expiresAt`, `sequence`, `requestId`, `nonce`, `signature`, `protocolVersion`.

Canaux : `TEXT`, `VOICE`, `MEDIA`, `UI_ACTION`, `APPROVAL_RESPONSE`, `JOB_CONTROL`.

`RemoteOutput` contient : `remoteOutputId`, `requestId`, `conversationId`, `type`, `payloadRef`, `sequence`, `final`, `createdAt`, `protocolVersion`.

Le payload persistant reste une référence minimale. Les sorties possibles couvrent deltas/final texte, événements voix, jobs, approvals, médias, erreurs et présence.

## Authentification et idempotence

Chaque entrée est signée Ed25519 par un appareil appairé. Le DeviceRegistry vérifie l'état et le scope correspondant au canal. Le repository refuse ou déduplique `requestId`, `remoteInputId` et nonce. Pairing et présence ne valent jamais approbation métier.

## Stream et reprise

Les sorties reçoivent une séquence monotone par requête. Le client peut reprendre après une séquence connue. Les deltas ne sont pas une source de vérité. Le final est d'abord confié au Conversation Store, puis annoncé avec un `messageId` stable. Une interruption doit être marquée `interrupted` ; elle ne devient jamais silencieusement un final complet.

## Présence, connexion et handoff

Connexion : `DISCONNECTED`, `CONNECTING`, `CONNECTED`, `DEGRADED`, `RECONNECTING`.

Présence : `ACTIVE`, `IDLE`, `BACKGROUND`, `OFFLINE`, `UNKNOWN`, `STALE`. Une présence dépassant le TTL devient `STALE`, sans modifier les permissions.

Le handoff contient uniquement des IDs et références : conversation, session, workspace, dernier message, tâche, artefact, jobs et résumé. `Continue` réutilise un handoff unique ; plusieurs handoffs actifs provoquent une clarification.

## Transport et réseau

Le routeur préfère LAN, puis relay, puis mailbox async. La bascule conserve la même requête et session logique. Cette politique est testée uniquement avec mocks. Une future implémentation LAN devra utiliser TLS avec authentification/pinning de l'identité appareil ; la découverte mDNS ne constituera jamais une authentification. Un futur relay ne devra voir que des frames chiffrées et un minimum de métadonnées.

## Voix

Le canal `VOICE` prépare un pipeline push-to-talk/foreground : transcript distant → Intent Engine → Noon → réponse texte/audio via la même `VoiceIdentity`. Un changement de modèle ne change pas la voix. Un handoff voix redémarrera une nouvelle connexion Realtime sur la cible tout en conservant la session logique ; aucun transfert transparent du flux audio n'est promis. iOS ne permet pas de garantir un hotword permanent en arrière-plan.

## Médias

Seul un média explicitement sélectionné est accepté. Le hash SHA-256 est vérifié avant écriture temporaire et avant MultimodalEngine. Une corruption bloque l'analyse. L'origine est `USER_UPLOAD_REMOTE_DEVICE` et le contenu reste une preuve non fiable. Aucun scan de photothèque, presse-papiers ou écran n'existe.

## Jobs, artefacts et services Mac

Le mobile peut demander un statut ou une annulation uniquement avec `REMOTE_JOBS`; le BackgroundJobEngine reste propriétaire du job. Une perte de connexion n'arrête pas le job. Les artefacts ne sont représentés que par métadonnées/ID ; un futur téléchargement devra être court, lié à l'appareil, mono-usage et vérifié par hash.

Gmail, Calendar, Notes, Reminders, Personal Search, Git et Codex restent exécutés sur le Mac. Leurs tokens, chemins et capacités brutes ne sont jamais transférés. Aucun shell, SSH, remote desktop, shutdown ou mise à jour distante n'est exposé.

## Approvals

Les approvals distantes restent `OFF`. Le service préparé exige : scope `REMOTE_APPROVALS`, approval existante, non expirée, fingerprint exact, réponse Ed25519 signée et nonce inédit. Seul ApprovalEngine peut accepter/refuser ; l'exécution repasse ensuite par Security et TransactionalExecution. Face ID/Touch ID nécessitera ultérieurement une attestation réelle, jamais une simple chaîne déclarative.

## Confidentialité des sorties

`LOCAL_ONLY`, `LOCAL_ONLY_DERIVED`, `PROTECTED` et `SECRET` sont bloqués. Une référence source local-only bloque aussi la réponse dérivée. Les profils protégés restent refusés par défaut. La télémétrie ne contient ni messages, transcripts, médias, résultats, approval contents, clés, nonces ni chemins.

## Rollout

- `remote.interaction`, `remote.text`, `remote.jobs`, `remote.handoff` : `SHADOW`.
- `remote.media`, `remote.approvals`, `remote.voice` : `OFF`.
- `OFF` coupe immédiatement le moteur.
- `SHADOW` authentifie et normalise sans appeler la logique métier.
- `LIMITED` et `ON` permettent l'exécution uniquement pour les appareils/scopes explicitement configurés.

## Limites

- pas d'UI mobile ni d'écran Electron de gestion Remote ;
- pas de transport réseau réel, TLS, mDNS, push Apple ou relay ;
- pas de chunk upload/reprise, seulement un transfert mock borné ;
- pas de TTS distant ni WebRTC mobile actif ;
- pas de notification lock-screen réelle ;
- pas de queue offline de commandes mutantes ; elles ne sont donc jamais exécutées tardivement ;
- le moteur est injectable mais n'est pas exposé comme nouvelle route HTTP publique.

## Vérification

```sh
node --test test/remote-interaction-engine.test.js
npm run eval:remote
npm run eval:critical
npm test
```
