# Étape 44 — rapport de production hardening

## Résultat exécutif

**Production readiness : `INTERNAL_ALPHA_READY`.** Le code, le package x64, le DMG et le ZIP sont générés ; 917 tests et les évaluations critiques passent. La release publique reste bloquée par l'absence de signature Developer ID/notarisation et par un smoke test packagé automatisé qui quitte avant son marqueur sur cette machine. Aucun résultat interactif voix/brief/notification n'est revendiqué.

## Baseline et environnement

- Branche : `main`, worktree déjà fortement modifié et préservé, aucun reset/clean/commit/push.
- Tests avant cette étape : 897 réussis.
- Node `v22.23.2`, npm `10.9.8`, Electron `43.4.1`, CPU `x86_64`, lockfile v3.
- Packager conservé : Electron Forge 7.11.2.
- Dépendances production : `npm audit --omit=dev` = 0 vulnérabilité.

## Build et chemins

- Profils : development, test, production et release via `NOON_BUILD_PROFILE`.
- Identité : Noon 1.0.6, `com.arnaudpiette.noon`.
- x64 : package réellement produit ; Sharp et Picovoice x64 présents.
- arm64 : scripts préparés, préflight bloquant tant que Sharp arm64 n'est pas installé ; non testé.
- Universal : non supporté/revendiqué.
- ASAR : actif ; `@img` et `@picovoice` ciblés hors archive pour leurs natifs.
- Ressources applicatives : résolues depuis `__dirname`/bundle.
- Données : `app.getPath("userData")`; aucune dépendance au `cwd` en runtime Electron.
- Migration legacy : copie validée et sauvegardée, originaux conservés ; aucune migration destructive ajoutée.

## Electron hardening

| Contrôle | État réel |
| --- | --- |
| contextIsolation | true |
| nodeIntegration | false |
| sandbox | true |
| webSecurity | true |
| navigation | page Noon exacte seulement ; externe HTTPS via navigateur système |
| window.open | refusé dans Electron |
| permissions | origine Noon, notifications et audio uniquement ; vidéo refusée |
| DevTools | development/test seulement |

Le preload expose uniquement : statut/préférences, visibilité fenêtre, état Live, wake word, statut/écriture chiffrée des clés, partage borné, réglages système allowlistés, permissions locales explicites et actions d'artefact bornées. Chaque channel `noon:*` est maintenant enveloppé par validation d'origine exacte, limite de 512 Kio et rate limit. Le test « renderer compromis » refuse une origine externe avec zéro effet.

La CSP limite scripts/connect/media à l'origine, interdit object/frame/base et navigation embarquée. `unsafe-inline` reste présent uniquement pour les styles actuels (dette P1). Le renderer contient encore certains `innerHTML` historiques protégés par `escapeHtml`; leur suppression progressive est une dette, pas un changement de cette étape.

## Permissions et secrets

| Permission | Nécessaire | Demande | Refus |
| --- | --- | --- | --- |
| Microphone | voix/wake word | démarrage actuel | chat écrit reste disponible |
| Notifications | brief/réponses | usage système | interface seulement |
| Screen Recording | non | jamais | sans effet |
| Accessibility | non | jamais | sans effet |
| Automation | non | jamais | sans effet |
| Files/Folders | sélection utilisateur | dialogue explicite | racine non ajoutée |

Entitlements réels : JIT/mémoire exécutable Electron, entrée audio, réseau client et serveur loopback. Aucun secret de signature ou API n'est packagé. OpenAI/Picovoice utilisent `safeStorage`; les jetons restent dans `userData`. Scan de motifs secrets : aucun secret réel détecté ; une chaîne factice de test uniquement. Aucun fichier runtime privé suivi par Git selon le préflight.

## Serveur local et cycle de vie

- Bind strict : `127.0.0.1`; port quotidien 3000 ; aucun wildcard CORS.
- Auth : secret aléatoire `safeStorage`, header injecté uniquement vers l'origine Noon ; routes mutantes protégées.
- Instance unique : `requestSingleInstanceLock`; seconde instance réveille la fenêtre.
- Fermeture fenêtre : application/tray restent actifs. Quit complet : timers, wake word, raccourcis, tray, jobs et serveur arrêtés.
- « Salut Noon » : peut fonctionner fenêtre masquée si le processus tourne et la préférence est active ; impossible après Quit complet.
- Login item : implémenté, opt-in/préférence existante.
- Sleep/wake : arrêt voix/wake sur suspend/verrouillage, reprise différée et contrôle du brief ; code testé statiquement, parcours packagé interactif non testé.
- Safe mode : désactive wake word, brief automatique et jobs autonomes, sans supprimer de données.
- Crash marker atomique : `starting` → `running` → `clean`; un arrêt non propre est journalisé sans rejeu aveugle.

## Récupération, base et logs

