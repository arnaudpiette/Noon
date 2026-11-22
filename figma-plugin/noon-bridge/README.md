# Noon Bridge — plugin Figma de Noon

Plugin privé qui relie Figma Desktop à Noon, sur ce Mac uniquement (127.0.0.1:3856).
Version 0.1 : lecture de la page et de la sélection. L'écriture arrivera derrière une validation dans Noon.

## Installer (une fois)

1. Dans Noon, active l'option `figma.bridge` (mode `LIMITED`), puis redémarre Noon.
2. Dans Figma Desktop, ouvre un fichier Design, puis
   **Plugins → Development → Import plugin from manifest…**
   et choisis `figma-plugin/noon-bridge/manifest.json` dans le dossier Noon.

## Jumeler

1. Noon : **Control Center → Figma → « Générer un code »** (valable 5 minutes).
2. Figma : **Plugins → Development → Noon Bridge**, saisis le code, puis « Jumeler ».
3. Le plugin affiche « Connecté à Noon ». Dans Noon, « Tester la lecture » doit répondre.

Garde la fenêtre du plugin ouverte pendant que Noon travaille dans Figma.
« Dissocier » (dans Noon ou dans le plugin) révoque le jeton.

## Sécurité

- Le plugin ne parle qu'à 127.0.0.1:3856 (manifeste `devAllowedDomains`).
- Seules les commandes de la liste blanche de `code.js` existent.
- Le jeton est gardé dans le stockage local du plugin ; Noon n'en garde que l'empreinte.
