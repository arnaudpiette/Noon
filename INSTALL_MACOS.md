# Installer Noon sur macOS

Noon cible d’abord les Mac Intel (`darwin-x64`). Le serveur local est inclus dans l’application et n’exige plus de Terminal.

## Développement

1. Installer Node.js LTS et lancer `npm install`.
2. Créer `.env` à partir de `.env.example` sans le partager.
3. Lancer `npm start`.

## Application locale

- `npm run package:mac:x64` crée le `.app` dans `out/`.
- `npm run make:mac:x64` crée le DMG et le ZIP dans `out/make/`.
- `npm run verify:mac` vérifie l’absence des principaux fichiers secrets/runtime.

Le premier build est non signé. macOS peut demander une confirmation dans Réglages Système > Confidentialité et sécurité.
