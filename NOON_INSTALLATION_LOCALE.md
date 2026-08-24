# Installation locale de Noon

## Installation

Construire avec `npm run make:mac:x64`, puis lancer `sh scripts/install-local-macos.sh`. Le script demande confirmation, quitte Noon, sauvegarde l’application existante avec un horodatage, installe `/Applications/Noon.app` et la relance.

## Mise à jour et restauration

Les sauvegardes sont nommées `/Applications/Noon-backup-AAAAMMJJ-HHMMSS.app`. Pour restaurer, quitter Noon, déplacer la version actuelle ailleurs, puis renommer la sauvegarde en `/Applications/Noon.app`. Ne jamais supprimer automatiquement `~/Library/Application Support/Noon` : ce dossier conserve préférences, clés chiffrées, mémoire et modèles locaux.

## Autorisations et ouverture de session

Autoriser le microphone dans Réglages Système → Confidentialité et sécurité → Microphone. L’option de lancement à l’ouverture est volontaire et désactivée par défaut. Si macOS exige une validation, ouvrir Réglages Système → Général → Ouverture.

## Désinstallation

Quitter complètement Noon depuis la barre de menus, puis déplacer `/Applications/Noon.app` dans la Corbeille. Les données personnelles restent conservées tant qu’Arnaud ne choisit pas manuellement de les supprimer.
