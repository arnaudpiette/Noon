# Sauvegarde et restauration

Les données internes résident dans le dossier `userData` de l’application. La migration initiale copie les anciens JSON, valide leur contenu et conserve les originaux ainsi qu’une sauvegarde.

Le gestionnaire interne crée un manifeste versionné et un checksum SHA-256 pour chaque JSON. Une restauration doit toujours afficher un aperçu, créer une sauvegarde de sécurité et demander une confirmation renforcée. Les secrets, caches, fichiers audio, projets complets et pièces jointes sont exclus.

Une archive portable devra être chiffrée avec une phrase secrète non enregistrée dans l’archive avant toute utilisation réelle.