- Jobs/approbations/transactions/sync conservent leurs propriétaires canoniques ; `UNKNOWN_OUTCOME` n'est pas rejoué automatiquement (tests existants).
- SQLite utilise transactions/WAL et les services de migration/sauvegarde existants ; aucune base vide silencieuse ajoutée.
- Logs : `<userData>/logs/noon.log`, 512 Kio, 5 rotations, rétention par rotation, clés et chemins utilisateur redacted.
- Crash reporting distant : non implémenté ; `startup-error.log` local et redacted à améliorer.

## Packaging, signature et distribution

- Package x64 : produit, 372 Mio ; une première build de 559 Mio a révélé `Archive.zip` embarqué et a été rejetée, puis la règle d'exclusion a été corrigée.
- DMG 1.0.6 : produit, 142 Mio.
- ZIP 1.0.6 : produit, 142 Mio.
- PKG : non configuré.
- Vérification : bundle ID/version/arch/contenu/manifeste PASS.
- Signature Developer ID : non configurée/non vérifiée. Une signature ad hoc a seulement été tentée pour le smoke local et ne vaut pas une signature de release.
- Hardened runtime : configuré uniquement lorsqu'une identité de signature est fournie ; non vérifié sur ce build.
- Notarisation/stapling/Gatekeeper : non configurés/non vérifiés, credentials absents.
- Auto-update : volontairement non implémenté faute de canal de mise à jour signé et rollbackable.
- CI : aucun workflow CI trouvé.

## Tests packagés et performances

| Scénario | x64 | arm64 | signé Developer ID | notarized | Résultat |
| --- | --- | --- | --- | --- | --- |
| Construction bundle | oui | non | non | non | PASS |
| DMG + ZIP | oui | non | non | non | PASS |
| Vérification identité/secret/arch | oui | non | non | non | PASS |
| Démarrage isolé + `/health` | tenté | non | non | non | FAIL : processus quitte avant marqueur |
| Offline packagé | non | non | non | non | NON TESTÉ |
| Voix packagée | non | non | non | non | NON TESTÉ |
| Daily Brief packagé | non | non | non | non | NON TESTÉ |
| Notifications packagées | non | non | non | non | NON TESTÉ |
| Control Center packagé | non | non | non | non | NON TESTÉ |
| Extensions packagées | non | non | non | non | NON TESTÉ |

Les hooks mesurent désormais process→serveur et process→fenêtre dans les logs, mais aucune mesure packagée valide n'a été obtenue. CPU/RAM idle/chat/voice et fuites listener/timer/socket/renderer n'ont pas été mesurés : aucune valeur n'est inventée. Volumes finaux : bundle 372 Mio, `app.asar` 48 Mio, DMG/ZIP 142 Mio. La réduction des plateformes natives inutiles et des locales reste P1.

## Vérifications

- `npm run build` : PASS.
- `node --test test/production-hardening.test.js test/control-center.test.js` : 20/20 PASS.
- Suite complète finale : 917 tests, 917 pass, 0 fail.
- `npm run eval:critical` : 54 PASS, 0 warning/fail/error.
- `npm run eval:production-hardening` : 5 PASS, 0 warning/fail/error.
- `npm audit --omit=dev` : 0 vulnérabilité.
- `git diff --check` : PASS.
- Command injection : aucune exécution shell depuis un payload renderer ajoutée ; `spawn` release utilise une liste d'arguments constante.
- Path traversal : actions d'artefact et racines locales passent par `realpath` et vérification de racine ; tests existants PASS.

## Release blockers et dette

### BLOCKER

1. Signature Developer ID et notarisation absentes.
2. Smoke test du vrai bundle non concluant ; donc clean install/existing data/offline non validés sur le paquet.

### WARNING

1. arm64 non construit ; Sharp arm64 absent de cette installation.
2. Voix, Daily Brief, notifications, sleep/wake et Control Center non validés interactivement dans le paquet.
3. Bundle volumineux et CSP styles encore permissive.

### INFO

1. DMG/ZIP x64 et release manifest sont opérationnels.
2. Auto-update reste intentionnellement désactivé.

## Fichiers propres à l'étape 44

- `electron/production-hardening.js`, `electron/main.js`
- `forge.config.js`, `package.json`
- `scripts/release-preflight.js`, `scripts/verify-macos-package.js`, `scripts/packaged-smoke.js`
- `test/production-hardening.test.js`
- `services/evaluation/noon-evaluation-engine.js`, `test/evals/scenarios/core-scenarios.js`
- `public/index.html`, `server.js`
- `docs/PRODUCTION_RELEASE.md`, `docs/PRODUCTION_SECURITY.md`, `docs/RECOVERY_AND_SAFE_MODE.md`

Les autres changements du worktree appartiennent aux étapes précédentes et ont été préservés.

## Prochaine étape

La prochaine étape prévue est **NOON — ÉTAPE 45 — Final Integration, Architecture Freeze & V1 Release Readiness**. Elle n'a pas été commencée.
