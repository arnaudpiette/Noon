# Production et release macOS de Noon

Ce document décrit le pipeline réel de Noon 1.0.6. Il ne constitue pas une preuve de signature ou de notarisation : ces statuts sont produits par les scripts de vérification.

## Sources de vérité

| Responsabilité | Propriétaire canonique |
| --- | --- |
| Cycle de vie et instance unique | `electron/main.js` |
| Packaging et distribution | Electron Forge, `forge.config.js` |
| Configuration runtime | `RuntimeConfigService` |
| Secrets | Electron `safeStorage` et services de coffre |
| Santé et diagnostics | `ReliabilityEngine`, `ControlCenterService` |
| Récupération et migrations | `UpdateRecoveryEngine`, `MigrationManager` |
| Jobs | `BackgroundJobEngine` |
| Transactions et UNKNOWN_OUTCOME | `TransactionalExecutionEngine` |
| Approbations | `ApprovalEngine` |
| Extensions | `ExtensionRegistry` |
| Mode hors ligne | `LocalIntelligenceRuntime` |
| Notifications | `NotificationAttentionEngine` |
| Évaluations | `NoonEvaluationEngine` |

## Profils et identité

- `development` : DevTools autorisés, lancement par `npm start`.
- `test` : primitives testables sans service distant.
- `production` : paquet sans DevTools.
- `release` : fabrication DMG/ZIP, vérification et smoke test.
- Bundle ID stable : `com.arnaudpiette.noon`.
- Version applicative : `package.json`; versions de schéma/config/sync restent gérées par leurs registres respectifs.
- Icône application : `assets/branding/noon-app-icon-source.png` → `assets/icons/noon.icns`.
- Icône menu bar distincte : `assets/icons/noonTemplate.png` et variante Retina.

## Architectures

La machine de développement validée est Intel (`x64`). Les binaires natifs Picovoice contiennent x64 et arm64, mais l'installation actuelle de Sharp ne contient que `sharp-darwin-x64`. La release x64 est donc la seule cible localement vérifiable. Les scripts arm64 existent, mais le préflight bloque la fabrication tant que les dépendances natives arm64 ne sont pas installées dans un environnement arm64 propre. Aucun Universal build n'est annoncé.

## Pipeline reproductible

```bash
npm ci
NOON_RELEASE_ARCH=x64 npm run release:preflight
npm run build
npm run make:mac:x64
NOON_RELEASE_ARCH=x64 npm run release:verify
NOON_RELEASE_ARCH=x64 npm run release:smoke
```

`release:preflight` vérifie identité, lockfile, assets, dépendances natives et absence de fichiers runtime suivis. `release:verify` contrôle le bundle, l'architecture, les fichiers interdits et produit `out/release-manifest-x64.json`. `release:smoke` lance le vrai exécutable avec un `userData` temporaire, en mode sûr et hors appels distants, puis exige un `/health` valide.

## Signature et notarisation

La signature est activée seulement avec `APPLE_SIGN_IDENTITY`. La notarisation est activée seulement avec `APPLE_ID`, `APPLE_PASSWORD` et `APPLE_TEAM_ID`. Aucun credential n'est stocké dans le dépôt. Une release finale signée doit être contrôlée avec :

```bash
node scripts/verify-macos-package.js --require-signature
codesign --verify --deep --strict --verbose=2 out/Noon-darwin-x64/Noon.app
spctl --assess --type execute --verbose=4 out/Noon-darwin-x64/Noon.app
xcrun stapler validate out/Noon-darwin-x64/Noon.app
```

Sans ces preuves, le build est interne et non une release publique notarized. L'auto-update reste volontairement non implémenté : aucun canal signé et vérifiable n'existe encore.

## Matrice de distribution

- DMG : configuré via `@electron-forge/maker-dmg`.
- ZIP : configuré via `@electron-forge/maker-zip`.
- PKG : non configuré, sans besoin démontré.
- x64 : supporté par les dépendances installées.
- arm64 : préparé, non validé localement.
- Universal : non préparé.

## Checklist release

- [ ] `git status` examiné, données privées absentes.
- [ ] `npm ci` exécuté depuis le lockfile.
- [ ] `npm test`, `npm run eval:critical` et `npm run eval:production-hardening` passent.
- [ ] Préflight de l'architecture cible passe.
- [ ] DMG et ZIP produits.
- [ ] Bundle vérifié et manifeste archivé.
- [ ] Smoke test packagé passe avec un profil neuf.
- [ ] Migration testée sur une copie de données existantes.
- [ ] Démarrage hors ligne, sleep/wake, microphone et brief testés manuellement sur le paquet.
- [ ] Signature, Gatekeeper et notarisation vérifiés avec les commandes ci-dessus.
