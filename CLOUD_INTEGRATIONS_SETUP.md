# Connexions cloud de Noon

Noon démarre avec `DRY_RUN_EXTERNAL_WRITES=true`. Les lectures peuvent être testées après connexion, mais les écritures restent simulées.

## Google Workspace

1. Dans Google Cloud Console, créer ou sélectionner un projet privé.
2. Activer Gmail API, Calendar API, Drive API et People API.
3. Configurer l’écran de consentement OAuth pour votre compte de test.
4. Créer un client OAuth local et enregistrer `http://127.0.0.1:3000/integrations/google/callback`.
5. Placer l’identifiant et le secret dans `.env`, jamais dans une conversation ou Git.
6. Pour Gmail, Noon demande uniquement `gmail.readonly`. Cette permission permet de rechercher et lire le contenu des messages du compte autorisé, sans envoyer, modifier ni supprimer d’e-mail.
7. Dans cette installation, le compte accepté est strictement `arno.piette@gmail.com`. Toute connexion avec un autre compte est refusée.
8. Ouvrir **Réglages → Intégrations → Gmail → Connecter**, puis valider personnellement l’écran de consentement Google.

Le contenu des messages sélectionnés par une recherche peut être transmis à OpenAI afin de produire la réponse demandée. Les jetons OAuth sont chiffrés localement avec le Trousseau macOS et ne sont jamais ajoutés à Git.

## GitHub

Utiliser d’abord `gh auth login` puis `gh auth status`. Ne jamais afficher `gh auth token`. Si un token est indispensable, utiliser un token finement limité au dépôt et aux permissions nécessaires. Staging, commit, push et pull request exigent des confirmations séparées. Force-push et réécriture d’historique restent impossibles.

## Figma

Créer une application OAuth Figma, déclarer le callback local, puis renseigner les variables `FIGMA_*` dans `.env`. La première version utilise `file_content:read`, `file_metadata:read` et, si nécessaire, `file_comments:read`. Les URL sont limitées à HTTPS et aux domaines Figma.

## Stockage

Dans Electron, les tokens sont chiffrés avec `safeStorage` et le Trousseau macOS. En mode serveur Node seul, ils restent uniquement en mémoire et la persistance est signalée comme indisponible.
