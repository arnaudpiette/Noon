# Synchronisation multi-appareils de Noon

## Statut

Le moteur est livré en **SHADOW** par défaut. Aucun fournisseur cloud réel n'est configuré et aucune donnée n'est envoyée hors de la machine. Le transport disponible est un relais loopback de test. Le Mac principal reste la source canonique et Noon continue de fonctionner entièrement hors ligne.

## Architecture

- `SyncPolicy` classe chaque type d'entité et applique les interdictions avant journalisation, chiffrement et émission.
- `SyncRepository` conserve appareils, pairing, révisions logiques, journal, outbox, inbox appliquée, curseurs, conflits et requêtes distantes dans SQLite.
- `DeviceRegistry` gère une identité stable, un pairing court, à usage unique, explicitement approuvé, des scopes minimaux et la révocation.
- `SyncCrypto` signe avec Ed25519 et chiffre chaque enveloppe avec X25519, HKDF-SHA256 et AES-256-GCM. Les clés de synchronisation sont distinctes des clés de mémoire privée.
- `SyncEngine` produit des changements de référence, applique la politique à la source et à la destination, chiffre les lots, déduplique, fusionne et conserve les conflits.
- `LoopbackSyncTransport` simule hors-ligne, doublons, réordonnancement, pagination et reprise par curseur sans réseau réel.

## Source de vérité et périmètre initial

| Donnée | Source canonique | Politique initiale |
| --- | --- | --- |
| Conversations et messages | Mac principal | Autorisée par scope |
| Workspaces / dossiers | Mac principal | Métadonnées seulement |
| Statut des jobs | Nœud d'exécution | Métadonnées seulement, jamais le payload |
| Notifications | Mac principal | Métadonnées seulement |
| Artefacts | Mac principal | Métadonnées ; blob sur demande explicite |
| Mémoire privée, profils protégés | Stockage privé local | Interdite |
| Tokens OAuth/API, secrets d'approbation | Trousseau/local | Interdits |
| Racines et chemins du système de fichiers | Machine locale | Interdits |
| Réglages de périphériques audio et flags runtime | Appareil local | Local uniquement |

Les profils Alexandra, Sinan et Kaan sont refusés par défaut. Une politique de consentement dédiée devra précéder toute extension de ce périmètre.

## Sécurité

Une enveloppe contient seulement des identifiants et métadonnées visibles nécessaires au routage ; son payload est chiffré et sa signature couvre l'enveloppe entière. Le relais ne reçoit jamais le clair. Une altération, une mauvaise clé ou une signature invalide bloque l'application. Une révocation bloque immédiatement les nouvelles émissions vers l'appareil.

Une requête distante authentifiée n'est **jamais exécutée** par le moteur de synchronisation. Elle est enregistrée avec l'origine `trusted_paired_device` et l'état `PENDING_SECURITY_POLICY`. Une future couche Remote Interaction devra la faire repasser par l'Intent Engine, l'Operational Security Policy, les Hard Rules, l'Approval Engine et l'Execution Engine.

## Conflits et suppressions

Les messages sont append-only. Les métadonnées sont fusionnées par champ à l'aide de versions logiques. Deux modifications concurrentes du même champ créent un conflit `NEEDS_USER`. Les statuts de jobs utilisent la version la plus récente. Les suppressions créent des tombstones conservés 90 jours par défaut et empêchent la résurrection silencieuse.

## Rollout et kill switch

Les flags `sync.engine`, `sync.conversations`, `sync.workspaces` et `sync.jobs` commencent en `SHADOW`. `sync.remoteRequests` reste `OFF`. En SHADOW, le moteur journalise seulement une référence de changement, sans dupliquer le payload et sans remplir l'outbox. Passer `sync.engine` à `OFF` constitue le kill switch local.

## Limites explicites

- Aucun backend cloud, compte utilisateur, push Apple ni découverte réseau n'est fourni.
- L'écran complet de gestion des appareils et conflits n'est pas encore construit.
- Le snapshot initial expose actuellement un manifeste versionné ; un transport distant devra paginer et chiffrer les entités demandées.
- La rotation coordonnée des clés entre appareils est préparée par les identités et la révocation, mais aucun protocole de rotation distribué n'est activé.
- Les requêtes distantes restent des contrats authentifiés non exécutables.

## Vérification

```sh
node --test test/multi-device-sync.test.js
npm run eval:sync
npm test
```
