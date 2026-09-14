# Instructions Electron pour Noon

Les règles de `AGENTS.md` situé à la racine restent applicables. Ce fichier ajoute des contraintes spécifiques au sous-système Electron. `AGENTS_ARCHITECTURE.md` décrit les agents internes de Noon et ne doit pas être remplacé par ce fichier. En cas de règle plus restrictive ici, respecter la règle la plus restrictive.

## Frontières d’architecture

- Respecter strictement la séparation entre processus main, preload et renderer.
- Préserver `electron/main.js`, `electron/preload.js` et l’architecture actuelle.
- Préserver les frontières IPC existantes.
- Privilégier des API IPC minimales, bornées, validées et orientées vers un besoin précis.
- Ne jamais exposer directement au renderer des secrets, tokens, clés API ou objets Node sensibles.
- Ne pas exposer de shell arbitraire.
- Ne pas donner au renderer un accès direct et non contrôlé au système de fichiers.
- Ne pas contourner les contrôles du preload, les permissions ou les approbations via une nouvelle API.
- Ne pas réécrire entièrement un gros fichier lorsqu’une modification locale suffit.

## Validation Electron et packaging

- Vérifier les conséquences sur Electron Forge après toute modification Electron.
- Vérifier les chemins de ressources en développement et dans l’application packagée.
- Prendre en compte macOS x64 et arm64; ne pas annoncer une architecture comme validée sans preuve correspondante.
- Prendre en compte les permissions macOS et leurs effets sur l’application réelle.
- Pour toute modification Electron importante, prévoir des tests en développement puis, lorsque pertinent, dans `Noon.app`.
- Une fonctionnalité qui fonctionne uniquement avec `npm start` ne doit pas être déclarée validée pour l’application packagée.

Commandes existantes pertinentes : `npm start`, `npm run start:safe`, `npm run package:mac:x64`, `npm run package:mac:arm64`, `npm run make:mac:x64`, `npm run make:mac:arm64`, `npm run release:preflight`, `npm run release:verify`, `npm run release:smoke`, `npm run verify:mac`, `npm run install:local`.
