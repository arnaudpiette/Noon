# Compagnon iPhone V1 — audit et design

**Statut au 22/11/2026 : GELÉ** (Roadmap V3, voir `docs/DECISIONS.md`). Côté Mac livré jusqu'à IP-3 (flag `remote.lan` OFF) ; application iOS non commencée. Chantier parallèle V2 de la roadmap (chapitre 8,
« non décalable en V3 »). Ce document s'appuie sur ce qui existe déjà côté Mac
(`MULTI_DEVICE_SYNC.md`, `REMOTE_INTERACTION_HANDOFF.md`) et décrit ce qui manque pour un
premier usage réel. Il ne crée ni compte, ni service cloud, ni accès distant au shell.

## 1. Objectif et critère de sortie

Critère de la roadmap : *démarrer une conversation sur le Mac, la reprendre sur l'iPhone, lire
le Brief et l'état d'une tâche, perdre puis retrouver le réseau, et révoquer l'iPhone sans
fuite — sur un appareil physique.*

Le Mac reste l'unique autorité : connecteurs, secrets, mémoire privée, exécution. L'iPhone
affiche, converse et demande ; l'appairage ne donne jamais le droit d'exécuter.

## 2. Audit de l'existant

| Brique | Fichiers | État |
|---|---|---|
| Politique de synchronisation par type de donnée | `services/sync/sync-policy.js` | Livrée, testée ; mémoire privée, tokens et chemins interdits |
| Identité, appairage court à usage unique, scopes, révocation | `services/sync/device-registry.js`, `device-identity-store.js` | Livré ; voir l'écart 3.1 |
| Enveloppes signées Ed25519, chiffrées X25519 + HKDF-SHA256 + AES-256-GCM | `services/sync/sync-crypto.js` | Livré ; compatible CryptoKit (§6) |
| Journal, curseurs, conflits, tombstones | `services/sync/sync-engine.js`, `sync-repository.js` | Livré en SHADOW |
| Interaction distante (TEXT, VOICE, MEDIA, UI_ACTION, APPROVAL_RESPONSE, JOB_CONTROL), anti-rejeu, reprise de flux | `services/remote/*` | Livrée en SHADOW, transports simulés |
| Handoff par références | `services/remote/handoff-service.js` | Livré en SHADOW |
| Flags | `sync.*` en SHADOW, `sync.remoteRequests` OFF, `remote.interaction/text/jobs/handoff` en SHADOW, `remote.media/approvals/voice` OFF, `notifications.mobile` OFF | — |

**Manque pour un usage réel** : un transport réseau, une authentification du Mac auprès de
l'iPhone, une interface d'appareils, l'application iOS, et la sortie du mode SHADOW pour les
seuls flux du MVP.

### 3.1 Écart de sécurité : authentification du Mac

`beginPairing` authentifie l'appareil auprès du Mac (clés publiques, code à usage unique,
approbation explicite). Rien ne prouve en revanche à l'iPhone qu'il parle au bon Mac : sur un
réseau réel, un tiers pourrait s'interposer pendant l'appairage. Le design ajoute une
**invitation** émise par le Mac (§4) qui épingle la clé du Mac avant tout échange.

## 4. Appairage

1. Sur le Mac (Control Center, section « Appareils »), l'utilisateur crée une invitation :
   QR code contenant l'adresse LAN et le port de la passerelle, l'empreinte SHA-256 des clés
   publiques du Mac, un jeton d'invitation aléatoire (usage unique, 5 minutes) et la version
   de protocole.
2. L'iPhone scanne le QR, génère ses clés (Keychain, non exportables) et appelle `pair/begin`
   avec son identité et le jeton. Il vérifie que les clés renvoyées par le Mac correspondent à
   l'empreinte du QR ; sinon il abandonne.
3. Les deux écrans affichent un **code de vérification à 6 chiffres**, dérivé des deux clés et
   du jeton (SHA-256 tronqué). L'utilisateur confirme sur le Mac que les codes sont identiques,
   choisit les scopes (sous-ensemble de ceux demandés), puis approuve : `approvePairing`.
