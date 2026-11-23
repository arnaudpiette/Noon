# Noon Bridge — plugin Figma de Noon

Plugin privé qui relie Figma Desktop à Noon, sur ce Mac uniquement (localhost:3856).
Version 0.2 : lecture (page, sélection, élément détaillé, styles et variables) et écriture validée :
Noon prépare un plan (créer cadres, rectangles, textes ; modifier nom, position, taille, couleur,
arrondi, texte, police, mise en page automatique, visibilité), tu le valides dans le chat
(« Confirmer exactement »), puis le plugin l'applique d'un bloc — un seul Cmd+Z l'annule.
Aucune suppression. Le plugin fonctionne en mode Design (pas en Dev Mode).

Après une mise à jour du plugin : ferme sa fenêtre et relance Plugins → Development → Noon Bridge.

## Installer (une fois)

1. Dans Noon, active l'option `figma.bridge` (mode `LIMITED`), puis redémarre Noon.
2. Dans Figma Desktop, ouvre un fichier en mode Design (pas Dev Mode : Maj+D), puis
   **Plugins → Development → Import plugin from manifest…**
   et choisis `figma-plugin/noon-bridge/manifest.json` dans le dossier Noon.

## Jumeler

1. Noon : **Control Center → Figma → « Générer un code »** (valable 5 minutes).
2. Figma : **Plugins → Development → Noon Bridge**, saisis le code, puis « Jumeler ».
3. Le plugin affiche « Connecté à Noon ». Dans Noon, « Tester la lecture » doit répondre.

Garde la fenêtre du plugin ouverte pendant que Noon travaille dans Figma.
« Dissocier » (dans Noon ou dans le plugin) révoque le jeton.

## Sécurité

- Le plugin ne parle qu'à localhost:3856 (manifeste `devAllowedDomains` ; Figma refuse les adresses IP).
- Seules les commandes de la liste blanche de `code.js` existent.
- Le jeton est gardé dans le stockage local du plugin ; Noon n'en garde que l'empreinte.