4. Révocation depuis le Mac (et « oublier ce Mac » sur l'iPhone) : effet immédiat sur les
   émissions, refus de toute enveloppe ultérieure de l'appareil.

## 5. Transport : passerelle LAN

- **Écouteur séparé** du serveur local de Noon (`server.js` n'est jamais exposé au réseau) :
  `services/remote/remote-lan-gateway.js`, flag `remote.lan` **OFF** par défaut, démarré
  seulement si le flag est actif et arrêté par le kill switch.
- **Réseau local uniquement** : adresses privées IPv4/IPv6 acceptées, toute autre origine
  refusée ; aucun port public, aucune redirection, aucun UPnP.
- **Routes minimales**, toutes à corps borné et limitées en débit :
  `POST /v1/pair/begin` (seule route non chiffrée, exige un jeton d'invitation valide),
  `POST /v1/envelopes` (enveloppes signées et chiffrées : entrées distantes, synchronisation),
  `GET /v1/outputs?after=<séquence>` (attente bornée des sorties, reprise par séquence).
- **Sécurité par enveloppes plutôt que TLS en V1.** Node ne sait pas générer de certificat
  X.509 sans dépendance supplémentaire, et un certificat auto-signé n'apporterait rien de plus
  ici : chaque requête et chaque réponse est une enveloppe `sync-crypto` signée par une clé
  épinglée à l'appairage et chiffrée pour le destinataire, avec anti-rejeu (nonce, séquence,
  expiration) déjà en place. Le relais éventuel (hors V1) ne verrait que des enveloppes.
- **Découverte** : pas de mDNS en V1 (il faudrait une dépendance et la découverte n'authentifie
  rien) ; l'adresse vient du QR. Si l'adresse du Mac change, l'iPhone propose de rescanner une
  invitation de reconnexion.
- **macOS** : l'écoute réseau d'Electron déclenche l'alerte du pare-feu macOS à la première
  activation ; à vérifier dans l'app packagée.

## 6. Interopérabilité cryptographique (Node ↔ CryptoKit)

À figer par des vecteurs de test partagés (JSON) exécutés des deux côtés.

- **Clés** : Node échange des PEM (SPKI pour les clés publiques). CryptoKit manipule des clés
  brutes de 32 octets : l'iPhone les enveloppe en SPKI avec les préfixes DER
  `302a300506032b6570032100` (Ed25519) et `302a300506032b656e032100` (X25519), puis en PEM.
- **Dérivation** : X25519 éphémère → HKDF-SHA256 (sel de 16 octets, info
  `noon-sync-envelope-v1`, 32 octets) → AES-256-GCM (nonce de 12 octets, étiquette de 16 octets).
- **Données authentifiées et signature** : JSON canonique — clés triées récursivement, sans
  espaces, comme `JSON.stringify` de Node. Côté Swift, `JSONEncoder` avec `.sortedKeys` **et**
  `.withoutEscapingSlashes` ; les en-têtes signés ne contiennent que des chaînes et des
  entiers (pas de flottants, dont la sérialisation diffère).
- **Signature** : Ed25519 sur le JSON canonique de l'enveloppe sans le champ `signature`.

## 7. Périmètre du MVP

| Fonction | Canal / flux existant | Flag pour l'appareil appairé |
|---|---|---|
| Lire le Daily Brief du jour | Sync (lecture, métadonnées + texte du Brief) | nouveau scope dédié, LIMITED |
| Conversations texte et reprise | `TEXT`, `sync.conversations` | `remote.text`, `sync.conversations` LIMITED |
| Handoff Mac ↔ iPhone | `handoff-service` | `remote.handoff` LIMITED |
| État des tâches | `JOB_CONTROL` (statut seulement) | `remote.jobs` LIMITED, annulation hors V1 |
| Approbations, médias, voix | `APPROVAL_RESPONSE`, `MEDIA`, `VOICE` | restent OFF en V1 |
| Notifications push | APNs | hors V1 (`notifications.mobile` OFF) |

Toute entrée distante repasse par le pipeline canonique (Intent, Security Policy, Hard Rules,
Approval, Execution) avec l'origine `trusted_paired_device` ; une action sensible renvoie une
demande d'approbation **sur le Mac** en V1. Aucune commande mutante n'est rejouée au retour du
réseau ; l'iPhone affiche explicitement « hors ligne » et l'âge des données.

## 8. Application iOS

- **SwiftUI natif**, iOS 17 minimum, sans dépendance tierce : CryptoKit, Keychain (clés non
  exportables, `ThisDeviceOnly`), Data Protection pour le cache local.
- **Écrans** : Appairage (scan, code de vérification), Brief, Conversations (avec reprise et
  état « interrompu »), Tâches (statut), Réglages (Mac appairé, oublier ce Mac).
- **Premier plan uniquement en V1** : iOS ne garantit ni connexion permanente ni hotword en
  arrière-plan ; l'app se resynchronise à l'ouverture.
- **Cache minimal** : dernier Brief, conversations récentes autorisées ; jamais de mémoire
  privée, de token ou de chemin du Mac. « Oublier ce Mac » efface clés et cache.

## 9. Tranches

1. **IP-1 — Passerelle et invitation, côté Mac (sans iOS).** *Livré le 21/11/2026* :
   `services/remote/remote-lan-gateway.js` et `test/remote-lan-gateway.test.js`, flag
   `remote.lan` (OFF) ; non encore démarré par Noon : l'écoute réelle et les commandes
   d'administration arrivent avec la section « Appareils » (IP-3). `remote-lan-gateway.js` derrière
   `remote.lan` (OFF), invitation QR et code de vérification, routes bornées, réseau local
   uniquement. Tests avec un client Node qui imite l'iPhone : clés brutes enveloppées en SPKI,
   JSON canonique, appairage, rejeu, révocation, origine non privée refusée.
2. **IP-2 — Vecteurs d'interopérabilité.** *Livré le 21/11/2026* :
   `test/fixtures/remote-interop-vectors.v1.json`, produit de façon déterministe par
   `services/remote/remote-interop-vectors.js` (`npm run remote:vectors`, `--check` pour vérifier)
   à partir du code de production. Contenu : clés brutes et PEM des deux appareils, JSON
   canonique, empreinte du QR, code de vérification, QR complet, corps de `pair/begin`, deux
   enveloppes (iPhone → Mac, Mac → iPhone) avec chaque étape intermédiaire (secret X25519, clé
   HKDF, AAD, octets signés) et trois enveloppes altérées à refuser. Clés de test publiques.
   `test/remote-interop-vectors.test.js` les revérifie indépendamment ; les tests Swift (IP-4)
   rejoueront le même fichier.
3. **IP-3 — Section « Compagnon iPhone » du Control Center.** *Livré le 21/11/2026* :
   `services/remote/remote-lan-service.js` (composition), `remote-lan-http-routes.js`
   (`/api/remote-lan/*`, serveur local uniquement), `public/iphone-companion-ui.js`.
   Démarrage **manuel uniquement** (jamais automatique, rien n'écoute avant le clic),
   écoute liée à l'adresse IPv4 privée du Mac (en0 en priorité, jamais `0.0.0.0`, port 47830,
   `NOON_REMOTE_LAN_PORT` pour le changer), identité du Mac dans le coffre safeStorage (refus de
   démarrer sans coffre persistant), invitation en QR (SVG dessiné côté interface, dépendance
   `qrcode-generator` MIT sans dépendance), comparaison du code, scopes cochés explicitement,
   refus, révocation, kill switch. Seule enveloppe traitée : `remote.ping` ; le reste répond
   `REMOTE_LAN_NOT_SUPPORTED` jusqu'à IP-4/IP-5. Non vérifié : alerte du pare-feu macOS et
   comportement dans l'app packagée.
4. **IP-4 — Application iOS : appairage et Brief.** Projet Xcode, sur le Mac et un iPhone réel.
5. **IP-5 — Conversations et handoff, puis état des tâches.**
6. **Validation** du critère de la roadmap sur appareil physique, coupure réseau comprise.

## 10. Distribution sans compte Apple Developer payant (décision du 21/11/2026)

Pas de compte payant pour l'instant. V1 utilise donc le **provisionnement gratuit de Xcode**
(compte Apple ordinaire) : l'app installée sur l'iPhone expire au bout de 7 jours et doit être
re-signée ; au plus 3 apps ainsi installées. Ce mode suffit au MVP, qui n'utilise pas les
notifications push (APNs exige un compte payant). Le renouvellement hebdomadaire peut être
automatisé par un outil de re-signature en Wi-Fi depuis le Mac (de type AltStore/SideStore),
au choix de l'utilisateur. Le passage à un compte payant reste possible plus tard sans changer
l'architecture.
